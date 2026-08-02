import { Router } from 'express';
import { listsCol, notesCol, highlightsCol, visitedCol } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const dataRouter = Router();
dataRouter.use(requireAuth);

// Aggregates everything the client needs for one user into the same shape the reader's
// client-side state uses: lists, membership, notes, highlights, visited.
async function buildUserData(userId) {
  const [listsSnap, notesSnap, highlightsSnap, visitedSnap] = await Promise.all([
    listsCol(userId).orderBy('position').get(),
    notesCol(userId).get(),
    highlightsCol(userId).get(),
    visitedCol(userId).get(),
  ]);

  const membership = {};
  const lists = listsSnap.docs.map((doc) => {
    const data = doc.data();
    (data.items || []).forEach((suttaId) => {
      (membership[suttaId] = membership[suttaId] || []).push(data.label);
    });
    return { id: doc.id, label: data.label };
  });

  const notes = {};
  notesSnap.docs.forEach((doc) => {
    notes[doc.id] = doc.data().text;
  });

  const highlights = {};
  highlightsSnap.docs.forEach((doc) => {
    const h = doc.data();
    (highlights[h.suttaId] = highlights[h.suttaId] || []).push({ id: doc.id, i: h.i, s: h.s, e: h.e, c: h.color });
  });

  const visited = {};
  visitedSnap.docs.forEach((doc) => {
    visited[doc.id] = doc.data().visitedAt;
  });

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
