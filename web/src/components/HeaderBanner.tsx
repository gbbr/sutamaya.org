import { useEffect, useState } from 'react';
import { navigate } from '@reach/router';
import { AlertTriangle, Download, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { flatSuttaOrder } from '../lib/corpus';
import { estimateOfflineStatus, isOfflineTextStale } from '../lib/offline';
import {
  isStandalone,
  hasOpenedSutta,
  isOfflineNudgeDismissed,
  dismissOfflineNudge,
  dismissedOfflineUpdateVersion,
  dismissOfflineUpdate,
} from '../lib/pwaNudge';

// The one slot below TreePane's header, and the three mutually exclusive things that can occupy it.
// Takes no props: everything it needs comes from context, so TreePane just renders it.
//
// The dismissal state and `hasOpenedSutta` are read once per mount (not subscribed live) since this
// remounts with TreePane on the route boundary that actually changes them (returning from
// /read/:suttaId), and each dismiss button sets local state directly rather than waiting for one.
export function HeaderBanner() {
  const { corpus } = useCorpus();
  const { needsReauth } = useUserData();
  const { promptGoogleSignIn } = useAuth();

  const [nudgeDismissed, setNudgeDismissed] = useState(() => isOfflineNudgeDismissed());
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState(() => dismissedOfflineUpdateVersion());
  const [offlineCachedStatus, setOfflineCachedStatus] = useState<{ cached: number; total: number } | null>(null);
  // The download nudge is PWA-only: asking for ~28MB in a passing browser tab is pushy, and it's
  // an installed app that has any use for the whole canon. The update nudge isn't, because it can
  // only fire for someone who already *finished* that download — they've committed to offline
  // reading whether or not they installed the app, and CacheFirst serves them the same stale text
  // in a tab as in the PWA, so hiding it there just leaves them silently a year behind.
  const downloadNudgeEligible = isStandalone() && hasOpenedSutta();
  const textStale = !!corpus && isOfflineTextStale(corpus.dataVersion);
  useEffect(() => {
    // Cache Storage membership over the whole corpus isn't free — only bother once the cheap,
    // synchronous checks above already say a banner could plausibly show. `textStale` is one of
    // those checks (a localStorage compare), and is false for anyone who never bulk-downloaded,
    // which is what keeps this probe off the common path.
    if (!corpus || !(downloadNudgeEligible || textStale)) return;
    let cancelled = false;
    estimateOfflineStatus(flatSuttaOrder(corpus)).then((s) => {
      if (!cancelled) setOfflineCachedStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [corpus, downloadNudgeEligible, textStale]);
  const fullyCached = !!offlineCachedStatus && offlineCachedStatus.cached >= offlineCachedStatus.total;
  // The two offline nudges are made mutually exclusive by whether the corpus is fully cached:
  // download it for offline reading, or — once it is — refresh a copy that's fallen behind the text
  // this build serves.
  const showOfflineNudge = downloadNudgeEligible && !nudgeDismissed && !!offlineCachedStatus && !fullyCached;
  const showUpdateNudge = textStale && fullyCached && !!corpus && updateDismissedVersion !== corpus.dataVersion;

  function dismissOfflineNudgeBanner() {
    dismissOfflineNudge();
    setNudgeDismissed(true);
  }
  function dismissUpdateNudgeBanner() {
    if (!corpus) return;
    dismissOfflineUpdate(corpus.dataVersion);
    setUpdateDismissedVersion(corpus.dataVersion);
  }

  // A lapsed session is the one sync state worth interrupting for: nothing else in the UI changes
  // when it happens (the account badge still shows a signed-in user, seeded from lib/lastUser.ts,
  // and every list/note/highlight still reads and writes against the local mirror), so the app
  // looks entirely normal while nothing reaches the server. Every other state — draining, offline,
  // permanently refused — either resolves on its own or can't be acted on, and lives as text in
  // Settings' Offline section instead. Not dismissible: the only thing that resolves it is signing
  // in, which the button does. Takes the slot from the two nudges while it's up; those can wait.
  if (needsReauth) {
    return (
      <div
        data-component="HeaderBanner"
        className="flex-none flex items-center gap-2.5 px-[18px] py-2.5 border-b border-ink/10 bg-red-600/[.07]"
      >
        <AlertTriangle size={15} strokeWidth={1.75} className="flex-none text-red-600" />
        <div
          className="flex-1 min-w-0 font-sans text-[12.5px] text-ink/70 truncate"
          title="Your session expired. Changes are saved on this device and will sync once you sign in again."
        >
          Signed out — changes aren't syncing
        </div>
        <button
          className="flex-none font-sans text-[12.5px] font-semibold text-red-600 underline decoration-red-600/40 underline-offset-2"
          onClick={promptGoogleSignIn}
        >
          Sign in
        </button>
      </div>
    );
  }

  if (!showOfflineNudge && !showUpdateNudge) return null;

  return (
    <div
      data-component="HeaderBanner"
      className="flex-none flex items-center gap-2.5 px-[18px] py-2.5 border-b border-ink/10 bg-accent/[.06]"
    >
      <Download size={15} strokeWidth={1.75} className="flex-none text-ink/60" />
      <div className="flex-1 min-w-0 font-sans text-[12.5px] text-ink/70 truncate">
        {showUpdateNudge ? 'Updated sutta text is available' : 'Download the full canon for offline reading'}
      </div>
      <button
        className="flex-none font-sans text-[12.5px] font-semibold text-accent-text underline decoration-accent-text/40 underline-offset-2"
        onClick={() => navigate('/settings', { state: { scrollTo: 'offline' } })}
      >
        {showUpdateNudge ? 'Update' : 'Download'}
      </button>
      <button
        className="flex-none flex items-center justify-center w-5 h-5 rounded-full text-ink/40 hover:bg-ink/[.08] hover:text-ink"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={showUpdateNudge ? dismissUpdateNudgeBanner : dismissOfflineNudgeBanner}
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
