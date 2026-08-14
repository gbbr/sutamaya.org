import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, cleanupUser, testUserId } from '../testUtils/testApp.js';
import { listsCol } from '../firestore.js';

const app = buildTestApp();

describe('routes/lists.js (Firestore emulator)', () => {
  let userId;

  afterEach(async () => {
    if (userId) await cleanupUser(userId);
  });

  it('creates a top-level list', async () => {
    userId = testUserId();
    const res = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'My favorites' });
    expect(res.status).toBe(201);
    expect(res.body.list).toMatchObject({ label: 'My favorites', parentId: null, kind: 'list', items: [] });
  });

  it('rejects a list whose parent is another plain list (not a group)', async () => {
    userId = testUserId();
    const plain = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Plain' });
    const res = await request(app)
      .post('/api/lists')
      .set('x-test-user', userId)
      .send({ label: 'Child', parentId: plain.body.list.id });
    expect(res.status).toBe(400);
  });

  it('nests a list under a group', async () => {
    userId = testUserId();
    const group = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Group', kind: 'group' });
    const res = await request(app)
      .post('/api/lists')
      .set('x-test-user', userId)
      .send({ label: 'Child', parentId: group.body.list.id });
    expect(res.status).toBe(201);
    expect(res.body.list.parentId).toBe(group.body.list.id);
  });

  // New lists/groups are meant to appear at the front of their parent's children, not the back —
  // per product decision on the "+" button next to My Lists.
  it('puts a newly-created list first among its top-level siblings', async () => {
    userId = testUserId();
    const first = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'First' });
    const second = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Second' });
    const snap = await listsCol(userId).orderBy('position').get();
    expect(snap.docs.map((d) => d.id)).toEqual([second.body.list.id, first.body.list.id]);
  });

  it('puts a newly-created list first among its siblings under the same group', async () => {
    userId = testUserId();
    const group = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Group', kind: 'group' });
    const parentId = group.body.list.id;
    const first = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'First', parentId });
    const second = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Second', parentId });
    const snap = await listsCol(userId).where('parentId', '==', parentId).orderBy('position').get();
    expect(snap.docs.map((d) => d.id)).toEqual([second.body.list.id, first.body.list.id]);
  });

  // isNotFound() (lists.js) keys off Firestore's raw gRPC NOT_FOUND code (5) to fold "does this
  // doc exist" into the write itself rather than a separate .get() first — this pins that
  // assumption against the real emulator (not a synthetic error), so a future
  // @google-cloud/firestore upgrade that changes the error shape fails this test instead of
  // silently misclassifying a real failure as a 404.
  it('PATCH on a nonexistent list 404s via isNotFound()', async () => {
    userId = testUserId();
    const res = await request(app).patch('/api/lists/does-not-exist').set('x-test-user', userId).send({ label: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('DELETE item from a nonexistent list 404s via isNotFound()', async () => {
    userId = testUserId();
    const res = await request(app).delete('/api/lists/does-not-exist/items/sn1.1').set('x-test-user', userId);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('PATCH on a real list with no recognized fields still 404s for a bogus id', async () => {
    userId = testUserId();
    const res = await request(app).patch('/api/lists/does-not-exist').set('x-test-user', userId).send({});
    expect(res.status).toBe(404);
  });

  it('deleting a list re-parents its children to its own parent, not orphaned', async () => {
    userId = testUserId();
    const group = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Group', kind: 'group' });
    const child = await request(app)
      .post('/api/lists')
      .set('x-test-user', userId)
      .send({ label: 'Child', parentId: group.body.list.id });

    const del = await request(app).delete(`/api/lists/${group.body.list.id}`).set('x-test-user', userId);
    expect(del.status).toBe(200);

    const listSnap = await listsCol(userId).doc(child.body.list.id).get();
    expect(listSnap.data().parentId).toBeNull();
  });

  it('deleting a nonexistent list 404s', async () => {
    userId = testUserId();
    const res = await request(app).delete('/api/lists/does-not-exist').set('x-test-user', userId);
    expect(res.status).toBe(404);
  });

  it('adds and removes a sutta from a list', async () => {
    userId = testUserId();
    const list = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'L' });
    const add = await request(app)
      .post(`/api/lists/${list.body.list.id}/items`)
      .set('x-test-user', userId)
      .send({ suttaId: 'sn1.1' });
    expect(add.status).toBe(201);

    const snap = await listsCol(userId).doc(list.body.list.id).get();
    expect(snap.data().items).toEqual(['sn1.1']);

    const remove = await request(app).delete(`/api/lists/${list.body.list.id}/items/sn1.1`).set('x-test-user', userId);
    expect(remove.status).toBe(200);
    const snap2 = await listsCol(userId).doc(list.body.list.id).get();
    expect(snap2.data().items).toEqual([]);
  });

  it('rejects adding a sutta to a group', async () => {
    userId = testUserId();
    const group = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Group', kind: 'group' });
    const res = await request(app)
      .post(`/api/lists/${group.body.list.id}/items`)
      .set('x-test-user', userId)
      .send({ suttaId: 'sn1.1' });
    expect(res.status).toBe(400);
  });

  it('rejects reparenting a list into its own descendant (cycle check)', async () => {
    userId = testUserId();
    const grandparent = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'A', kind: 'group' });
    const parent = await request(app)
      .post('/api/lists')
      .set('x-test-user', userId)
      .send({ label: 'B', kind: 'group', parentId: grandparent.body.list.id });

    const res = await request(app)
      .patch(`/api/lists/${grandparent.body.list.id}`)
      .set('x-test-user', userId)
      .send({ parentId: parent.body.list.id });
    expect(res.status).toBe(400);
  });

  it('PUT /:id/items/order reorders a list\'s own items', async () => {
    userId = testUserId();
    const list = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'L' });
    for (const suttaId of ['sn1.1', 'sn1.2', 'sn1.3']) {
      await request(app).post(`/api/lists/${list.body.list.id}/items`).set('x-test-user', userId).send({ suttaId });
    }

    const res = await request(app)
      .put(`/api/lists/${list.body.list.id}/items/order`)
      .set('x-test-user', userId)
      .send({ order: ['sn1.3', 'sn1.1', 'sn1.2'] });
    expect(res.status).toBe(200);

    const snap = await listsCol(userId).doc(list.body.list.id).get();
    expect(snap.data().items).toEqual(['sn1.3', 'sn1.1', 'sn1.2']);
  });

  it('PUT /:id/items/order appends an item present in stored items but missing from the posted order', async () => {
    userId = testUserId();
    const list = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'L' });
    await request(app).post(`/api/lists/${list.body.list.id}/items`).set('x-test-user', userId).send({ suttaId: 'sn1.1' });
    await request(app).post(`/api/lists/${list.body.list.id}/items`).set('x-test-user', userId).send({ suttaId: 'sn1.2' });

    // Simulates another tab adding sn1.2 after this client already snapshotted an order of just ['sn1.1'].
    const res = await request(app)
      .put(`/api/lists/${list.body.list.id}/items/order`)
      .set('x-test-user', userId)
      .send({ order: ['sn1.1'] });
    expect(res.status).toBe(200);

    const snap = await listsCol(userId).doc(list.body.list.id).get();
    expect(snap.data().items).toEqual(['sn1.1', 'sn1.2']);
  });

  it('PUT /:id/items/order 404s for a nonexistent list and 400s for a group', async () => {
    userId = testUserId();
    const missing = await request(app).put('/api/lists/does-not-exist/items/order').set('x-test-user', userId).send({ order: [] });
    expect(missing.status).toBe(404);

    const group = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'Group', kind: 'group' });
    const onGroup = await request(app)
      .put(`/api/lists/${group.body.list.id}/items/order`)
      .set('x-test-user', userId)
      .send({ order: [] });
    expect(onGroup.status).toBe(400);
  });

  it('PUT /order bulk-reorders sibling lists', async () => {
    userId = testUserId();
    const a = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'A' });
    const b = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'B' });
    const c = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'C' });

    const res = await request(app)
      .put('/api/lists/order')
      .set('x-test-user', userId)
      .send({ parentId: null, order: [c.body.list.id, a.body.list.id, b.body.list.id] });
    expect(res.status).toBe(200);

    const positions = await Promise.all(
      [c, a, b].map(async (created, expectedPosition) => {
        const doc = await listsCol(userId).doc(created.body.list.id).get();
        return doc.data().position === expectedPosition;
      })
    );
    expect(positions).toEqual([true, true, true]);
  });

  it('PUT /order rejects reparenting into a cycle the same way PATCH does', async () => {
    userId = testUserId();
    const grandparent = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'A', kind: 'group' });
    const parent = await request(app)
      .post('/api/lists')
      .set('x-test-user', userId)
      .send({ label: 'B', kind: 'group', parentId: grandparent.body.list.id });

    const res = await request(app)
      .put('/api/lists/order')
      .set('x-test-user', userId)
      .send({ parentId: parent.body.list.id, order: [grandparent.body.list.id] });
    expect(res.status).toBe(400);
  });
});
