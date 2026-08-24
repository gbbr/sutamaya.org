import { describe, expect, it } from 'vitest';
import {
  ADOPTED_NOTE_SEPARATOR,
  adoptMirror,
  applyFlushOutcome,
  applySnapshot,
  createListRecord,
  emptyMirror,
  hasContent,
  markDispatched,
  markVisitedRecord,
  queueItemOrder,
  queueMembership,
  removeListRecord,
  renameListRecord,
  setListParentRecord,
  queueSiblingOrder,
  setNoteRecord,
  syncCounts,
  writeHighlightRecord,
  type FlushOutcome,
  type MirrorState,
} from './mirror';
import type { UserData } from './api';

const emptySnapshot: UserData = { lists: [], membership: {}, notes: {}, highlights: {}, visited: {} };

function snapshot(overrides: Partial<UserData>): UserData {
  return { ...emptySnapshot, ...overrides };
}

function list(state: MirrorState, id: string, parentId: string | null = null, kind: 'list' | 'group' = 'list'): MirrorState {
  return createListRecord(state, { id, label: id, parentId, kind });
}

// A pulled record, as applySnapshot would have written it: clean, and therefore replaceable.
function pulled(state: MirrorState, id: string, items: string[] = []): MirrorState {
  return applySnapshot(state, snapshot({ lists: [{ id, label: id, parentId: null, kind: 'list', items }] }));
}

describe('applySnapshot', () => {
  it('replaces clean records and keeps dirty ones', () => {
    let state = pulled(emptyMirror('u1'), 'l1');
    state = renameListRecord(state, 'l1', 'renamed offline');
    state = pulled(state, 'l1');

    // The pull was taken before the rename reached the server, so the local version is the newer
    // one and stays — that is the whole reason a dirty flag exists rather than a cache.
    expect(state.lists.l1.dirty).toBe(true);
    expect(state.lists.l1.data.label).toBe('renamed offline');
  });

  it('keeps each pulled notes own mtime', () => {
    const state = applySnapshot(
      emptyMirror('u1'),
      snapshot({ notes: { dn1: { text: 'hello', m: '2026-01-01T00:00:00.000Z|d' } } })
    );

    // mirrorView orders the Notes auto-list by this. A blank would flatten that order into whatever
    // order the server's SELECT happened to return, and sort every pulled note below any locally
    // dirty one regardless of which was actually written more recently.
    expect(state.notes.dn1.data.mtime).toBe('2026-01-01T00:00:00.000Z|d');
  });

  it('drops a clean record the snapshot no longer mentions', () => {
    let state = pulled(emptyMirror('u1'), 'l1');
    state = applySnapshot(state, emptySnapshot);

    // Deleted on another device, or cascaded out with a deleted ancestor: either way the server is
    // right and there is nothing local worth keeping.
    expect(state.lists.l1).toBeUndefined();
  });

  it('replays a queued membership op over the pulled items', () => {
    let state = pulled(emptyMirror('u1'), 'l1');
    state = queueMembership(state, 'l1', 'dn1', true);
    state = pulled(state, 'l1', []);

    // The add hasn't landed, so the snapshot doesn't have it — without the replay the sutta would
    // blink out of the list on every pull until the flush caught up.
    expect(state.lists.l1.data.items).toEqual(['dn1']);
    expect(state.ops).toHaveLength(1);
  });

  it('does not resurrect a group a pending erase names', () => {
    let state = applySnapshot(
      emptyMirror('u1'),
      snapshot({ highlights: { dn1: [{ id: 'h1', i: 0, s: 0, e: 5, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|d' }] } })
    );
    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 5 }], null);
    expect(state.highlights.g1).toBeUndefined();

    state = applySnapshot(
      state,
      snapshot({ highlights: { dn1: [{ id: 'h1', i: 0, s: 0, e: 5, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|d' }] } })
    );

    // The erase is still queued, so the server still has the group — dropping it here is what keeps
    // an erase made offline from visibly undoing itself on every pull.
    expect(state.highlights.g1).toBeUndefined();
  });

  it('recombines a pulled group into one record per `g`', () => {
    const state = applySnapshot(
      emptyMirror('u1'),
      snapshot({
        highlights: {
          dn1: [
            { id: 'h2', i: 1, s: 0, e: 4, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|d' },
            { id: 'h1', i: 0, s: 3, e: 9, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|d' },
          ],
        },
      })
    );

    // One row per segment on the wire, one record per group in the mirror — and in segment order,
    // whatever order the rows arrived in.
    expect(Object.keys(state.highlights)).toEqual(['g1']);
    expect(state.highlights.g1.data.ranges).toEqual([
      { i: 0, s: 3, e: 9 },
      { i: 1, s: 0, e: 4 },
    ]);
  });
});

describe('local collapses', () => {
  it('drops a highlight group created and erased before either ever synced', () => {
    let state = writeHighlightRecord(emptyMirror('u1'), 'dn1', [{ i: 0, s: 0, e: 5 }], 'yellow');
    const created = Object.keys(state.highlights);
    expect(created).toHaveLength(1);

    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 5 }], null);

    // Pushed as a create-then-tombstone pair the tombstone matches nothing if it lands first, and
    // the create then resurrects a highlight the user already erased. Nothing to push is both
    // simpler and safer.
    expect(state.highlights).toEqual({});
  });

  it('carries a dropped groups own tombstones into the write that replaces it', () => {
    // A synced group, recoloured offline, then erased offline before either write went out.
    let state = applySnapshot(
      emptyMirror('u1'),
      snapshot({ highlights: { dn1: [{ id: 'h1', i: 0, s: 0, e: 5, c: 'yellow', g: 'synced', m: '2026-01-01T00:00:00.000Z|d' }] } })
    );
    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 5 }], 'green');
    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 5 }], null);

    // The recolour is dropped as never-synced, but the group it displaced is one the server still
    // holds — losing that tombstone with it would bring the original highlight back on the next pull.
    const pending = Object.values(state.highlights);
    expect(pending).toHaveLength(1);
    expect(pending[0].data.color).toBeNull();
    expect(pending[0].data.erase).toEqual(['synced']);
  });

  it('cancels an add and a remove of the same sutta in the same list', () => {
    let state = pulled(emptyMirror('u1'), 'l1');
    state = queueMembership(state, 'l1', 'dn1', true);
    state = queueMembership(state, 'l1', 'dn1', false);

    // Both were still queued, so the list's items are back to what the server already has.
    expect(state.ops).toEqual([]);
    expect(state.lists.l1.data.items).toEqual([]);
  });

  it('drops a list deleted before its create ever reached the server, along with its ops', () => {
    let state = list(emptyMirror('u1'), 'l1');
    state = queueMembership(state, 'l1', 'dn1', true);
    state = removeListRecord(state, 'l1');

    expect(state.lists.l1).toBeUndefined();
    expect(state.ops).toEqual([]);
  });

  it('takes a deleted group\'s whole subtree with it', () => {
    let state = list(emptyMirror('u1'), 'g1', null, 'group');
    state = list(state, 'g2', 'g1', 'group');
    state = list(state, 'l1', 'g2');
    state = markDispatched(state, state);
    state = removeListRecord(state, 'g1');

    // Deleting a group deletes what is inside it — nothing may survive by being re-homed, which is
    // what a child left pointing at a row that no longer exists would do (see repairListTree).
    expect(state.lists.g2.data.deleted).toBe(true);
    expect(state.lists.l1.data.deleted).toBe(true);
  });

  it('tombstones a synced list sitting under a group deleted before its own create was sent', () => {
    let state = pulled(emptyMirror('u1'), 'l1');
    state = list(state, 'g1', null, 'group');
    state = setListParentRecord(state, 'l1', 'g1');
    state = removeListRecord(state, 'g1');

    // The group is this device's own invention and goes without trace, but the server holds `l1` —
    // dropping it on the group's verdict would leave nothing to carry the delete, and the next pull
    // would hand the list straight back.
    expect(state.lists.g1).toBeUndefined();
    expect(state.lists.l1.data.deleted).toBe(true);
    expect(state.lists.l1.dirty).toBe(true);
  });

  it('drops an unsent list under a deleted group rather than pushing a create for it', () => {
    let state = list(emptyMirror('u1'), 'g1', null, 'group');
    state = markDispatched(state, state);
    state = list(state, 'l1', 'g1');
    state = queueMembership(state, 'l1', 'dn1', true);
    state = removeListRecord(state, 'g1');

    // The group has to be tombstoned, but the child never left this device: pushing its create
    // under a tombstoned parent only leaves a row the server's own cascade hides.
    expect(state.lists.g1.data.deleted).toBe(true);
    expect(state.lists.l1).toBeUndefined();
    expect(state.ops).toEqual([]);
  });

  it('tombstones a list deleted while its own create is still in flight', () => {
    let state = list(emptyMirror('u1'), 'l1');
    // What a flush does to the records it is about to put on the wire.
    state = markDispatched(state, state);
    state = removeListRecord(state, 'l1');

    // The POST may already have landed, so there is no collapsing this away: dropping the record
    // leaves nothing to carry the delete, and the pull at the end of that same flush hands the
    // list back as a clean row.
    expect(state.lists.l1.data.deleted).toBe(true);
    expect(state.lists.l1.dirty).toBe(true);
  });

  it('tombstones a highlight group erased while its own create is still in flight', () => {
    let state = writeHighlightRecord(emptyMirror('u1'), 'dn1', [{ i: 0, s: 0, e: 5 }], 'yellow');
    const [g] = Object.keys(state.highlights);
    state = markDispatched(state, state);
    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 5 }], null);

    // Same race as the list above: the group the server may already hold has to be named as a
    // tombstone, or the erase quietly undoes itself on the next pull.
    const pending = Object.values(state.highlights);
    expect(pending).toHaveLength(1);
    expect(pending[0].data.color).toBeNull();
    expect(pending[0].data.erase).toEqual([g]);
  });

  it('tombstones a list the server already knows about rather than removing it', () => {
    let state = pulled(emptyMirror('u1'), 'l1');
    state = removeListRecord(state, 'l1');

    // The row has to stay: a device that was offline when the delete happened would otherwise push
    // its still-live copy back, which against a missing row is a fresh creation.
    expect(state.lists.l1.data.deleted).toBe(true);
    expect(state.lists.l1.dirty).toBe(true);
  });

  it('renumbers a reorder and re-parents anything crossing into the target parent', () => {
    let state = list(emptyMirror('u1'), 'g1', null, 'group');
    state = list(state, 'a');
    state = list(state, 'b', 'g1');
    state = queueSiblingOrder(state, 'g1', ['b', 'a']);

    // Sets parentId on every id in `order`, not just position, which is what lets a cross-parent
    // drop fold into this single call instead of a setListParent first (see planListDrop in
    // lib/listTreeDrop.ts) — the fix for a real shipped bug (a55e1ecc) where two sequential calls
    // produced a visible two-step "jump" on drop.
    expect(state.lists.a.data).toMatchObject({ parentId: 'g1', position: 1 });
    expect(state.lists.b.data).toMatchObject({ parentId: 'g1', position: 0 });
    // Untouched sibling sets keep their own positions — `position` orders siblings, not the table.
    expect(state.lists.g1.data.parentId).toBeNull();
  });

  it('queues one op for a whole reorder instead of dirtying every sibling', () => {
    let state = applySnapshot(
      emptyMirror('u1'),
      snapshot({ lists: ['a', 'b', 'c'].map((id) => ({ id, label: id, parentId: null, kind: 'list' as const, items: [] })) })
    );
    state = queueSiblingOrder(state, null, ['c', 'a', 'b']);

    // The whole point: dragging the last of N siblings to the top is one request, not N. As per-row
    // records it was one PATCH each, which exhausts the Worker's per-minute budget in a couple of
    // gestures — and takes GET /api/auth/me down with it, since they share that budget.
    expect(state.ops).toHaveLength(1);
    expect(Object.values(state.lists).every((record) => !record.dirty)).toBe(true);
    // The order still applies locally and immediately, with no round trip.
    expect(state.lists.c.data.position).toBe(0);
    expect(state.lists.a.data.position).toBe(1);
  });

  it('keeps only the latest order per parent, and one per parent reordered', () => {
    let state = list(emptyMirror('u1'), 'g1', null, 'group');
    state = list(state, 'a', 'g1');
    state = list(state, 'b', 'g1');
    state = queueSiblingOrder(state, 'g1', ['a', 'b']);
    state = queueSiblingOrder(state, 'g1', ['b', 'a']);
    state = queueSiblingOrder(state, null, ['g1']);

    // An order it supersedes would just be overwritten, so only the last one for that parent is
    // worth pushing — but a different parent's order is its own gesture and survives alongside it.
    expect(state.ops).toHaveLength(2);
    expect(state.ops.map((op) => op.type === 'siblingOrder' && op.parentId)).toEqual(['g1', null]);
  });

  it('replays a queued reorder over the pulled positions', () => {
    let state = applySnapshot(
      emptyMirror('u1'),
      snapshot({ lists: ['a', 'b'].map((id) => ({ id, label: id, parentId: null, kind: 'list' as const, items: [] })) })
    );
    state = queueSiblingOrder(state, null, ['b', 'a']);
    state = applySnapshot(
      state,
      snapshot({ lists: ['a', 'b'].map((id) => ({ id, label: id, parentId: null, kind: 'list' as const, items: [] })) })
    );

    // The reorder hasn't landed, so the snapshot still has the old order — without the replay the
    // tree would visibly snap back on every pull until the flush caught up.
    expect(state.lists.b.data.position).toBe(0);
    expect(state.lists.a.data.position).toBe(1);
    expect(state.ops).toHaveLength(1);
  });

  it('keeps a queued item order ahead of a later edit to the same list', () => {
    let state = pulled(emptyMirror('u1'), 'l1', ['a', 'b']);
    state = queueItemOrder(state, 'l1', ['b', 'a']);
    const queued = state.ops[0] as { mtime: string };
    state = renameListRecord(state, 'l1', 'renamed');

    // PUT /lists/:id/items/order is conditional on the *row's* mtime — the same column a rename
    // writes — and records flush before ops. Left behind the rename, the op would match no row,
    // still be answered 200, and be retired as landed while the pull restored the old order.
    const op = state.ops[0] as { mtime: string };
    expect(op.mtime > queued.mtime).toBe(true);
    expect(op.mtime > state.lists.l1.data.mtime).toBe(true);
  });

  it('keeps a queued sibling order ahead of a later edit to a row it names', () => {
    let state = pulled(emptyMirror('u1'), 'a');
    state = applySnapshot(
      state,
      snapshot({ lists: ['a', 'b'].map((id) => ({ id, label: id, parentId: null, kind: 'list' as const, items: [] })) })
    );
    state = queueSiblingOrder(state, null, ['b', 'a']);
    const queued = state.ops[0] as { mtime: string };
    state = renameListRecord(state, 'a', 'renamed');

    // PUT /lists/order guards every row it touches the same way, so a rename of any one of them
    // would otherwise veto the whole gesture.
    const op = state.ops[0] as { mtime: string };
    expect(op.mtime > queued.mtime).toBe(true);
    expect(op.mtime > state.lists.a.data.mtime).toBe(true);
  });

  it('skips re-marking whatever is already the most recent visit', () => {
    let state = markVisitedRecord(emptyMirror('u1'), 'dn1');
    const before = state.visited;
    state = markVisitedRecord(state, 'dn1');
    expect(state.visited).toBe(before);

    // A genuine change of most-recent is not skipped — that is a real reordering of "Visited".
    state = markVisitedRecord(state, 'dn2');
    state = markVisitedRecord(state, 'dn1');
    expect(state.visited.dn1.data.visitedAt > state.visited.dn2.data.visitedAt).toBe(true);
  });
});

// Shared by both describe blocks below — applyFlushOutcome and syncCounts, which reads what it
// leaves behind.
const outcome = (over: Partial<FlushOutcome>): FlushOutcome => ({
  status: 'ok',
  acks: [],
  rejected: [],
  doneOps: [],
  rejectedOps: [],
  remaps: [],
  snapshot: null,
  ...over,
});

describe('applyFlushOutcome', () => {
  it('clears the dirty flag for the version that was actually pushed', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'first');
    const pushed = state.notes.dn1.data.mtime;
    state = applyFlushOutcome(state, outcome({ acks: [{ kind: 'note', id: 'dn1', mtime: pushed }] }));

    expect(state.notes.dn1.dirty).toBe(false);
  });

  it('leaves a record dirty when it was edited again while the flush was out', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'first');
    const pushed = state.notes.dn1.data.mtime;
    state = setNoteRecord(state, 'dn1', 'second');
    state = applyFlushOutcome(state, outcome({ acks: [{ kind: 'note', id: 'dn1', mtime: pushed }] }));

    // The ack is for a version the mirror has already moved past, so the newer body is still unsent.
    expect(state.notes.dn1.dirty).toBe(true);
    expect(state.notes.dn1.data.text).toBe('second');
  });

  it('moves a re-minted list id, its children and its queued ops together', () => {
    let state = list(emptyMirror('u1'), 'g1', null, 'group');
    state = createListRecord(state, { id: 'c1', label: 'child', parentId: 'g1', kind: 'list' });
    state = queueMembership(state, 'g1', 'dn1', true);
    state = applyFlushOutcome(state, outcome({ remaps: [{ from: 'g1', to: 'g2' }] }));

    expect(state.lists.g1).toBeUndefined();
    expect(state.lists.g2.data.id).toBe('g2');
    // A reference left behind would point at nothing: the child would render at the top level and
    // the add would 404 against a list that does not exist.
    expect(state.lists.c1.data.parentId).toBe('g2');
    expect(state.ops[0]).toMatchObject({ type: 'add', listId: 'g2' });
  });

  it('retires a pushed erase-only write, which has no rows of its own to keep', () => {
    let state = applySnapshot(
      emptyMirror('u1'),
      snapshot({ highlights: { dn1: [{ id: 'h1', i: 0, s: 0, e: 5, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|d' }] } })
    );
    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 5 }], null);
    const [g, record] = Object.entries(state.highlights)[0];
    state = applyFlushOutcome(state, outcome({ acks: [{ kind: 'highlight', id: g, mtime: record.data.mtime }] }));

    expect(state.highlights).toEqual({});
  });

  it('marks a permanently rejected record stuck, still dirty, without touching a newer edit', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'first');
    const rejectedMtime = state.notes.dn1.data.mtime;
    state = applyFlushOutcome(state, outcome({ rejected: [{ kind: 'note', id: 'dn1', mtime: rejectedMtime }] }));

    expect(state.notes.dn1.dirty).toBe(true);
    expect(state.notes.dn1.rejected).toBe(true);

    // A version the rejection wasn't about — the user already tried again — isn't pre-judged by
    // its predecessor's failure.
    state = setNoteRecord(state, 'dn1', 'second');
    expect(state.notes.dn1.rejected).toBeUndefined();
  });

  it('marks a permanently rejected op stuck without retiring it', () => {
    let state = createListRecord(emptyMirror('u1'), { id: 'l1', label: 'l1', parentId: null, kind: 'list' });
    state = { ...state, lists: { l1: { dirty: false, data: { ...state.lists.l1.data, pendingCreate: false } } } };
    state = queueMembership(state, 'l1', 'dn1', true);
    const opId = state.ops[0].id;
    state = applyFlushOutcome(state, outcome({ rejectedOps: [opId] }));

    expect(state.ops).toHaveLength(1);
    expect(state.ops[0].rejected).toBe(true);
  });
});

describe('syncCounts', () => {
  it('counts every dirty record and queued op as pending', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'a note');
    state = createListRecord(state, { id: 'l1', label: 'l1', parentId: null, kind: 'list' });
    state = queueMembership(state, 'l1', 'dn2', true);

    // Two dirty records (the note, the pending-create list) plus one queued op.
    expect(syncCounts(state)).toEqual({ pending: 3, stuck: 0 });
  });

  it('counts a rejected record or op in both pending and stuck', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'a note');
    const mtime = state.notes.dn1.data.mtime;
    state = applyFlushOutcome(state, outcome({ rejected: [{ kind: 'note', id: 'dn1', mtime }] }));

    expect(syncCounts(state)).toEqual({ pending: 1, stuck: 1 });
  });

  it('counts nothing once everything is clean', () => {
    const state = applySnapshot(emptyMirror('u1'), emptySnapshot);
    expect(syncCounts(state)).toEqual({ pending: 0, stuck: 0 });
  });
});

describe('adoptMirror', () => {
  it('carries signed-out lists onto the account as fresh creates', () => {
    let local = list(emptyMirror('local-1'), 'l1');
    local = queueMembership(local, 'l1', 'dn1', true);
    const adopted = adoptMirror(emptyMirror('u1'), local);

    expect(adopted.userId).toBe('u1');
    expect(adopted.lists.l1.dirty).toBe(true);
    // The account's server has never seen this row, whatever the local mirror thought.
    expect(adopted.lists.l1.data.pendingCreate).toBe(true);
    expect(adopted.lists.l1.data.createSent).toBe(false);
    expect(adopted.ops).toHaveLength(1);
    expect(adopted.ops[0]).toMatchObject({ type: 'add', listId: 'l1', suttaId: 'dn1' });
  });

  it('keeps each record at the mtime the user wrote it', () => {
    const local = setNoteRecord(emptyMirror('local-1'), 'dn1', 'written offline');
    const adopted = adoptMirror(emptyMirror('u1'), local);
    expect(adopted.notes.dn1.data.mtime).toBe(local.notes.dn1.data.mtime);
  });

  it('appends rather than replaces when both sides have a note for the same sutta', () => {
    const account = setNoteRecord(emptyMirror('u1'), 'dn1', 'from my phone');
    const local = setNoteRecord(emptyMirror('local-1'), 'dn1', 'from this browser');
    const adopted = adoptMirror(account, local);

    expect(adopted.notes.dn1.data.text).toBe(`from my phone${ADOPTED_NOTE_SEPARATOR}from this browser`);
    // A merged note is newer than either half, or the older one could win against the row it was
    // just merged into.
    expect(adopted.notes.dn1.data.mtime > account.notes.dn1.data.mtime).toBe(true);
    expect(adopted.notes.dn1.data.mtime > local.notes.dn1.data.mtime).toBe(true);
  });

  it('drops a list created and deleted before it ever left the device', () => {
    let local = list(emptyMirror('local-1'), 'l1');
    local = removeListRecord(local, 'l1');
    expect(adoptMirror(emptyMirror('u1'), local).lists).toEqual({});
  });

  it('re-sequences ops onto the end of the account queue', () => {
    let account = list(emptyMirror('u1'), 'a1');
    account = queueMembership(account, 'a1', 'mn1', true);
    let local = list(emptyMirror('local-1'), 'l1');
    local = queueMembership(local, 'l1', 'dn1', true);

    const adopted = adoptMirror(account, local);
    const seqs = adopted.ops.map((op) => op.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(adopted.nextSeq).toBeGreaterThan(Math.max(...seqs));
  });

  it('is a no-op for an empty local mirror', () => {
    expect(hasContent(emptyMirror('local-1'))).toBe(false);
    const account = list(emptyMirror('u1'), 'a1');
    expect(adoptMirror(account, emptyMirror('local-1'))).toEqual(account);
  });
});
