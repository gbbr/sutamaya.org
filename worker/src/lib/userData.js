import { latestIds } from './autoListRecency.js';
import { shapeList } from './listShape.js';
import { repairListTree } from './listTree.js';

// Fixed, non-persisted ids for the three auto-managed lists below — never written to the `lists`
// table, so they can't drift from the highlights/notes/visited rows they're derived from
// (unlike a stored list, which needs its own explicit add/remove call kept in sync with every
// highlight or note change) and can't be renamed, deleted, or manually reordered.
// These string literals are duplicated in web/src/lib/autoLists.ts (no module shared between the
// two npm workspaces) — keep both in sync if either ever changes.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// Bounds how many rows ListPane renders for an auto-list: it draws every item as a full DOM row,
// unvirtualized, so an unbounded list would get sluggish long before D1 read volume mattered — the
// highlights and notes tables are fetched in full either way, for rendering elsewhere. All three
// share one cap, so no auto-list quietly holds fewer than its neighbours.
export const AUTO_LIST_CAP = 100;

// Pure assembly of buildUserData's (routes/data.js) response shape from already-fetched D1 rows —
// pulled out so the shaping/auto-list-synthesis logic is unit-testable without a live database.
// Each `*Docs` array is `{id, data}` pairs, `data` being each row's own field object, matching
// how routes/data.js maps its query results.
//
// Tombstoned notes/highlights/visited rows are filtered out in SQL before they get here (see
// buildUserData). `listDocs` is the exception and arrives with its tombstones, because lib/listTree.js
// needs them to cascade a deleted group's descendants out — it does that filtering itself.
export function assembleUserData({ listDocs, noteDocs, highlightDocs, visitedDocs }) {
  // Keyed by list id, not label — two lists can share a label (e.g. same-named lists nested
  // under different parents), and an id is the only thing that identifies one unambiguously.
  const membership = {};
  // `parentId`/`items` (in stored order) let the client render lists as a tree (groups
  // nested under their parent) and show/reorder each list's own suttas in the order the user
  // put them in, instead of re-deriving both from the flatter `membership` map, which only
  // tells you *which* lists a sutta belongs to, not their relative order within one list.
  // `kind` distinguishes a plain list (holds suttas) from a ListGroup (holds only other
  // lists/groups, never items — see routes/lists.js's invalidParentReason).
  //
  // repairListTree (lib/listTree.js) decides which lists survive at all — dropping tombstones and
  // everything beneath them — as well as their order and, where a stored `parentId` dangles, the
  // parentId each is shaped with. `position`/`mtime`/`deleted` feed that repair and stop here.
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

  // `m` is the note's mtime, carried for the same reason a highlight row carries one: the client
  // derives its own Notes auto-list over the mirror (web/src/lib/mirrorView.ts) and needs a
  // timestamp to order it by, or every pulled note compares equal and the list falls back to
  // whatever order the SELECT returned.
  const notes = {};
  noteDocs.forEach(({ id, data }) => {
    notes[id] = { text: data.text, m: data.updatedAt || '' };
  });

  // `m` is the row's mtime, the tiebreak the reader paints overlapping groups by (see
  // web/src/lib/highlights.ts) — short-keyed like `c`/`g` since this map is sent in full.
  const highlights = {};
  highlightDocs.forEach(({ id, data }) => {
    (highlights[data.suttaId] = highlights[data.suttaId] || []).push({
      id,
      i: data.i,
      s: data.s,
      e: data.e,
      c: data.color,
      g: data.g,
      m: data.mtime ?? '',
    });
  });

  const visited = {};
  visitedDocs.forEach(({ id, data }) => {
    visited[id] = data.visitedAt;
  });

  // Every suttaId with at least one highlight, most-recently-highlighted first (there's no
  // stored order to preserve the way a real list has, so recency is the most useful default),
  // capped to AUTO_LIST_CAP.
  const highlightedIds = latestIds(
    highlightDocs.map(({ data }) => ({ id: data.suttaId, at: data.createdAt })),
    AUTO_LIST_CAP
  );

  // notesCol doc ids *are* sutta ids, and a note doc only exists while its text is non-empty
  // (see PUT /notes/:suttaId, which deletes on blank) — so "doc exists" already means "has a
  // note", no extra filtering needed.
  const notedIds = latestIds(
    noteDocs.map(({ id, data }) => ({ id, at: data.updatedAt || '' })),
    AUTO_LIST_CAP
  );

  // visitedCol doc ids *are* sutta ids too (see the `visited` schema note above), most-recently-
  // visited first.
  const recentIds = latestIds(
    visitedDocs.map(({ id, data }) => ({ id, at: data.visitedAt })),
    AUTO_LIST_CAP
  );

  if (recentIds.length) {
    lists.push({ id: RECENT_AUTO_LIST_ID, label: 'Visited', parentId: null, kind: 'list', items: recentIds, auto: true });
    recentIds.forEach((id) => (membership[id] = [...(membership[id] || []), RECENT_AUTO_LIST_ID]));
  }
  if (highlightedIds.length) {
    lists.push({ id: HIGHLIGHTS_AUTO_LIST_ID, label: 'Highlights', parentId: null, kind: 'list', items: highlightedIds, auto: true });
    highlightedIds.forEach((id) => (membership[id] = [...(membership[id] || []), HIGHLIGHTS_AUTO_LIST_ID]));
  }
  if (notedIds.length) {
    lists.push({ id: NOTES_AUTO_LIST_ID, label: 'Notes', parentId: null, kind: 'list', items: notedIds, auto: true });
    notedIds.forEach((id) => (membership[id] = [...(membership[id] || []), NOTES_AUTO_LIST_ID]));
  }

  return { lists, membership, notes, highlights, visited };
}
