import { Router } from 'express';
import { listsCol, notesCol, highlightsCol, visitedCol } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const dataRouter = Router();
dataRouter.use(requireAuth);

// Fixed, non-persisted ids for the two auto-managed lists below — never written to the `lists`
// collection, so they can't drift from the highlights/notes they're derived from (unlike a
// stored list, which needs its own explicit add/remove call kept in sync with every highlight
// or note change) and can't be renamed, deleted, or manually reordered.
// These string literals are duplicated in web/src/lib/autoLists.ts (no module shared between
// the two npm workspaces) — keep both in sync if either ever changes.
const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
const NOTES_AUTO_LIST_ID = 'auto-notes';

// Aggregates everything the client needs for one user into the same shape the reader's
// client-side state uses: lists, membership, notes, highlights, visited.
async function buildUserData(userId) {
  const [listsSnap, notesSnap, highlightsSnap, visitedSnap] = await Promise.all([
    listsCol(userId).orderBy('position').get(),
    notesCol(userId).get(),
    highlightsCol(userId).get(),
    visitedCol(userId).get(),
  ]);

  // Keyed by list id, not label — two lists can share a label (e.g. same-named lists nested
  // under different parents), and an id is the only thing that identifies one unambiguously.
  const membership = {};
  const lists = listsSnap.docs.map((doc) => {
    const data = doc.data();
    const items = data.items || [];
    items.forEach((suttaId) => {
      (membership[suttaId] = membership[suttaId] || []).push(doc.id);
    });
    // `parentId`/`items` (in stored order) let the client render lists as a tree (groups
    // nested under their parent) and show/reorder each list's own suttas in the order the user
    // put them in, instead of re-deriving both from the flatter `membership` map, which only
    // tells you *which* lists a sutta belongs to, not their relative order within one list.
    // `kind` distinguishes a plain list (holds suttas) from a ListGroup (holds only other
    // lists/groups, never items — see routes/lists.js's invalidParentReason).
    return { id: doc.id, label: data.label, parentId: data.parentId ?? null, kind: data.kind === 'group' ? 'group' : 'list', items };
  });

  const notes = {};
  notesSnap.docs.forEach((doc) => {
    notes[doc.id] = doc.data().text;
  });

  const highlights = {};
  highlightsSnap.docs.forEach((doc) => {
    const h = doc.data();
    (highlights[h.suttaId] = highlights[h.suttaId] || []).push({ id: doc.id, i: h.i, s: h.s, e: h.e, c: h.color, g: h.g });
  });

  const visited = {};
  visitedSnap.docs.forEach((doc) => {
    visited[doc.id] = doc.data().visitedAt;
  });

  // Every suttaId with at least one highlight, most-recently-highlighted first (there's no
  // stored order to preserve the way a real list has, so recency is the most useful default).
  const highlightRecency = new Map();
  highlightsSnap.docs.forEach((doc) => {
    const h = doc.data();
    const prev = highlightRecency.get(h.suttaId);
    if (!prev || h.createdAt > prev) highlightRecency.set(h.suttaId, h.createdAt);
  });
  const highlightedIds = [...highlightRecency.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([id]) => id);

  // notesCol doc ids *are* sutta ids, and a note doc only exists while its text is non-empty
  // (see PUT /notes/:suttaId, which deletes on blank) — so "doc exists" already means "has a
  // note", no extra filtering needed.
  const notedIds = notesSnap.docs
    .map((doc) => ({ id: doc.id, updatedAt: doc.data().updatedAt || '' }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((x) => x.id);

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

dataRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await buildUserData(req.user.id));
  })
);

dataRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const payload = { email: req.user.email, exportedAt: new Date().toISOString(), ...(await buildUserData(req.user.id)) };
    res.setHeader('Content-Disposition', 'attachment; filename="sutamaya-export.json"');
    res.json(payload);
  })
);
