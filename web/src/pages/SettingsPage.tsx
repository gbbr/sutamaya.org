import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AlertTriangle, ArrowLeft, Check, CloudOff, Download, Info, Loader2, LogOut, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData, type SyncStatus } from '../context/UserDataContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { EmailCodeSignIn } from '../components/EmailCodeSignIn';
import { dataApi } from '../lib/api';
import { shareUserDataExport } from '../lib/exportData';
import { flatSuttaOrder } from '../lib/corpus';
import { isTypingTarget } from '../lib/shortcuts';
import { statusOf } from '../lib/retry';
import { isIosBrowserTab } from '../lib/localAccount';
import { isNativeApp } from '../lib/platform';
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

// The word that enables the delete button. There is no password on these accounts, so typing it is
// the reader's one proof of intent; a short word rather than the account's own address, which is
// long and fights a phone keyboard.
const DELETE_CONFIRMATION = 'DELETE';

// Whether opening the delete confirmation should focus its field. Not on a touch pointer, where
// the keyboard that raises would cover the card the confirmation is written in.
const wantsAutoFocus = () => !window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Whether the account has already been erased, asked of the one endpoint that tells that apart
 * from a lapsed session: `/api/data` answers 410 for a session naming an account that is gone,
 * which is the same signal a sync reads (docs/offline-sync.md). False whenever it cannot be
 * established, so an unanswerable question reports failure rather than success.
 */
async function accountAlreadyGone(): Promise<boolean> {
  try {
    await dataApi.all();
    return false;
  } catch (e) {
    return statusOf(e) === 410;
  }
}

// Rough size of the whole offline download over the wire — sutta text, dictionary and search text,
// as the compressed bundles they are fetched in.
const TOTAL_DOWNLOAD_MB_ESTIMATE = 10;
// Rough size the same content occupies on the device, where it is held uncompressed.
const TOTAL_STORED_MB_ESTIMATE = 60;

// The shell colours one theme tile is drawn in, as literals rather than the `--paper`/`--treepane`/
// `--ink` custom properties they mirror, since every tile renders in its own theme at once.
interface ShellPalette {
  paper: string;
  pane: string;
  ink: string;
  accent: string;
}
const LIGHT_SHELL: ShellPalette = { paper: '#FBF9F5', pane: '#E9E4DA', ink: '#1B1917', accent: '#7A5B2E' };
const DARK_SHELL: ShellPalette = { paper: '#171513', pane: '#1E1B17', ink: '#E4DFD8', accent: '#C49A61' };

// The app-theme choices. `palettes` holds one entry for a pinned theme, and two for System, whose
// tile shows light on the left and dark on the right.
const THEME_OPTIONS: Array<{ id: AppTheme; label: string; palettes: ShellPalette[] }> = [
  { id: 'light', label: 'Light', palettes: [LIGHT_SHELL] },
  { id: 'dark', label: 'Dark', palettes: [DARK_SHELL] },
  { id: 'system', label: 'System', palettes: [LIGHT_SHELL, DARK_SHELL] },
];

// One section's card: a panel of rows split by hairlines. Border and background are left to the
// caller (cardClass), which swaps both for the flashed-on-arrival state.
const CARD = 'rounded-field border px-5 transition-colors duration-[1200ms] ease-out';
// A card's fill, in both themes.
const CARD_FILL = 'bg-field dark:bg-ink/[.02]';
// The heading naming the card below it.
const SECTION_LABEL = 'font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3 mb-2';

// The filled full-width button, for the one action a card is asking for.
const PRIMARY_BUTTON =
  'flex items-center justify-center gap-1.5 w-full py-[12px] rounded-field bg-accent hover:bg-accent/90 text-[#FBFAF7] font-sans text-ui-base font-medium';
const SECONDARY_BUTTON =
  'flex items-center justify-center gap-1.5 w-full py-[12px] rounded-field border border-ink/[.18] font-sans text-ui-base font-medium text-ink hover:text-ink hover:bg-ink/[.04]';
// One UI-scale stepper, a segment inside the bordered group that draws the outline around them.
const UI_SCALE_STEP_BTN =
  'flex items-center justify-center w-12 h-10 text-ink hover:bg-ink/[.04] disabled:opacity-35 disabled:hover:bg-transparent';
// The last card on the page, outlined in the danger tint: everything it holds is destructive. Only
// the border carries that, over the same fill every other card has, so the section reads as serious
// without the page ending on a block of colour.
const DANGER_CARD = `${CARD} ${CARD_FILL} border-danger-text/25 py-4 mb-5`;
// The deed itself, filled — in `danger-fill` rather than `danger-text`, which is lifted to a salmon
// in the dark theme to stay legible as text and glares at button size.
const DANGER_BUTTON =
  'flex items-center justify-center gap-1.5 w-full py-[12px] rounded-field bg-danger-fill hover:opacity-90 text-[#FBFAF7] font-sans text-ui-base font-medium disabled:opacity-40 disabled:hover:opacity-40';
// The confirmation's text field, matching the sign-in card's. Focus is drawn the way that card
// draws the input it is waiting on — a coloured border and a soft ring, in place of the OS ring the
// rest of the app already suppresses — but in this card's own tint rather than the accent.
const FIELD =
  'w-full h-10 px-3 rounded-field border border-ink/[.18] bg-transparent font-sans text-ui-md placeholder:text-ink-5 ' +
  'focus:outline-none focus:border-danger-text/50 focus:ring-2 focus:ring-danger-text/20';
// A small inline action — Export, Sign out — underlined as the app's inline actions are.
const LINK_ACTION = 'inline-flex items-center gap-1.5 font-sans text-ui-base text-ink-2 underline decoration-ink/40 hover:text-ink';
// The same action once armed, in the danger tint this page otherwise keeps for something that is
// wrong right now.
const LINK_DANGER =
  'inline-flex items-center gap-1.5 font-sans text-ui-base text-danger-text underline decoration-danger-text/40 hover:text-danger-text';

// Downloads the account export. In the browser it is what it looks like — a link to the export
// route, which the browser saves. The native build has no such download (lib/exportData.ts), so
// there it is a button that fetches the file and passes it to the OS share sheet, saying so while
// it works. Appears twice: beside Sign out, and beside the account deletion it is the way out of.
function ExportAction() {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');

  if (!isNativeApp()) {
    return (
      <a href={dataApi.exportUrl} className={LINK_ACTION}>
        {/* Nudged down a pixel, to the label's optical centre. */}
        <Download size={16} strokeWidth={1.75} className="translate-y-[1px]" />
        Export my data
      </a>
    );
  }

  return (
    <button
      className={state === 'failed' ? LINK_DANGER : LINK_ACTION}
      disabled={state === 'working'}
      onClick={async () => {
        setState('working');
        try {
          await shareUserDataExport();
          setState('idle');
        } catch (e) {
          console.error('Export failed', e);
          setState('failed');
        }
      }}
    >
      {state === 'working' ? (
        <Loader2 size={16} strokeWidth={1.75} className="translate-y-[1px] animate-spin" />
      ) : (
        <Download size={16} strokeWidth={1.75} className="translate-y-[1px]" />
      )}
      {state === 'working' ? 'Preparing…' : state === 'failed' ? 'Export failed — try again' : 'Export my data'}
    </button>
  );
}

// Draws one theme tile's miniature of the shell: a tree-pane band beside the paper surface. Laid
// out at the tile's full width, so the System tile's two clipped halves line up across the seam.
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

// The "or" rule between the two sign-in methods.
function SignInDivider() {
  return (
    <div className="flex items-center gap-3 my-3.5">
      <span className="h-px flex-1 bg-ink/[.12]" />
      <span className="font-sans text-ui-xs uppercase tracking-wider text-ink-4">or</span>
      <span className="h-px flex-1 bg-ink/[.12]" />
    </div>
  );
}

// The sections this page can be deep-linked into and highlighted on arrival.
type ScrollTarget = 'offline' | 'auth';

// Returns a coarse "just now" / "5 minutes ago" reading of a timestamp.
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

// Returns the icon and sentence describing the offline-sync queue (docs/offline-sync.md's "Sync
// state"). The library's footer row says the same in two or three words.
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

export function SettingsPage() {
  // Title only: this page describes nothing a search result would want, so it keeps the app-wide
  // description.
  useDocumentMeta('Settings');
  const location = useLocation();
  const navigate = useNavigate();
  // Leaves Settings for wherever the reader was, via App.tsx's RestoreLastLocation.
  const backToLastLocation = useCallback(() => navigate('/'), [navigate]);

  const { user, logout, deleteAccount, forgetAccount, loading, authError } = useAuth();
  const { uiScale, theme, setUiScale, setTheme } = useUiPrefs();
  const { corpus } = useCorpus();
  const { syncStatus, pendingCount, lastSyncedAt, needsReauth, lists, notes, highlights } = useUserData();

  // Whether this device holds work worth keeping, which gates every "your data is only on this
  // device" warning: the header banner, the account badge's dot and the Account card's two lines.
  const hasLocalWork = hasLocalWorkWorthKeeping(lists, notes, highlights);

  // Moves the UI scale one step, rounded back onto the step grid so repeated additions can't
  // drift off it in floating point.
  const stepUiScale = (delta: number) => {
    const next = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, uiScale + delta));
    setUiScale(Math.round(next / UI_SCALE_STEP) * UI_SCALE_STEP);
  };

  // Whether the sign-out button is armed, which a first click does when there is unsynced work.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // The account being signed out of, which keeps the Account card on screen until the page is left:
  // `user` blanks before the sign-out finishes, and the signed-out card would show in the meantime.
  const [signingOutAs, setSigningOutAs] = useState<typeof user>(null);
  const shownUser = user ?? signingOutAs;

  // The Delete account card's second step: what it is being asked, what the reader has typed into
  // it, and whether the request is out. Reset together by `cancelDelete`.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Case-insensitive: a phone's own capitalisation shouldn't decide whether the button works.
  const deleteArmed = deleteTyped.trim().toUpperCase() === DELETE_CONFIRMATION;
  const dangerSectionRef = useRef<HTMLDivElement>(null);
  const deleteFieldRef = useRef<HTMLInputElement>(null);

  // Opening the confirmation brings the whole card into view: it is the last thing on the page, so
  // on a short window it expands mostly below the fold — over the one paragraph naming what is
  // about to be destroyed. `nearest` moves the minimum needed and does nothing when the card
  // already fits.
  //
  // The cursor follows only where focusing summons no keyboard, as ListMembershipPopover's field
  // does. On a touch device the keyboard would cover the card this just revealed, and taking the
  // browser's own scroll-on-focus out of the way (which is what keeps it off this smooth one)
  // leaves nothing to lift the field clear of it. Tapping the field still works, and the OS then
  // places it correctly.
  useEffect(() => {
    if (!confirmDelete) return;
    dangerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (wantsAutoFocus()) deleteFieldRef.current?.focus({ preventScroll: true });
  }, [confirmDelete]);

  function cancelDelete() {
    setConfirmDelete(false);
    setDeleteTyped('');
    setDeleteError(null);
  }

  // Erases the account, then leaves Settings for wherever the reader was — signed out, on a fresh
  // local account, with this device's copy of the data gone (AuthContext's deleteAccount).
  async function handleDeleteAccount() {
    if (deleting || !deleteArmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      backToLastLocation();
    } catch (e) {
      // A failed request is not a failed deletion: a reply lost on the way back leaves the account
      // erased with nothing here to say so. Ask before reporting failure, and where it is already
      // gone, finish the teardown the lost reply owed us.
      if (statusOf(e) !== 401 && (await accountAlreadyGone())) {
        await forgetAccount();
        backToLastLocation();
        return;
      }
      console.error('account deletion failed', e);
      setDeleteError(
        statusOf(e) === 401
          ? 'Your session has expired. Sign in again to delete your account.'
          : 'Could not delete your account. Please try again.'
      );
      setDeleting(false);
    }
  }

  const [offlineStatus, setOfflineStatus] = useState<'idle' | 'downloading'>('idle');
  // Progress of the offline download, shown as a percentage (see lib/offline.ts).
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [cachedStatus, setCachedStatus] = useState<{ cached: number; total: number } | null>(null);
  // Whether a completed bulk download predates the corpus now being served
  // (cachedCorpusVersions). A synchronous localStorage compare, so read during render.
  const textStale = !!corpus && isOfflineTextStale(corpus.dataVersion);
  const [failedCount, setFailedCount] = useState(0);
  const [circuitTripped, setCircuitTripped] = useState(false);
  const [dictionaryFailed, setDictionaryFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // The two deep-linkable sections. Both refs are attached unconditionally, and the Authentication
  // section keeps a placeholder while `loading`, so the scroll effect below waits on nothing.
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
      // Falls back to nothing cached, rather than leaving "Checking offline availability…"
      // standing forever.
      .catch(() => {
        if (!cancelled) setCachedStatus({ cached: 0, total: uids.length });
      });
    return () => {
      cancelled = true;
    };
  }, [corpus]);

  // Where a signed-out action sent the reader here from (promptGoogleSignIn), which the OAuth
  // round trip returns them to. Read once, at mount, as the scroll cue below is.
  const [signInReturnTo] = useState(() => (location?.state as { returnTo?: string } | undefined)?.returnTo);

  // Scrolls to, and briefly highlights, whichever section this page was navigated here for.
  useEffect(() => {
    const scrollTo = (location?.state as { scrollTo?: ScrollTarget } | undefined)?.scrollTo;
    if (!scrollTo) return;
    const ref = scrollTo === 'offline' ? offlineSectionRef : authSectionRef;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlashTarget(scrollTo);
    const timer = window.setTimeout(() => setFlashTarget(null), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  // Returns a section card's classes, accent-tinted and outlined while it is the arrival highlight.
  function cardClass(id: ScrollTarget): string {
    return `${CARD} ${flashTarget === id ? 'border-accent bg-accent/[.09]' : `border-ink/[.09] ${CARD_FILL}`}`;
  }

  // Aborts an in-flight download when the reader leaves Settings, which pauses it: the ref doesn't
  // survive unmount, and prefetchAllSuttas skips what is already cached, so clicking again resumes.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleDownloadOffline() {
    // The ref, not offlineStatus, guards re-entry: it updates synchronously, so two clicks landing
    // in one render can't start a second download.
    if (!corpus || abortRef.current) return;
    const uids = flatSuttaOrder(corpus);
    // Asks for persistent storage, best-effort — Safari mostly no-ops it, and the result isn't
    // surfaced.
    navigator.storage?.persist?.().catch(() => {});
    const controller = new AbortController();
    abortRef.current = controller;
    setOfflineStatus('downloading');
    setProgress({ done: 0, total: uids.length });
    setFailedCount(0);
    setCircuitTripped(false);
    setDictionaryFailed(false);
    // Whether each half is refetched and overwritten rather than skipped where already cached:
    // true unless a completed download recorded the version now being served. The two are tracked
    // separately, so reworded sutta text costs no dictionary refetch.
    const versions = cachedCorpusVersions();
    const forceText = versions.data !== corpus.dataVersion;
    const forceDictionary = versions.dictionary !== corpus.dictionaryVersion;
    // catch as well as finally: prefetchAllSuttas resolves normally when individual suttas fail,
    // so only something unexpected lands here, and the UI still has to recover to idle.
    try {
      // Alongside the sutta shards rather than after. The reader only fetches the dictionary shard
      // each tapped word falls in, so unlike the sutta text this is rarely already complete, and
      // the download has to guarantee it before reporting done or word lookups fail offline.
      //
      // The help page's screenshots ride along in the same pass — a fraction of a percent of the
      // total, and without them the guide shows broken images offline. Its result isn't surfaced;
      // see prefetchHelpImages.
      const [{ failed, circuitTripped: tripped }, dictionaryOk] = await Promise.all([
        prefetchAllSuttas(uids, {
          signal: controller.signal,
          force: forceText,
          searchVersion: corpus.searchVersion,
          onProgress: (done, total) => setProgress({ done, total }),
        }),
        prefetchDictionary(controller.signal, forceDictionary),
        prefetchHelpImages(controller.signal),
      ]);
      setFailedCount(failed.length);
      setCircuitTripped(tripped);
      setDictionaryFailed(!dictionaryOk && !controller.signal.aborted);
      // Each half's version is recorded only on a clean finish, so a cancelled or partly failed
      // download keeps reporting the offline copy as behind.
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

  // Escape leaves the page, as the "Back" button does, except while a text field has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isTypingTarget(e)) backToLastLocation();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backToLastLocation]);

  // Block layout with margin-auto centring rather than flex, which has scrollHeight bugs under
  // overflow:auto on some WebView builds.
  return (
    <div
      data-component="SettingsPage"
      className="sc h-full bg-paper px-5 pt-10"
      style={{ paddingTop: 'calc(2.5rem + var(--safe-top))' }}
    >
      <div className="w-full max-w-[540px] pb-10 mx-auto">
        {/* Back to wherever the reader was, via '/' rather than browser history, which a relaunch
            or a hard refresh onto /settings would leave empty. */}
        <button className="flex items-center gap-1.5 font-sans text-ui-base text-ink-4 mb-5" onClick={backToLastLocation}>
          <ArrowLeft size={17} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-ui-3xl font-semibold tracking-[-.01em] mb-5">Settings</div>

        {/* The Account section: sign-in when signed out, sync state with Export and Sign out when
            signed in. Keeps a placeholder while `loading`, so it always has height for the scroll
            target above to land on. */}
        <div ref={authSectionRef}>
          <div className={SECTION_LABEL}>Account</div>
          <div className={`${cardClass('auth')} mb-5`}>
            {loading ? (
              <div className="font-sans text-ui-base text-ink-4 py-4">Checking sign-in status…</div>
            ) : shownUser ? (
              <>
                {/* A lapsed session, which shows sign-in in place of the sync line: `user` is
                    still populated (lib/lastUser.ts), so nothing else here would say the account
                    has stopped syncing. */}
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
                  {/* Name over address, the address wrapping within itself rather than
                      truncating. */}
                  <div className="mb-3">
                    {shownUser.name && <div className="text-ui-base">{shownUser.name}</div>}
                    <div
                      className={`font-sans break-all ${
                        shownUser.name ? 'text-ui-sm text-ink-4 mt-0.5' : 'text-ui-base'
                      }`}
                    >
                      {shownUser.email}
                    </div>
                  </div>
                  {/* The warning that arms Sign out, shown only when unsynced changes would go
                      with this device's copy of the account's data (AuthContext's logout). */}
                  {confirmSignOut && (
                    <div className="flex items-start gap-1.5 font-sans text-ui-base text-danger-text mb-2">
                      <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                      <span>
                        {pendingCount === 1 ? '1 change hasn’t' : `${pendingCount} changes haven’t`} synced yet. Signing
                        out now discards {pendingCount === 1 ? 'it' : 'them'}.
                      </span>
                    </div>
                  )}
                  {/* Sign out on the left, Export on the right. */}
                  <div className="flex items-center justify-between">
                    <button
                      className={`${confirmSignOut ? LINK_DANGER : LINK_ACTION} disabled:opacity-60`}
                      disabled={!!signingOutAs}
                      onClick={async () => {
                        if (pendingCount > 0 && !confirmSignOut) {
                          setConfirmSignOut(true);
                          return;
                        }
                        setSigningOutAs(user);
                        try {
                          await logout();
                        } catch (err) {
                          setSigningOutAs(null);
                          throw err;
                        }
                        navigate('/');
                      }}
                    >
                      {/* Nudged down a pixel, to the label's optical centre. */}
                      <LogOut size={16} strokeWidth={1.75} className="translate-y-[1px]" />
                      {signingOutAs ? 'Signing out…' : confirmSignOut ? 'Sign out anyway' : 'Sign out'}
                    </button>
                    {/* Export, hidden on a lapsed session: the request would answer 401, which in
                        the browser downloads the error body. */}
                    {!needsReauth && <ExportAction />}
                  </div>
                </div>
              </>
            ) : (
              <div className="py-4">
                <div className="font-sans text-ui-base text-ink-2 mb-3">
                  Your lists, notes and highlights are saved on this device. Sign in to keep them and sync across
                  devices.
                </div>
                {/* The general warning, shown everywhere but an iOS browser tab, which gets the
                    concrete one below instead. */}
                {!isIosBrowserTab() && hasLocalWork && (
                  <div className="flex items-start gap-1.5 font-sans text-ui-base text-warning-text mb-3">
                    <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                    <span>Without signing in, you risk losing your changes when the browser clears this website's data.</span>
                  </div>
                )}
                {/* The iOS browser-tab warning, which states WebKit's own eviction policy and so
                    cannot be dismissed. */}
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

        {/* The Offline section. Renders whatever the corpus and cache state, so its position and
            height stay fixed for the scroll target above. In the native app the whole corpus ships
            in the bundle, so there is nothing to download — a plain line stands in its place. */}
        <div ref={offlineSectionRef}>
          <div className={SECTION_LABEL}>Offline</div>

          {isNativeApp() ? (
            <div className={`${cardClass('offline')} py-4 mb-5`}>
              <div className="font-sans text-ui-base text-ink-2">
                All suttas, the dictionary and search are built into the app and work offline.
              </div>
            </div>
          ) : (
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
                {/* Says that leaving pauses rather than cancels, since the bar simply disappears
                    on navigation. */}
                <div className="font-sans text-ui-sm text-ink-4 mt-2">
                  Leaving this page pauses the download — you can resume it later.
                </div>
              </>
            ) : (
              <>
                {/* The content's offline state:
                      unknown  – a "checking" line while the estimate resolves
                      stale    – an icon and the accent colour, the one state asking to be acted on
                      complete – a plain line saying so
                      partial  – how much is here, and what a download would add */}
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
                    <p>Currently {Math.round((cachedStatus.cached / cachedStatus.total) * 100)}% is available offline.</p>
                    <p className="mt-2">
                      Downloading all content enables the app to work fully offline. It downloads about{' '}
                      {TOTAL_DOWNLOAD_MB_ESTIMATE} MB and uses about {TOTAL_STORED_MB_ESTIMATE} MB on this
                      device.
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
          )}
        </div>

        {/* The Display section: theme tiles and the UI scale. */}
        <div className={SECTION_LABEL}>Display</div>

        <div className={`${CARD} border-ink/[.09] ${CARD_FILL} mb-5`}>
          <div className="py-3.5">
            <div className="font-sans text-ui-sm text-ink-4 mb-2">Theme</div>
            <div className="flex gap-3">
              {THEME_OPTIONS.map((t) => {
                const selected = theme === t.id;
                return (
                  <button key={t.id} className="flex-1" aria-pressed={selected} onClick={() => setTheme(t.id)}>
                    {/* A real border rather than `ring-inset`, which would paint under the tile's
                        own opaque panels, and 2px in both states so selecting doesn't nudge it. */}
                    <span
                      className={`flex h-[62px] rounded-field overflow-hidden border-2 ${
                        selected ? 'border-accent' : 'border-ink/[.12]'
                      }`}
                    >
                      {/* One slice per palette: an equal share of the tile's width holding a
                          full-width miniature, pulled left so each slice shows its own part. */}
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

          {/* The UI scale row: label and Reset on one side, the stepper on the other, wrapping to
              two lines when they stop fitting. */}
          <div className="py-3.5 border-t border-ink/[.06] flex flex-wrap items-center justify-between gap-y-2">
            <div className="flex items-baseline gap-3">
              <div className="font-sans text-ui-sm text-ink-4">UI scale</div>
              {uiScale !== 1 && (
                <button className="font-sans text-ui-sm text-accent-text" onClick={() => setUiScale(1)}>
                  Reset
                </button>
              )}
            </div>
            {/* One connected stepper: the two buttons and the value share an outline, divided by
                hairlines. */}
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

        {/* The Danger zone: last on the page and deliberately far from Sign out and Export, so it
            can't be reached for by accident. Signed in only — there is no account to delete
            otherwise, a local reader's data being theirs alone. Hidden on a lapsed session, which
            has nothing left to delete with: the export would answer 401 and the deletion itself
            would be refused. The Account card above is already asking for a fresh sign-in. */}
        {!loading && shownUser && !needsReauth && (
          <div ref={dangerSectionRef}>
            <div className={SECTION_LABEL}>
              Danger zone
            </div>
            <div className={DANGER_CARD}>
              {!confirmDelete ? (
                <>
                  <div className="font-sans text-ui-base text-ink-2 mb-3">
                    Permanently delete your account and everything in it. Download a copy first if you want to keep
                    it.
                  </div>
                  {/* Export on the left, the deletion on the right — the way out is read before
                      the way that ends it. */}
                  <div className="flex items-center justify-between">
                    <ExportAction />
                    <button className={LINK_DANGER} onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={16} strokeWidth={1.75} className="translate-y-[1px]" />
                      Delete my account
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Names what goes, and that it goes everywhere: the account is the copy every
                      device syncs against. */}
                  <div className="flex items-start gap-1.5 font-sans text-ui-base text-danger-text mb-3">
                    <AlertTriangle size={16} strokeWidth={1.75} className="flex-none mt-[3px]" />
                    <span>
                      This deletes your lists, notes, highlights and reading history, on every device. It happens
                      immediately and can’t be undone.
                    </span>
                  </div>
                  {/* A form, so the one field's keyboard carries a working Go/Done key rather than
                      leaving a phone to dismiss itself before the button underneath can be reached. */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleDeleteAccount();
                    }}
                  >
                    <label htmlFor="delete-confirm" className="block font-sans text-ui-sm text-ink-4 mb-1.5">
                      Type <span className="font-medium text-ink">{DELETE_CONFIRMATION}</span> to confirm
                    </label>
                    <input
                      id="delete-confirm"
                      ref={deleteFieldRef}
                      value={deleteTyped}
                      onChange={(e) => setDeleteTyped(e.target.value)}
                      placeholder={DELETE_CONFIRMATION}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className={`${FIELD} mb-2.5`}
                    />
                    <button type="submit" className={DANGER_BUTTON} disabled={!deleteArmed || deleting}>
                      <Trash2 size={16} strokeWidth={1.75} />
                      {deleting ? 'Deleting…' : 'Delete my account'}
                    </button>
                    <button
                      type="button"
                      className="w-full mt-2.5 font-sans text-ui-base text-ink-4 underline decoration-ink/25 underline-offset-2"
                      disabled={deleting}
                      onClick={cancelDelete}
                    >
                      Cancel
                    </button>
                  </form>
                  {deleteError && <div className="font-sans text-ui-base text-danger-text mt-2">{deleteError}</div>}
                </>
              )}
            </div>
          </div>
        )}

        {/* The footer's two occasional links, Help and Report an issue. */}
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
