import { latestIds } from './autoListRecency.js';
import { shapeList } from './listShape.js';

// Fixed, non-persisted ids for the three auto-managed lists below — never written to the `lists`
// collection, so they can't drift from the highlights/notes/visited docs they're derived from
// (unlike a stored list, which needs its own explicit add/remove call kept in sync with every
// highlight or note change) and can't be renamed, deleted, or manually reordered.
// These string literals are duplicated in web/src/lib/autoLists.ts (no module shared between the
// two npm workspaces) — keep both in sync if either ever changes.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// Bounds how many rows ListPane has to render for an auto-list — it renders every item as a
// full DOM row, unvirtualized, so an unbounded list would get sluggish for a heavy user long
// before hitting any Firestore cost concern (the underlying highlights/notes/visited
// collections are fetched in full either way, for highlight-span/note-badge/visited-state
// rendering elsewhere in the app). "Recent" additionally uses this as its actual product
// definition ("last 20 visited"), not just a rendering safeguard — see RECENT_AUTO_LIST_CAP.
export const AUTO_LIST_CAP = 100;
export const RECENT_AUTO_LIST_CAP = 20;

// Pure assembly of buildUserData's (routes/data.js) response shape from already-fetched
// Firestore docs — pulled out so the shaping/auto-list-synthesis logic is unit-testable without
// a live Firestore/emulator. Each `*Docs` array is `{id, data}` pairs, `data` being each doc's
// own field object (i.e. `doc.data()`), matching how routes/data.js maps its query snapshots.
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
  const lists = listDocs.map(({ id, data }) => {
    const shaped = shapeList(id, data);
    shaped.items.forEach((suttaId) => {
      (membership[suttaId] = membership[suttaId] || []).push(id);
    });
    return shaped;
  });

  const notes = {};
  noteDocs.forEach(({ id, data }) => {
    notes[id] = data.text;
  });

  const highlights = {};
  highlightDocs.forEach(({ id, data }) => {
    (highlights[data.suttaId] = highlights[data.suttaId] || []).push({ id, i: data.i, s: data.s, e: data.e, c: data.color, g: data.g });
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
  // visited first, capped to the last 20.
  const recentIds = latestIds(
    visitedDocs.map(({ id, data }) => ({ id, at: data.visitedAt })),
    RECENT_AUTO_LIST_CAP
  );

  if (recentIds.length) {
    lists.push({ id: RECENT_AUTO_LIST_ID, label: 'Recent', parentId: null, kind: 'list', items: recentIds, auto: true });
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
