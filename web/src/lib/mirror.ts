import { displacedGroupIds, type HlRange } from './highlights';
import { AUTO_LIST_IDS } from './autoLists';
import { highlightRowsFor } from './mirrorView';
import { nextMtime } from './mtime';
import { randomId } from './ids';
import type { UserData } from './api';
import type { ListKind } from './types';

// The offline mirror: every list, note, highlight and visit this account has, as the client's own
// durable copy rather than a cache of the last server response. Mutators here write to it and mark
// what they touched dirty; lib/sync.ts pushes the dirty parts and applies the server's snapshot
// back; lib/mirrorView.ts derives the shape the UI renders. Nothing here talks to the network, and
// every function is a pure state transition, except that mutators call nextMtime()/randomId() — a
// write's timestamp and identity are minted when the user acts, not when the flush reaches the
// network. See docs/offline-sync.md.
//
// Two kinds of pending work:
//
// - **Records** are desired state. A list, a note, a visit, a highlight group: the flush pushes
//   what should be true, so replaying it means the same thing an hour later.
// - **Ops** cover everything that edits a list's `items`. Add, remove and reorder are idempotent
//   and commute server-side, so they replay as they are — which is what lets two devices each file
//   a different sutta into the same list and have both stick.

export interface ListRecord {
  id: string;
  label: string;
  parentId: string | null;
  kind: ListKind;
  items: string[];
  // Orders siblings (rows sharing a parent), not the whole set, and is routinely negative: a new
  // list is prepended, not appended (see firstPosition).
  position: number;
  mtime: string;
  // A tombstone, not a removal: a list dropped from the mirror outright would come straight back
  // on the next pull if the delete hadn't been pushed yet, and its descendants would be re-homed
  // to the root in the meantime instead of going with it.
  deleted: boolean;
  // True until POST /lists has landed for this row, so the flush knows whether to create or patch.
  pendingCreate: boolean;
  // True once a flush has dispatched this row's POST, whether or not the response came back. Read
  // only while `pendingCreate` is still set, and only by removeListRecord, which has to tell "the
  // server has never heard of this row" from "the server may hold it already" — `pendingCreate`
  // alone can't, since it stays set across the whole in-flight window. It lives on the record
  // rather than the `Stored` wrapper because a rename replaces the wrapper, and whether the row
  // reached the server isn't something a later edit changes.
  createSent: boolean;
}

export interface NoteRecord {
  suttaId: string;
  // Blank means cleared. The server tombstones a blank note rather than storing it, and the mirror
  // keeps the empty record for the same reason: it is what loses the merge against a stale device
  // pushing the note's old body back.
  text: string;
  mtime: string;
}

// One immutable highlight group, keyed by the `g` the client minted when the user picked the
// colour. `erase` names the groups this write displaces — worked out on the device where the user
// acted, so the server never has to infer it from rows that may have changed since. A pure erase
// is `color: null` with a non-empty `erase` and no rows of its own.
export interface HighlightRecord {
  g: string;
  suttaId: string;
  ranges: HlRange[];
  color: string | null;
  erase: string[];
  mtime: string;
  // As ListRecord.createSent: true once a flush has dispatched this group's write. A group erased
  // while its own create is in flight has to be tombstoned rather than dropped, or the create the
  // server already accepted comes straight back on the next pull.
  sent: boolean;
}

export interface VisitedRecord {
  suttaId: string;
  visitedAt: string;
}

export type RecordKind = 'list' | 'note' | 'highlight' | 'visited';

export interface Stored<T> {
  // Set by a local mutation, cleared once the server has acknowledged that exact version (see
  // lib/sync.ts). Everything dirty survives a pull unchanged — it is work the snapshot hasn't
  // seen yet.
  dirty: boolean;
  data: T;
}

// A queued edit to one list's `items`, or to one parent's sibling order. `seq` is a per-mirror
// counter, so ops replay in the order the user made them. `siblingOrder` is keyed by `parentId`
// (null for the top level) rather than by `listId`, since it is about a parent's children rather
// than a list's contents.
export type QueuedOp =
  | { id: string; seq: number; type: 'add'; listId: string; suttaId: string }
  | { id: string; seq: number; type: 'remove'; listId: string; suttaId: string }
  | { id: string; seq: number; type: 'order'; listId: string; order: string[]; mtime: string }
  | { id: string; seq: number; type: 'siblingOrder'; parentId: string | null; order: string[]; mtime: string };

export interface MirrorState {
  // Whose mirror this is. Persisted with it and checked on every save, so a session that signs
  // out and back in as someone else can't write one account's records under the other's key.
  userId: string | null;
  lists: Record<string, Stored<ListRecord>>;
  notes: Record<string, Stored<NoteRecord>>;
  highlights: Record<string, Stored<HighlightRecord>>;
  visited: Record<string, Stored<VisitedRecord>>;
  ops: QueuedOp[];
  nextSeq: number;
}

export function emptyMirror(userId: string | null = null): MirrorState {
  return { userId, lists: {}, notes: {}, highlights: {}, visited: {}, ops: [], nextSeq: 1 };
}

// Position for a newly created list: one less than its lowest sibling, seeded at 1 so an empty
// parent yields 0. Mirrors lib/listPositions.js's firstPosition (and the SQL reproduction of it in
// CREATE_LIST_SQL), so a list created offline lands where the server would have put it.
function firstPosition(positions: number[]): number {
  return positions.reduce((min, p) => Math.min(min, p ?? 0), 1) - 1;
}

function withList(state: MirrorState, id: string, record: Stored<ListRecord> | null): MirrorState {
  const lists = { ...state.lists };
  if (record) lists[id] = record;
  else delete lists[id];
  return { ...state, lists };
}

// Applies `change` to a live list record and marks it dirty. A missing (or already tombstoned)
// row is left alone — there is nothing to edit and nothing to push.
//
// A change that alters nothing is dropped rather than stamped: a fresh `mtime` on an untouched row
// would win it every future last-writer-wins merge, so another device's rename would lose to a
// local edit that never touched the row. It also keeps a no-op drop from costing a request.
function editList(state: MirrorState, id: string, change: Partial<ListRecord>): MirrorState {
  const current = state.lists[id];
  if (!current || current.data.deleted) return state;
  // Object.is, so an array-valued change (`items`, which nothing here passes today) always counts
  // as a change rather than being compared by identity and wrongly skipped.
  const changed = Object.entries(change).some(([key, value]) => !Object.is(current.data[key as keyof ListRecord], value));
  if (!changed) return state;
  const next = withList(state, id, { dirty: true, data: { ...current.data, ...change, mtime: nextMtime() } });
  return restampOrderOps(next, id);
}

// Moves any queued order op touching `id` ahead of the mtime just stamped on that row.
//
// Both order endpoints are conditional on the row's `mtime` — the same column a rename, reparent or
// delete writes — so an order queued at T1 followed by a rename at T2 would leave the op failing
// its own guard. The server answers `200 {ok:true}` for a guarded update matching no row, so the
// flush counts the op as landed and drops it, and the pull at the end of that same flush hands back
// the order the user just dragged away from. Re-stamping keeps the op newer than this device's own
// later edits to the row; against another device's edits it still carries the timestamp from when
// the user acted, so a genuinely stale reorder still loses.
function restampOrderOps(state: MirrorState, id: string): MirrorState {
  const affected = (op: QueuedOp) =>
    (op.type === 'order' && op.listId === id) || (op.type === 'siblingOrder' && op.order.includes(id));
  if (!state.ops.some(affected)) return state;
  return { ...state, ops: state.ops.map((op) => (affected(op) ? { ...op, mtime: nextMtime() } : op)) };
}

// `id` is minted by the caller, so the new list has its final identity before this returns and the
// caller can hand that same ListDef straight to the UI.
export function createListRecord(
  state: MirrorState,
  { id, label, parentId, kind }: { id: string; label: string; parentId: string | null; kind: ListKind }
): MirrorState {
  const siblings = Object.values(state.lists)
    .filter((l) => !l.data.deleted && l.data.parentId === parentId)
    .map((l) => l.data.position);
  const record: ListRecord = {
    id,
    label,
    parentId,
    kind,
    items: [],
    position: firstPosition(siblings),
    mtime: nextMtime(),
    deleted: false,
    pendingCreate: true,
    createSent: false,
  };
  return withList(state, record.id, { dirty: true, data: record });
}

export function renameListRecord(state: MirrorState, id: string, label: string): MirrorState {
  return editList(state, id, { label });
}

export function setListParentRecord(state: MirrorState, id: string, parentId: string | null): MirrorState {
  return editList(state, id, { parentId });
}

// Sibling order — the whole of one drag or one Move-up/down click, as a single queued operation, so
// one gesture costs one request whatever the group's size. As per-row records it cost one PATCH per
// sibling, which exhausts the Worker's per-minute rate limit in a couple of gestures.
//
// `order` is the parent's full sibling sequence with the moved row already in place, and every id in
// it is re-parented to `parentId` — which is what lets a cross-parent drop stay a single call rather
// than a setListParent followed by a reorder (see planListDrop in lib/listTreeDrop.ts).
//
// Positions are applied locally so the tree renders the new order with no round trip, but without
// marking the rows dirty: sibling order is not part of a record's conditional write, so dirtying
// them here would push the per-row PATCHes this avoids. The queued op carries it, the same division
// queueMembership uses for a list's items.
export function queueSiblingOrder(state: MirrorState, parentId: string | null, order: string[]): MirrorState {
  const lists = { ...state.lists };
  order.forEach((id, position) => {
    const current = lists[id];
    if (!current || current.data.deleted) return;
    lists[id] = { ...current, data: { ...current.data, parentId, position } };
  });
  // Only the latest order for a parent matters. Keyed on parentId, so reordering two different
  // groups queues two ops.
  const ops = state.ops.filter((op) => !(op.type === 'siblingOrder' && op.parentId === parentId));
  return nextOp({ ...state, lists, ops }, { type: 'siblingOrder', parentId, order, mtime: nextMtime() });
}

// `id` plus every row beneath it, tombstoned rows included — what hangs off a dead ancestor still
// has to be dealt with, and the callers below no-op on a row that is already tombstoned anyway.
// Guarded by a visited set rather than assuming a tree: two devices can each make a valid move that
// together form a cycle (see repairListTree), so the mirror can genuinely hold one.
function withDescendants(state: MirrorState, id: string): string[] {
  const childrenOf = new Map<string | null, string[]>();
  for (const { data } of Object.values(state.lists)) {
    const siblings = childrenOf.get(data.parentId) ?? [];
    siblings.push(data.id);
    childrenOf.set(data.parentId, siblings);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const child of childrenOf.get(cur) ?? []) queue.push(child);
  }
  return out;
}

// Deletes the list and, since deleting a group takes what is inside it, everything beneath it. Each
// row is decided on its own:
//
// - one that has never left this device is dropped outright, along with anything queued against it.
//   A create landing after its own delete would resurrect the row.
// - anything else is tombstoned, because the server may already hold it and nothing else would tell
//   it the row is gone.
//
// A subtree can't share one verdict: a synced list dragged into a group created moments ago sits
// under a never-sent parent, and dropping it with that parent would leave the server's copy alive
// to come back on the next pull.
//
// "Never left this device" is `createSent`, not `pendingCreate` — the latter is still set while the
// create is out on the wire, and a row deleted in that window is one the server may hold.
export function removeListRecord(state: MirrorState, id: string): MirrorState {
  if (!state.lists[id]) return state;
  const dropped = new Set<string>();
  let next = state;
  for (const memberId of withDescendants(state, id)) {
    const current = next.lists[memberId];
    if (!current) continue;
    if (current.data.pendingCreate && !current.data.createSent) {
      dropped.add(memberId);
      next = withList(next, memberId, null);
    } else {
      next = editList(next, memberId, { deleted: true });
    }
  }
  // A queued sibling order may still *name* a dropped id. Left alone rather than rewritten, since
  // the server reconciles a posted order against the rows that exist and drops the rest.
  //
  // One keyed *on* a dropped parent is a different matter: that group never reached the server and
  // now never will, so the op could only ever be refused. It goes with the row.
  if (dropped.size === 0) return next;
  return {
    ...next,
    ops: next.ops.filter((op) =>
      op.type === 'siblingOrder' ? !op.parentId || !dropped.has(op.parentId) : !dropped.has(op.listId)
    ),
  };
}

export function setNoteRecord(state: MirrorState, suttaId: string, text: string): MirrorState {
  // Whitespace-only is stored as cleared, exactly as the server does (`text.trim() === ''`
  // tombstones the row), so the Notes auto-list can't show a note the server has no row for.
  const stored = text.trim() ? text : '';
  return {
    ...state,
    notes: { ...state.notes, [suttaId]: { dirty: true, data: { suttaId, text: stored, mtime: nextMtime() } } },
  };
}

export function markVisitedRecord(state: MirrorState, suttaId: string): MirrorState {
  // "Visited" is ordered by visitedAt, so re-marking what is already the most recent visit changes
  // nothing visible. Skipped rather than churning the state reference and rebuilding every consumer
  // keyed on it. Revisiting an older sutta is a real reordering and is not skipped.
  const current = state.visited[suttaId];
  if (current && Object.values(state.visited).every((v) => v.data.visitedAt <= current.data.visitedAt)) return state;
  return {
    ...state,
    visited: { ...state.visited, [suttaId]: { dirty: true, data: { suttaId, visitedAt: nextMtime() } } },
  };
}

// One highlight write: a new group over `ranges` (or nothing at all, for a plain erase), plus the
// groups it displaces. A group is immutable, so a recolour is a tombstone and a brand new group,
// never an update — which is what makes the write safe to replay.
export function writeHighlightRecord(
  state: MirrorState,
  suttaId: string,
  ranges: HlRange[],
  color: string | null
): MirrorState {
  const displaced = displacedGroupIds(highlightRowsFor(state, suttaId), ranges);
  const highlights = { ...state.highlights };
  const erase: string[] = [];
  for (const g of displaced) {
    const record = highlights[g];
    // A group created and erased before either left this device drops out entirely rather than
    // pushing a create followed by a tombstone, which the create could land after and resurrect.
    // Its own tombstones still come along: a recolour made offline and then undone offline has to
    // retire the group it displaced, which the server does hold.
    if (record?.dirty) erase.push(...record.data.erase);
    // Anything the server might hold is named as a tombstone, covering a group whose own write is
    // still in flight (`sent`) as well as one already synced. Tombstoning a group the server never
    // received matches no rows and costs nothing; missing one it did receive means the erase undoes
    // itself on the next pull.
    if (!record?.dirty || record.data.sent) erase.push(g);
    delete highlights[g];
  }
  const pushable = [...new Set(erase)];
  if (!color && !pushable.length) return { ...state, highlights };
  const g = randomId();
  highlights[g] = { dirty: true, data: { g, suttaId, ranges, color, erase: pushable, mtime: nextMtime(), sent: false } };
  return { ...state, highlights };
}

// The op minus the identity the queue gives it. Spelled out rather than derived with Omit, which
// distributes over the union into a shape none of the three members actually has.
type NewOp =
  | { type: 'add'; listId: string; suttaId: string }
  | { type: 'remove'; listId: string; suttaId: string }
  | { type: 'order'; listId: string; order: string[]; mtime: string }
  | { type: 'siblingOrder'; parentId: string | null; order: string[]; mtime: string };

function nextOp(state: MirrorState, op: NewOp): MirrorState {
  return {
    ...state,
    ops: [...state.ops, { ...op, id: randomId(), seq: state.nextSeq } as QueuedOp],
    nextSeq: state.nextSeq + 1,
  };
}

// One list's items with one sutta added or removed. Both are idempotent, which is what lets the
// same op be replayed (see replayOps) without changing the answer.
function nextMembership(items: string[], suttaId: string, add: boolean): string[] {
  if (!add) return items.filter((s) => s !== suttaId);
  // Already a member: hand back the same array, so callers comparing by reference see no change.
  if (items.includes(suttaId)) return items;
  // A new sutta goes at the end, which is where it belongs in user order.
  return [...items, suttaId];
}

// Adds or removes one sutta in one list, locally and as a queued op. Two pending ops for the same
// pair that undo each other cancel: the local items array is then back to what the server already
// has, so there is nothing left to push.
export function queueMembership(state: MirrorState, listId: string, suttaId: string, add: boolean): MirrorState {
  const current = state.lists[listId];
  if (!current) return state;
  const items = nextMembership(current.data.items, suttaId, add);
  // Item membership isn't part of the record's conditional write, so this touches neither mtime nor
  // the dirty flag — the queued op carries it.
  const withItems = withList(state, listId, { ...current, data: { ...current.data, items } });
  const pending = withItems.ops.filter(
    (op) => (op.type === 'add' || op.type === 'remove') && op.listId === listId && op.suttaId === suttaId
  );
  const inverse = pending[pending.length - 1];
  const rest = { ...withItems, ops: withItems.ops.filter((op) => !pending.includes(op)) };
  if (inverse && inverse.type === (add ? 'remove' : 'add')) return rest;
  return nextOp(rest, { type: add ? 'add' : 'remove', listId, suttaId });
}

// A list's own item order. Queued rather than folded into the record because it edits the same
// `items` column the add/remove ops do — and the server reconciles a posted order against whatever
// is actually stored, so an id another device added since is appended rather than dropped.
export function queueItemOrder(state: MirrorState, listId: string, order: string[]): MirrorState {
  const current = state.lists[listId];
  if (!current) return state;
  const withItems = withList(state, listId, { ...current, data: { ...current.data, items: order } });
  // Only the latest order for this list matters.
  const superseded = { ...withItems, ops: withItems.ops.filter((op) => !(op.type === 'order' && op.listId === listId)) };
  return nextOp(superseded, { type: 'order', listId, order, mtime: nextMtime() });
}

function reconcileItems(current: string[], order: string[]): string[] {
  const currentSet = new Set(current);
  const reconciled = order.filter((id) => currentSet.has(id));
  const reconciledSet = new Set(reconciled);
  current.forEach((id) => {
    if (!reconciledSet.has(id)) reconciled.push(id);
  });
  return reconciled;
}

// One list's freshly pulled items with a single still-queued op replayed over them.
function replayItemsOp(items: string[], op: Extract<QueuedOp, { type: 'add' | 'remove' | 'order' }>): string[] {
  // The membership ops go through the same helper the local write used, so a replay and the
  // original edit can't disagree.
  if (op.type === 'add') return nextMembership(items, op.suttaId, true);
  if (op.type === 'remove') return nextMembership(items, op.suttaId, false);
  // 'order': the queued order was decided against the items this device had, and the pull may have
  // brought in ones it has never seen, so it is reconciled rather than applied wholesale.
  return reconcileItems(items, op.order);
}

// Replays the still-queued ops over freshly pulled rows, so a change made offline doesn't blink out
// of the UI until it lands: a membership edit over the pulled `items`, and a reorder over the pulled
// positions, which the snapshot would otherwise hand back in the server's older order.
function replayOps(lists: Record<string, Stored<ListRecord>>, ops: QueuedOp[]): Record<string, Stored<ListRecord>> {
  for (const op of ops) {
    if (op.type === 'siblingOrder') {
      op.order.forEach((id, position) => {
        const target = lists[id];
        if (!target) return;
        lists[id] = { ...target, data: { ...target.data, parentId: op.parentId, position } };
      });
      continue;
    }
    const target = lists[op.listId];
    if (!target) continue;
    lists[op.listId] = { ...target, data: { ...target.data, items: replayItemsOp(target.data.items, op) } };
  }
  return lists;
}

// Folds a `GET /api/data` snapshot into the mirror: the server's version replaces every clean
// record, clean records the snapshot doesn't mention are gone (deleted elsewhere, or cascaded out
// by a deleted ancestor), and everything still dirty survives untouched — it is work the snapshot
// was taken before seeing.
export function applySnapshot(state: MirrorState, snapshot: UserData): MirrorState {
  const lists: Record<string, Stored<ListRecord>> = {};
  // The snapshot arrives already repaired and in sibling order, but without positions of its own —
  // the server drops those, along with mtime and the tombstones — so each row takes its index among
  // its siblings. That keeps the order the server sent, and matches the dense indices the server
  // itself assigns after a reorder (PUT /api/lists/order).
  const seen = new Map<string | null, number>();
  for (const list of snapshot.lists) {
    // The three auto-lists are synthesized, not rows — the mirror derives its own (see
    // lib/mirrorView.ts) so they exist offline too.
    if (list.auto || AUTO_LIST_IDS.has(list.id)) continue;
    const parentId = list.parentId ?? null;
    const position = seen.get(parentId) ?? 0;
    seen.set(parentId, position + 1);
    lists[list.id] = {
      dirty: false,
      data: {
        id: list.id,
        label: list.label,
        parentId,
        kind: list.kind,
        items: list.items,
        position,
        // The server doesn't send a list's mtime. It is only read as the loser-picking tiebreak
        // when two moves form a cycle, and a snapshot the server already repaired has none — so the
        // only rows that can be in a cycle are the locally moved ones, which carry a real mtime.
        mtime: '',
        deleted: false,
        pendingCreate: false,
        // Moot while `pendingCreate` is false: this row is on the server by definition.
        createSent: false,
      },
    };
  }
  for (const [id, record] of Object.entries(state.lists)) if (record.dirty) lists[id] = record;

  const notes: Record<string, Stored<NoteRecord>> = {};
  for (const [suttaId, { text, m }] of Object.entries(snapshot.notes)) {
    // The note's own mtime, not a blank: mirrorView orders the Notes auto-list by it, and a blank
    // would flatten that into the snapshot's arrival order and sort every pulled note below any
    // locally dirty one.
    notes[suttaId] = { dirty: false, data: { suttaId, text, mtime: m } };
  }
  for (const [id, record] of Object.entries(state.notes)) if (record.dirty) notes[id] = record;

  const visited: Record<string, Stored<VisitedRecord>> = {};
  for (const [suttaId, visitedAt] of Object.entries(snapshot.visited)) {
    visited[suttaId] = { dirty: false, data: { suttaId, visitedAt } };
  }
  for (const [id, record] of Object.entries(state.visited)) if (record.dirty) visited[id] = record;

  // A group this device has erased but not yet pushed is still live on the server and comes back in
  // the snapshot. Dropping it here keeps an erase made offline from visibly undoing itself on every
  // pull until the write lands.
  const pendingErase = new Set(
    Object.values(state.highlights).flatMap((record) => (record.dirty ? record.data.erase : []))
  );
  const highlights: Record<string, Stored<HighlightRecord>> = {};
  for (const [suttaId, rows] of Object.entries(snapshot.highlights)) {
    for (const row of rows) {
      if (pendingErase.has(row.g)) continue;
      // One row per segment; the group is the record, so they're recombined by `g` on the way in.
      const group = highlights[row.g] ?? {
        dirty: false,
        data: { g: row.g, suttaId, ranges: [], color: row.c, erase: [], mtime: row.m, sent: true },
      };
      group.data.ranges.push({ i: row.i, s: row.s, e: row.e });
      highlights[row.g] = group;
    }
  }
  for (const group of Object.values(highlights)) group.data.ranges.sort((a, b) => a.i - b.i || a.s - b.s);
  for (const [id, record] of Object.entries(state.highlights)) if (record.dirty) highlights[id] = record;

  return { ...state, lists: replayOps(lists, state.ops), notes, highlights, visited };
}

// Re-ids a list the server refused (409 id_collision — another account holds that id), along with
// every reference to it: its children's parentId and every queued op naming it. Without this the
// record could never drain, since every retry would collide identically.
export function remapListId(state: MirrorState, from: string, to: string): MirrorState {
  const existing = state.lists[from];
  if (!existing) return state;
  const lists: Record<string, Stored<ListRecord>> = {};
  for (const [id, record] of Object.entries(state.lists)) {
    if (id === from) continue;
    lists[id] =
      record.data.parentId === from ? { ...record, dirty: true, data: { ...record.data, parentId: to } } : record;
  }
  lists[to] = { ...existing, data: { ...existing.data, id: to } };
  return {
    ...state,
    lists,
    // A sibling order names ids in `order` rather than in a `listId`, and its `parentId` can be the
    // renamed row too — a reorder of the group's children queued before the group itself landed.
    ops: state.ops.map((op) => {
      if (op.type === 'siblingOrder') {
        return {
          ...op,
          parentId: op.parentId === from ? to : op.parentId,
          order: op.order.map((id) => (id === from ? to : id)),
        };
      }
      return op.listId === from ? { ...op, listId: to } : op;
    }),
  };
}

// Separates the two halves of a note that were written under different identities, when signing in
// brings a locally-written note onto an account that already had one for the same sutta.
export const ADOPTED_NOTE_SEPARATOR = '\n\n———\n\n';

// Moves everything a signed-out reader made (`local`) into the account they just signed into
// (`account`), so the ordinary flush pushes it to the server as their own.
//
// Every adopted record is marked dirty and keeps the `mtime` it was written at, since that is when
// the user acted — re-stamping would let a note written here a week ago beat one written on their
// phone yesterday (docs/offline-sync.md). Lists and highlights are re-created rather than merged:
// both carry client-minted ids, so nothing they hold can collide with what the account already has,
// and both go back to `pendingCreate`/`sent: false` because this account's server has never seen
// them.
//
// Notes are the one thing that can collide, being keyed by sutta rather than by a minted id. Where
// this device can see both texts they are concatenated, which is lossless where last-writer-wins is
// not. Where it can't — a first sign-in on a device that has never held this account's data, so the
// account mirror is empty until the first pull — the ordinary mtime merge decides.
export function adoptMirror(account: MirrorState, local: MirrorState): MirrorState {
  const lists = { ...account.lists };
  for (const [id, record] of Object.entries(local.lists)) {
    // A list created and deleted before it ever left the device — no server holds it, so the
    // tombstone has nothing to retire.
    if (record.data.deleted && record.data.pendingCreate) continue;
    if (lists[id]) continue;
    lists[id] = { dirty: true, data: { ...record.data, pendingCreate: true, createSent: false } };
  }

  const notes = { ...account.notes };
  for (const [suttaId, record] of Object.entries(local.notes)) {
    if (!record.data.text) continue;
    const existing = notes[suttaId];
    if (!existing?.data.text || existing.data.text === record.data.text) {
      notes[suttaId] = { dirty: true, data: { ...record.data } };
      continue;
    }
    // A retried adoption (crash/reload between saveMirror and deleteMirror in UserDataContext) can
    // run this merge twice against the same local record — the account note has already absorbed
    // it. Without this check the local half gets appended a second time.
    if (existing.data.text.endsWith(`${ADOPTED_NOTE_SEPARATOR}${record.data.text}`)) {
      notes[suttaId] = { dirty: true, data: { ...existing.data } };
      continue;
    }
    notes[suttaId] = {
      dirty: true,
      data: {
        suttaId,
        text: `${existing.data.text}${ADOPTED_NOTE_SEPARATOR}${record.data.text}`,
        // The merged text is new, so it needs a timestamp newer than either half — otherwise the
        // older of the two could win against the very row it was just merged into.
        mtime: nextMtime(),
      },
    };
  }

  const highlights = { ...account.highlights };
  for (const [g, record] of Object.entries(local.highlights)) {
    if (highlights[g]) continue;
    highlights[g] = { dirty: true, data: { ...record.data, sent: false } };
  }

  const visited = { ...account.visited };
  for (const [suttaId, record] of Object.entries(local.visited)) {
    const existing = visited[suttaId];
    if (existing && existing.data.visitedAt >= record.data.visitedAt) continue;
    visited[suttaId] = { dirty: true, data: { ...record.data } };
  }

  // Re-sequenced onto the end of the account's queue: `seq` is per-mirror, so the local ops have to
  // replay after anything already waiting rather than interleave by a counter that meant something
  // else.
  const ops = [...local.ops]
    .sort((a, b) => a.seq - b.seq)
    .map((op, i) => ({ ...op, seq: account.nextSeq + i }));

  return {
    ...account,
    lists,
    notes,
    highlights,
    visited,
    ops: [...account.ops, ...ops],
    nextSeq: account.nextSeq + ops.length,
  };
}

// True when a mirror holds anything worth carrying onto an account, so sign-in skips adoption for a
// device that was never used signed out.
export function hasContent(state: MirrorState): boolean {
  return (
    Object.keys(state.lists).length > 0 ||
    Object.values(state.notes).some((n) => !!n.data.text) ||
    Object.keys(state.highlights).length > 0 ||
    Object.keys(state.visited).length > 0
  );
}

function clearDirty<T extends { mtime: string }>(
  records: Record<string, Stored<T>>,
  id: string,
  mtime: string,
  extra?: Partial<T>
): Record<string, Stored<T>> {
  const record = records[id];
  if (!record) return records;
  // Edited again while the flush was out — the newer version is still unsent, so it stays dirty.
  const settled = record.data.mtime === mtime;
  if (!settled && !extra) return records;
  return { ...records, [id]: { dirty: !settled, data: extra ? { ...record.data, ...extra } : record.data } };
}

// How much work the mirror still owes the server — everything dirty or queued. Read by
// UserDataContext to derive the sync indicator (docs/offline-sync.md's "Sync state").
export function syncCounts(state: MirrorState): { pending: number } {
  let pending = state.ops.length;
  for (const group of [state.lists, state.notes, state.highlights, state.visited]) {
    for (const record of Object.values(group)) if (record.dirty) pending += 1;
  }
  return { pending };
}

export interface FlushAck {
  kind: RecordKind;
  id: string;
  mtime: string;
}

export interface FlushOutcome {
  // 'ok' — everything drained and the pull applied. 'offline' — a retryable failure stopped the
  // flush partway; nothing was lost, the rest goes next time. 'unauthorized' — the session lapsed,
  // so the flush pauses with the queue intact rather than throwing writes away. 'blocked' — another
  // tab holds the flush lock.
  status: 'ok' | 'offline' | 'unauthorized' | 'blocked';
  // Everything the flush is done with, whether the server took it or permanently refused it (see
  // settle in lib/sync.ts) — either way there is nothing left to send.
  acks: FlushAck[];
  doneOps: string[];
  remaps: { from: string; to: string }[];
  snapshot: UserData | null;
}

// Records that a flush is about to put these records on the wire. Called with the snapshot the
// flush was handed, before its first request goes out, since the flag has to be right during the
// round trip itself.
//
// It marks the row rather than the version: `createSent`/`sent` answer "might the server hold this
// already", which a later local edit doesn't change, so a record edited mid-flight keeps the flag
// and stays dirty on its own merits (see clearDirty). Marking a write the flush never sends — another
// tab held the lock, or an earlier record halted it — costs at most a tombstone for a row that
// doesn't exist, which matches nothing.
export function markDispatched(state: MirrorState, dispatched: MirrorState): MirrorState {
  let lists = state.lists;
  for (const [id, record] of Object.entries(dispatched.lists)) {
    if (!record.dirty || !record.data.pendingCreate) continue;
    const live = lists[id];
    if (!live || live.data.createSent) continue;
    if (lists === state.lists) lists = { ...state.lists };
    lists[id] = { ...live, data: { ...live.data, createSent: true } };
  }
  let highlights = state.highlights;
  for (const [g, record] of Object.entries(dispatched.highlights)) {
    if (!record.dirty) continue;
    const live = highlights[g];
    if (!live || live.data.sent) continue;
    if (highlights === state.highlights) highlights = { ...state.highlights };
    highlights[g] = { ...live, data: { ...live.data, sent: true } };
  }
  // Same reference when there was nothing to mark, so the common case costs no render and no
  // IndexedDB write.
  if (lists === state.lists && highlights === state.highlights) return state;
  return { ...state, lists, highlights };
}

// Folds a finished flush back into whatever the mirror looks like now, which may not be what the
// flush started from, since the user goes on editing while it is out. Everything is matched on the
// exact version that was pushed, so a record edited mid-flush stays dirty.
export function applyFlushOutcome(state: MirrorState, outcome: FlushOutcome): MirrorState {
  let next = outcome.remaps.reduce((acc, { from, to }) => remapListId(acc, from, to), state);
  for (const ack of outcome.acks) {
    if (ack.kind === 'list') next = { ...next, lists: clearDirty(next.lists, ack.id, ack.mtime, { pendingCreate: false }) };
    else if (ack.kind === 'note') next = { ...next, notes: clearDirty(next.notes, ack.id, ack.mtime) };
    else if (ack.kind === 'visited') {
      const record = next.visited[ack.id];
      if (record && record.data.visitedAt === ack.mtime) {
        next = { ...next, visited: { ...next.visited, [ack.id]: { dirty: false, data: record.data } } };
      }
    } else {
      const record = next.highlights[ack.id];
      // A pushed erase-only write holds no rows of its own, so once it has landed there is nothing
      // left for it to represent.
      if (record?.data.mtime === ack.mtime) {
        const highlights = { ...next.highlights };
        if (record.data.color === null) delete highlights[ack.id];
        else highlights[ack.id] = { dirty: false, data: { ...record.data, erase: [] } };
        next = { ...next, highlights };
      }
    }
  }
  if (outcome.doneOps.length) {
    const done = new Set(outcome.doneOps);
    next = { ...next, ops: next.ops.filter((op) => !done.has(op.id)) };
  }
  return outcome.snapshot ? applySnapshot(next, outcome.snapshot) : next;
}
