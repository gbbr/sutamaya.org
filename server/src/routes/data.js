import { Router } from 'express';
import { listsCol, notesCol, highlightsCol, visitedCol } from '../firestore.js';
import { requireAuth, findUserById } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { assembleUserData } from '../lib/userData.js';

export const dataRouter = Router();
dataRouter.use(requireAuth);

// Aggregates everything the client needs for one user into the same shape the reader's
// client-side state uses: lists, membership, notes, highlights, visited. The actual
// shaping/auto-list-synthesis logic lives in lib/userData.js's assembleUserData, pulled out so
// it's unit-testable without a live Firestore/emulator — this just fetches the four collections
// and hands their docs over in the shape that function expects.
async function buildUserData(userId) {
  const [listsSnap, notesSnap, highlightsSnap, visitedSnap] = await Promise.all([
    listsCol(userId).orderBy('position').get(),
    notesCol(userId).get(),
    highlightsCol(userId).get(),
    visitedCol(userId).get(),
  ]);
  return assembleUserData({
    listDocs: listsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    noteDocs: notesSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    highlightDocs: highlightsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    visitedDocs: visitedSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  });
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
