import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { AlertTriangle, Download, X } from 'lucide-react';
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

// The one banner slot below TreePane's header, and the four things that can occupy it. Everything
// it needs comes from context, so TreePane just renders it.
//
// Exactly one shows, in this order:
//   re-auth       – the session lapsed; nothing else says so and nothing syncs until it is fixed
//   keep safe     – signed out, with local work now worth losing
//   updated text  – a bulk-downloaded corpus has fallen behind this build
//   download      – the corpus isn't cached for offline reading yet
//
// Dismissing one leaves the slot empty for the rest of the mount rather than swapping in the next,
// which in the same place would read as the dismiss having failed; the successor waits for the
// next mount, which is every return from the reader. The dismissal state is read once per mount
// for the same reason.

// The banner texts, exported so tests assert against what actually renders.
export const OFFLINE_DOWNLOAD_TEXT = 'Keep reading offline';
export const OFFLINE_UPDATE_TEXT = 'Updated sutta text available';
export const REAUTH_TEXT = "Changes not syncing";
export const KEEP_SAFE_TEXT = 'Save your changes';
// The same words as KEEP_SAFE_TEXT: the iOS browser-tab case is escalated by tone, not wording.
export const KEEP_SAFE_IOS_TEXT = 'Save your changes';

// The three tones, which have to be told apart at a glance, sharing one slot as they do.
//   alert  – something is broken and needs fixing
//   warn   – data is at risk, as Settings' Account card renders the same risk
//   accent – an optional improvement
const TONES = {
  alert: { fill: 'bg-danger-text/[.09]', icon: 'text-danger-text', action: 'text-danger-text decoration-danger-text/40' },
  warn: { fill: 'bg-warning-text/[.10]', icon: 'text-warning-text', action: 'text-warning-text decoration-warning-text/40' },
  accent: { fill: 'bg-accent/[.09]', icon: 'text-ink-3', action: 'text-accent-text decoration-accent-text/40' },
} as const;

// One banner's chrome, so the four variants differ only in what they say and do.
function Banner({
  tone,
  icon,
  text,
  action,
  onAction,
  onDismiss,
}: {
  tone: keyof typeof TONES;
  icon: ReactNode;
  text: string;
  action: string;
  onAction: () => void;
  onDismiss?: () => void;
}) {
  const { fill, icon: iconClass, action: actionClass } = TONES[tone];
  return (
    // A tinted card inset from both edges rather than a full-bleed bar, which under the header's
    // tab underline would leave the active tab pointing at the message. The margin and padding
    // together put the icon on the 24px the tree rows start their text from.
    <div
      data-component="HeaderBanner"
      className={`flex-none flex items-center gap-2.5 mx-3 mt-3 px-3 py-3 rounded-field ${fill}`}
    >
      <span className={`flex-none ${iconClass}`}>{icon}</span>
      <div className="flex-1 min-w-0 font-sans text-ui-sm text-ink-2 truncate" title={text}>
        {text}
      </div>
      <button
        className={`flex-none font-sans text-ui-sm font-semibold underline underline-offset-2 ${actionClass}`}
        onClick={onAction}
      >
        {action}
      </button>
      {onDismiss && (
        <button
          className="flex-none flex items-center justify-center w-5 h-5 rounded-full text-ink-4 hover:bg-ink/[.08] hover:text-ink"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={16} strokeWidth={2} />
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
  // Keyed by the local id, so signing out — which mints a fresh one — offers the prompt again.
  const [keepSafeDismissed, setKeepSafeDismissed] = useState(() => isKeepSafeDismissed(localUserId));
  // Set by a dismiss that could uncover a lower-priority banner, holding the slot empty until the
  // next mount.
  const [dismissedThisMount, setDismissedThisMount] = useState(false);
  const [offlineCachedStatus, setOfflineCachedStatus] = useState<{ cached: number; total: number } | null>(null);
  // The download nudge is for an installed app that has opened a sutta; asking a passing browser
  // tab for the whole canon is pushy. The update nudge has no such gate, only ever firing for
  // someone who already finished that download.
  const downloadNudgeEligible = isStandalone() && hasOpenedSutta();
  const textStale = !!corpus && isOfflineTextStale(corpus.dataVersion);
  useEffect(() => {
    // Walking Cache Storage isn't free, so it waits until the synchronous checks above say a
    // banner could plausibly show.
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
  // Whether the corpus is fully cached is what makes the two offline nudges exclusive: download
  // it, or, once it is downloaded, refresh a copy that has fallen behind.
  const showOfflineNudge = downloadNudgeEligible && !nudgeDismissed && !!offlineCachedStatus && !fullyCached;
  const showUpdateNudge = textStale && fullyCached && !!corpus && updateDismissedVersion !== corpus.dataVersion;

  // Counted off the derived view rather than the mirror, so it means what the reader sees.
  const showKeepSafe = !isSignedIn && hasLocalWorkWorthKeeping(lists, notes, highlights) && !keepSafeDismissed;

  if (needsReauth) {
    // The one sync state worth interrupting for: the account badge still shows a signed-in user
    // and the mirror still reads and writes, so the app looks normal while nothing reaches the
    // server. Not dismissible, since only signing in resolves it.
    return (
      <Banner
        tone="alert"
        icon={<AlertTriangle size={18} strokeWidth={1.75} />}
        text={REAUTH_TEXT}
        action="Sign in"
        onAction={promptGoogleSignIn}
      />
    );
  }

  if (showKeepSafe) {
    // Signed out, with something to lose. On an iOS browser tab that is literal — WebKit evicts a
    // site's storage after about a week away — so that case takes the red tone.
    const ios = isIosBrowserTab();
    return (
      <Banner
        tone={ios ? 'alert' : 'warn'}
        icon={<AlertTriangle size={18} strokeWidth={1.75} />}
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
      icon={<Download size={18} strokeWidth={1.75} />}
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
