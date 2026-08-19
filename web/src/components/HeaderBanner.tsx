import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { AlertTriangle, Download, Info, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { flatSuttaOrder } from '../lib/corpus';
import { estimateOfflineStatus, isOfflineTextStale } from '../lib/offline';
import { dismissKeepSafe, isIosBrowserTab, isKeepSafeDismissed } from '../lib/localAccount';
import { hasLocalWorkWorthKeeping } from '../lib/keepSafe';
import {
  isStandalone,
  hasOpenedSutta,
  isOfflineNudgeDismissed,
  dismissOfflineNudge,
  dismissedOfflineUpdateVersion,
  dismissOfflineUpdate,
} from '../lib/pwaNudge';

// The one slot below TreePane's header, and the four mutually exclusive things that can occupy it.
// Takes no props: everything it needs comes from context, so TreePane just renders it.
//
// Exactly one banner shows at a time, in this order of priority:
//
//   1. **Re-auth** — the session lapsed. Nothing else in the UI says so, and nothing syncs until
//      it's fixed, so it outranks everything.
//   2. **Keep this safe** — signed out, with local work now worth losing. Outranks the offline
//      nudges because it's about data that may not survive, not about convenience.
//   3. **Updated text** — a bulk-downloaded corpus has fallen behind this build.
//   4. **Download** — the corpus isn't cached for offline reading yet.
//
// The dismissal state and `hasOpenedSutta` are read once per mount (not subscribed live) since this
// remounts with TreePane on the route boundary that actually changes them (returning from
// /read/:suttaId), and each dismiss button sets local state directly rather than waiting for one.
//
// At most one banner is dismissed per mount: dismissing one leaves the slot empty rather than
// swapping in the next one down the list, which — same bar, same place, same shape — reads as the
// dismiss having failed, so the second message gets closed unread. The successor waits for the next
// mount, which is every return from the reader.

// Exported so tests assert against the same strings this component actually renders, rather than
// a copy that can drift out of sync with it.
export const OFFLINE_DOWNLOAD_TEXT = 'Download the canon for offline reading';
export const OFFLINE_UPDATE_TEXT = 'Updated sutta text is available';
export const REAUTH_TEXT = "Signed out — changes aren't syncing";
export const KEEP_SAFE_TEXT = 'Saved temporarily on this device';
export const KEEP_SAFE_IOS_TEXT = 'Safari may erase your notes in 7 days';

// One banner's chrome, so the four variants differ only in what they say and do.
function Banner({
  tone,
  icon,
  text,
  action,
  onAction,
  onDismiss,
}: {
  tone: 'alert' | 'accent';
  icon: ReactNode;
  text: string;
  action: string;
  onAction: () => void;
  onDismiss?: () => void;
}) {
  const alert = tone === 'alert';
  return (
    <div
      data-component="HeaderBanner"
      className={`flex-none flex items-center gap-2.5 px-[18px] py-2.5 border-b border-ink/10 ${
        alert ? 'bg-red-600/[.07]' : 'bg-accent/[.06]'
      }`}
    >
      <span className={`flex-none ${alert ? 'text-danger-text' : 'text-ink/60'}`}>{icon}</span>
      <div className="flex-1 min-w-0 font-sans text-[12.5px] text-ink/70 truncate" title={text}>
        {text}
      </div>
      <button
        className={`flex-none font-sans text-[12.5px] font-semibold underline underline-offset-2 ${
          alert ? 'text-danger-text decoration-danger-text/40' : 'text-accent-text decoration-accent-text/40'
        }`}
        onClick={onAction}
      >
        {action}
      </button>
      {onDismiss && (
        <button
          className="flex-none flex items-center justify-center w-5 h-5 rounded-full text-ink/40 hover:bg-ink/[.08] hover:text-ink"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

export function HeaderBanner() {
  const { corpus } = useCorpus();
  const { needsReauth, lists, notes, highlights } = useUserData();
  const { promptGoogleSignIn, isSignedIn, localUserId } = useAuth();

  const [nudgeDismissed, setNudgeDismissed] = useState(() => isOfflineNudgeDismissed());
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState(() => dismissedOfflineUpdateVersion());
  // Keyed by the local id, so signing out — which mints a fresh one — offers the prompt again for
  // what is, as far as this device's unsynced work goes, a new body of work.
  const [keepSafeDismissed, setKeepSafeDismissed] = useState(() => isKeepSafeDismissed(localUserId));
  // Set by any dismiss that can uncover a lower-priority banner, to hold the slot empty until the
  // next mount. Only "keep this safe" can, so far — the two offline nudges are mutually exclusive
  // and nothing ranks below them.
  const [dismissedThisMount, setDismissedThisMount] = useState(false);
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

  // Counted off the derived view rather than the mirror, so it means the same thing the user sees:
  // auto-lists are excluded (they exist whether or not the user made anything), and a highlight is
  // counted per group — one selection, however many segments it spans.
  const showKeepSafe = !isSignedIn && hasLocalWorkWorthKeeping(lists, notes, highlights) && !keepSafeDismissed;

  if (needsReauth) {
    // A lapsed session is the one sync state worth interrupting for: nothing else in the UI changes
    // when it happens (the account badge still shows a signed-in user, seeded from lib/lastUser.ts,
    // and every list/note/highlight still reads and writes against the local mirror), so the app
    // looks entirely normal while nothing reaches the server. Every other state — draining,
    // offline, permanently refused — either resolves on its own or can't be acted on, and lives as
    // text in Settings' Offline section instead. Not dismissible: the only thing that resolves it
    // is signing in, which the button does.
    return (
      <Banner
        tone="alert"
        icon={<AlertTriangle size={15} strokeWidth={1.75} />}
        text={REAUTH_TEXT}
        action="Sign in"
        onAction={promptGoogleSignIn}
      />
    );
  }

  if (showKeepSafe) {
    // Signed out, and now with something to lose. On iOS in a browser tab that isn't a figure of
    // speech — WebKit evicts all script-writable storage for a site left unvisited for about a
    // week — so that case gets the specific warning rather than the general one. Both sentences
    // stay short enough to survive a phone-width pane without truncating; the button carries the
    // action so the text only has to carry the risk. "Temporarily" is the load-bearing word in
    // the general case: without it the line reads as a reassurance that the work is safely stored
    // here, when what it has to say is that nothing outside this device holds a copy of it.
    const ios = isIosBrowserTab();
    return (
      <Banner
        tone={ios ? 'alert' : 'accent'}
        icon={ios ? <AlertTriangle size={15} strokeWidth={1.75} /> : <Info size={15} strokeWidth={1.75} />}
        text={ios ? KEEP_SAFE_IOS_TEXT : KEEP_SAFE_TEXT}
        action="Sign in"
        onAction={promptGoogleSignIn}
        onDismiss={() => {
          dismissKeepSafe(localUserId);
          setKeepSafeDismissed(true);
          setDismissedThisMount(true);
        }}
      />
    );
  }

  if (dismissedThisMount || (!showOfflineNudge && !showUpdateNudge)) return null;

  return (
    <Banner
      tone="accent"
      icon={<Download size={15} strokeWidth={1.75} />}
      text={showUpdateNudge ? OFFLINE_UPDATE_TEXT : OFFLINE_DOWNLOAD_TEXT}
      action={showUpdateNudge ? 'Update' : 'Download'}
      onAction={() => navigate('/settings', { state: { scrollTo: 'offline' } })}
      onDismiss={
        showUpdateNudge
          ? () => {
              if (!corpus) return;
              dismissOfflineUpdate(corpus.dataVersion);
              setUpdateDismissedVersion(corpus.dataVersion);
            }
          : () => {
              dismissOfflineNudge();
              setNudgeDismissed(true);
            }
      }
    />
  );
}
