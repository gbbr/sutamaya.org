import { useEffect, useRef, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { AlertTriangle, ArrowLeft, Check, CloudOff, Info, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData, type SyncStatus } from '../context/UserDataContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { dataApi } from '../lib/api';
import { flatSuttaOrder } from '../lib/corpus';
import {
  cachedCorpusVersions,
  clearCachedDictionary,
  clearCachedText,
  estimateOfflineStatus,
  isOfflineTextStale,
  prefetchAllSuttas,
  prefetchDictionary,
  recordCachedCorpusVersion,
} from '../lib/offline';
import type { AppTheme, ReaderFace } from '../lib/types';

const UI_SCALE_MIN = 0.85;
const UI_SCALE_MAX = 1.4;
const UI_SCALE_STEP = 0.05;

const THEME_OPTIONS: Array<{ id: AppTheme; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

const UI_FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
  { id: 'times', label: 'Times' },
  { id: 'system', label: 'System' },
];

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

// One line describing the offline-sync queue (see docs/offline-sync.md's "Sync state"). This is the
// only place any of it is shown: the app's chrome carries nothing for the states that resolve on
// their own (draining, offline) or that a user can't act on (permanently refused), so this is where
// someone wondering whether their data has actually reached the server finds out.
function syncStatusLine(
  status: SyncStatus,
  pendingCount: number,
  lastSyncedAt: string | null,
): { Icon: typeof RefreshCw; spin: boolean; text: string } {
  if (status === 'offline') {
    return { Icon: CloudOff, spin: false, text: "Offline — changes are saved locally and will sync when you're back online." };
  }
  if (status === 'stuck') {
    return { Icon: AlertTriangle, spin: false, text: "Some changes couldn't be synced and will keep being retried." };
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
  const { uiScale, uiFace, theme, setUiScale, setUiFace, setTheme } = useUiPrefs();
  const { corpus } = useCorpus();
  const { syncStatus, pendingCount, lastSyncedAt, needsReauth } = useUserData();

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

  // Constant inset/padding (not just conditional on the flash itself) so the highlight has room
  // to bleed slightly past the section's own text without the padding itself popping in and
  // shifting layout right as the flash starts.
  function flashClass(id: ScrollTarget): string {
    return `-mx-3 px-3 py-2 rounded-field transition-colors duration-[1400ms] ease-out ${
      flashTarget === id ? 'bg-accent/10' : 'bg-transparent'
    }`;
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
    // Refreshing a stale copy has to drop the caches first: prefetchAllSuttas skips every uid
    // already present and prefetchDictionary skips every shard already cached, so re-running them
    // over a full cache would report success without replacing a single stale byte. The two are
    // cleared independently — a reworded sutta shouldn't cost a ~2.6MB dictionary re-fetch.
    const versions = cachedCorpusVersions();
    if (versions.data !== null && versions.data !== corpus.dataVersion) await clearCachedText();
    if (versions.dictionary !== null && versions.dictionary !== corpus.dictionaryVersion) await clearCachedDictionary();
    // catch, not just finally — prefetchAllSuttas is designed to resolve normally even when
    // individual suttas fail (that's what the returned `failed` list is for), but this still
    // guards against something genuinely unexpected (e.g. Cache Storage itself unavailable)
    // turning into an unhandled rejection instead of the UI cleanly recovering to idle.
    try {
      // Run alongside the sutta shards rather than after. The reader only fetches the dictionary
      // shard each tapped word falls in, so unlike the sutta text this is rarely already complete
      // — and "download all suttas for offline" has to guarantee it before reporting done, since
      // without every shard the reader's word lookups fail in airplane mode either way.
      const [{ failed, circuitTripped: tripped }, dictionaryOk] = await Promise.all([
        prefetchAllSuttas(uids, {
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        }),
        prefetchDictionary(controller.signal),
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
  // comment) — Escape is the conventional "leave this screen" key, and there's no free-text
  // field here whose own Escape handling would need to take priority over it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') backToLastLocation();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Plain block layout + margin-auto centering, not flex(justify-center/items-start) — flex
  // containers with overflow:auto have a history of scrollHeight bugs on some WebView builds;
  // block layout's overflow handling is simpler and more universally correct.
  return (
    <div data-component="SettingsPage" className="sc h-full bg-paper px-5 pt-10">
      <div className="w-full max-w-[420px] pb-10 mx-auto">
        {/* Goes to '/', which restores wherever the user actually was (see RestoreLastLocation
            in App.tsx) rather than a fixed default — and, since it doesn't rely on genuine
            browser history the way navigate(-1) would, also works when there's no in-app
            history to go back to: a fresh tab/PWA relaunch landing straight on /settings, or a
            hard refresh while on this page. */}
        <button className="flex items-center gap-1.5 font-sans text-[13px] text-ink/50 mb-6" onClick={backToLastLocation}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-[22px] font-semibold tracking-[-.01em] mb-6">Settings</div>

        {/* UI Theme configuration section. */}
        <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-3 mt-6">Display</div>

        <div className="mb-6">
          <div className="font-sans text-[14px] mb-2">Theme</div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                className={`h-9 rounded-field border font-sans text-[13px] ${
                  theme === t.id ? 'border-accent bg-accent text-[#FBFAF7]' : 'border-ink/[.22] text-ink/70'
                }`}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-baseline justify-between mb-2">
            <label htmlFor="ui-scale" className="font-sans text-[14px]">
              UI Scale
            </label>
            <span className="font-sans text-[13px] text-ink/50">{Math.round(uiScale * 100)}%</span>
          </div>
          <input
            id="ui-scale"
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={UI_SCALE_STEP}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between font-sans text-[11px] text-ink/40 mt-1">
            <span>{Math.round(UI_SCALE_MIN * 100)}%</span>
            <button className="underline decoration-ink/25 underline-offset-2" onClick={() => setUiScale(1)}>
              Reset
            </button>
            <span>{Math.round(UI_SCALE_MAX * 100)}%</span>
          </div>
        </div>

        <div className="mb-6">
          <div className="font-sans text-[14px] mb-2">UI Font</div>
          <div className="grid grid-cols-3 gap-2">
            {UI_FACE_OPTIONS.map((f) => (
              <button
                key={f.id}
                className={`h-9 rounded-field border font-sans text-[13px] ${
                  uiFace === f.id ? 'border-accent bg-accent text-[#FBFAF7]' : 'border-ink/[.22] text-ink/70'
                }`}
                onClick={() => setUiFace(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Download offline corpus section. Renders unconditionally regardless of
            `loading`/corpus state (see offlineSectionRef above) — cachedStatus itself starts out
            null and just shows a "Checking…" line until it resolves, which doesn't affect this
            section's own position or height. */}
        <div ref={offlineSectionRef} className={flashClass('offline')}>
          <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-3 mt-6">Offline</div>

          <div className="mb-6">
            {offlineStatus === 'downloading' ? (
              <>
                <div className="h-2 rounded-full bg-ink/10 overflow-hidden mb-2">
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex items-center justify-between font-sans text-[13px] text-ink/50">
                  <span>{progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%</span>
                  <button className="underline decoration-ink/25 underline-offset-2" onClick={handleCancelOfflineDownload}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* An available update gets an icon and the accent colour — every other state
                    here is a passive status line in muted grey, which is exactly what the eye
                    skips over, and this one is the only line that's asking for a decision. */}
                {cachedStatus && textStale ? (
                  <div className="flex items-start gap-1.5 font-sans text-[13px] text-accent-text mb-2">
                    <Info size={15} strokeWidth={1.75} className="flex-none mt-[1.5px]" />
                    <span>Updated sutta text is available.</span>
                  </div>
                ) : (
                  <div className="font-sans text-[13px] text-ink/60 mb-2">
                    {cachedStatus
                      ? cachedStatus.cached >= cachedStatus.total
                        ? 'All suttas available offline.'
                        : `${Math.round((cachedStatus.cached / cachedStatus.total) * 100)}% available offline.`
                      : 'Checking offline availability…'}
                  </div>
                )}
                <button
                  className="block w-full text-center h-11 rounded-field border border-ink/[.22] font-sans text-[14px] font-medium disabled:opacity-50"
                  onClick={handleDownloadOffline}
                  disabled={!corpus}
                >
                  {textStale ? 'Re-download updated suttas' : 'Download all suttas for offline'}
                </button>
                {failedCount > 0 &&
                  (circuitTripped ? (
                    <div className="font-sans text-[13px] text-red-600 mt-2">
                      Stopped early after repeated failures — {failedCount} couldn't be downloaded.
                    </div>
                  ) : (
                    <div className="font-sans text-[13px] text-red-600 mt-2">{failedCount} couldn't be downloaded — try again.</div>
                  ))}
                {dictionaryFailed && (
                  <div className="font-sans text-[13px] text-red-600 mt-2">Dictionary couldn't be downloaded — try again.</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* User authentication section with Google sign-in and with Export JSON and Sign-out
            when authenticated. Fixed as the last section on the page regardless of sign-in
            state — it used to lead when signed out, to surface the sign-in CTA for visitors who
            landed here specifically to sign in, but that's now handled more reliably by
            promptGoogleSignIn's scrollTo:'auth' state (see the effect above), which works
            regardless of section order and doesn't depend on Settings happening to open already
            scrolled to its top. While `loading`, it shows a lightweight placeholder rather than
            collapsing to nothing, so the section always has real height and a valid scroll
            target (see authSectionRef above) regardless of how long the session check takes. */}
        <div ref={authSectionRef} className={flashClass('auth')}>
          <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-3 mt-6">Account</div>
          {loading ? (
            <div className="font-sans text-[13px] text-ink/40">Checking sign-in status…</div>
          ) : user ? (
            <>
              {/* This is about lists/notes/highlights syncing to the account (docs/offline-sync.md), a
               separate mechanism from the corpus caching above — grouped here anyway since both
               read as "offline-related status" to a user, and neither means anything signed out.
               A lapsed session replaces it rather than joining it: `user` is still populated (it's
               cached in lib/lastUser.ts and a flush 401 deliberately doesn't clear it, since that
               would mount an empty mirror over a full one), so without this the section renders as
               a perfectly ordinary signed-in account and the banner that sent the user here points
               at a sign-in button that isn't there. `syncStatus` would meanwhile report the queue
               as 'pending', which is true but misleading — nothing is being sent while paused. */}
              {needsReauth ? (
                <>
                  <div className="flex items-start gap-1.5 font-sans text-[13px] mb-4 text-red-600">
                    <AlertTriangle size={13} strokeWidth={1.75} className="flex-none mt-[3px]" />
                    <span>
                      Your session expired, so nothing is syncing. Your changes are saved on this device and will sync
                      once you sign in again.
                    </span>
                  </div>
                  <GoogleSignInButton />
                  {authError && <div className="font-sans text-[13px] text-red-600 mt-2">{authError}</div>}
                  <div className="font-sans text-[13px] text-ink/60 mb-1 mt-6">Signed in as</div>
                </>
              ) : (
                <>
                  {(() => {
                    const { Icon, spin, text } = syncStatusLine(syncStatus, pendingCount, lastSyncedAt);
                    return (
                      <div className={`flex items-center gap-1.5 font-sans text-[13px] mb-6 ${syncStatus === 'stuck' ? 'text-red-600' : 'text-ink/50'}`}>
                        <Icon size={13} strokeWidth={1.75} className={`flex-none ${spin ? 'animate-[spin_2s_linear_infinite]' : ''}`} />
                        {text}
                      </div>
                    );
                  })()}
                  <div className="font-sans text-[13px] text-ink/60 mb-1">Signed in as</div>
                </>
              )}
              <div className="text-[16px] mb-3">{user.name ? `${user.name} · ${user.email}` : user.email}</div>
              {/* Hidden while the session is dead rather than left to fail: this is a plain link to
                  a requireAuth route, so it would answer 401 and hand back an error body as a
                  download. Sign out below stays — POST /api/auth/logout is unauthenticated, so it
                  works either way, and leaving the account is a legitimate thing to want here. */}
              {!needsReauth && (
                <a
                  href={dataApi.exportUrl}
                  className="block w-full text-center h-11 leading-[44px] rounded-field border border-ink/[.22] font-sans text-[14px] font-medium mb-3"
                >
                  Export my data as JSON
                </a>
              )}
              <button
                className="flex items-center justify-center gap-1.5 w-full h-11 rounded-field bg-accent text-[#FBFAF7] font-sans text-[14px] font-medium"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                <LogOut size={15} strokeWidth={1.75} />
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="font-sans text-[14px] text-ink/60 mb-4">
                Sign in with Google to sync your lists, notes and highlights across devices.
              </div>
              <GoogleSignInButton />
              {authError && <div className="font-sans text-[13px] text-red-600 mt-2">{authError}</div>}
            </>
          )}
        </div>

        <a
          href="https://github.com/gbbr/sutamaya.org/issues/new"
          target="_blank"
          rel="noreferrer"
          className="block text-center font-sans text-[12px] text-ink/40 underline decoration-ink/25 underline-offset-2 mt-8"
        >
          Report an issue
        </a>
      </div>
    </div>
  );
}
