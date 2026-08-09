import { useEffect, useRef, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUiPrefs } from '../context/UiPrefsContext';
import { useCorpus } from '../context/CorpusContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { dataApi } from '../lib/api';
import { flatSuttaOrder } from '../lib/corpus';
import { estimateOfflineStatus, prefetchAllSuttas } from '../lib/offline';
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

export function SettingsPage(_props: RouteComponentProps) {
  const { user, logout, loading, authError } = useAuth();
  const { uiScale, uiFace, theme, setUiScale, setUiFace, setTheme } = useUiPrefs();
  const { corpus } = useCorpus();

  const [offlineStatus, setOfflineStatus] = useState<'idle' | 'downloading'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [cachedStatus, setCachedStatus] = useState<{ cached: number; total: number } | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [circuitTripped, setCircuitTripped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
    // catch, not just finally — prefetchAllSuttas is designed to resolve normally even when
    // individual suttas fail (that's what the returned `failed` list is for), but this still
    // guards against something genuinely unexpected (e.g. Cache Storage itself unavailable)
    // turning into an unhandled rejection instead of the UI cleanly recovering to idle.
    try {
      const { failed, circuitTripped: tripped } = await prefetchAllSuttas(uids, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setFailedCount(failed.length);
      setCircuitTripped(tripped);
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

  // Same genuine history-back as the "Back" button above (see its own comment) — Escape is the
  // conventional "leave this screen" key, and there's no free-text field here whose own Escape
  // handling would need to take priority over it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') navigate(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // items-start, not the flex default (stretch) — stretch caps this column at the container's own
  // height, so its content overflows past its box (and past its own pb-10, which then sits inside
  // that capped box instead of after the real, overflowing end of the content) rather than growing
  // the column to its natural (taller) content height the way scrolling needs.
  return (
    <div data-component="SettingsPage" className="sc h-full bg-paper px-5 pt-10 flex justify-center items-start">
      <div className="w-full max-w-[420px] pb-10">
        {/* Genuine history-back (not navigate('/')) — `/` always redirects to /browse/mn (see
            App.tsx), which would silently discard whatever nodeId/list/scroll state the user
            had before opening Settings. */}
        <button className="flex items-center gap-1.5 font-sans text-[13px] text-ink/50 mb-6" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <div className="text-[22px] font-semibold tracking-[-.01em] mb-6">Settings</div>

        <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-3">Display</div>

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
              UI scale
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
          <div className="font-sans text-[14px] mb-2">UI font</div>
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

        <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-3">Offline</div>

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
                <span>
                  {progress.done} of {progress.total}
                </span>
                <button className="underline decoration-ink/25 underline-offset-2" onClick={handleCancelOfflineDownload}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="font-sans text-[13px] text-ink/60 mb-2">
                {cachedStatus
                  ? cachedStatus.cached >= cachedStatus.total
                    ? 'All suttas available offline.'
                    : `${cachedStatus.cached.toLocaleString()} of ${cachedStatus.total.toLocaleString()} suttas available offline.`
                  : 'Checking offline availability…'}
              </div>
              <button
                className="block w-full text-center h-11 rounded-field border border-ink/[.22] font-sans text-[14px] font-medium disabled:opacity-50"
                onClick={handleDownloadOffline}
                disabled={!corpus}
              >
                Download all suttas for offline
              </button>
              {failedCount > 0 &&
                (circuitTripped ? (
                  <div className="font-sans text-[13px] text-red-600 mt-2">
                    Stopped early after repeated failures — {failedCount} couldn't be downloaded.
                  </div>
                ) : (
                  <div className="font-sans text-[13px] text-red-600 mt-2">{failedCount} couldn't be downloaded — try again.</div>
                ))}
            </>
          )}
        </div>

        {/* loading gates only this account section now, not the whole page — Display/Offline
            above render immediately regardless. Auth resolution retries with backoff on any
            network hiccup (see AuthContext), which competes with this page's own heavy download
            traffic for bandwidth on mobile; blanking the entire page for however long that takes
            was needlessly punishing when only this section actually depends on it. */}
        {loading ? null : user ? (
          <>
            <div className="font-sans text-[13px] text-ink/60 mb-1">Signed in as</div>
            <div className="text-[16px] mb-6">{user.name ? `${user.name} · ${user.email}` : user.email}</div>
            <a
              href={dataApi.exportUrl}
              className="block w-full text-center h-11 leading-[44px] rounded-field border border-ink/[.22] font-sans text-[14px] font-medium mb-3"
            >
              Export my data as JSON
            </a>
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
            <GoogleSignInButton variant="standard" />
            {authError && <div className="font-sans text-[13px] text-red-600 mt-2">{authError}</div>}
          </>
        )}
      </div>
    </div>
  );
}
