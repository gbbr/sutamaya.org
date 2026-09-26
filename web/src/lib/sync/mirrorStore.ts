import type { MirrorState } from './mirror';
import { loadMirror, writeMirror, type StoredMirror } from './mirrorDb';

// A change to the mirror, as every mutator in mirror.ts is: a function of the state it is applied
// to, so it can be applied again over another tab's save.
export type MirrorChange = (state: MirrorState) => MirrorState;

// The channel a tab announces each write on, by the id of the mirror it wrote.
const CHANNEL = 'sutamaya.mirror';

// Returns `state` with `changes` applied in order.
function replay(changes: MirrorChange[], state: MirrorState): MirrorState {
  return changes.reduce((s, change) => change(s), state);
}

// MirrorStore is this tab's copy of one identity's mirror, kept in step with the one every tab
// shares in IndexedDB (docs/offline-sync.md's "Tabs"). A change applies to the copy at once and is
// written behind it; a write finding that another tab has written since replays this tab's changes
// over that tab's save instead of writing over it.
export class MirrorStore {
  private state: MirrorState;
  // Whether the mirror has loaded; nothing is written before.
  private ready = false;
  // The revision of the shared mirror `state` was read at or last written as.
  private rev: string | null = null;
  // Changes applied to `state` and not yet written, oldest first.
  private pending: MirrorChange[] = [];
  private writeQueued = false;
  // This tab's reads and writes of the shared mirror, one at a time.
  private queue: Promise<void> = Promise.resolve();
  // Set by another tab's write landing while this one was still loading.
  private missed = false;
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null = null;

  constructor(
    // Whose mirror this is; null for the stand-in shown before any identity is known.
    private readonly userId: string | null,
    // What to show until the mirror has loaded.
    initial: MirrorState
  ) {
    this.state = initial;
    if (userId === null) return;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.addEventListener('message', this.onMessage);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
  }

  getSnapshot = (): MirrorState => this.state;

  // Whether the mirror has loaded.
  isReady = (): boolean => this.ready;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // Takes the mirror as read from IndexedDB; every change from here on is written.
  loaded({ state, rev }: StoredMirror): void {
    this.state = state;
    this.rev = rev;
    this.ready = true;
    this.pending = [];
    this.emit();
    if (!this.missed) return;
    this.missed = false;
    this.refresh();
  }

  // Applies a change to this tab's copy and queues its write. Before the mirror has loaded, the
  // change is shown but not kept: the load replaces it.
  apply(change: MirrorChange): void {
    const next = change(this.state);
    if (next === this.state) return;
    this.state = next;
    this.emit();
    if (!this.ready) return;
    this.pending.push(change);
    if (this.writeQueued) return;
    this.writeQueued = true;
    this.enqueue(() => this.write());
  }

  // Tells the other tabs of a write made to this mirror outside the store: an adoption, which the
  // account's load makes.
  announce(): void {
    this.channel?.postMessage(this.userId);
  }

  // Stops following the other tabs once this tab's own writes have landed, which the returned
  // promise waits for.
  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
      this.enqueue(() => this.channel?.close());
    }
    return this.queue;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private enqueue(task: () => Promise<void> | void): void {
    this.queue = this.queue.then(task).catch((e) => console.error('mirror store failed', e));
  }

  // Writes the pending changes. A failed write keeps them for the next one.
  private async write(): Promise<void> {
    this.writeQueued = false;
    const changes = this.pending;
    const state = this.state;
    this.pending = [];
    try {
      const written = await writeMirror(state, this.rev, (stored) => replay(changes, stored));
      this.rev = written.rev;
      // Rebased over another tab's save: this copy becomes that, with this tab's changes on top,
      // those made while the write was out included.
      if (written.state !== state) {
        this.state = replay(this.pending, written.state);
        this.emit();
      }
      this.announce();
    } catch (e) {
      this.pending = [...changes, ...this.pending];
      console.error('mirror save failed', e);
    }
  }

  // Re-reads the shared mirror after another tab's write. Skipped while this tab has changes
  // waiting, whose write replays them over that tab's save, and for a mirror no longer stored,
  // which this tab's next write puts back.
  private refresh(): void {
    if (this.closed) return;
    if (!this.ready) {
      this.missed = true;
      return;
    }
    this.enqueue(async () => {
      if (this.pending.length) return;
      try {
        const stored = await loadMirror(this.userId!);
        if (stored.rev === null || stored.rev === this.rev || this.pending.length) return;
        this.state = stored.state;
        this.rev = stored.rev;
        this.emit();
      } catch (e) {
        console.error('mirror refresh failed', e);
      }
    });
  }

  private onMessage = (e: MessageEvent): void => {
    if (e.data === this.userId) this.refresh();
  };

  // A tab coming back into view may have missed a write while it was hidden or frozen.
  private onVisible = (): void => {
    if (document.visibilityState === 'visible') this.refresh();
  };
}
