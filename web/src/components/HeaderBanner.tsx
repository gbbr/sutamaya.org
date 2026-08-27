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
// The dismissal state and `hasOpenedSutta` are read once per mount rather than subscribed live,
// since this remounts with TreePane on the route boundary that changes them — returning from
// /read/:suttaId — and each dismiss button sets local state directly.
//
// At most one banner is dismissed per mount: dismissing one leaves the slot empty rather than
// swapping in the next one down, which in the same card and place would read as the dismiss having
// failed. The successor waits for the next mount, which is every return from the reader.

// Exported so tests assert against the same strings this component actually renders, rather than
// a copy that can drift out of sync with it.
export const OFFLINE_DOWNLOAD_TEXT = 'Keep reading offline';
export const OFFLINE_UPDATE_TEXT = 'Updated sutta text available';
export const REAUTH_TEXT = "Changes not syncing";
export const KEEP_SAFE_TEXT = 'Save your changes';
// Same wording as KEEP_SAFE_TEXT: the iOS browser-tab case, where WebKit wipes script-writable
// storage after about seven days of inactivity, is escalated by tone rather than by words.
export const KEEP_SAFE_IOS_TEXT = 'Save your changes';

// Three tones for three kinds of message: red is broken and needs fixing, amber is data at risk,
// accent is an optional improvement. They have to be told apart at a glance, since they share one
// slot and arrive one after another in the same card. Amber matches how Settings' Account card
// renders this same risk.
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
    // A tinted card inset from both edges rather than a full-bleed bar: the header ends in the tab
    // underline, and a second full-width band under it would repeat that edge and leave the active
    // tab pointing at the message instead of at the list it labels.
    //
    // 12px of margin plus 12px of padding puts the icon on the 24px the tree rows start their text
    // from, so the card lines up with the column below rather than with the header's own 22px
    // padding. `rounded-field` is the app's one card radius.
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
  // Set by any dismiss that can uncover a lower-priority banner, to hold the slot empty until the
  // next mount. Only "keep this safe" can, so far — the two offline nudges are mutually exclusive
  // and nothing ranks below them.
  const [dismissedThisMount, setDismissedThisMount] = useState(false);
  const [offlineCachedStatus, setOfflineCachedStatus] = useState<{ cached: number; total: number } | null>(null);
  // The download nudge is PWA-only: asking for ~28MB in a passing browser tab is pushy, and it is
  // an installed app that has use for the whole canon. The update nudge is not, since it can only
  // fire for someone who already finished that download — CacheFirst serves them the same stale
  // text in a tab as in the PWA.
  const downloadNudgeEligible = isStandalone() && hasOpenedSutta();
  const textStale = !!corpus && isOfflineTextStale(corpus.dataVersion);
  useEffect(() => {
    // Cache Storage membership over the whole corpus isn't free, so it runs only once the cheap
    // synchronous checks above say a banner could plausibly show. `textStale` is a localStorage
    // compare and is false for anyone who never bulk-downloaded, which keeps this off the common
    // path.
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
    // A lapsed session is the one sync state worth interrupting for: the account badge still shows
    // a signed-in user (seeded from lib/lastUser.ts) and everything still reads and writes against
    // the local mirror, so the app looks normal while nothing reaches the server. Every other state
    // either resolves on its own or can't be acted on, and Settings' Account card spells them out.
    // Not dismissible — the only thing that resolves it is signing in, which the button does.
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
    // Signed out, with something to lose. On iOS in a browser tab that is literal — WebKit evicts
    // all script-writable storage for a site left unvisited for about a week — so that case gets
    // the red tone rather than amber. Naming Safari would be wrong on iOS Chrome and the other
    // non-Safari browsers, which share the same WebKit storage engine, so only the tone escalates.
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
