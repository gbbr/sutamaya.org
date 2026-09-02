import { displacedIds, type HlSpan } from './highlights';
import { AUTO_LIST_IDS } from './autoLists';
import { highlightsFor } from './mirrorView';
import { nextMtime } from './mtime';
import { randomId } from './ids';
import type { UserData } from './api';
import type { ListKind } from './types';

// The offline mirror: every list, note, highlight and visit this account has, as the client's own
// durable copy rather than a cache of the last server response. Mutators here write to it and mark
// what they touched dirty; lib/sync.ts pushes the dirty parts and applies the server's snapshot
// back; lib/mirrorView.ts derives the shape the UI renders. See docs/offline-sync.md.
//
// Pending work travels in two forms:
//   records – desired state (a list, note, visit or highlight), so replaying one an hour later
//             still means what it meant
//   ops     – edits to a list's `items` and to sibling order, which are idempotent and commute, so
//             two devices can each file a different sutta into one list and both stick
//
// Nothing here touches the network, and every function is a pure state transition — except that a
// mutator calls nextMtime() and randomId(), a write's timestamp and identity being minted when the
// user acts rather than when the flush goes out.

export interface ListRecord {
  id: string;
  label: string;
  parentId: string | null;
  kind: ListKind;
  items: string[];
  // Order among the rows sharing a parent, routinely negative since a new list is prepended.
  position: number;
  mtime: string;
  // A tombstone rather than a removal, so an unpushed delete can't be undone by the next pull.
  deleted: boolean;
  // True until a `list.create` has landed, so the flush knows to push a create rather than an
  // update.
  pendingCreate: boolean;
  // True once a flush has dispatched the create, response or not, which is what tells "the server
  // has never heard of this row" from "the server may already hold it". On the record rather than
  // the `Stored` wrapper, which a rename replaces.
  createSent: boolean;
}

export interface NoteRecord {
  suttaId: string;
  // Blank means cleared, and is kept as a record rather than dropped, so it can win the merge
  // against a stale device pushing the old body back.
  text: string;
  mtime: string;
}

// One immutable highlight, keyed by the `g` minted when the colour was picked. `erase` names the
// highlights this write displaces, worked out on the device where the user acted. A pure erase is
// `color: null`, whose `span` records only what was selected.
export interface HighlightRecord {
  g: string;
  suttaId: string;
  span: HlSpan;
  color: string | null;
  erase: string[];
  mtime: string;
  // As ListRecord.createSent: true once a flush has dispatched this write, so a highlight erased
  // while its own create is in flight is tombstoned rather than dropped.
  sent: boolean;
}

export interface VisitedRecord {
  suttaId: string;
  visitedAt: string;
}

export type RecordKind = 'list' | 'note' | 'highlight' | 'visited';

export interface Stored<T> {
  // Set by a local write, cleared once the server acknowledges that exact version. Everything
  // dirty survives a pull unchanged, being work the snapshot hasn't seen.
  dirty: boolean;
  data: T;
}

// A queued edit to one list's `items`, or to one parent's sibling order. `seq` is a per-mirror
// counter, so ops replay in the order the user made them.
export type QueuedOp =
  | { id: string; seq: number; type: 'add'; listId: string; suttaId: string }
  | { id: string; seq: number; type: 'remove'; listId: string; suttaId: string }
  | { id: string; seq: number; type: 'order'; listId: string; order: string[]; mtime: string }
  | { id: string; seq: number; type: 'siblingOrder'; parentId: string | null; order: string[]; mtime: string };

export interface MirrorState {
  // Whose mirror this is, checked on every save so one account's records can't be written under
  // another's key.
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

// A highlight as an older build persisted it: one range per segment covered, rather than the two
// endpoints of the whole span.
interface LegacyHighlightRecord {
  ranges?: { i: number; s: number; e: number }[];
}

// Normalizes a mirror persisted by an older build on the way in from mirrorDb.ts, so nothing
// downstream sees more than one shape. Today that means collapsing a highlight's per-segment
// ranges to its two endpoints.
//
// It is permanent: a reader who never signs in has no server copy to re-pull from, so there is no
// point at which every device is known to have converted. The do-nothing path is therefore the hot
// one and is read-only by construction — a mirror needing no conversion comes back as the very
// object it was given.
export function upgradeStoredMirror(state: MirrorState): MirrorState {
  let highlights: Record<string, Stored<HighlightRecord>> | null = null;
  for (const [g, record] of Object.entries(state.highlights ?? {})) {
    const data = record.data as HighlightRecord & LegacyHighlightRecord;
    if (!Array.isArray(data.ranges)) continue;
    const { ranges, ...rest } = data;
    highlights = highlights ?? { ...state.highlights };
    const ordered = [...ranges].sort((a, b) => a.i - b.i || a.s - b.s);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    // An empty `ranges` is a record no write path could have produced, dropped rather than carried
    // forward with an invented span.
    if (!first) delete highlights[g];
    else highlights[g] = { ...record, data: { ...rest, span: { i0: first.i, o0: first.s, i1: last.i, o1: last.e } } };
  }
  return highlights ? { ...state, highlights } : state;
}

// Returns a new list's position, one below its lowest sibling and 0 in an empty parent. Mirrors
// the server's own firstPosition, so a list created offline lands where the server would put it.
function firstPosition(positions: number[]): number {
  return positions.reduce((min, p) => Math.min(min, p ?? 0), 1) - 1;
}

function withList(state: MirrorState, id: string, record: Stored<ListRecord> | null): MirrorState {
  const lists = { ...state.lists };
  if (record) lists[id] = record;
  else delete lists[id];
  return { ...state, lists };
}

// Applies `change` to a live list record and marks it dirty; a missing or tombstoned row is left
// alone. A change altering nothing is dropped rather than stamped, since a fresh `mtime` on an
// untouched row would win it every future merge against another device's real edit.
function editList(state: MirrorState, id: string, change: Partial<ListRecord>): MirrorState {
  const current = state.lists[id];
  if (!current || current.data.deleted) return state;
  // Object.is, so an array-valued change counts as a change rather than being skipped on identity.
  const changed = Object.entries(change).some(([key, value]) => !Object.is(current.data[key as keyof ListRecord], value));
  if (!changed) return state;
  const next = withList(state, id, { dirty: true, data: { ...current.data, ...change, mtime: nextMtime() } });
  return restampOrderOps(next, id);
}

// Moves any queued order op touching `id` ahead of the mtime just stamped on that row. Both order
// endpoints are conditional on the same `mtime` a rename or delete writes, so without this a
// reorder followed by a rename fails its own guard and the pull hands back the old order. It only
// outruns this device's own later edits; against another device's, the op keeps the timestamp from
// when the user acted, so a genuinely stale reorder still loses.
function restampOrderOps(state: MirrorState, id: string): MirrorState {
  const affected = (op: QueuedOp) =>
    (op.type === 'order' && op.listId === id) || (op.type === 'siblingOrder' && op.order.includes(id));
  if (!state.ops.some(affected)) return state;
  return { ...state, ops: state.ops.map((op) => (affected(op) ? { ...op, mtime: nextMtime() } : op)) };
}

// Creates a list. `id` is minted by the caller, so the row has its final identity before this
// returns.
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

// Queues one parent's whole sibling order — a drag, or a Move up/down — as a single op, so a
// gesture costs one request whatever the group's size. `order` is the full sequence with the moved
// row already in place, and every id in it is re-parented to `parentId`, which is what lets every
// drop in the tree be this one call. Positions are applied locally so the tree renders at once,
// but the rows are not dirtied: the op carries the order, not the records.
export function queueSiblingOrder(state: MirrorState, parentId: string | null, order: string[]): MirrorState {
  const lists = { ...state.lists };
  order.forEach((id, position) => {
    const current = lists[id];
    if (!current || current.data.deleted) return;
    lists[id] = { ...current, data: { ...current.data, parentId, position } };
  });
  // Only a parent's latest order matters, so an earlier op for the same parent is dropped.
  const ops = state.ops.filter((op) => !(op.type === 'siblingOrder' && op.parentId === parentId));
  return nextOp({ ...state, lists, ops }, { type: 'siblingOrder', parentId, order, mtime: nextMtime() });
}

// Returns `id` and every row beneath it, tombstoned rows included. Guarded by a visited set rather
// than assuming a tree: two devices can each make a valid move that together form a cycle.
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

// Deletes a list and, since deleting a group takes what is inside it, everything beneath it. Each
// row is decided on its own, a subtree being able to hold both kinds:
//   never sent (createSent false) – dropped outright, with anything queued against it, since a
//                                   create landing after its delete would resurrect the row
//   anything else                 – tombstoned, the server may already hold it
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
  // An op keyed on a dropped parent goes with the row, that group having never reached the server.
  // One merely naming a dropped id is left alone: the server reconciles a posted order against the
  // rows that exist.
  if (dropped.size === 0) return next;
  return {
    ...next,
    ops: next.ops.filter((op) =>
      op.type === 'siblingOrder' ? !op.parentId || !dropped.has(op.parentId) : !dropped.has(op.listId)
    ),
  };
}

export function setNoteRecord(state: MirrorState, suttaId: string, text: string): MirrorState {
  // Whitespace-only is stored as cleared, as the server does, so the Notes auto-list can't show a
  // note the server holds no row for.
  const stored = text.trim() ? text : '';
  return {
    ...state,
    notes: { ...state.notes, [suttaId]: { dirty: true, data: { suttaId, text: stored, mtime: nextMtime() } } },
  };
}

export function markVisitedRecord(state: MirrorState, suttaId: string): MirrorState {
  // Re-marking what is already the most recent visit changes nothing in a list ordered by
  // visitedAt, so it is skipped rather than churning the state reference.
  const current = state.visited[suttaId];
  if (current && Object.values(state.visited).every((v) => v.data.visitedAt <= current.data.visitedAt)) return state;
  return {
    ...state,
    visited: { ...state.visited, [suttaId]: { dirty: true, data: { suttaId, visitedAt: nextMtime() } } },
  };
}

// Writes a highlight over `span`, or erases (`color: null`), tombstoning whatever it displaces.
// Highlights are immutable, so a recolour is a tombstone plus a new highlight, never an update,
// which is what makes the write safe to replay.
export function writeHighlightRecord(
  state: MirrorState,
  suttaId: string,
  span: HlSpan,
  color: string | null
): MirrorState {
  const displaced = displacedIds(highlightsFor(state, suttaId), span);
  const highlights = { ...state.highlights };
  const erase: string[] = [];
  for (const g of displaced) {
    const record = highlights[g];
    // A highlight created and erased without ever leaving this device inherits its own tombstones,
    // which the server may hold, but is not itself tombstoned below.
    if (record?.dirty) erase.push(...record.data.erase);
    // Anything the server might hold is tombstoned — one already synced, and one whose own write
    // is still in flight. Tombstoning a row it never received matches nothing and costs nothing.
    if (!record?.dirty || record.data.sent) erase.push(g);
    delete highlights[g];
  }
  const pushable = [...new Set(erase)];
  if (!color && !pushable.length) return { ...state, highlights };
  const g = randomId();
  highlights[g] = { dirty: true, data: { g, suttaId, span, color, erase: pushable, mtime: nextMtime(), sent: false } };
  return { ...state, highlights };
}

// An op before the queue gives it an id and a seq. Spelled out rather than derived with Omit,
// which distributes over the union into a shape none of its members has.
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

// Returns one list's items with a sutta added or removed. Both are idempotent, which is what lets
// an op be replayed without changing the answer.
function nextMembership(items: string[], suttaId: string, add: boolean): string[] {
  if (!add) return items.filter((s) => s !== suttaId);
  // Already a member: the same array back, so a caller comparing by reference sees no change.
  if (items.includes(suttaId)) return items;
  // A new sutta goes last, where it belongs in user order.
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

// Returns one list's freshly pulled items with a single queued op replayed over them. The
// membership ops go through the same helper the local write used, so the two can't disagree; an
// order is reconciled rather than applied wholesale, the pull having possibly brought in items the
// queued order never saw.
function replayItemsOp(items: string[], op: Extract<QueuedOp, { type: 'add' | 'remove' | 'order' }>): string[] {
  if (op.type === 'add') return nextMembership(items, op.suttaId, true);
  if (op.type === 'remove') return nextMembership(items, op.suttaId, false);
  return reconcileItems(items, op.order);
}

// Replays the still-queued ops over freshly pulled rows, so an edit made offline doesn't blink out
// of the UI until it lands.
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
// record, a clean record the snapshot doesn't mention is gone, and everything dirty survives — it
// is work the snapshot was taken before seeing.
export function applySnapshot(state: MirrorState, snapshot: UserData): MirrorState {
  const lists: Record<string, Stored<ListRecord>> = {};
  // The snapshot arrives repaired and in sibling order but with no positions of its own, so each
  // row takes its index among its siblings — the dense indices the server itself assigns.
  const seen = new Map<string | null, number>();
  for (const list of snapshot.lists) {
    // The auto-lists are synthesized rather than rows; the mirror derives its own so they exist
    // offline too (lib/mirrorView.ts).
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
        // The server sends no mtime. It is read only as the tiebreak when two moves form a cycle,
        // and a repaired snapshot has none, so only locally moved rows need a real one.
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
    // The note's own mtime, which mirrorView orders the Notes auto-list by.
    notes[suttaId] = { dirty: false, data: { suttaId, text, mtime: m } };
  }
  for (const [id, record] of Object.entries(state.notes)) if (record.dirty) notes[id] = record;

  const visited: Record<string, Stored<VisitedRecord>> = {};
  for (const [suttaId, visitedAt] of Object.entries(snapshot.visited)) {
    visited[suttaId] = { dirty: false, data: { suttaId, visitedAt } };
  }
  for (const [id, record] of Object.entries(state.visited)) if (record.dirty) visited[id] = record;

  // Highlights erased locally but not yet pushed, which the server still holds and the snapshot
  // brings back — dropped here, so an offline erase doesn't undo itself on every pull.
  const pendingErase = new Set(
    Object.values(state.highlights).flatMap((record) => (record.dirty ? record.data.erase : []))
  );
  const highlights: Record<string, Stored<HighlightRecord>> = {};
  for (const [suttaId, rows] of Object.entries(snapshot.highlights)) {
    for (const { id, i0, o0, i1, o1, c, m } of rows) {
      if (pendingErase.has(id)) continue;
      highlights[id] = {
        dirty: false,
        data: { g: id, suttaId, span: { i0, o0, i1, o1 }, color: c, erase: [], mtime: m, sent: true },
      };
    }
  }
  for (const [id, record] of Object.entries(state.highlights)) if (record.dirty) highlights[id] = record;

  return { ...state, lists: replayOps(lists, state.ops), notes, highlights, visited };
}

// Re-ids a list the server refused as a collision, along with every reference to it — its
// children's parentId and every queued op naming it — so the record can drain rather than
// colliding identically on every retry.
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
    // A sibling order names ids in `order` rather than a `listId`, and its `parentId` can be the
    // re-idded row as well.
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

// Separates the two halves of a note merged by adoptMirror.
export const ADOPTED_NOTE_SEPARATOR = '\n\n———\n\n';

// Moves everything a signed-out reader made into the account they just signed into, for the
// ordinary flush to push as their own.
//
// Every adopted record is dirty and keeps the `mtime` it was written at, that being when the user
// acted. Lists and highlights are re-created rather than merged — both carry client-minted ids, so
// neither can collide — and go back to unsent, this account's server never having seen them. Notes
// are keyed by sutta and so can collide: where this device holds both texts they are concatenated,
// which is lossless where last-writer-wins is not, and otherwise the ordinary mtime merge decides.
export function adoptMirror(account: MirrorState, local: MirrorState): MirrorState {
  const lists = { ...account.lists };
  for (const [id, record] of Object.entries(local.lists)) {
    // A list created and deleted before it ever left the device: no server holds it, so its
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
    // A retried adoption — a crash between saveMirror and deleteMirror — would otherwise append
    // the local half a second time.
    if (existing.data.text.endsWith(`${ADOPTED_NOTE_SEPARATOR}${record.data.text}`)) {
      notes[suttaId] = { dirty: true, data: { ...existing.data } };
      continue;
    }
    notes[suttaId] = {
      dirty: true,
      data: {
        suttaId,
        text: `${existing.data.text}${ADOPTED_NOTE_SEPARATOR}${record.data.text}`,
        // Newer than either half, so neither can win against the row they were merged into.
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

  // Re-sequenced onto the end of the account's queue: `seq` is per-mirror, so the local ops would
  // otherwise interleave by a counter that meant something else.
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

// True when a mirror holds anything worth adopting onto an account.
export function hasContent(state: MirrorState): boolean {
  return (
    Object.keys(state.lists).length > 0 ||
    Object.values(state.notes).some((n) => !!n.data.text) ||
    Object.keys(state.highlights).length > 0 ||
    Object.keys(state.visited).length > 0
  );
}

// Clears one record's dirty flag, but only for the exact version the server acknowledged.
function clearDirty<T extends { mtime: string }>(
  records: Record<string, Stored<T>>,
  id: string,
  mtime: string,
  extra?: Partial<T>
): Record<string, Stored<T>> {
  const record = records[id];
  if (!record) return records;
  // A record edited again while the flush was out is still unsent, so it stays dirty.
  const settled = record.data.mtime === mtime;
  if (!settled && !extra) return records;
  return { ...records, [id]: { dirty: !settled, data: extra ? { ...record.data, ...extra } : record.data } };
}

// How much work the mirror still owes the server, dirty records and queued ops together, which the
// sync indicator reads.
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
  // How the flush ended.
  //   ok           – everything drained and the pull applied
  //   offline      – a retryable failure stopped it partway; the rest goes next time
  //   unauthorized – the session lapsed, so it paused with the queue intact
  //   blocked      – another tab holds the flush lock
  status: 'ok' | 'offline' | 'unauthorized' | 'blocked';
  // Everything the flush is done with, taken or permanently refused alike — either way there is
  // nothing left to send.
  acks: FlushAck[];
  doneOps: string[];
  remaps: { from: string; to: string }[];
  snapshot: UserData | null;
}

// Marks the rows a flush is about to put on the wire, before its first request goes out, since
// `createSent` and `sent` have to be right during the round trip itself. They mark the row rather
// than the version, answering "might the server hold this already", which a later local edit
// doesn't change. Marking a write the flush never sends costs at most a tombstone matching no row.
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
  // The same reference back when there was nothing to mark, so the common case costs no render.
  if (lists === state.lists && highlights === state.highlights) return state;
  return { ...state, lists, highlights };
}

// Folds a finished flush into whatever the mirror looks like now, which may not be what the flush
// started from. Everything is matched on the exact version pushed, so a record edited mid-flush
// stays dirty.
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
      // A landed erase-only write holds no rows of its own, so nothing is left for it to stand for.
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
