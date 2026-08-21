import { navigate } from '@reach/router';
import { AlertTriangle, Check, CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUserData } from '../context/UserDataContext';
import type { SyncStatus } from '../context/UserDataContext';
import { hasLocalWorkWorthKeeping } from '../lib/keepSafe';

// Answers "where does my work live right now" at the right end of TreePane's footer, opposite Help.
// Signing in is never required here (see docs/offline-sync.md), so a plain sync readout would be
// blank — and so a lie by omission — for anyone signed out; naming the *location* instead means
// the slot always has something true to say, whichever way the app is being used.
//
// The icon is always shown and the label only when something is actually wrong. A calm state
// resolves itself and a glance is enough; a warning that needs decoding before it can be acted on
// is a warning nobody acts on, and this one can't rely on a tooltip (nobody hovers, and mobile
// can't). "Offline" is the one calm state that keeps its words: unlike syncing or synced, it's a
// condition someone may want to confirm rather than merely notice.
//
// Amber for everything that isn't calm, never red: red belongs to the header banner, which is the
// surface that interrupts. This one is standing status and shouldn't compete with it — most of
// these states raise a banner at the same time.
interface Status {
  Icon: typeof Check;
  spin: boolean;
  text: string;
  warn: boolean;
  label: string;
}

function statusFor(signedIn: boolean, sync: SyncStatus, needsReauth: boolean, atRisk: boolean): Status {
  if (!signedIn) {
    return {
      Icon: HardDrive,
      spin: false,
      text: atRisk ? 'Local only' : '',
      warn: atRisk,
      label: 'Your work is saved on this device only — open Settings',
    };
  }
  // A lapsed session before a stuck queue: both leave changes unsent, but this is the one the user
  // can actually end, and until they do nothing retries at all (see UserDataContext's `needsReauth`).
  if (needsReauth) {
    return { Icon: AlertTriangle, spin: false, text: 'Sign in', warn: true, label: 'Signed out — changes are not syncing' };
  }
  if (sync === 'offline') {
    return { Icon: CloudOff, spin: false, text: 'Offline', warn: false, label: 'Offline — changes will sync when you reconnect' };
  }
  // Refused by the server rather than merely queued, but still retried on every flush — so it says
  // what's happening rather than asking for something that wouldn't help.
  if (sync === 'stuck') {
    return { Icon: AlertTriangle, spin: false, text: 'Retrying', warn: true, label: "Some changes haven't synced yet — open Settings" };
  }
  if (sync === 'pending') {
    return { Icon: RefreshCw, spin: true, text: '', warn: false, label: 'Syncing your changes' };
  }
  return { Icon: Check, spin: false, text: '', warn: false, label: 'Everything is synced — open Settings' };
}

export function DataStatus() {
  const { user } = useAuth();
  const { syncStatus, needsReauth, lists, notes, highlights } = useUserData();
  const { Icon, spin, text, warn, label } = statusFor(
    !!user,
    syncStatus,
    needsReauth,
    hasLocalWorkWorthKeeping(lists, notes, highlights),
  );
  return (
    <button
      data-component="DataStatus"
      // Its own vertical padding rather than the footer's, so the tap target is the full height of
      // the bar on either end — see TreePane's footer.
      className={`flex-none flex items-center gap-[7px] min-w-0 pl-3 pr-[18px] py-[11px] font-sans text-[12.5px] ${
        warn ? 'text-warning-text' : 'text-ink/45 hover:text-ink/70'
      }`}
      aria-label={label}
      // Supplement, not the explanation: the states that carry no words are the calm ones, where
      // the icon is enough on its own and the tooltip only confirms it for whoever pauses. Nothing
      // a reader has to act on depends on hovering — mobile can't.
      title={label}
      onClick={() => navigate('/settings', { state: { scrollTo: 'auth' } })}
    >
      {text && <span className="truncate">{text}</span>}
      <Icon
        size={14}
        strokeWidth={2}
        className={`flex-none ${warn ? '' : 'text-ink/35'} ${spin ? 'animate-[spin_2s_linear_infinite]' : ''}`}
      />
    </button>
  );
}
