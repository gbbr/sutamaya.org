import { describe, expect, it } from 'vitest';
import { repairListTree } from './listTree';
import { deriveUserData } from './mirrorView';
import { emptyMirror, type ListRecord, type MirrorState, type Stored } from './mirror';
// @ts-expect-error -- plain-JS worker modules, no .d.ts across the workspace boundary
import { repairListTree as workerRepairListTree } from '../../../worker/src/lib/listTree.js';
// @ts-expect-error -- ditto
import { assembleUserData } from '../../../worker/src/lib/userData.js';

// web/src/lib/listTree.ts and mirrorView.ts are ports of worker/src/lib/listTree.js and
// userData.js — the same algorithms written twice because nothing shares a module between the two
// npm workspaces. docs/offline-sync.md's invariant 12 says a fix to one belongs in both, and both
// sides have thorough tests of their own, but each is written against its own fixtures: they can
// drift apart without either suite noticing. The visible symptom would be the UI rearranging
// itself the moment a pull lands, since the client renders its own derivation and then the
// server's shaping of the same rows.
//
// So these run one set of fixtures through both implementations and diff the results, the way
// autoLists.test.ts already does for the constants the two files duplicate.

interface Row {
  id: string;
  parentId: string | null;
  position: number;
  mtime: string;
  deleted: boolean;
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  parentId: null,
  position: 0,
  mtime: `2025-01-01T00:00:00.000Z|${id}`,
  deleted: false,
  ...over,
});

// The worker takes `deleted` as SQLite's integer; the client as a boolean. Everything else is the
// same shape, which is what makes a straight diff possible.
const asWorkerRows = (rows: Row[]) => rows.map((r) => ({ ...r, deleted: r.deleted ? 1 : 0 }));
const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

// One fixture per structural case the repair has to decide: nothing to do, a cascade, a dangler, a
// cycle, ties, and the combinations where two of those interact.
const trees: Record<string, Row[]> = {
  'a plain forest': [row('a', { position: 1 }), row('b', { position: 0 }), row('c', { parentId: 'a' })],
  'a tombstoned group with descendants': [
    row('g', { deleted: true }),
    row('child', { parentId: 'g' }),
    row('grandchild', { parentId: 'child' }),
    row('elsewhere'),
  ],
  'a dangling parent under a surviving grandparent': [row('top'), row('orphan', { parentId: 'vanished' }), row('kid', { parentId: 'orphan' })],
  'a two-node cycle': [row('x', { parentId: 'y', mtime: '2025-01-02T00:00:00.000Z|x' }), row('y', { parentId: 'x' })],
  'a three-node cycle with a tail': [
    row('p', { parentId: 'r' }),
    row('q', { parentId: 'p', mtime: '2025-01-03T00:00:00.000Z|q' }),
    row('r', { parentId: 'q', mtime: '2025-01-02T00:00:00.000Z|r' }),
    row('tail', { parentId: 'r' }),
  ],
  'a cycle containing a tombstone': [row('m', { parentId: 'n', deleted: true }), row('n', { parentId: 'm' })],
  'equal positions and equal mtimes': [
    row('second', { position: 0, mtime: '2025-01-01T00:00:00.000Z' }),
    row('first', { position: 0, mtime: '2025-01-01T00:00:00.000Z' }),
  ],
  'negative positions from repeated prepends': [row('oldest', { position: 0 }), row('newer', { position: -1 }), row('newest', { position: -2 })],
  'a tombstoned ancestor above a cycle': [
    row('dead', { deleted: true }),
    row('c1', { parentId: 'c2' }),
    row('c2', { parentId: 'c1', mtime: '2025-01-05T00:00:00.000Z|c2' }),
    row('under', { parentId: 'dead' }),
  ],
  'nothing at all': [],
};

describe('repairListTree agrees between web and worker', () => {
  for (const [name, rows] of Object.entries(trees)) {
    it(`resolves ${name} identically`, () => {
      const web = repairListTree(rows.map((r) => ({ ...r })));
      const worker = workerRepairListTree(asWorkerRows(rows));
      expect(idsOf(web)).toEqual(idsOf(worker));
      // Order alone isn't the whole answer — a re-homed dangler or a broken cycle changes which
      // parent a survivor points at, and the two halves have to agree on that too.
      expect(web.map((r) => r.parentId)).toEqual(worker.map((r: Row) => r.parentId));
    });
  }
});

// The two derivations don't take the same input (the mirror's records versus D1's `{id, data}`
// rows) or emit quite the same notes shape (the UI renders text, the wire carries `{text, m}`), so
// the fixture is built once and adapted to each, and the comparison normalizes the one field that
// differs on purpose.
function mirrorFrom(lists: (Partial<ListRecord> & { id: string })[]): MirrorState {
  const state = emptyMirror('u1');
  const stored: Record<string, Stored<ListRecord>> = {};
  for (const list of lists) {
    stored[list.id] = {
      dirty: false,
      data: {
        label: list.id,
        parentId: null,
        kind: 'list',
        items: [],
        position: 0,
        mtime: `2025-01-01T00:00:00.000Z|${list.id}`,
        deleted: false,
        pendingCreate: false,
        createSent: true,
        ...list,
      } as ListRecord,
    };
  }
  return { ...state, lists: stored };
}

function workerDocsFrom(state: MirrorState) {
  return {
    listDocs: Object.values(state.lists).map(({ data }) => ({
      id: data.id,
      data: { ...data, deleted: data.deleted ? 1 : 0 },
    })),
    noteDocs: Object.values(state.notes).map(({ data }) => ({
      id: data.suttaId,
      data: { text: data.text, updatedAt: data.mtime },
    })),
    highlightDocs: Object.values(state.highlights).flatMap(({ data }) =>
      data.color
        ? data.ranges.map((r) => ({
            id: `${data.g}:${r.i}`,
            data: { suttaId: data.suttaId, i: r.i, s: r.s, e: r.e, color: data.color, g: data.g, mtime: data.mtime, createdAt: data.mtime },
          }))
        : []
    ),
    visitedDocs: Object.values(state.visited).map(({ data }) => ({ id: data.suttaId, data: { visitedAt: data.visitedAt } })),
  };
}

describe('deriveUserData agrees with the worker’s assembleUserData', () => {
  const cases: Record<string, MirrorState> = {
    'a nested tree with membership': mirrorFrom([
      { id: 'g1', kind: 'group', label: 'Group' },
      { id: 'l1', parentId: 'g1', items: ['dn1', 'mn10'], position: -1 },
      { id: 'l2', items: ['dn1'] },
    ]),
    'a tombstoned group above a live list': mirrorFrom([
      { id: 'dead', kind: 'group', deleted: true },
      { id: 'inside', parentId: 'dead', items: ['dn1'] },
      { id: 'alive', items: ['dn2'] },
    ]),
    'a dangling parent': mirrorFrom([{ id: 'stray', parentId: 'gone', items: ['sn1.1'] }]),
  };

  for (const [name, state] of Object.entries(cases)) {
    it(`shapes ${name} the same way`, () => {
      const web = deriveUserData(state);
      const worker = assembleUserData(workerDocsFrom(state));
      expect(web.lists).toEqual(worker.lists);
      expect(web.membership).toEqual(worker.membership);
    });
  }

  it('synthesizes the same auto-lists from the same notes, highlights and visits', () => {
    let state = mirrorFrom([{ id: 'l1', items: ['dn1'] }]);
    state = {
      ...state,
      notes: {
        dn1: { dirty: false, data: { suttaId: 'dn1', text: 'older', mtime: '2025-01-01T00:00:00.000Z|d' } },
        mn1: { dirty: false, data: { suttaId: 'mn1', text: 'newer', mtime: '2025-01-02T00:00:00.000Z|d' } },
      },
      highlights: {
        g1: {
          dirty: false,
          data: { g: 'g1', suttaId: 'sn1.1', ranges: [{ i: 0, s: 0, e: 4 }], color: 'yellow', erase: [], mtime: '2025-01-03T00:00:00.000Z|d', sent: true },
        },
      },
      visited: {
        dn2: { dirty: false, data: { suttaId: 'dn2', visitedAt: '2025-01-04T00:00:00.000Z' } },
        dn1: { dirty: false, data: { suttaId: 'dn1', visitedAt: '2025-01-05T00:00:00.000Z' } },
      },
    } as MirrorState;

    const web = deriveUserData(state);
    const worker = assembleUserData(workerDocsFrom(state));

    expect(web.lists).toEqual(worker.lists);
    expect(web.membership).toEqual(worker.membership);
    expect(web.highlights).toEqual(worker.highlights);
    expect(web.visited).toEqual(worker.visited);
    // The one deliberate difference: the client keeps the text the UI renders, the wire adds the
    // mtime the client needs to order the Notes auto-list by.
    expect(web.notes).toEqual(Object.fromEntries(Object.entries(worker.notes).map(([id, n]: [string, any]) => [id, n.text])));
  });
});
