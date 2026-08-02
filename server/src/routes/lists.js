import { Router } from 'express';
import { listsCol, FieldValue } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const listsRouter = Router();
listsRouter.use(requireAuth);

function serializeList(doc) {
  const data = doc.data();
  return { id: doc.id, label: data.label, items: data.items || [] };
}

listsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const snap = await listsCol(req.user.id).orderBy('position').get();
    res.json({ lists: snap.docs.map(serializeList) });
  })
);

listsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const label = ((req.body && req.body.label) || '').trim();
    if (!label) return res.status(400).json({ error: 'List name is required.' });
    const last = await listsCol(req.user.id).orderBy('position', 'desc').limit(1).get();
    const position = last.empty ? 0 : (last.docs[0].data().position ?? 0) + 1;
    const ref = await listsCol(req.user.id).add({ label, position, items: [], createdAt: new Date().toISOString() });
    res.status(201).json({ list: { id: ref.id, label, items: [] } });
  })
);

listsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    const update = {};
    if (typeof req.body?.label === 'string' && req.body.label.trim()) update.label = req.body.label.trim();
    if (Number.isInteger(req.body?.position)) update.position = req.body.position;
    if (Object.keys(update).length) await ref.update(update);
    res.json({ ok: true });
  })
);

listsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    await ref.delete();
    res.json({ ok: true });
  })
);

listsRouter.post(
  '/:id/items',
  asyncHandler(async (req, res) => {
    const suttaId = req.body && req.body.suttaId;
    if (!suttaId) return res.status(400).json({ error: 'suttaId is required.' });
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    await ref.update({ items: FieldValue.arrayUnion(suttaId) });
    res.status(201).json({ ok: true });
  })
);

listsRouter.delete(
  '/:id/items/:suttaId',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    await ref.update({ items: FieldValue.arrayRemove(req.params.suttaId) });
    res.json({ ok: true });
  })
);

listsRouter.put(
  '/:id/items/order',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    await ref.update({ items: order });
    res.json({ ok: true });
  })
);
