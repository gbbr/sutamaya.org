import { dataApi, type PushItem, type PushResult } from './api';
import { isRetryable, statusOf } from './retry';
import { randomId } from './ids';
import type { FlushAck, FlushOutcome, ListRecord, MirrorState, QueuedOp, Stored } from './mirror';
import type { UserData } from './api';

// The flush: everything the mirror holds that the server hasn't seen, pushed to POST /api/data/push
// in chunks, then a pull that folds the merged result back in. One sync costs a couple of requests
// however much is queued.
//
// Three rules order the queue, and the push preserves that order:
//   records before ops    – an op naming a list the server has never seen is refused
//   lists by mtime        – the server prepends a new list as the client does, so pushing them in
//                           the order the user made them reproduces the order the user sees
//   parents before children – enforced separately from mtime, which says when a row was last
//                           touched, not when it was created (orderListsForPush)
//
// Nothing here mutates the caller's state: it reports what landed, and applyFlushOutcome folds that
// into whatever the mirror looks like by the time it returns.

// One queued write, with what the mirror needs back once the server answers: a record carries the
// `ack` that clears its dirty flag, an op the `opId` that retires it.
interface Push {
  item: PushItem;
  ack?: FlushAck;
  opId?: string;
}

// Items per push request. Matches PUSH_MAX_ITEMS in worker/src/routes/data.js, which refuses
// anything larger; the two workspaces share no modules, so change one and change the other.
const CHUNK_SIZE = 10;

// How many fresh ids to try before giving up on a colliding create.
const MAX_ID_ATTEMPTS = 4;

// Returns the push item for one queued op.
function opItem(op: QueuedOp): PushItem {
  if (op.type === 'add') return { type: 'item.add', listId: op.listId, suttaId: op.suttaId };
  if (op.type === 'remove') return { type: 'item.remove', listId: op.listId, suttaId: op.suttaId };
  if (op.type === 'siblingOrder') return { type: 'sibling.order', parentId: op.parentId, order: op.order, mtime: op.mtime };
  return { type: 'item.order', listId: op.listId, order: op.order, mtime: op.mtime };
}

// Reorders mtime-sorted records so any naming a parent still waiting on its own create comes after
// that create — a rename bumping the parent's mtime past its children would otherwise leave it
// last. A deleted record carries no `parentId` and is never pulled forward, and `visiting` guards a
// cycle no valid tree can produce.
function orderListsForPush(records: Stored<ListRecord>[]): Stored<ListRecord>[] {
  const byId = new Map(records.map((record) => [record.data.id, record]));
  const ordered: Stored<ListRecord>[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();

  const emit = (record: Stored<ListRecord>) => {
    const id = record.data.id;
    if (emitted.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const parent = record.data.deleted || !record.data.parentId ? undefined : byId.get(record.data.parentId);
    if (parent?.data.pendingCreate) emit(parent);
    visiting.delete(id);
    emitted.add(id);
    ordered.push(record);
  };
  records.forEach(emit);
  return ordered;
}

// Everything the mirror owes the server, in the order it has to arrive in.
function buildQueue(state: MirrorState): Push[] {
  const queue: Push[] = [];

  const dirtyLists = orderListsForPush(
    Object.values(state.lists)
      .filter((record) => record.dirty)
      .sort((a, b) => (a.data.mtime < b.data.mtime ? -1 : 1))
  );
  for (const { data } of dirtyLists) {
    const ack: FlushAck = { kind: 'list', id: data.id, mtime: data.mtime };
    if (data.deleted) queue.push({ ack, item: { type: 'list.delete', id: data.id, mtime: data.mtime } });
    // A create carries the record's current state, so a list renamed before it ever reached the
    // server costs one item rather than two.
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
        span: data.span,
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

  // Ops last, in the order the user made them: an add and a later remove of the same sutta only
  // mean what they should that way round.
  for (const op of [...state.ops].sort((a, b) => a.seq - b.seq)) queue.push({ opId: op.id, item: opItem(op) });

  return queue;
}

// Renames every reference to a list id within one queued write, so the rest of the queue can go
// out under a fresh id without being rebuilt.
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

// Pushes everything the mirror owes the server, then pulls a fresh snapshot.
export async function flushMirror(state: MirrorState): Promise<FlushOutcome> {
  const acks: FlushAck[] = [];
  const doneOps: string[] = [];
  const remaps: { from: string; to: string }[] = [];
  // Set by the first failure meaning "stop", which leaves the rest of the queue in order.
  let halted: 'offline' | 'unauthorized' | null = null;

  let queue = buildQueue(state);
  let cursor = 0;
  // Where a create is colliding and how many fresh ids it has been given, counted per position so
  // a second collision later in the flush has its own budget.
  let collisionAt: number | null = null;
  let idAttempts = 0;

  while (cursor < queue.length && !halted) {
    const chunk = queue.slice(cursor, cursor + CHUNK_SIZE);
    let results: PushResult[];
    try {
      ({ results } = await dataApi.push(chunk.map((push) => push.item)));
    } catch (err) {
      const status = statusOf(err);
      // A whole-request refusal that is neither a lapsed session nor retryable means this client
      // built a push the server won't parse. It can't be pinned on one item, so nothing is retired.
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

      // A 409 means the id belongs to another account, so no retry under it can succeed: the row
      // gets a fresh id, every reference to it is rewritten, and the chunk goes out again.
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

      // Everything else retires the write, landed or refused: a refusal is permanent, and the pull
      // at the end of this flush hands back the account's own version of that row — the same
      // rebase a write losing last-writer-wins gets. A refusal goes to the console, being a bug on
      // one side or the other, and never to the reader, who has nothing to decide. A 404 is not
      // one: the row is simply gone, so the write is moot rather than failed.
      if (!('ok' in result) && result.status !== 404) {
        console.error('sync gave up on a permanently refused write', { item, error: result.error });
      }
      if (ack) acks.push(ack);
      if (opId) doneOps.push(opId);
    }

    if (!collided) cursor += chunk.length;
  }

  // A full snapshot rather than a delta, the payload being small at this scale. Skipped when the
  // push already stopped, since the pull would fail the same way.
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

// The lock holding one flusher at a time across every tab on the device; they share one mirror,
// and two at once would double the traffic and let two snapshots land out of order.
const FLUSH_LOCK = 'sutamaya.flush';

// Flushes unless another tab is already flushing, in which case this round is skipped rather than
// queued. Where Web Locks aren't available the flush simply runs; every write is idempotent.
export async function flushWithLock(state: MirrorState): Promise<FlushOutcome> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return flushMirror(state);
  return locks.request(FLUSH_LOCK, { ifAvailable: true }, (lock) => (lock ? flushMirror(state) : Promise.resolve(BLOCKED)));
}
