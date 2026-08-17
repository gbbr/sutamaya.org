import { describe, expect, it, vi, beforeEach } from 'vitest';
import { emptyMirror, queueMembership, createListRecord, setNoteRecord, type MirrorState } from './mirror';
import { flushMirror } from './sync';

const dataApiAll = vi.fn();
const listsApiCreate = vi.fn();
const listsApiAddItem = vi.fn();
const notesApiSet = vi.fn();

vi.mock('./api', () => ({
  dataApi: { all: (...args: unknown[]) => dataApiAll(...args) },
  listsApi: {
    create: (...args: unknown[]) => listsApiCreate(...args),
    update: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
    addItem: (...args: unknown[]) => listsApiAddItem(...args),
    removeItem: vi.fn(async () => ({ ok: true })),
    reorderItems: vi.fn(async () => ({ ok: true })),
  },
  notesApi: { set: (...args: unknown[]) => notesApiSet(...args) },
  highlightsApi: { setRanges: vi.fn(async () => ({ ok: true })) },
  visitedApi: { mark: vi.fn(async () => ({ ok: true })) },
}));

function httpError(status: number) {
  return Promise.reject(Object.assign(new Error(`Request failed (${status})`), { status }));
}

// A list already on the server (clean create) plus one queued membership op against it.
function withQueuedAdd(): MirrorState {
  let state = createListRecord(emptyMirror('u1'), { id: 'l1', label: 'Favorites', parentId: null, kind: 'list' });
  state = { ...state, lists: { l1: { dirty: false, data: { ...state.lists.l1.data, pendingCreate: false } } } };
  return queueMembership(state, 'l1', 'dn1', true);
}

beforeEach(() => {
  vi.clearAllMocks();
  dataApiAll.mockResolvedValue({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });
  listsApiCreate.mockResolvedValue({ list: null });
  listsApiAddItem.mockResolvedValue({ ok: true });
  notesApiSet.mockResolvedValue({ ok: true });
});

describe('flushMirror', () => {
  it('stops on a status-less failure and leaves the rest of the queue for next time', async () => {
    notesApiSet.mockImplementation(() => Promise.reject(new Error('Failed to fetch')));
    const state = setNoteRecord(withQueuedAdd(), 'dn1', 'a note');

    const outcome = await flushMirror(state);

    // There is no point pushing the rest of the queue at a network that isn't there — and stopping
    // is what keeps the ops in the order the user made them.
    expect(outcome.status).toBe('offline');
    expect(outcome.acks).toEqual([]);
    expect(outcome.doneOps).toEqual([]);
    expect(listsApiAddItem).not.toHaveBeenCalled();
    // No snapshot either: the pull would fail the same way, and applying nothing is not the same as
    // applying an empty dataset.
    expect(outcome.snapshot).toBeNull();
  });

  it('leaves a permanently rejected record unacked, and carries on with the rest', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    notesApiSet.mockImplementation(() => httpError(400));
    const state = setNoteRecord(withQueuedAdd(), 'dn1', 'a note');

    const outcome = await flushMirror(state);

    // Retrying a 400 blindly cannot fix it, so the record stays dirty — a queue that never drains
    // is a thing to surface, not to hide. Nothing else in the flush is held up by it.
    expect(outcome.status).toBe('ok');
    expect(outcome.acks).toEqual([]);
    // Reported separately from `acks` so the mirror can mark it stuck rather than merely "still
    // dirty" — see applyFlushOutcome/syncCounts, which is what the sync indicator reads.
    expect(outcome.rejected).toEqual([{ kind: 'note', id: 'dn1', mtime: state.notes.dn1.data.mtime }]);
    expect(outcome.doneOps).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reports a permanently rejected list operation the same way, without retiring it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listsApiAddItem.mockImplementation(() => httpError(400));
    const state = withQueuedAdd();
    const opId = state.ops[0].id;

    const outcome = await flushMirror(state);

    expect(outcome.status).toBe('ok');
    expect(outcome.doneOps).toEqual([]);
    expect(outcome.rejectedOps).toEqual([opId]);
    errorSpy.mockRestore();
  });

  it('retires a write whose row is gone rather than retrying it forever', async () => {
    listsApiAddItem.mockImplementation(() => httpError(404));
    const outcome = await flushMirror(withQueuedAdd());

    // The list was deleted on another device: the add is moot rather than failed, so the op is
    // dropped instead of accumulating in a queue that can never drain.
    expect(outcome.status).toBe('ok');
    expect(outcome.doneOps).toHaveLength(1);
  });

  it('pauses on a 401 without acknowledging anything', async () => {
    notesApiSet.mockImplementation(() => httpError(401));
    const outcome = await flushMirror(setNoteRecord(emptyMirror('u1'), 'dn1', 'a note'));

    expect(outcome.status).toBe('unauthorized');
    expect(outcome.acks).toEqual([]);
  });

  it('pushes list creates oldest first, so a parent always precedes its child', async () => {
    let state = createListRecord(emptyMirror('u1'), { id: 'g1', label: 'Group', parentId: null, kind: 'group' });
    state = createListRecord(state, { id: 'c1', label: 'Child', parentId: 'g1', kind: 'list' });

    await flushMirror(state);

    // POST /lists rejects an unknown parent, so a child arriving first would be a 400 the queue
    // could never recover from.
    expect(listsApiCreate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['g1', 'c1']);
  });
});
