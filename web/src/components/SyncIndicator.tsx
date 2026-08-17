import type { CSSProperties } from 'react';
import { Check, RefreshCw, CloudOff, AlertTriangle, LogIn } from 'lucide-react';
import type { SyncStatus } from '../context/UserDataContext';

interface SyncIndicatorProps {
  status: SyncStatus;
  pendingCount: number;
  needsReauth: boolean;
  onReauth: () => void;
  size: number;
}

// The account badge's neighbour in TreePane's header — what state the offline sync queue is in
// (see offline-sync.md's "Sync state"), as a single icon rather than a status line, since this sits in
// chrome that's visible on every load and shouldn't cost more than a glance. `needsReauth` takes
// priority over everything else: the session has lapsed and no amount of waiting fixes that, where
// every other state resolves on its own. Clicking it is the only interactive case — it calls
// promptGoogleSignIn() directly, which is the right place for that navigation because it is now a
// direct response to the user's own action rather than a background flush deciding on its own to
// interrupt whatever they were doing.
export function SyncIndicator({ status, pendingCount, needsReauth, onReauth, size }: SyncIndicatorProps) {
  const dim: CSSProperties = { width: size, height: size };
  const iconSize = Math.round(size * 0.56);

  if (needsReauth) {
    return (
      <button
        data-component="SyncIndicator"
        className="flex-none rounded-full flex items-center justify-center text-red-600 hover:bg-red-600/10"
        style={dim}
        aria-label="Sign-in expired — click to sign in again"
        title="Sign-in expired — your changes are saved and will sync once you sign in again"
        onClick={onReauth}
      >
        <LogIn size={iconSize} strokeWidth={2} />
      </button>
    );
  }

  if (status === 'offline') {
    return (
      <div
        data-component="SyncIndicator"
        className="flex-none rounded-full flex items-center justify-center text-ink/40"
        style={dim}
        aria-label="Offline — changes are saved locally and will sync when you're back online"
        title="Offline — changes are saved locally and will sync when you're back online"
      >
        <CloudOff size={iconSize} strokeWidth={1.75} />
      </div>
    );
  }

  // A permanently-refused write still counts toward `pendingCount` (see syncCounts in lib/mirror.ts
  // — it keeps being retried), so this is shown instead of, not alongside, the plain pending count.
  if (status === 'stuck') {
    return (
      <div
        data-component="SyncIndicator"
        className="flex-none rounded-full flex items-center justify-center text-red-600"
        style={dim}
        aria-label="Some changes couldn't be synced"
        title="Some changes couldn't be synced and will keep being retried"
      >
        <AlertTriangle size={iconSize} strokeWidth={1.75} />
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div
        data-component="SyncIndicator"
        className="flex-none rounded-full flex items-center justify-center text-ink/40"
        style={dim}
        aria-label={`Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}`}
        title={`Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}`}
      >
        <RefreshCw size={iconSize} strokeWidth={1.75} className="animate-[spin_2s_linear_infinite]" />
      </div>
    );
  }

  return (
    <div
      data-component="SyncIndicator"
      className="flex-none rounded-full flex items-center justify-center text-ink/30"
      style={dim}
      aria-label="Synced"
      title="Synced"
    >
      <Check size={iconSize} strokeWidth={2} />
    </div>
  );
}
