import { Router } from 'express';
import { db, listsCol, FieldValue } from '../firestore.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { nextPosition } from '../lib/listPositions.js';
import { invalidParentReasonForDoc, wouldCreateCycle } from '../lib/listParent.js';
import { shapeList } from '../lib/listShape.js';

export const listsRouter = Router();
listsRouter.use(requireAuth);

function serializeList(doc) {
  return shapeList(doc.id, doc.data());
}

function parentIdFromBody(body) {
  return typeof body?.parentId === 'string' ? body.parentId : null;
}

function orderFromBody(body) {
  return Array.isArray(body?.order) ? body.order : [];
}

// Fetches the candidate parent and checks it via invalidParentReasonForDoc (see that function's
// own comment for the actual validity rule) — the top-level `null` case short-circuits before
// ever hitting Firestore. Used for creating a new list, which can never be its own ancestor, so
// no cycle check is needed here — see invalidReparentReason below for moving an *existing* list.
async function invalidParentReason(userId, parentId) {
  if (!parentId) return null;
  const doc = await listsCol(userId).doc(parentId).get();
  return invalidParentReasonForDoc(doc);
}

// Same parent-existence/kind check as invalidParentReason (delegated to it directly, so the two
// can't drift apart), plus a cycle check for each id in `movingIds` being reparented to
// `parentId` (see wouldCreateCycle's own comment) — used wherever an *existing* list's parentId
// is being changed, unlike a fresh create.
async function invalidReparentReason(userId, parentId, movingIds) {
  const kindError = await invalidParentReason(userId, parentId);
  if (kindError) return kindError;
  if (!parentId) return null;
  const snap = await listsCol(userId).get();
  const allLists = snap.docs.map((d) => ({ id: d.id, parentId: d.data().parentId ?? null }));
  for (const movingId of movingIds) {
    if (wouldCreateCycle(movingId, parentId, allLists)) return 'Cannot move a list into its own descendant.';
  }
  return null;
}

// Fetches a list doc, writing the 404/400 response itself and returning null when the doc
// doesn't exist or can't hold suttas (a group) — shared by the two "add/reorder this list's
// items" routes below, which both need the same existence+kind check before touching `items`.
async function requireSuttaListDoc(ref, res) {
  const doc = await ref.get();
  if (!doc.exists) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (doc.data().kind === 'group') {
    res.status(400).json({ error: 'A group cannot hold suttas.' });
    return null;
  }
  return doc;
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
    const parentId = parentIdFromBody(req.body);
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

// `update()` against a doc id that doesn't exist rejects with a NOT_FOUND (gRPC code 5) error —
// used below (and by the item-removal route further down) to fold the "does this list exist"
// check into the write itself instead of a separate `.get()` beforehand. Anything else just
// rethrows, so a real failure still surfaces as a 500 via asyncHandler rather than a false 404.
function isNotFound(err) {
  return err && err.code === 5;
}

listsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const update = {};
    if (typeof req.body?.label === 'string' && req.body.label.trim()) update.label = req.body.label.trim();
    if (Number.isInteger(req.body?.position)) update.position = req.body.position;
    // `parentId` is a legitimate value to explicitly set to null (move to top level), so check
    // for the key's presence rather than truthiness.
    if (req.body && 'parentId' in req.body) {
      const parentId = parentIdFromBody(req.body);
      const parentError = await invalidReparentReason(req.user.id, parentId, [req.params.id]);
      if (parentError) return res.status(400).json({ error: parentError });
      update.parentId = parentId;
    }
    if (Object.keys(update).length) {
      try {
        await ref.update(update);
      } catch (err) {
        if (isNotFound(err)) return res.status(404).json({ error: 'not_found' });
        throw err;
      }
    } else {
      // Nothing to write — fall back to a plain existence check so a PATCH with no recognized
      // fields still 404s for a bogus id instead of silently succeeding.
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'not_found' });
    }
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
    const parentId = parentIdFromBody(req.body);
    const order = orderFromBody(req.body);
    const parentError = await invalidReparentReason(req.user.id, parentId, order);
    if (parentError) return res.status(400).json({ error: parentError });
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
    // Runs as a transaction (not a plain batch) so the re-parent position computation below can't
    // race a concurrent create/reorder under the same new parent between the reads and the write
    // — a batch reads and writes as two separate steps, which left a window for that collision.
    const found = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return false;
      // Re-parent any sub-lists to this list's own parent (bubble them up a level) instead of
      // orphaning them (dangling parentId pointing at a deleted doc) or cascade-deleting them,
      // which would silently destroy list membership data the user didn't ask to remove.
      const parentId = doc.data().parentId ?? null;
      const [children, newSiblings] = await Promise.all([
        tx.get(listsCol(req.user.id).where('parentId', '==', req.params.id)),
        // Equality-only, no orderBy, so this doesn't need a composite index — max position is
        // just computed in memory below, same pattern as the highlight-overlap filter.
        tx.get(listsCol(req.user.id).where('parentId', '==', parentId)),
      ]);
      // Re-parented children keep arriving at their own old positions otherwise, which can
      // collide with the new parent's existing children (both starting at 0) and leave their
      // relative order undefined — append them after the new parent's current siblings instead.
      let position = nextPosition(newSiblings.docs.map((d) => d.data().position));
      children.docs.forEach((child) => tx.update(child.ref, { parentId, position: position++ }));
      tx.delete(ref);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  })
);

listsRouter.post(
  '/:id/items',
  asyncHandler(async (req, res) => {
    const suttaId = req.body && req.body.suttaId;
    if (!suttaId) return res.status(400).json({ error: 'suttaId is required.' });
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await requireSuttaListDoc(ref, res);
    if (!doc) return;
    await ref.update({ items: FieldValue.arrayUnion(suttaId) });
    res.status(201).json({ ok: true });
  })
);

listsRouter.delete(
  '/:id/items/:suttaId',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    try {
      await ref.update({ items: FieldValue.arrayRemove(req.params.suttaId) });
    } catch (err) {
      if (isNotFound(err)) return res.status(404).json({ error: 'not_found' });
      throw err;
    }
    res.json({ ok: true });
  })
);

listsRouter.put(
  '/:id/items/order',
  asyncHandler(async (req, res) => {
    const ref = listsCol(req.user.id).doc(req.params.id);
    const doc = await requireSuttaListDoc(ref, res);
    if (!doc) return;
    const order = orderFromBody(req.body);
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
