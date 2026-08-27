import { describe, expect, it, vi, beforeEach } from 'vitest';
import { emptyMirror, queueMembership, createListRecord, setNoteRecord, type MirrorState } from './mirror';
import { flushMirror } from './sync';
import type { PushItem, PushResult } from './api';

const dataApiAll = vi.fn();
const dataApiPush = vi.fn();

vi.mock('./api', () => ({
  dataApi: {
    all: (...args: unknown[]) => dataApiAll(...args),
    push: (...args: unknown[]) => dataApiPush(...args),
  },
}));

function httpError(status: number) {
  return Promise.reject(Object.assign(new Error(`Request failed (${status})`), { status }));
}

// Every pushed item, flattened out of however many requests the flush made.
function pushedItems(): PushItem[] {
  return dataApiPush.mock.calls.flatMap((call) => call[0] as PushItem[]);
}

// Answers a push item by item, so a test can refuse one kind and leave the rest accepted.
function respond(refuse: (item: PushItem) => PushResult | null = () => null) {
  return async (items: PushItem[]) => ({ results: items.map((item) => refuse(item) ?? { ok: true }) });
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
  dataApiPush.mockImplementation(respond());
});

describe('flushMirror', () => {
  it('stops on a status-less failure and leaves the whole queue for next time', async () => {
    dataApiPush.mockImplementation(() => Promise.reject(new Error('Failed to fetch')));
    const state = setNoteRecord(withQueuedAdd(), 'dn1', 'a note');

    const outcome = await flushMirror(state);

    // A request that never arrived says nothing about any item in it, so nothing is retired — and
    // stopping is what keeps the ops in the order the user made them.
    expect(outcome.status).toBe('offline');
    expect(outcome.acks).toEqual([]);
    expect(outcome.doneOps).toEqual([]);
    // No snapshot either: the pull would fail the same way, and applying nothing is not the same as
    // applying an empty dataset.
    expect(outcome.snapshot).toBeNull();
  });

  it('gives up on a permanently refused record and carries on with the rest', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dataApiPush.mockImplementation(respond((item) => (item.type === 'note' ? { error: 'bad_note', status: 400 } : null)));
    const state = setNoteRecord(withQueuedAdd(), 'dn1', 'a note');

    const outcome = await flushMirror(state);

    // A refusal is permanent by definition, so no later attempt would answer differently: the write
    // is retired like any other, and the pull rebases the row onto whatever the account has. Keeping
    // it would leave a queue that can never drain and a warning the reader can do nothing about.
    expect(outcome.status).toBe('ok');
    expect(outcome.acks).toEqual([{ kind: 'note', id: 'dn1', mtime: state.notes.dn1.data.mtime }]);
    // And the items behind it in the same push still land — that is what per-item results are for.
    expect(outcome.doneOps).toHaveLength(1);
    // The disagreement about validity is a bug in one of the two sides, so it goes to whoever is
    // watching the console.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('gives up on a permanently refused list operation the same way', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dataApiPush.mockImplementation(respond((item) => (item.type === 'item.add' ? { error: 'bad_op', status: 400 } : null)));
    const state = withQueuedAdd();
    const opId = state.ops[0].id;

    const outcome = await flushMirror(state);

    expect(outcome.status).toBe('ok');
    expect(outcome.doneOps).toEqual([opId]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('retires a write whose row is gone rather than retrying it forever', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dataApiPush.mockImplementation(respond((item) => (item.type === 'item.add' ? { error: 'not_found', status: 404 } : null)));

    const outcome = await flushMirror(withQueuedAdd());

    // The list was deleted on another device: the add is moot rather than failed, so the op is
    // dropped instead of accumulating in a queue that can never drain — and without the console
    // noise a genuine refusal earns, since nothing here disagreed about anything.
    expect(outcome.status).toBe('ok');
    expect(outcome.doneOps).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('pauses on a 401 without acknowledging anything', async () => {
    dataApiPush.mockImplementation(() => httpError(401));
    const outcome = await flushMirror(setNoteRecord(emptyMirror('u1'), 'dn1', 'a note'));

    expect(outcome.status).toBe('unauthorized');
    expect(outcome.acks).toEqual([]);
  });

  it('pushes list creates oldest first, so a parent always precedes its child', async () => {
    let state = createListRecord(emptyMirror('u1'), { id: 'g1', label: 'Group', parentId: null, kind: 'group' });
    state = createListRecord(state, { id: 'c1', label: 'Child', parentId: 'g1', kind: 'list' });

    await flushMirror(state);

    // A create naming an unknown parent is refused, so a child arriving first would be a permanent
    // refusal the queue could never recover from.
    expect(pushedItems().map((item) => (item.type === 'list.create' ? item.id : item.type))).toEqual(['g1', 'c1']);
  });

  it('sends records before operations, in one push', async () => {
    const state = setNoteRecord(withQueuedAdd(), 'dn1', 'a note');

    await flushMirror(state);

    // An op naming a list the server has never seen is refused and thrown away, so membership can
    // never precede the record it names. One request carries both.
    expect(dataApiPush).toHaveBeenCalledTimes(1);
    expect(pushedItems().map((item) => item.type)).toEqual(['note', 'item.add']);
  });

  it('chunks a long queue and drains it before pulling', async () => {
    let state = emptyMirror('u1');
    for (let i = 0; i < 250; i += 1) state = setNoteRecord(state, `dn${i}`, `note ${i}`);

    const outcome = await flushMirror(state);

    // The Worker refuses more than PUSH_MAX_ITEMS at once, so the client loops until the queue
    // drains — and the pull happens once, at the end, not per chunk.
    expect(dataApiPush.mock.calls.map((call) => (call[0] as PushItem[]).length)).toEqual([100, 100, 50]);
    expect(dataApiAll).toHaveBeenCalledTimes(1);
    expect(outcome.acks).toHaveLength(250);
  });

  it('keeps the unsent remainder when a later chunk fails', async () => {
    let state = emptyMirror('u1');
    for (let i = 0; i < 150; i += 1) state = setNoteRecord(state, `dn${i}`, `note ${i}`);
    dataApiPush.mockImplementationOnce(respond()).mockImplementationOnce(() => httpError(503));

    const outcome = await flushMirror(state);

    // The first chunk landed and is acked; the rest is still owed, and there is no pull, since the
    // snapshot would not yet reflect what is left to send.
    expect(outcome.status).toBe('offline');
    expect(outcome.acks).toHaveLength(100);
    expect(outcome.snapshot).toBeNull();
  });

  it('re-mints a colliding list id and rewrites every reference behind it', async () => {
    let state = createListRecord(emptyMirror('u1'), { id: 'l1', label: 'Mine', parentId: null, kind: 'list' });
    state = queueMembership(state, 'l1', 'dn3', true);
    // Only the first id belongs to another account; the fresh one goes through.
    dataApiPush.mockImplementationOnce(
      respond((item) => (item.type === 'list.create' && item.id === 'l1' ? { error: 'id_collision', status: 409 } : null))
    );

    const outcome = await flushMirror(state);

    expect(outcome.status).toBe('ok');
    expect(outcome.remaps).toHaveLength(1);
    const { to } = outcome.remaps[0];
    expect(outcome.remaps[0].from).toBe('l1');
    // The create goes again under the new id, and the queued add follows it — an add left pointing
    // at the old id would land on a list that does not exist, and the sutta would be lost.
    const creates = pushedItems().filter((item) => item.type === 'list.create');
    expect(creates.map((item) => (item.type === 'list.create' ? item.id : ''))).toEqual(['l1', to]);
    // The add rode along in the same chunk as the losing create, so the server saw it once under
    // the old id — where, being another account's row, it is simply refused, since every statement
    // is scoped to this user. What matters is that it goes again under the new one.
    const adds = pushedItems().filter((item) => item.type === 'item.add');
    expect(adds.at(-1)).toEqual({ type: 'item.add', listId: to, suttaId: 'dn3' });
    // The ack has to name the id the create actually landed under, or applyFlushOutcome clears
    // nothing and the record stays dirty forever.
    expect(outcome.acks).toContainEqual({ kind: 'list', id: to, mtime: state.lists.l1.data.mtime });
  });
});
