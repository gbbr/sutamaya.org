import { dataApi, type PushItem, type PushResult } from './api';
import { isRetryable, statusOf } from './retry';
import { randomId } from './ids';
import type { FlushAck, FlushOutcome, MirrorState, QueuedOp } from './mirror';
import type { UserData } from './api';

// The flush: everything the mirror holds that the server hasn't seen, pushed to POST /api/data/push
// in chunks, followed by a pull that folds the merged result back in. One sync is a couple of
// requests however much is queued — a first sign-in after a long signed-out session would otherwise
// issue one request per edit and spend most of them being rate-limited.
//
// Two rules shape the order, and the push preserves it. **Records before operations**, because a
// list created offline and then filled with suttas produces one record and several ops, and an op
// naming a list the server has never seen is refused and thrown away. And **list creates in mtime
// order**, because a child created after its parent must reach the server after it (an unknown
// parent is refused), and because the server prepends each new list the same way the client does —
// so pushing them in the order the user made them reproduces the order the user sees.
//
// Nothing here mutates the caller's state. It reports what landed, and lib/mirror.ts's
// applyFlushOutcome folds that into whatever the mirror looks like by the time it returns — not
// necessarily what the flush started from, since the user keeps editing while it is out.

// One queued write, with what the mirror needs back once the server has answered it: a record
// carries the `ack` that clears its dirty flag, an operation the `opId` that retires it.
interface Push {
  item: PushItem;
  ack?: FlushAck;
  opId?: string;
}

// Matches PUSH_MAX_ITEMS in worker/src/routes/data.js, which refuses anything larger. The two
// workspaces share no modules, so this is a deliberate second copy — change one, change the other.
const CHUNK_SIZE = 100;

// How many fresh ids to try before giving up on a colliding create. A v4 UUID won't collide by
// chance, so this is about the failure staying legible, not about it being likely.
const MAX_ID_ATTEMPTS = 4;

function opItem(op: QueuedOp): PushItem {
  if (op.type === 'add') return { type: 'item.add', listId: op.listId, suttaId: op.suttaId };
  if (op.type === 'remove') return { type: 'item.remove', listId: op.listId, suttaId: op.suttaId };
  if (op.type === 'siblingOrder') return { type: 'sibling.order', parentId: op.parentId, order: op.order, mtime: op.mtime };
  return { type: 'item.order', listId: op.listId, order: op.order, mtime: op.mtime };
}

// Everything the mirror owes the server, in the order it has to arrive in.
function buildQueue(state: MirrorState): Push[] {
  const queue: Push[] = [];

  const dirtyLists = Object.values(state.lists)
    .filter((record) => record.dirty)
    .sort((a, b) => (a.data.mtime < b.data.mtime ? -1 : 1));
  for (const { data } of dirtyLists) {
    const ack: FlushAck = { kind: 'list', id: data.id, mtime: data.mtime };
    if (data.deleted) queue.push({ ack, item: { type: 'list.delete', id: data.id, mtime: data.mtime } });
    // The create carries the record's current state, not the state it was created with — a list
    // renamed or moved before it ever reached the server needs one item, not two.
    else if (data.pendingCreate)
      queue.push({
        ack,
        item: { type: 'list.create', id: data.id, label: data.label, parentId: data.parentId, kind: data.kind, mtime: data.mtime },
      });
    else
      queue.push({
        ack,
        item: { type: 'list.update', id: data.id, label: data.label, parentId: data.parentId, mtime: data.mtime },
      });
  }

  for (const { dirty, data } of Object.values(state.notes)) {
    if (!dirty) continue;
    queue.push({
      ack: { kind: 'note', id: data.suttaId, mtime: data.mtime },
      item: { type: 'note', suttaId: data.suttaId, text: data.text, mtime: data.mtime },
    });
  }

  for (const { dirty, data } of Object.values(state.highlights)) {
    if (!dirty) continue;
    queue.push({
      ack: { kind: 'highlight', id: data.g, mtime: data.mtime },
      item: {
        type: 'highlight',
        suttaId: data.suttaId,
        ranges: data.ranges,
        color: data.color,
        g: data.g,
        erase: data.erase,
        mtime: data.mtime,
      },
    });
  }

  for (const { dirty, data } of Object.values(state.visited)) {
    if (!dirty) continue;
    queue.push({
      ack: { kind: 'visited', id: data.suttaId, mtime: data.visitedAt },
      item: { type: 'visited', suttaId: data.suttaId, visitedAt: data.visitedAt },
    });
  }

  // Item ops last, and in the order the user made them — an add and a later remove of the same
  // sutta only mean what they should if they arrive that way round.
  for (const op of [...state.ops].sort((a, b) => a.seq - b.seq)) queue.push({ opId: op.id, item: opItem(op) });

  return queue;
}

// Renames every reference to a list id in one queued write, for a create whose id turned out to
// belong to another account. Applied to the colliding create and everything still behind it — a
// child naming it as parent, an add filing a sutta into it, an order listing it among siblings —
// so the rest of the queue can go out under the new id without being rebuilt.
function remapPush(push: Push, from: string, to: string): Push {
  const swap = (id: string | null) => (id === from ? to : id);
  const { item, ack } = push;
  let next: PushItem = item;
  if (item.type === 'list.create') next = { ...item, id: swap(item.id) as string, parentId: swap(item.parentId) };
  else if (item.type === 'list.update') next = { ...item, id: swap(item.id) as string, parentId: swap(item.parentId) };
  else if (item.type === 'list.delete') next = { ...item, id: swap(item.id) as string };
  else if (item.type === 'item.add' || item.type === 'item.remove' || item.type === 'item.order')
    next = { ...item, listId: swap(item.listId) as string };
  else if (item.type === 'sibling.order')
    next = { ...item, parentId: swap(item.parentId), order: item.order.map((id) => swap(id) as string) };
  if (next === item && !(ack?.kind === 'list' && ack.id === from)) return push;
  return { ...push, item: next, ack: ack?.kind === 'list' && ack.id === from ? { ...ack, id: to } : ack };
}

export async function flushMirror(state: MirrorState): Promise<FlushOutcome> {
  const acks: FlushAck[] = [];
  const doneOps: string[] = [];
  const remaps: { from: string; to: string }[] = [];
  // Set by the first failure that means "stop": there is no point pushing the rest of the queue at
  // a network that isn't there or a session that has lapsed, and stopping keeps the ops in order.
  let halted: 'offline' | 'unauthorized' | null = null;

  let queue = buildQueue(state);
  let cursor = 0;
  // Fresh ids tried so far on the create at `collisionAt`, so a create that somehow keeps colliding
  // is given up on rather than looping. Counted per position, since a later create in the same
  // flush colliding is a separate failure with its own budget.
  let collisionAt: number | null = null;
  let idAttempts = 0;

  while (cursor < queue.length && !halted) {
    const chunk = queue.slice(cursor, cursor + CHUNK_SIZE);
    let results: PushResult[];
    try {
      ({ results } = await dataApi.push(chunk.map((push) => push.item)));
    } catch (err) {
      const status = statusOf(err);
      // A whole-request refusal that isn't a lapsed session or a retryable failure means this
      // client built a push the server won't parse — a bug here, and one that can't be pinned on
      // any single item, so nothing is retired. It is logged and the queue is left intact.
      if (status !== 401 && !isRetryable(status)) console.error('sync could not push a batch', err);
      halted = status === 401 ? 'unauthorized' : 'offline';
      break;
    }
    if (results.length !== chunk.length) {
      console.error('sync got a push result of the wrong length', { sent: chunk.length, got: results.length });
      halted = 'offline';
      break;
    }

    let collided = false;
    for (let i = 0; i < chunk.length; i += 1) {
      const { item, ack, opId } = chunk[i];
      const result = results[i];

      // The id belongs to another account, so no retry under it can ever succeed. Mint a fresh one
      // and rewrite every reference to it — the create itself, children, queued ops — or this
      // record could never drain. The rest of this chunk goes out again under the new id.
      const at = cursor + i;
      const attempts = collisionAt === at ? idAttempts : 0;
      if (!('ok' in result) && result.status === 409 && item.type === 'list.create' && attempts < MAX_ID_ATTEMPTS) {
        const from = item.id;
        const to = randomId();
        remaps.push({ from, to });
        queue = queue.map((push, index) => (index < at ? push : remapPush(push, from, to)));
        cursor = at;
        collisionAt = at;
        idAttempts = attempts + 1;
        collided = true;
        break;
      }

      // Everything else retires the write, whether it landed or not. A refusal is permanent by
      // definition, so there is no version of it that a later attempt would answer differently: the
      // write is given up on, and the pull at the end of this flush hands back the account's own
      // version of that row — the same rebase a write losing last-writer-wins already gets. That
      // client and server disagreed about validity at all is a bug in one of them, so it goes to
      // the console for whoever is watching, and nowhere near the reader, who has nothing to
      // decide. A 404 is the exception: the row is gone — deleted on another device, or cascaded
      // out with a deleted ancestor — so the write is moot rather than failed.
      if (!('ok' in result) && result.status !== 404) {
        console.error('sync gave up on a permanently refused write', { item, error: result.error });
      }
      if (ack) acks.push(ack);
      if (opId) doneOps.push(opId);
    }

    if (!collided) cursor += chunk.length;
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

const BLOCKED: FlushOutcome = {
  status: 'blocked',
  acks: [],
  doneOps: [],
  remaps: [],
  snapshot: null,
};

// One flusher at a time across every tab and PWA window on the device. They share one mirror, so
// two flushing at once would push the same records twice — harmless, since every write is
// idempotent, but it doubles the traffic and lets two snapshots land out of order. `ifAvailable`
// means a tab that loses the race skips this round rather than queueing behind the winner. Where
// Web Locks aren't available the flush simply runs; the writes are still safe.
const FLUSH_LOCK = 'sutamaya.flush';

export async function flushWithLock(state: MirrorState): Promise<FlushOutcome> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return flushMirror(state);
  return locks.request(FLUSH_LOCK, { ifAvailable: true }, (lock) => (lock ? flushMirror(state) : Promise.resolve(BLOCKED)));
}
