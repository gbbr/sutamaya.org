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
// back; lib/mirrorView.ts derives the shape the UI renders. Nothing in this module talks to the
// network, and every function is a pure state transition — the one deliberate exception being that
// mutators call nextMtime()/randomId(), because a write's timestamp and identity have to be minted
// *when the user acts*, not when the flush eventually reaches the network. That distinction is the
// whole point of the design (see docs/offline-sync.md).
//
// Two kinds of pending work, and the split is deliberate:
//
// - **Records** are desired state. A list, a note, a visit, a highlight group: the flush pushes
//   what should be true, so replaying it means the same thing an hour later as it did when the
//   user acted.
// - **Ops** are the exception, for everything that edits a list's `items`. Add, remove and reorder
//   are already idempotent and commuting server-side, so they replay as they are — and keeping
//   them as operations is what lets two devices each file a different sutta into the same list
//   and have both stick, instead of one `items` array overwriting the other.

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
  // True until POST /lists has landed for this row — the flush needs to know whether to create the
  // row or patch it, and a client-minted id is exactly what makes that knowable offline.
  pendingCreate: boolean;
  // True once a flush has *dispatched* this row's POST, whether or not the response ever came back.
  // Only read while `pendingCreate` is still set, and only by removeListRecord, which needs to tell
  // "the server has never heard of this row" from "the server may well hold it already" — a
  // distinction `pendingCreate` alone can't make, since it stays set for the whole in-flight window
  // and beyond a response lost on the way home. It lives on the record rather than on the `Stored`
  // wrapper because a rename replaces the wrapper, and whether the *row* reached the server is not
  // something a later edit changes.
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
  // Set when the server permanently rejected this exact version (a 400, or an id collision that
  // outlived every retry) rather than merely not having seen it yet — still dirty, since the flush
  // keeps retrying it (see lib/sync.ts), but distinct so the sync indicator can tell "queued" from
  // "stuck" instead of retrying forever in silence. A fresh local edit replaces this whole `Stored`
  // rather than patching it (see e.g. editList), which is what clears the flag: a new version
  // deserves a fresh attempt rather than being pre-judged by its predecessor's failure.
  rejected?: boolean;
  data: T;
}

// A queued edit to one list's `items`, or to one parent's sibling order. `seq` is a per-mirror
// counter, so ops replay in the order the user made them rather than in whatever order a map
// iterates. `siblingOrder` is keyed by `parentId` (null for the top level) rather than by a
// `listId` like the other three, since it is about a parent's children rather than a list's
// contents.
// `rejected` mirrors Stored.rejected above, for the same reason: an op the server has permanently
// refused (a delete-target-in-a-cycle 400, say) still sits in the queue being retried, but the sync
// indicator needs to tell that apart from one merely not-yet-sent.
export type QueuedOp =
  | { id: string; seq: number; type: 'add'; listId: string; suttaId: string; rejected?: boolean }
  | { id: string; seq: number; type: 'remove'; listId: string; suttaId: string; rejected?: boolean }
  | { id: string; seq: number; type: 'order'; listId: string; order: string[]; mtime: string; rejected?: boolean }
  | {
      id: string;
      seq: number;
      type: 'siblingOrder';
      parentId: string | null;
      order: string[];
      mtime: string;
      rejected?: boolean;
    };

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
// would win it every future last-writer-wins merge, so a rename made on another device would lose
// to a local edit that never actually touched that row. It also keeps a no-op drop — dragging a row
// back where it started — from costing a request.
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
// Both order endpoints are conditional on the *row's* `mtime` — the same column a rename, reparent
// or delete writes — so an order queued at T1 and then a rename made at T2 would leave the op
// failing its own guard. The server answers `200 {ok:true}` for a guarded update that matched no
// row, so the flush counts the op as landed and drops it, and the pull at the end of that same
// flush hands back the order the user had just dragged away from. Re-stamping keeps the op newer
// than this device's own later edits to the row, which is the only thing that can overtake it here;
// against *another* device's edits it still carries a timestamp from when the user acted, so a
// stale reorder loses a genuine merge exactly as before.
function restampOrderOps(state: MirrorState, id: string): MirrorState {
  const affected = (op: QueuedOp) =>
    (op.type === 'order' && op.listId === id) || (op.type === 'siblingOrder' && op.order.includes(id));
  if (!state.ops.some(affected)) return state;
  return { ...state, ops: state.ops.map((op) => (affected(op) ? { ...op, mtime: nextMtime() } : op)) };
}

// `id` is minted by the caller rather than here, so the list it creates has its final identity
// before this returns — the caller hands that same ListDef straight back to the UI without having
// to read it out of the state it just queued.
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

// Sibling order — the whole of one drag or one Move-up/down click. Queued as a single operation
// rather than written into each row's own record, because as records it cost one PATCH per sibling:
// dragging the 50th list of a group to the top rewrote all 50 positions, which exhausts the
// Worker's per-minute rate limit in a couple of gestures and takes GET /api/auth/me down with it.
// One gesture is now one request whatever the group's size.
//
// `order` is the parent's full sibling sequence with the moved row already in place, and every id in
// it is re-parented to `parentId` — which is what lets a cross-parent drop stay a single call rather
// than a setListParent followed by a reorder (see planListDrop in lib/listTreeDrop.ts).
//
// Positions are applied locally so the tree renders the new order with no round trip, but *without*
// marking the rows dirty: sibling order isn't part of a record's own conditional write any more, so
// dirtying them here would push the per-row PATCHes this exists to avoid. The queued op carries it,
// the same division queueMembership already uses for a list's items.
export function queueSiblingOrder(state: MirrorState, parentId: string | null, order: string[]): MirrorState {
  const lists = { ...state.lists };
  order.forEach((id, position) => {
    const current = lists[id];
    if (!current || current.data.deleted) return;
    lists[id] = { ...current, data: { ...current.data, parentId, position } };
  });
  // Only the latest order for a given parent matters — an earlier one it supersedes would just be
  // overwritten. Keyed on parentId, so reordering two different groups queues two ops.
  const ops = state.ops.filter((op) => !(op.type === 'siblingOrder' && op.parentId === parentId));
  return nextOp({ ...state, lists, ops }, { type: 'siblingOrder', parentId, order, mtime: nextMtime() });
}

// Tombstones the list — except one that has never left this device, which is dropped outright along
// with anything queued against it. Pushing a create and then a delete for a row no device has ever
// seen is pure noise, and the create landing after the delete would resurrect it.
//
// "Never left this device" is `createSent`, not `pendingCreate`: the latter is still set while the
// create is out on the wire, and a row deleted in that window is one the server may already hold.
// Dropping it then loses the delete outright — nothing is left to push it, and the pull at the end
// of that very flush brings the list back as a clean record.
export function removeListRecord(state: MirrorState, id: string): MirrorState {
  const current = state.lists[id];
  if (!current) return state;
  if (current.data.pendingCreate && !current.data.createSent) {
    // A queued sibling order may still name this id; it is left alone rather than rewritten, since
    // the server reconciles a posted order against the rows that actually exist and drops the rest.
    return { ...withList(state, id, null), ops: state.ops.filter((op) => !('listId' in op) || op.listId !== id) };
  }
  return editList(state, id, { deleted: true });
}

export function setNoteRecord(state: MirrorState, suttaId: string, text: string): MirrorState {
  // Whitespace-only is stored as cleared, exactly as the server does (`text.trim() === ''`
  // tombstones the row) — otherwise the mirror would show a note in the Notes auto-list that the
  // server has no row for, and the divergence would only close on the next pull.
  const stored = text.trim() ? text : '';
  return {
    ...state,
    notes: { ...state.notes, [suttaId]: { dirty: true, data: { suttaId, text: stored, mtime: nextMtime() } } },
  };
}

export function markVisitedRecord(state: MirrorState, suttaId: string): MirrorState {
  // Re-marking whatever is already the most recent visit changes nothing anyone can see — "Recent"
  // is ordered by exactly this — so it's skipped rather than churning the state reference and
  // making every consumer keyed on it (the My Lists tree's lookup tables, ListPane's flatLists)
  // rebuild for nothing. Revisiting a sutta *isn't* skipped: that's a real reordering.
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
    // A group created and then erased before either ever left this device drops out entirely rather
    // than pushing a create followed by a tombstone: the tombstone's `WHERE g = ?` matches nothing
    // if it somehow lands first, and the create then resurrects a highlight the user already erased.
    // Its own tombstones have to come along, though — a recolour made offline and then undone
    // offline still has to retire the group it displaced, which the server does still hold.
    if (record?.dirty) erase.push(...record.data.erase);
    // Anything the server might hold is named as a tombstone, which covers a group whose own write
    // is still in flight (`sent`) as well as one already synced. Tombstoning a group the server
    // turns out never to have received matches no rows and costs nothing, where failing to
    // tombstone one it did receive means the erase silently undoes itself on the next pull.
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

// Adds or removes one sutta in one list, locally and as a queued op. Two pending ops for the same
// pair that undo each other cancel: the local items array is then back to what the server already
// has, so there is nothing left to push.
export function queueMembership(state: MirrorState, listId: string, suttaId: string, add: boolean): MirrorState {
  const current = state.lists[listId];
  if (!current) return state;
  const items = add
    ? current.data.items.includes(suttaId)
      ? current.data.items
      : [...current.data.items, suttaId]
    : current.data.items.filter((s) => s !== suttaId);
  // Item membership isn't part of the record's own conditional write, so this doesn't touch mtime
  // or the dirty flag — the queued op is what carries it.
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
  // Only the latest order matters — an earlier one it supersedes would just be overwritten.
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

// Replays the still-queued ops over freshly pulled rows, so a change made offline doesn't blink out
// of the UI for as long as it takes to land — a membership edit over the pulled `items`, and a
// reorder over the pulled positions, which the snapshot would otherwise hand back in the server's
// older order.
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
    const items = target.data.items;
    const next =
      op.type === 'add'
        ? items.includes(op.suttaId)
          ? items
          : [...items, op.suttaId]
        : op.type === 'remove'
          ? items.filter((s) => s !== op.suttaId)
          : reconcileItems(items, op.order);
    lists[op.listId] = { ...target, data: { ...target.data, items: next } };
  }
  return lists;
}

// Folds a `GET /api/data` snapshot into the mirror: the server's version replaces every clean
// record, clean records the snapshot doesn't mention are gone (deleted elsewhere, or cascaded out
// by a deleted ancestor), and everything still dirty survives untouched — it is work the snapshot
// was taken before seeing.
export function applySnapshot(state: MirrorState, snapshot: UserData): MirrorState {
  const lists: Record<string, Stored<ListRecord>> = {};
  // The snapshot arrives already repaired and in sibling order but without positions of its own
  // (the server drops them, along with mtime and the tombstones), so each row takes its index
  // among its siblings. That keeps the order the server sent, and matches what the server itself
  // stores after a reorder, which assigns dense indices the same way (PUT /api/lists/order).
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
        // The server doesn't send a list's mtime, so a pulled row carries none. It is only ever
        // read as the loser-picking tiebreak when two moves form a cycle — and a snapshot the
        // server already repaired has none, so the only rows that can be in one are the locally
        // moved ones, which do carry a real mtime.
        mtime: '',
        deleted: false,
        pendingCreate: false,
        // Moot while `pendingCreate` is false — this row is on the server by definition, so there is
        // no create left to have dispatched.
        createSent: false,
      },
    };
  }
  for (const [id, record] of Object.entries(state.lists)) if (record.dirty) lists[id] = record;

  const notes: Record<string, Stored<NoteRecord>> = {};
  for (const [suttaId, { text, m }] of Object.entries(snapshot.notes)) {
    // The note's own mtime, not a blank: mirrorView orders the Notes auto-list by it, and a blank
    // would both flatten that order into the snapshot's arrival order and sort every pulled note
    // below any locally dirty one regardless of which was actually written more recently.
    notes[suttaId] = { dirty: false, data: { suttaId, text, mtime: m } };
  }
  for (const [id, record] of Object.entries(state.notes)) if (record.dirty) notes[id] = record;

  const visited: Record<string, Stored<VisitedRecord>> = {};
  for (const [suttaId, visitedAt] of Object.entries(snapshot.visited)) {
    visited[suttaId] = { dirty: false, data: { suttaId, visitedAt } };
  }
  for (const [id, record] of Object.entries(state.visited)) if (record.dirty) visited[id] = record;

  // A group this device has erased but not yet pushed is still live on the server, so it comes
  // back in the snapshot. Dropping it here is what keeps an erase made offline from visibly
  // undoing itself on every pull until the write lands.
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

// Renames a list the server refused the id of (409 id_collision — another account holds it), along
// with every reference to it: its children's parentId and every queued op naming it. Without this
// the record could never drain, since every retry would collide identically.
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

// Marks a record `rejected` for the exact version the server permanently refused. A record edited
// again since — `mtime` has moved on — is left alone: the rejection was about a version that no
// longer exists, and the fresh one deserves its own attempt rather than starting out stuck.
function markRejected<T extends { mtime: string }>(
  records: Record<string, Stored<T>>,
  id: string,
  mtime: string
): Record<string, Stored<T>> {
  const record = records[id];
  if (!record || record.data.mtime !== mtime) return records;
  return { ...records, [id]: { ...record, rejected: true } };
}

// Counts of work the mirror still owes the server: `pending` is everything dirty or queued,
// `stuck` is the subset of that the server has already permanently refused. Pure UI state, read by
// UserDataContext to derive the sync indicator (docs/offline-sync.md's "Sync state") — a `stuck` count above
// zero is what turns "retrying forever in silence" into something the user can actually see.
export function syncCounts(state: MirrorState): { pending: number; stuck: number } {
  let pending = state.ops.length;
  let stuck = state.ops.reduce((n, op) => n + (op.rejected ? 1 : 0), 0);
  for (const group of [state.lists, state.notes, state.highlights, state.visited]) {
    for (const record of Object.values(group)) {
      if (record.dirty) pending += 1;
      if (record.rejected) stuck += 1;
    }
  }
  return { pending, stuck };
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
  acks: FlushAck[];
  // Records and ops the server permanently refused this round (a 400, or an id collision that
  // outlived every retry) — left dirty/queued rather than acked, but marked so the mirror can tell
  // the sync indicator "stuck" instead of leaving the rejection silent.
  rejected: FlushAck[];
  doneOps: string[];
  rejectedOps: string[];
  remaps: { from: string; to: string }[];
  snapshot: UserData | null;
}

// Records that a flush is about to put these records on the wire. Called with the snapshot the
// flush was handed, *before* its first request goes out — after would be too late, since the whole
// point is to be right during the round trip itself.
//
// It marks the row rather than the version: `createSent`/`sent` answer "might the server hold this
// already", which a later local edit doesn't change, so a record edited mid-flight keeps the flag
// (and stays dirty on its own merits, see clearDirty). Marking a write the flush then never sends —
// another tab held the lock, or an earlier record halted it — is deliberately harmless: the cost is
// a tombstone for a row that may not exist, which matches nothing and is discarded.
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
  // Same reference when there was nothing to mark, so the common case costs neither a render nor a
  // write to IndexedDB.
  if (lists === state.lists && highlights === state.highlights) return state;
  return { ...state, lists, highlights };
}

// Folds a finished flush back into whatever the mirror looks like *now* — which may not be what
// the flush started from, since the user goes on editing while it is out. Everything here is
// matched on the exact version that was pushed, so a record edited mid-flush stays dirty.
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
  for (const ack of outcome.rejected) {
    if (ack.kind === 'list') next = { ...next, lists: markRejected(next.lists, ack.id, ack.mtime) };
    else if (ack.kind === 'note') next = { ...next, notes: markRejected(next.notes, ack.id, ack.mtime) };
    else if (ack.kind === 'visited') {
      const record = next.visited[ack.id];
      if (record && record.data.visitedAt === ack.mtime) {
        next = { ...next, visited: { ...next.visited, [ack.id]: { ...record, rejected: true } } };
      }
    } else {
      next = { ...next, highlights: markRejected(next.highlights, ack.id, ack.mtime) };
    }
  }
  if (outcome.doneOps.length) {
    const done = new Set(outcome.doneOps);
    next = { ...next, ops: next.ops.filter((op) => !done.has(op.id)) };
  }
  if (outcome.rejectedOps.length) {
    const rejected = new Set(outcome.rejectedOps);
    next = { ...next, ops: next.ops.map((op) => (rejected.has(op.id) ? { ...op, rejected: true } : op)) };
  }
  return outcome.snapshot ? applySnapshot(next, outcome.snapshot) : next;
}
