import { Router } from 'express';
import { db, listsCol, FieldValue } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { nextPosition } from '../lib/listPositions.js';

export const listsRouter = Router();
listsRouter.use(requireAuth);

function serializeList(doc) {
  const data = doc.data();
  return { id: doc.id, label: data.label, parentId: data.parentId ?? null, kind: data.kind === 'group' ? 'group' : 'list', items: data.items || [] };
}

// A ListGroup can hold other lists/groups; a plain list can't hold anything — so any non-null
// parentId, for either kind of doc, must point at an existing group. Returns an error message
// string if invalid, or null if the parent checks out (including the top-level `null` case).
async function invalidParentReason(userId, parentId) {
  if (!parentId) return null;
  const doc = await listsCol(userId).doc(parentId).get();
  if (!doc.exists) return 'Parent not found.';
  if (doc.data().kind !== 'group') return 'Only a group can contain other lists.';
  return null;
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
    const kind = req.body?.kind === 'group' ? 'group' : 'list';
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
    const parentError = await invalidParentReason(req.user.id, parentId);
    if (parentError) return res.status(400).json({ error: parentError });
    const col = listsCol(req.user.id);
    const ref = col.doc();
    // Reading the current max position and writing the new doc in one transaction (instead of
    // two separate calls) keeps two near-simultaneous creates from both computing the same
    // `max + 1` and landing on colliding positions — Firestore retries the loser once the
    // winner's write is visible.
    await db.runTransaction(async (tx) => {
      const last = await tx.get(col.orderBy('position', 'desc').limit(1));
      const position = nextPosition(last.docs.map((d) => d.data().position));
      tx.set(ref, { label, parentId, kind, position, items: [], createdAt: new Date().toISOString() });
    });
    res.status(201).json({ list: { id: ref.id, label, parentId, kind, items: [] } });
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
      const parentId = typeof req.body.parentId === 'string' ? req.body.parentId : null;
      const parentError = await invalidParentReason(req.user.id, parentId);
      if (parentError) return res.status(400).json({ error: parentError });
      update.parentId = parentId;
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
    const parentError = await invalidParentReason(req.user.id, parentId);
    if (parentError) return res.status(400).json({ error: parentError });
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
    const [children, newSiblings] = await Promise.all([
      listsCol(req.user.id).where('parentId', '==', req.params.id).get(),
      // Equality-only, no orderBy, so this doesn't need a composite index — max position is
      // just computed in memory below, same pattern as the highlight-overlap filter.
      listsCol(req.user.id).where('parentId', '==', parentId).get(),
    ]);
    // Re-parented children keep arriving at their own old positions otherwise, which can
    // collide with the new parent's existing children (both starting at 0) and leave their
    // relative order undefined — append them after the new parent's current siblings instead.
    let position = nextPosition(newSiblings.docs.map((d) => d.data().position));
    const batch = db.batch();
    children.docs.forEach((child) => batch.update(child.ref, { parentId, position: position++ }));
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
    if (doc.data().kind === 'group') return res.status(400).json({ error: 'A group cannot hold suttas.' });
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
    if (doc.data().kind === 'group') return res.status(400).json({ error: 'A group cannot hold suttas.' });
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    // Reconcile against the current stored items instead of blind-replacing: if a sutta was
    // added (arrayUnion, e.g. from another tab) after the client snapshotted `order`, it won't
    // be in `order` — append it rather than silently dropping it. Anything removed the same way
    // is dropped from `order` rather than resurrected.
    const current = doc.data().items || [];
    const currentSet = new Set(current);
    const reconciled = order.filter((id) => currentSet.has(id));
    const reconciledSet = new Set(reconciled);
    current.forEach((id) => {
      if (!reconciledSet.has(id)) reconciled.push(id);
    });
    await ref.update({ items: reconciled });
    res.json({ ok: true });
  })
);
