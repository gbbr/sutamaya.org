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

// Atomically replace any highlight overlapping any of the given [s,e) ranges (each in its own
// segment i) of suttaId with `color` (color === null just removes the overlap) — a single-range
// array covers the common single-segment selection, a multi-entry one covers a cross-segment
// selection (see useHighlightPopup), so one request always maps to one atomic write regardless
// of how many segments it spans. Mirrors the prototype's setRangeHl. Fetches by suttaId alone
// (single equality filter, no composite index needed) and filters/overlaps in memory — a sutta
// has at most a handful of highlights, so this is cheap either way. Runs as a transaction (not a
// plain batch) so two overlapping writes for the same sutta racing each other (e.g. two open
// tabs) can't both read the same pre-write snapshot and produce a lost update — Firestore retries
// the loser against the winner's fresh state.
annotationsRouter.put(
  '/highlights/ranges',
  asyncHandler(async (req, res) => {
    const { suttaId, ranges, color } = req.body || {};
    if (!suttaId || !Array.isArray(ranges) || !ranges.length) {
      return res.status(400).json({ error: 'suttaId and a non-empty ranges array are required.' });
    }
    for (const r of ranges) {
      if (!Number.isInteger(r.i) || !Number.isInteger(r.s) || !Number.isInteger(r.e)) {
        return res.status(400).json({ error: 'each range needs integer i, s, e.' });
      }
    }
    const col = highlightsCol(req.user.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(col.where('suttaId', '==', suttaId));
      const overlapping = snap.docs.filter((doc) => ranges.some((r) => rangesOverlap(doc.data(), r.i, r.s, r.e)));
      overlapping.forEach((doc) => tx.delete(doc.ref));
      if (color) {
        const createdAt = new Date().toISOString();
        ranges.forEach((r) => tx.set(col.doc(), { suttaId, i: r.i, s: r.s, e: r.e, color, createdAt }));
      }
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
