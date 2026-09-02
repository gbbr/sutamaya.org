import { latestIds } from './autoListRecency.js';
import { shapeList } from './listShape.js';
import { repairListTree } from './listTree.js';

// Ids of the three synthesized auto-lists, never written to the `lists` table. Duplicated in
// web/src/lib/autoLists.ts, no module being shared between the two workspaces.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// Most items the Highlights and Notes lists carry, each saying "Showing 300 of N" past it.
// Duplicated in web/src/lib/autoLists.ts — see the note on the ids above.
export const AUTO_LIST_CAP = 300;

// Most items the Visited list carries.
export const VISITED_AUTO_LIST_CAP = 100;

// Assembles buildUserData's (routes/data.js) response from already-fetched D1 rows, synthesizing
// the three auto-lists. Each `*Docs` array is `{id, data}` pairs, `data` being one row's fields.
//
// Tombstoned notes, highlights and visits are filtered out in SQL before they arrive; `listDocs`
// keeps its tombstones, which repairListTree needs to cascade a deleted group's descendants out.
export function assembleUserData({ listDocs, noteDocs, highlightDocs, visitedDocs }) {
  // Which lists hold each sutta, keyed by list id — two lists can share a label.
  const membership = {};
  // The lists, in tree order. repairListTree (lib/listTree.js) decides which survive, their order,
  // and the parentId each is shaped with where a stored one dangles; `position`, `mtime` and
  // `deleted` feed that repair and stop here.
  const dataById = new Map(listDocs.map(({ id, data }) => [id, data]));
  const ordered = repairListTree(
    listDocs.map(({ id, data }) => ({
      id,
      parentId: data.parentId ?? null,
      position: data.position ?? 0,
      mtime: data.mtime ?? '',
      deleted: data.deleted ?? 0,
    }))
  );
  const lists = ordered.map(({ id, parentId }) => {
    const shaped = shapeList(id, { ...dataById.get(id), parentId });
    shaped.items.forEach((suttaId) => {
      (membership[suttaId] = membership[suttaId] || []).push(id);
    });
    return shaped;
  });

  // Each note's text and `m`, its mtime, which the client's own Notes auto-list orders by.
  const notes = {};
  noteDocs.forEach(({ id, data }) => {
    notes[id] = { text: data.text, m: data.updatedAt || '' };
  });

  // The highlights on each sutta. `c` is the colour and `m` the mtime, the tiebreak the reader
  // paints overlapping highlights by; both are short-keyed, this map being sent in full.
  const highlights = {};
  highlightDocs.forEach(({ id, data }) => {
    (highlights[data.suttaId] = highlights[data.suttaId] || []).push({
      id,
      i0: data.i0,
      o0: data.o0,
      i1: data.i1,
      o1: data.o1,
      c: data.color,
      m: data.mtime ?? '',
    });
  });

  const visited = {};
  visitedDocs.forEach(({ id, data }) => {
    visited[id] = data.visitedAt;
  });

  // Every sutta with a highlight, most recent first — an auto-list has no stored order.
  const highlightedIds = latestIds(
    highlightDocs.map(({ data }) => ({ id: data.suttaId, at: data.createdAt })),
    AUTO_LIST_CAP
  );

  // Every sutta with a note, most recently written first. A note doc's id is its sutta id, and a
  // cleared note is tombstoned, so no further filtering is needed.
  const notedIds = latestIds(
    noteDocs.map(({ id, data }) => ({ id, at: data.updatedAt || '' })),
    AUTO_LIST_CAP
  );

  // Every sutta visited, most recent first.
  const recentIds = latestIds(
    visitedDocs.map(({ id, data }) => ({ id, at: data.visitedAt })),
    VISITED_AUTO_LIST_CAP
  );

  // How many suttas carry a highlight, counted distinct — a sutta may hold several, and each
  // list's `total` is the uncapped figure the count badge shows.
  const highlightedTotal = new Set(highlightDocs.map(({ data }) => data.suttaId)).size;

  if (recentIds.length) {
    lists.push({ id: RECENT_AUTO_LIST_ID, label: 'Visited', parentId: null, kind: 'list', items: recentIds, auto: true, total: visitedDocs.length });
    recentIds.forEach((id) => (membership[id] = [...(membership[id] || []), RECENT_AUTO_LIST_ID]));
  }
  if (highlightedIds.length) {
    lists.push({ id: HIGHLIGHTS_AUTO_LIST_ID, label: 'Highlights', parentId: null, kind: 'list', items: highlightedIds, auto: true, total: highlightedTotal });
    highlightedIds.forEach((id) => (membership[id] = [...(membership[id] || []), HIGHLIGHTS_AUTO_LIST_ID]));
  }
  if (notedIds.length) {
    lists.push({ id: NOTES_AUTO_LIST_ID, label: 'Notes', parentId: null, kind: 'list', items: notedIds, auto: true, total: noteDocs.length });
    notedIds.forEach((id) => (membership[id] = [...(membership[id] || []), NOTES_AUTO_LIST_ID]));
  }

  return { lists, membership, notes, highlights, visited };
}
