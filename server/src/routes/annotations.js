import { Router } from 'express';
import { db, notesCol, highlightsCol, visitedCol } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { rangesOverlap } from '../lib/highlightOverlap.js';

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
// Runs as a transaction (not a plain batch) so two overlapping writes for the same sutta
// racing each other (e.g. two open tabs) can't both read the same pre-write snapshot and
// produce a lost update — Firestore retries the loser against the winner's fresh state.
annotationsRouter.put(
  '/highlights/range',
  asyncHandler(async (req, res) => {
    const { suttaId, i, s, e, color } = req.body || {};
    if (!suttaId || !Number.isInteger(i) || !Number.isInteger(s) || !Number.isInteger(e)) {
      return res.status(400).json({ error: 'suttaId, i, s, e are required.' });
    }
    const col = highlightsCol(req.user.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(col.where('suttaId', '==', suttaId));
      const overlapping = snap.docs.filter((doc) => rangesOverlap(doc.data(), i, s, e));
      overlapping.forEach((doc) => tx.delete(doc.ref));
      if (color) tx.set(col.doc(), { suttaId, i, s, e, color, createdAt: new Date().toISOString() });
    });
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
