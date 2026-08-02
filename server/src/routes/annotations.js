import { Router } from 'express';
import { db, notesCol, highlightsCol, visitedCol } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const annotationsRouter = Router();
annotationsRouter.use(requireAuth);

annotationsRouter.put(
  '/notes/:suttaId',
  asyncHandler(async (req, res) => {
    const text = (req.body && req.body.text) || '';
    const ref = notesCol(req.user.id).doc(req.params.suttaId);
    if (text.trim() === '') await ref.delete();
    else await ref.set({ text, updatedAt: new Date().toISOString() });
    res.json({ ok: true });
  })
);

// Atomically replace any highlight overlapping [s,e) in segment i of suttaId with `color`
// (color === null just removes the overlap). Mirrors the prototype's setRangeHl. Fetches by
// suttaId alone (single equality filter, no composite index needed) and filters/overlaps
// in memory — a sutta has at most a handful of highlights, so this is cheap either way.
annotationsRouter.put(
  '/highlights/range',
  asyncHandler(async (req, res) => {
    const { suttaId, i, s, e, color } = req.body || {};
    if (!suttaId || !Number.isInteger(i) || !Number.isInteger(s) || !Number.isInteger(e)) {
      return res.status(400).json({ error: 'suttaId, i, s, e are required.' });
    }
    const col = highlightsCol(req.user.id);
    const snap = await col.where('suttaId', '==', suttaId).get();
    const overlapping = snap.docs.filter((doc) => {
      const h = doc.data();
      return h.i === i && h.s < e && h.e > s;
    });
    const batch = db.batch();
    overlapping.forEach((doc) => batch.delete(doc.ref));
    if (color) batch.set(col.doc(), { suttaId, i, s, e, color, createdAt: new Date().toISOString() });
    await batch.commit();
    res.json({ ok: true });
  })
);

annotationsRouter.delete(
  '/highlights/:id',
  asyncHandler(async (req, res) => {
    await highlightsCol(req.user.id).doc(req.params.id).delete();
    res.json({ ok: true });
  })
);

annotationsRouter.post(
  '/visited/:suttaId',
  asyncHandler(async (req, res) => {
    await visitedCol(req.user.id).doc(req.params.suttaId).set({ visitedAt: new Date().toISOString() });
    res.json({ ok: true });
  })
);
