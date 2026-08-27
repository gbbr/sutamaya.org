import { useEffect, useRef, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { AlertTriangle, ArrowLeft, Check, CloudOff, Download, Info, LogOut, Minus, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData, type SyncStatus } from '../context/UserDataContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { EmailCodeSignIn } from '../components/EmailCodeSignIn';
import { dataApi } from '../lib/api';
import { flatSuttaOrder } from '../lib/corpus';
import { isTypingTarget } from '../lib/shortcuts';
import { isIosBrowserTab } from '../lib/localAccount';
import { hasLocalWorkWorthKeeping } from '../lib/keepSafe';
import {
  cachedCorpusVersions,
  estimateOfflineStatus,
  isOfflineTextStale,
  prefetchAllSuttas,
  prefetchDictionary,
  prefetchHelpImages,
  recordCachedCorpusVersion,
} from '../lib/offline';
import type { AppTheme } from '../lib/types';

const UI_SCALE_MIN = 0.85;
const UI_SCALE_MAX = 1.4;
const UI_SCALE_STEP = 0.05;

// Sutta text + dictionary shards combined (see build:corpus's text-shards and dict-shards
// manifests) — hardcoded rather than fetched, since it only moves a little between corpus
// refreshes and isn't worth a manifest round trip just to show a "~X MB" estimate.
const TOTAL_DOWNLOAD_MB_ESTIMATE = 50;

// Each theme is previewed as a miniature of the shell itself — a narrow tree-pane band of rows
// beside the wider paper surface, drawn in that theme's own palette — rather than named in a
// filled button, so the choice is made by looking rather than by reading. Same idea as the
// reader's own swatch picker (ReaderMenuPanel's THEME_SWATCHES), with the shell's colours instead
// of the reader's.
//
// The colours are literals rather than the `--paper`/`--treepane`/`--ink` custom properties they
// mirror, because every tile has to render in its own theme at once while the page as a whole is
// in only one of them.
interface ShellPalette {
  paper: string;
  pane: string;
  ink: string;
  accent: string;
}
const LIGHT_SHELL: ShellPalette = { paper: '#FBF9F5', pane: '#E9E4DA', ink: '#1B1917', accent: '#7A5B2E' };
const DARK_SHELL: ShellPalette = { paper: '#171513', pane: '#1E1B17', ink: '#E4DFD8', accent: '#C49A61' };

// `palettes` is what the tile is drawn in: one for a pinned theme, two for System, which shows the
// same miniature with the light half on the left and the dark half on the right — the OS's own
// Light/Dark/Auto convention. The reader's picker deliberately has no System tile; this is the
// shell's setting only.
const THEME_OPTIONS: Array<{ id: AppTheme; label: string; palettes: ShellPalette[] }> = [
  { id: 'light', label: 'Light', palettes: [LIGHT_SHELL] },
  { id: 'dark', label: 'Dark', palettes: [DARK_SHELL] },
  { id: 'system', label: 'System', palettes: [LIGHT_SHELL, DARK_SHELL] },
];

// Every section is one of these: a panel holding rows split by hairlines. Each theme lifts the
// card off the page from its own end of the brightness scale — light mode fills it with `field`,
// which is whiter than `paper`; dark mode tints with `ink` at very low alpha, which lightens
// there. Either way it stays barely distinct from the page on purpose: the border is what draws
// the card, and the fill only has to keep it from reading as an empty outline. Border and
// background are left to the caller: the flashed-on-arrival state (see cardClass) swaps both, and
// transitioning them is why every card carries the transition here rather than only the two that
// can flash.
const CARD = 'rounded-field border px-5 transition-colors duration-[1200ms] ease-out';
// The two halves of that fill, as one class the flashed and unflashed paths can share.
const CARD_FILL = 'bg-field dark:bg-ink/[.02]';

// Primary is reserved for the one action a card is actually asking for; secondary is the plain
// outlined full-width shape for everything else that still deserves that much weight. Export and
// Sign out don't — neither is what a card is asking the reader to do — so they're plain icon+text
// links instead (LINK_ACTION), sized like inline text rather than a button.
const PRIMARY_BUTTON =
  'flex items-center justify-center gap-1.5 w-full py-[12px] rounded-field bg-accent hover:bg-accent/90 text-[#FBFAF7] font-sans text-ui-base font-medium';
const SECONDARY_BUTTON =
  'flex items-center justify-center gap-1.5 w-full py-[12px] rounded-field border border-ink/[.18] font-sans text-ui-base font-medium text-ink hover:text-ink hover:bg-ink/[.04]';
// The UI scale steppers. No border or radius of their own: they're segments inside one bordered,
// rounded group (see the UI scale row), which draws the outline and the hairlines between them.
const UI_SCALE_STEP_BTN =
  'flex items-center justify-center w-12 h-10 text-ink hover:bg-ink/[.04] disabled:opacity-35 disabled:hover:bg-transparent';
// Underlined to match the app's existing convention for small inline actions (EmailCodeSignIn's
// "Resend code"/"Use a different email") — without it, the icon was the only thing marking these
// as clickable rather than descriptive text.
// Held at ink-2 rather than the ink-3 used for this page's descriptive labels: these are the
// two things someone comes to this section to *do*, and at label weight they read as disabled.
const LINK_ACTION = 'inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 underline decoration-ink/40 hover:text-ink';
// Danger-text is reserved on this page for something actually wrong right now (a lapsed session, a
// failed download, the iOS eviction warning) — not a standing "this button is risky" tint, which
// would fight with those real warnings when one is showing alongside it. Sign out only borrows it
// once armed (confirmSignOut), matching the same-colored warning line that appears above it at
// that point; at rest it reads the same as Export.
const LINK_DANGER =
  'inline-flex items-center gap-1.5 font-sans text-ui-base text-danger-text underline decoration-danger-text/40 hover:text-danger-text';

// The tree-pane band and paper surface of one theme-tile miniature. Every tile lays this out at
// the tile's full width, so the System tile's two halves — each clipping one of them to its own
// side — line their rows up exactly across the seam and only the palette changes there.
function ShellMiniature({ p }: { p: ShellPalette }) {
  return (
    <>
      <span className="w-[34%] flex flex-col justify-center gap-[5px] px-2" style={{ background: p.pane }}>
        <span className="h-[4px] w-[78%] rounded-full" style={{ background: p.ink, opacity: 0.28 }} />
        <span className="h-[4px] w-[56%] rounded-full" style={{ background: p.accent }} />
        <span className="h-[4px] w-[66%] rounded-full" style={{ background: p.ink, opacity: 0.28 }} />
      </span>
      <span className="flex-1 flex flex-col justify-center gap-[6px] px-2.5" style={{ background: p.paper }}>
        <span className="h-[5px] w-[58%] rounded-full" style={{ background: p.ink, opacity: 0.75 }} />
        <span className="h-[4px] w-full rounded-full" style={{ background: p.ink, opacity: 0.2 }} />
        <span className="h-[4px] w-[85%] rounded-full" style={{ background: p.ink, opacity: 0.2 }} />
      </span>
    </>
  );
}

// Separates the two sign-in methods without ranking them — they're alternatives, not a primary
// and a fallback.
function SignInDivider() {
  return (
    <div className="flex items-center gap-3 my-3.5">
      <span className="h-px flex-1 bg-ink/[.12]" />
      <span className="font-sans text-ui-xs uppercase tracking-wider text-ink-4">or</span>
      <span className="h-px flex-1 bg-ink/[.12]" />
    </div>
  );
}

// The two sections this page can be deep-linked into and highlighted on arrival — see the
// scroll/flash effect below.
type ScrollTarget = 'offline' | 'auth';

// Delegates to '/', which RestoreLastLocation (App.tsx) already resolves to
// getLastLocation() ?? '/browse/dn' — reusing that instead of duplicating the same fallback
// chain here.
function backToLastLocation() {
  navigate('/');
}

// A short, coarse "how stale might this be" readout for the sync line below — exact-to-the-minute
// precision isn't the point, just whether it was a moment ago or a while ago.
function formatSyncedAt(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// One line describing the offline-sync queue (see docs/offline-sync.md's "Sync state"). The full
// sentences live here and nowhere else: the library's footer row (components/DataLocationRow.tsx)
// carries the same states in two or three words and links here, so this is where someone who wants
// to know what "Not synced" actually means finds out.
function syncStatusLine(
  status: SyncStatus,
  pendingCount: number,
  lastSyncedAt: string | null,
): { Icon: typeof RefreshCw; spin: boolean; text: string } {
  if (status === 'offline') {
    return { Icon: CloudOff, spin: false, text: "Offline — changes are saved locally and will sync when you're back online." };
  }
  if (status === 'pending') {
    return { Icon: RefreshCw, spin: true, text: `Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}…` };
  }
  return {
    Icon: Check,
    spin: false,
    text: lastSyncedAt ? `Last synced ${formatSyncedAt(lastSyncedAt)}.` : 'Not synced yet.',
  };
}

export function SettingsPage({ location }: RouteComponentProps) {
  const { user, logout, loading, authError } = useAuth();
  const { uiScale, theme, setUiScale, setTheme } = useUiPrefs();
  const { corpus } = useCorpus();
  const { syncStatus, pendingCount, lastSyncedAt, needsReauth, lists, notes, highlights } = useUserData();

  // The one gate on every "your data is only on this device" warning — the header banner, the
  // account badge's dot and both warning lines in the Account card below. A reader who hasn't
  // made anything yet has nothing to lose, so none of them appear.
  const hasLocalWork = hasLocalWorkWorthKeeping(lists, notes, highlights);

  // Stepped rather than dragged: applying a scale rewrites the viewport meta tag's
  // `initial-scale` on iOS Safari (see applyUiScale in lib/uiPrefs.ts), and WebKit needs a frame
  // to reflow against it — one discrete commit per tap gives it that, where a slider fired a
  // dozen a second. Rounded back onto the step grid so repeated 0.05 additions can't drift off
  // it in binary floating point.
  const stepUiScale = (delta: number) => {
    const next = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, uiScale + delta));
    setUiScale(Math.round(next / UI_SCALE_STEP) * UI_SCALE_STEP);
  };

  // Second click arms the sign-out button when there is unsynced work to lose — see the button.
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const [offlineStatus, setOfflineStatus] = useState<'idle' | 'downloading'>('idle');
  // done/total are bytes across the shard bundles being downloaded (see lib/offline.ts), not
  // sutta counts — a shard-count-of-4000+ progress readout doesn't mean much to a reader, a
  // percentage does.
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [cachedStatus, setCachedStatus] = useState<{ cached: number; total: number } | null>(null);
  // Read during render rather than held in state: it's a synchronous localStorage compare, and
  // every event that can change it (a finished download) already re-renders this page via
  // setCachedStatus. Only ever true for a device that completed a bulk download — see
  // cachedCorpusVersions.
  const textStale = !!corpus && isOfflineTextStale(corpus.dataVersion);
  const [failedCount, setFailedCount] = useState(0);
  const [circuitTripped, setCircuitTripped] = useState(false);
  const [dictionaryFailed, setDictionaryFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Lets an entry point elsewhere in the app — the offline-download nudge in TreePane, or a
  // sign-in prompt (ReaderMenuPanel, ListMembershipPicker, the account badge — see
  // promptGoogleSignIn in AuthContext) — land here already scrolled to, and briefly
  // highlighting, the specific section it was actually about, rather than just the page top.
  // Both refs are attached unconditionally (see the Offline/Authentication sections below, and
  // note the Authentication section renders a stable placeholder rather than collapsing to
  // nothing while `loading`), so the scroll effect further down never has to wait on anything
  // async.
  const offlineSectionRef = useRef<HTMLDivElement>(null);
  const authSectionRef = useRef<HTMLDivElement>(null);
  const [flashTarget, setFlashTarget] = useState<ScrollTarget | null>(null);

  useEffect(() => {
    if (!corpus) return;
    let cancelled = false;
    const uids = flatSuttaOrder(corpus);
    estimateOfflineStatus(uids)
      .then((s) => {
        if (!cancelled) setCachedStatus(s);
      })
      // estimateOfflineStatus already treats "caches unsupported" as a non-throwing 0/total
      // result — this only catches something genuinely unexpected. Without it, a failure here
      // would leave "Checking offline availability…" showing forever instead of falling back to
      // a real (if pessimistic) number.
      .catch(() => {
        if (!cancelled) setCachedStatus({ cached: 0, total: uids.length });
      });
    return () => {
      cancelled = true;
    };
  }, [corpus]);

  // Where a signed-out action sent the user here from (promptGoogleSignIn) — handed to the
  // sign-in button so the OAuth round trip returns them to it. Read once, at mount, for the same
  // reason the scroll cue below is.
  const [signInReturnTo] = useState(() => (location?.state as { returnTo?: string } | undefined)?.returnTo);

  // Scrolls to, and briefly highlights, whichever section this page was actually navigated here
  // for. Deliberately only runs once on mount (not keyed on location.state) — it's a one-shot
  // "you arrived here for a reason" cue, not something that should re-fire on unrelated re-renders.
  useEffect(() => {
    const scrollTo = (location?.state as { scrollTo?: ScrollTarget } | undefined)?.scrollTo;
    if (!scrollTo) return;
    const ref = scrollTo === 'offline' ? offlineSectionRef : authSectionRef;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlashTarget(scrollTo);
    const timer = window.setTimeout(() => setFlashTarget(null), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  // The arrival highlight is the section's own card, tinted and outlined in the accent — so it's
  // an even border all the way round by construction, with no inset padding to hand-balance, and
  // nothing moves when it fades: both properties are colours the card already has, and CARD
  // carries the transition that takes them back to rest.
  function cardClass(id: ScrollTarget): string {
    return `${CARD} ${flashTarget === id ? 'border-accent bg-accent/[.09]' : `border-ink/[.09] ${CARD_FILL}`}`;
  }

  // Aborts an in-flight download if the user navigates away from Settings. Without this, leaving
  // mid-download orphans it: abortRef is a ref, so it doesn't survive unmount, and returning to
  // Settings mounts a fresh instance with its own empty ref — able to start a second, independent
  // download racing the first, which is now unreachable by any Cancel button. Aborting on unmount
  // means "leave the page" reliably pauses the download; the resumable design (prefetchAllSuttas
  // skips whatever's already cached) makes returning and clicking again pick up where it left off.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleDownloadOffline() {
    // The ref check (not just offlineStatus) guards against a genuine re-entrant call — e.g. two
    // click events landing before React re-renders the button away — since a ref updates
    // synchronously where state doesn't. Overwriting abortRef.current with a second controller
    // here would orphan the first download's Cancel button the same way skipping the unmount
    // guard above would.
    if (!corpus || abortRef.current) return;
    const uids = flatSuttaOrder(corpus);
    // Best-effort: tied to a real user gesture around meaningful storage use, which is what
    // browsers' own persistence heuristics reward. Safari mostly no-ops this — nothing to show
    // either way, so its result isn't surfaced in the UI.
    navigator.storage?.persist?.().catch(() => {});
    const controller = new AbortController();
    abortRef.current = controller;
    setOfflineStatus('downloading');
    setProgress({ done: 0, total: uids.length });
    setFailedCount(0);
    setCircuitTripped(false);
    setDictionaryFailed(false);
    // Whenever this device can't vouch for what's already cached being current — a known-stale
    // recorded version, or no completed download to have verified it in the first place, since
    // reactively-cached suttas from ordinary browsing may predate this build — every shard is
    // refetched and overwritten in place rather than skipped. Without that, both prefetchers skip
    // what they already hold and the "refresh" reports success without replacing a stale byte.
    // Overwriting rather than deleting the cache first is what keeps a download that fails or is
    // cancelled from leaving the device with *less* offline text than it started with. The two
    // versions are tracked independently, so reworded sutta text doesn't cost a ~2.6MB dictionary
    // refetch; a matching version means an interrupted download resumes instead of restarting.
    const versions = cachedCorpusVersions();
    const forceText = versions.data !== corpus.dataVersion;
    const forceDictionary = versions.dictionary !== corpus.dictionaryVersion;
    // catch, not just finally — prefetchAllSuttas is designed to resolve normally even when
    // individual suttas fail (that's what the returned `failed` list is for), but this still
    // guards against something genuinely unexpected (e.g. Cache Storage itself unavailable)
    // turning into an unhandled rejection instead of the UI cleanly recovering to idle.
    try {
      // Run alongside the sutta shards rather than after. The reader only fetches the dictionary
      // shard each tapped word falls in, so unlike the sutta text this is rarely already complete
      // — and "download all suttas for offline" has to guarantee it before reporting done, since
      // without every shard the reader's word lookups fail in airplane mode either way.
      // The help page's screenshots ride along in the same pass — a fraction of a percent of the
      // total, and without them "download all content" would leave the guide showing broken
      // images offline. Its result isn't surfaced: see prefetchHelpImages for why illustration
      // failing doesn't deserve the same banner as missing sutta text.
      const [{ failed, circuitTripped: tripped }, dictionaryOk] = await Promise.all([
        prefetchAllSuttas(uids, {
          signal: controller.signal,
          force: forceText,
          onProgress: (done, total) => setProgress({ done, total }),
        }),
        prefetchDictionary(controller.signal, forceDictionary),
        prefetchHelpImages(controller.signal),
      ]);
      setFailedCount(failed.length);
      setCircuitTripped(tripped);
      setDictionaryFailed(!dictionaryOk && !controller.signal.aborted);
      // Recorded only on a clean finish, and each half on its own — a cancelled or partly failed
      // download leaves the previous version in place, which is exactly the "your offline copy is
      // behind" state the nudge should keep reporting until it's actually resolved.
      if (failed.length === 0 && !controller.signal.aborted) recordCachedCorpusVersion('data', corpus.dataVersion);
      if (dictionaryOk) recordCachedCorpusVersion('dictionary', corpus.dictionaryVersion);
      setCachedStatus(await estimateOfflineStatus(uids));
    } catch (e) {
      console.error('Offline download failed', e);
    } finally {
      abortRef.current = null;
      setOfflineStatus('idle');
    }
  }

  function handleCancelOfflineDownload() {
    abortRef.current?.abort();
  }

  // Same "return to wherever the user actually was" as the "Back" button above (see its own
  // comment) — Escape is the conventional "leave this screen" key. It stands down while a text
  // field has focus: the sign-in card's email and six-digit code inputs are both here, and
  // abandoning the page mid-entry would throw away a code the user has to request again.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isTypingTarget(e)) backToLastLocation();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Plain block layout + margin-auto centering, not flex(justify-center/items-start) — flex
  // containers with overflow:auto have a history of scrollHeight bugs on some WebView builds;
  // block layout's overflow handling is simpler and more universally correct.
  return (
    <div data-component="SettingsPage" className="sc h-full bg-paper px-5 pt-10">
      <div className="w-full max-w-[540px] pb-10 mx-auto">
        {/* Goes to '/', which restores wherever the user actually was (see RestoreLastLocation
            in App.tsx) rather than a fixed default — and, since it doesn't rely on genuine
            browser history the way navigate(-1) would, also works when there's no in-app
            history to go back to: a fresh tab/PWA relaunch landing straight on /settings, or a
            hard refresh while on this page. */}
        <button className="flex items-center gap-1.5 font-sans text-ui-base text-ink-4 mb-5" onClick={backToLastLocation}>
          <ArrowLeft size={17} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-ui-3xl font-semibold tracking-[-.01em] mb-5">Settings</div>

        {/* User authentication section with Google sign-in and with Export JSON and Sign-out
            when authenticated. Leads the page: it's the one section that says whether anything
            here is being kept anywhere but this device, and it's where the header's account badge
            and the "keep this safe" banner both land. Scroll targeting doesn't depend on that
            position — promptGoogleSignIn's scrollTo:'auth' state (see the effect above) works
            regardless of section order. While `loading`, it shows a lightweight placeholder rather
            than collapsing to nothing, so the section always has real height and a valid scroll
            target (see authSectionRef above) regardless of how long the session check takes. */}
        <div ref={authSectionRef}>
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">Account</div>
          <div className={`${cardClass('auth')} mb-5`}>
            {loading ? (
              <div className="font-sans text-ui-base text-ink-4 py-4">Checking sign-in status…</div>
            ) : user ? (
              <>
                {/* This is about lists/notes/highlights syncing to the account (docs/offline-sync.md), a
                 separate mechanism from the corpus caching below — grouped here anyway since both
                 read as "offline-related status" to a user, and neither means anything signed out.
                 A lapsed session replaces it rather than joining it: `user` is still populated (it's
                 cached in lib/lastUser.ts and a flush 401 deliberately doesn't clear it, since that
                 would mount an empty mirror over a full one), so without this the section renders as
                 a perfectly ordinary signed-in account and the banner that sent the user here points
                 at a sign-in button that isn't there. `syncStatus` would meanwhile report the queue
                 as 'pending', which is true but misleading — nothing is being sent while paused. */}
                {needsReauth ? (
                  <div className="py-4">
                    <div className="flex items-start gap-1.5 font-sans text-ui-base mb-3 text-danger-text">
                      <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                      <span>
                        Your session expired, so nothing is syncing. Your changes are saved on this device and will sync
                        once you sign in again.
                      </span>
                    </div>
                    <GoogleSignInButton returnTo={signInReturnTo} />
                    {authError && <div className="font-sans text-ui-base text-danger-text mt-2">{authError}</div>}
                    <SignInDivider />
                    <EmailCodeSignIn returnTo={signInReturnTo} />
                  </div>
                ) : (
                  (() => {
                    const { Icon, spin, text } = syncStatusLine(syncStatus, pendingCount, lastSyncedAt);
                    return (
                      <div className="flex items-start gap-1.5 py-3.5 font-sans text-ui-base text-ink-2">
                        <Icon size={16} strokeWidth={1.75} className={`flex-none mt-[4px] ${spin ? 'animate-[spin_2s_linear_infinite]' : ''}`} />
                        {text}
                      </div>
                    );
                  })()
                )}
                <div className="py-3.5 border-t border-ink/[.06]">
                  <div className="font-sans text-ui-sm text-ink-4 mb-1">Signed in as</div>
                  {/* Name and address stacked rather than joined on one line: at narrow widths a
                      single line wraps mid-pair and strands the separator on its own row. The
                      address wraps within itself instead of truncating — people read it to check
                      which account they're in. */}
                  <div className="mb-3">
                    {user.name && <div className="text-ui-base">{user.name}</div>}
                    <div
                      className={`font-sans break-all ${
                        user.name ? 'text-ui-sm text-ink-4 mt-0.5' : 'text-ui-base'
                      }`}
                    >
                      {user.email}
                    </div>
                  </div>
                  {/* Signing out drops this device's copy of the account's data (see logout in
                      AuthContext) — which is only safe for what the server already has. Anything
                      still queued would go with it, so that case asks first rather than confirming
                      unconditionally: a signed-out-and-back-in round trip on a fully synced account
                      loses nothing and shouldn't have to answer for itself. */}
                  {confirmSignOut && (
                    <div className="flex items-start gap-1.5 font-sans text-ui-base text-danger-text mb-2">
                      <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                      <span>
                        {pendingCount === 1 ? '1 change hasn’t' : `${pendingCount} changes haven’t`} synced yet. Signing
                        out now discards {pendingCount === 1 ? 'it' : 'them'}.
                      </span>
                    </div>
                  )}
                  {/* Sign out on the left, Export on the right — leaving and taking a copy with you
                      are opposite-feeling actions, not two items in a list, so they don't share an
                      edge the way stacked links would. Export is hidden while the session is dead
                      rather than left to fail (see below); Sign out still works either way, since
                      POST /api/auth/logout is unauthenticated. */}
                  <div className="flex items-center justify-between">
                    <button
                      className={confirmSignOut ? LINK_DANGER : LINK_ACTION}
                      onClick={async () => {
                        if (pendingCount > 0 && !confirmSignOut) {
                          setConfirmSignOut(true);
                          return;
                        }
                        await logout();
                        navigate('/');
                      }}
                    >
                      {/* Centring these geometrically leaves them reading high against the
                          label, whose optical centre sits below the box's: nudged down a pixel. */}
                      <LogOut size={16} strokeWidth={1.75} className="translate-y-[1px]" />
                      {confirmSignOut ? 'Sign out anyway' : 'Sign out'}
                    </button>
                    {/* This is a plain link to a requireAuth route, so a dead session would answer
                        401 and hand back an error body as a download — hidden rather than left to
                        fail that way. */}
                    {!needsReauth && (
                      <a href={dataApi.exportUrl} className={LINK_ACTION}>
                        <Download size={16} strokeWidth={1.75} className="translate-y-[1px]" />
                        Export my data
                      </a>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="py-4">
                <div className="font-sans text-ui-base text-ink-2 mb-3">
                  Your lists, notes and highlights are saved on this device. Sign in to keep them and sync across
                  devices.
                </div>
                {/* Complements the line above rather than repeating the header banner's own wording
                    ("Saved temporarily on this device") — this is the risk that wording is short
                    for. Suppressed on an iOS browser tab, where the danger line below states the
                    same risk in its concrete form — two stacked warnings about one thing read as
                    noise. */}
                {!isIosBrowserTab() && hasLocalWork && (
                  <div className="flex items-start gap-1.5 font-sans text-ui-base text-warning-text mb-3">
                    <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                    <span>Without signing in, you risk losing your changes when the browser clears this website's data.</span>
                  </div>
                )}
                {/* On iOS in a browser tab this is the literal storage policy, not a nudge — WebKit
                    evicts a site's IndexedDB after about seven days without a visit — so unlike the
                    header banner's version of it, it can't be dismissed. Installing to the Home
                    Screen is the documented exemption, so it's offered alongside signing in rather
                    than being the second-best answer. */}
                {isIosBrowserTab() && hasLocalWork && (
                  <div className="flex items-start gap-1.5 font-sans text-ui-base text-danger-text mb-3">
                    <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                    <span>Without signing in, you risk losing your changes when the browser clears this website's data.</span>
                  </div>
                )}
                <GoogleSignInButton returnTo={signInReturnTo} />
                {authError && <div className="font-sans text-ui-base text-danger-text mt-2">{authError}</div>}
                <SignInDivider />
                <EmailCodeSignIn returnTo={signInReturnTo} />
              </div>
            )}
          </div>
        </div>

        {/* Download offline corpus section. Renders unconditionally regardless of
            `loading`/corpus state (see offlineSectionRef above) — cachedStatus itself starts out
            null and just shows a "Checking…" line until it resolves, which doesn't affect this
            section's own position or height. */}
        <div ref={offlineSectionRef}>
          <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">Offline</div>

          <div className={`${cardClass('offline')} py-4 mb-5`}>
            {offlineStatus === 'downloading' ? (
              <>
                <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden mb-2">
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex items-center justify-between font-sans text-ui-sm text-ink-4">
                  <span className="tabular-nums">{progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%</span>
                  <button className="text-accent-text" onClick={handleCancelOfflineDownload}>
                    Cancel
                  </button>
                </div>
                {/* Stated plainly, in the same muted grey as every other status line here, rather
                    than as a warning: leaving loses nothing. The unmount abort above stops the
                    download and prefetchAllSuttas skips whatever's already cached, so returning
                    and tapping again picks up where it left off. Without the line, though, the
                    bar just disappears when the reader navigates away and there's no way to tell
                    a pause from a failure. */}
                <div className="font-sans text-ui-sm text-ink-4 mt-2">
                  Leaving this page pauses the download — you can resume it later.
                </div>
              </>
            ) : (
              <>
                {/* An available update gets an icon and the accent colour — every other state
                    here is a passive status line in muted grey, which is exactly what the eye
                    skips over, and this one is the only line that's asking for a decision. It's
                    also the only one whose button is filled rather than outlined, for the same
                    reason: nothing else on this page is asking to be acted on. */}
                {!cachedStatus ? (
                  <div className="font-sans text-ui-base text-ink-2 mb-3">Checking content status…</div>
                ) : textStale ? (
                  <div className="flex items-start gap-1.5 font-sans text-ui-base text-accent-text mb-3">
                    <Info size={18} strokeWidth={1.75} className="flex-none mt-[2px]" />
                    <span>Updated content is available ({TOTAL_DOWNLOAD_MB_ESTIMATE} MB).</span>
                  </div>
                ) : cachedStatus.cached >= cachedStatus.total ? (
                  <div className="font-sans text-ui-base text-ink-2 mb-3">All content available offline.</div>
                ) : (
                  <div className="font-sans text-ui-base text-ink-2 mb-3">
                    {/* How much is already here leads: it's the fact that tells the reader whether
                        this is worth doing at all. What the download buys them, and what it costs,
                        follow. */}
                    <p>Currently {Math.round((cachedStatus.cached / cachedStatus.total) * 100)}% is available offline.</p>
                    <p className="mt-2">
                      Downloading all content enables the app to work fully offline. Total size is approx.{' '}
                      {TOTAL_DOWNLOAD_MB_ESTIMATE} MB.
                    </p>
                  </div>
                )}
                <button
                  className={`${textStale ? PRIMARY_BUTTON : SECONDARY_BUTTON} disabled:opacity-50`}
                  onClick={handleDownloadOffline}
                  disabled={!corpus || !cachedStatus || (!textStale && cachedStatus.cached >= cachedStatus.total)}
                >
                  {textStale ? 'Download updated content' : 'Download all content'}
                </button>
                {failedCount > 0 &&
                  (circuitTripped ? (
                    <div className="font-sans text-ui-base text-danger-text mt-2">
                      Stopped early after repeated failures — {failedCount} items couldn't be downloaded.
                    </div>
                  ) : (
                    <div className="font-sans text-ui-base text-danger-text mt-2">{failedCount} items couldn't be downloaded — try again.</div>
                  ))}
                {dictionaryFailed && (
                  <div className="font-sans text-ui-base text-danger-text mt-2">Dictionary couldn't be downloaded — try again.</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* UI Theme configuration section. A card, with its label outside and above it: the
            controls inside are separated by hairlines rather than by whitespace, so one section
            reads as one object at a glance and the gaps between sections don't have to carry that
            job on their own. Every row keeps its label on its own line above a full-width control
            — a label column beside the control would squeeze the option pills at narrow widths and
            at the top of the UI-scale range. Last on the page: these are set once and rarely
            revisited, unlike the account and offline state above them. */}
        <div className="font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2">Display</div>

        <div className={`${CARD} border-ink/[.09] ${CARD_FILL} mb-5`}>
          <div className="py-3.5">
            <div className="font-sans text-ui-sm text-ink-4 mb-2">Theme</div>
            <div className="flex gap-3">
              {THEME_OPTIONS.map((t) => {
                const selected = theme === t.id;
                return (
                  <button key={t.id} className="flex-1" aria-pressed={selected} onClick={() => setTheme(t.id)}>
                    {/* A real border, not `ring-inset`: an inset box-shadow paints under the
                        tile's own opaque panels and would be invisible. Held at 2px in both
                        states so selecting one doesn't nudge the miniature inside it. */}
                    <span
                      className={`flex h-[62px] rounded-field overflow-hidden border-2 ${
                        selected ? 'border-accent' : 'border-ink/[.12]'
                      }`}
                    >
                      {/* One slice per palette: each is an equal share of the tile's width
                          holding a full-width miniature, pulled left by the slices before it so
                          the slice shows its own part of it. With a single palette that's the
                          whole miniature and no offset; with two it's the light left half beside
                          the dark right half. */}
                      {t.palettes.map((p, i) => (
                        <span
                          key={i}
                          className="flex shrink-0 overflow-hidden"
                          style={{ width: `${100 / t.palettes.length}%` }}
                        >
                          <span
                            className="flex shrink-0"
                            style={{ width: `${t.palettes.length * 100}%`, marginLeft: `-${i * 100}%` }}
                          >
                            <ShellMiniature p={p} />
                          </span>
                        </span>
                      ))}
                    </span>
                    <span
                      className={`block mt-1.5 font-sans text-ui-sm ${
                        selected ? 'text-accent-text font-medium' : 'text-ink-4'
                      }`}
                    >
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* The one row on this card that keeps its label beside the control rather than above
              it: the stepper is a fixed, compact width, so a full-width row would leave most of
              it empty. It wraps back to two lines when the two halves stop fitting — which they
              do at the top of the scale range on a narrow phone. Reset travels with the label,
              at the far edge from the "+", since each step re-zooms the page and drifts a
              held-still pointer upward. */}
          <div className="py-3.5 border-t border-ink/[.06] flex flex-wrap items-center justify-between gap-y-2">
            <div className="flex items-baseline gap-3">
              <div className="font-sans text-ui-sm text-ink-4">UI scale</div>
              {uiScale !== 1 && (
                <button className="font-sans text-ui-sm text-accent-text" onClick={() => setUiScale(1)}>
                  Reset
                </button>
              )}
            </div>
            {/* One connected stepper — the two buttons and the value they change share a single
                outline, divided by hairlines. Spread to the row's outer edges instead, the gap
                between them reads as an empty segmented control rather than as one object. */}
            <div className="inline-flex items-stretch rounded-field border border-ink/[.18] overflow-hidden">
              <button
                className={UI_SCALE_STEP_BTN}
                aria-label="Decrease UI scale"
                disabled={uiScale <= UI_SCALE_MIN}
                onClick={() => stepUiScale(-UI_SCALE_STEP)}
              >
                <Minus size={19} strokeWidth={2} />
              </button>
              <span className="flex items-center justify-center w-16 border-x border-ink/[.18] font-sans text-ui-base tabular-nums text-ink-2">
                {Math.round(uiScale * 100)}%
              </span>
              <button
                className={UI_SCALE_STEP_BTN}
                aria-label="Increase UI scale"
                disabled={uiScale >= UI_SCALE_MAX}
                onClick={() => stepUiScale(UI_SCALE_STEP)}
              >
                <Plus size={19} strokeWidth={2} />
              </button>
            </div>
          </div>

        </div>

        {/* Both are occasional-use links rather than actions this page is asking for, so they
            share one muted footer row instead of a card of their own. The library's own help row
            (TreePane) is the primary way into the guide; this is the second place someone looks. */}
        <div className="flex items-center justify-center gap-2.5 font-sans text-ui-sm text-ink-4 mt-6">
          <button className="underline decoration-ink/25 underline-offset-2" onClick={() => navigate('/help')}>
            Help
          </button>
          <span aria-hidden className="text-ink-5">
            ·
          </span>
          <a
            href="https://github.com/gbbr/sutamaya.org/issues/new"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-ink/25 underline-offset-2"
          >
            Report an issue
          </a>
        </div>
      </div>
    </div>
  );
}
