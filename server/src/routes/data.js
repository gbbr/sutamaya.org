import { Router } from 'express';
import { listsCol, notesCol, highlightsCol, visitedCol } from '../firestore.js';
import { requireAuth, findUserById } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { latestIds } from '../lib/autoListRecency.js';

export const dataRouter = Router();
dataRouter.use(requireAuth);

// Fixed, non-persisted ids for the two auto-managed lists below — never written to the `lists`
// collection, so they can't drift from the highlights/notes they're derived from (unlike a
// stored list, which needs its own explicit add/remove call kept in sync with every highlight
// or note change) and can't be renamed, deleted, or manually reordered.
// These string literals are duplicated in web/src/lib/autoLists.ts (no module shared between
// the two npm workspaces) — keep both in sync if either ever changes.
const RECENT_AUTO_LIST_ID = 'auto-recent';
const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
const NOTES_AUTO_LIST_ID = 'auto-notes';

// Bounds how many rows ListPane has to render for an auto-list — it renders every item as a
// full DOM row, unvirtualized, so an unbounded list would get sluggish for a heavy user long
// before hitting any Firestore cost concern (the underlying highlights/notes/visited
// collections are fetched in full either way, for highlight-span/note-badge/visited-state
// rendering elsewhere in the app). "Recent" additionally uses this as its actual product
// definition ("last 20 visited"), not just a rendering safeguard — see RECENT_AUTO_LIST_CAP.
const AUTO_LIST_CAP = 100;
const RECENT_AUTO_LIST_CAP = 20;

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
  // stored order to preserve the way a real list has, so recency is the most useful default),
  // capped to AUTO_LIST_CAP.
  const highlightedIds = latestIds(
    highlightsSnap.docs.map((doc) => ({ id: doc.data().suttaId, at: doc.data().createdAt })),
    AUTO_LIST_CAP
  );

  // notesCol doc ids *are* sutta ids, and a note doc only exists while its text is non-empty
  // (see PUT /notes/:suttaId, which deletes on blank) — so "doc exists" already means "has a
  // note", no extra filtering needed.
  const notedIds = latestIds(
    notesSnap.docs.map((doc) => ({ id: doc.id, at: doc.data().updatedAt || '' })),
    AUTO_LIST_CAP
  );

  // visitedCol doc ids *are* sutta ids too (see the `visited` schema note above), most-recently-
  // visited first, capped to the last 20.
  const recentIds = latestIds(
    visitedSnap.docs.map((doc) => ({ id: doc.id, at: doc.data().visitedAt })),
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

dataRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await buildUserData(req.user.id));
  })
);

dataRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    // requireAuth no longer fetches the full profile (see auth.js) — this is the one route under
    // it that actually needs the email, so it fetches its own.
    const user = await findUserById(req.user.id);
    const payload = { email: user?.email, exportedAt: new Date().toISOString(), ...(await buildUserData(req.user.id)) };
    res.setHeader('Content-Disposition', 'attachment; filename="sutamaya-export.json"');
    res.json(payload);
  })
);
