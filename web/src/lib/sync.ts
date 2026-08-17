import { dataApi, highlightsApi, listsApi, notesApi, visitedApi } from './api';
import { isRetryable, statusOf } from './retry';
import { randomId } from './ids';
import { remapListId, type FlushAck, type FlushOutcome, type MirrorState, type QueuedOp } from './mirror';
import type { UserData } from './api';

// The flush: everything the mirror holds that the server hasn't seen, pushed through the ordinary
// endpoints, followed by a pull that folds the merged result back in.
//
// Two rules shape the order. **Records before operations**, because a list created offline and
// then filled with suttas produces one record and several ops, and an op naming a list the server
// has never seen 404s and is thrown away. And **list creates in mtime order**, because a child
// created after its parent must reach the server after it (POST /lists rejects an unknown parent),
// and because the server prepends each new list the same way the client does — so pushing them in
// the order the user made them reproduces the order the user sees.
//
// Nothing here mutates the caller's state. It reports what landed, and lib/mirror.ts's
// applyFlushOutcome folds that into whatever the mirror looks like by the time it returns — which
// is not necessarily what the flush started from, since the user keeps editing while it is out.

type Verdict = 'ok' | 'gone' | 'permanent' | 'unauthorized' | 'retryable' | 'collision';

async function send(run: () => Promise<unknown>): Promise<Verdict> {
  try {
    await run();
    return 'ok';
  } catch (err) {
    const status = statusOf(err);
    if (status === 401) return 'unauthorized';
    // Only POST /lists answers this, when the client-minted id belongs to another account.
    if (status === 409) return 'collision';
    // The row is gone — deleted on another device, or cascaded out with a deleted ancestor. The
    // write is moot rather than failed, so it is retired rather than retried forever.
    if (status === 404) return 'gone';
    return isRetryable(status) ? 'retryable' : 'permanent';
  }
}

function runOp(op: QueuedOp): Promise<unknown> {
  if (op.type === 'add') return listsApi.addItem(op.listId, op.suttaId);
  if (op.type === 'remove') return listsApi.removeItem(op.listId, op.suttaId);
  return listsApi.reorderItems(op.listId, op.order, op.mtime);
}

// How many fresh ids to try before giving up on a colliding create. A v4 UUID will not collide by
// chance, so this is about the failure staying legible rather than about it being likely.
const MAX_ID_ATTEMPTS = 4;

export async function flushMirror(state: MirrorState): Promise<FlushOutcome> {
  const acks: FlushAck[] = [];
  const doneOps: string[] = [];
  const remaps: { from: string; to: string }[] = [];
  let working = state;
  // Set by the first failure that means "stop": there is no point pushing the rest of the queue at
  // a network that isn't there or a session that has lapsed, and stopping keeps the ops in order.
  let halted: 'offline' | 'unauthorized' | null = null;

  // Returns false when the flush should stop. A permanent rejection is neither acked nor retried
  // blindly: the record stays dirty, and a queue that never drains is what the sync indicator has
  // to surface.
  async function push(ack: FlushAck, run: () => Promise<unknown>): Promise<boolean> {
    return settle(ack, await send(run));
  }

  function settle(ack: FlushAck, verdict: Verdict): boolean {
    if (verdict === 'unauthorized' || verdict === 'retryable') {
      halted = verdict === 'unauthorized' ? 'unauthorized' : 'offline';
      return false;
    }
    // 'collision' only reaches here after MAX_ID_ATTEMPTS fresh ids all collided, which is not a
    // thing that happens — but acking it would clear the dirty flag for a create that never landed.
    if (verdict === 'permanent' || verdict === 'collision') console.error('sync rejected a record permanently', ack);
    else acks.push(ack);
    return true;
  }

  const dirtyLists = Object.values(working.lists)
    .filter((record) => record.dirty)
    .sort((a, b) => (a.data.mtime < b.data.mtime ? -1 : 1))
    .map((record) => record.data.id);

  for (const listId of dirtyLists) {
    const record = working.lists[listId];
    if (!record?.dirty) continue;
    const { data } = record;
    let landed: boolean;
    if (data.deleted) {
      landed = await push({ kind: 'list', id: listId, mtime: data.mtime }, () => listsApi.remove(listId, data.mtime));
    } else if (data.pendingCreate) {
      // The create carries the record's current state, not the state it was created with — a list
      // renamed or moved before it ever reached the server needs one request, not two.
      let current = data;
      let verdict: Verdict = 'collision';
      for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && verdict === 'collision'; attempt += 1) {
        const { id, label, parentId, kind, mtime } = current;
        verdict = await send(() => listsApi.create({ id, label, parentId, kind, mtime }));
        if (verdict !== 'collision') break;
        // The id belongs to another account, so no retry under it can ever succeed. Mint a fresh
        // one and rewrite the local record and every reference to it — children and queued ops
        // alike — or this record could never drain.
        const to = randomId();
        remaps.push({ from: current.id, to });
        working = remapListId(working, current.id, to);
        current = working.lists[to].data;
      }
      landed = settle({ kind: 'list', id: current.id, mtime: current.mtime }, verdict);
    } else {
      landed = await push({ kind: 'list', id: listId, mtime: data.mtime }, () =>
        listsApi.update(listId, { label: data.label, parentId: data.parentId, position: data.position, mtime: data.mtime })
      );
    }
    if (!landed) break;
  }

  for (const { dirty, data } of Object.values(working.notes)) {
    if (halted) break;
    if (!dirty) continue;
    await push({ kind: 'note', id: data.suttaId, mtime: data.mtime }, () => notesApi.set(data.suttaId, data.text, data.mtime));
  }

  for (const { dirty, data } of Object.values(working.highlights)) {
    if (halted) break;
    if (!dirty) continue;
    await push({ kind: 'highlight', id: data.g, mtime: data.mtime }, () =>
      highlightsApi.setRanges(data.suttaId, data.ranges, data.color, { g: data.g, mtime: data.mtime, erase: data.erase })
    );
  }

  for (const { dirty, data } of Object.values(working.visited)) {
    if (halted) break;
    if (!dirty) continue;
    await push({ kind: 'visited', id: data.suttaId, mtime: data.visitedAt }, () => visitedApi.mark(data.suttaId, data.visitedAt));
  }

  // Item ops last, and in the order the user made them — an add and a later remove of the same
  // sutta only mean what they should if they arrive that way round.
  if (!halted) {
    for (const op of [...working.ops].sort((a, b) => a.seq - b.seq)) {
      const verdict = await send(() => runOp(op));
      if (verdict === 'unauthorized' || verdict === 'retryable') {
        halted = verdict === 'unauthorized' ? 'unauthorized' : 'offline';
        break;
      }
      // 'gone' is the list having been deleted elsewhere, which retires the op rather than failing
      // it. A permanent rejection stays queued, same as a rejected record.
      if (verdict === 'permanent') console.error('sync rejected a list operation permanently', op);
      else doneOps.push(op.id);
    }
  }

  // A full snapshot, not a delta: at this scale the payload is small enough that a sequence cursor
  // would be pure cost. Skipped when the flush already stopped — the pull would fail the same way.
  let snapshot: UserData | null = null;
  if (!halted) {
    try {
      snapshot = await dataApi.all();
    } catch (err) {
      halted = statusOf(err) === 401 ? 'unauthorized' : 'offline';
    }
  }

  return { status: halted ?? 'ok', acks, doneOps, remaps, snapshot };
}

const BLOCKED: FlushOutcome = { status: 'blocked', acks: [], doneOps: [], remaps: [], snapshot: null };

// One flusher at a time across every tab and PWA window on the device. They all share the same
// mirror, so two flushing at once would push the same records twice — harmless, since every write
// is idempotent, but it doubles the traffic and lets two snapshots land out of order. `ifAvailable`
// means a tab that loses the race skips this round rather than queueing behind the winner, which
// is right for something that runs again in seconds anyway. Where Web Locks aren't available the
// flush simply runs — the writes are still safe, and the alternative is not syncing at all.
const FLUSH_LOCK = 'sutamaya.flush';

export async function flushWithLock(state: MirrorState): Promise<FlushOutcome> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return flushMirror(state);
  return locks.request(FLUSH_LOCK, { ifAvailable: true }, (lock) => (lock ? flushMirror(state) : Promise.resolve(BLOCKED)));
}
