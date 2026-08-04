import { Router } from 'express';
import { db, listsCol, FieldValue } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const listsRouter = Router();
listsRouter.use(requireAuth);

function serializeList(doc) {
  const data = doc.data();
  return { id: doc.id, label: data.label, parentId: data.parentId ?? null, items: data.items || [] };
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
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
    const last = await listsCol(req.user.id).orderBy('position', 'desc').limit(1).get();
    const position = last.empty ? 0 : (last.docs[0].data().position ?? 0) + 1;
    const ref = await listsCol(req.user.id).add({ label, parentId, position, items: [], createdAt: new Date().toISOString() });
    res.status(201).json({ list: { id: ref.id, label, parentId, items: [] } });
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
    // `parentId` is a legitimate value to explicitly set to null (move to top level), so check
    // for the key's presence rather than truthiness.
    if (req.body && 'parentId' in req.body) {
      update.parentId = typeof req.body.parentId === 'string' ? req.body.parentId : null;
    }
    if (Object.keys(update).length) await ref.update(update);
    res.json({ ok: true });
  })
);

// Bulk-reorders one parent's direct children (parentId: null for top-level lists) —
// mirrors PUT /:id/items/order below, just for the lists themselves instead of one list's
// sutta items. `order` positions are only meaningful relative to siblings sharing the same
// parent (see buildUserData in routes/data.js, which the client filters by parentId), so this
// never needs to touch — or even know about — any other parent's lists.
listsRouter.put(
  '/order',
  asyncHandler(async (req, res) => {
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    const batch = db.batch();
    order.forEach((id, position) => batch.update(listsCol(req.user.id).doc(id), { position, parentId }));
    await batch.commit();
    res.json({ ok: true });
  })
);

listsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    // Re-parent any sub-lists to this list's own parent (bubble them up a level) instead of
    // orphaning them (dangling parentId pointing at a deleted doc) or cascade-deleting them,
    // which would silently destroy list membership data the user didn't ask to remove.
    const parentId = doc.data().parentId ?? null;
    const children = await listsCol(req.user.id).where('parentId', '==', req.params.id).get();
    const batch = db.batch();
    children.docs.forEach((child) => batch.update(child.ref, { parentId }));
    batch.delete(ref);
    await batch.commit();
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
