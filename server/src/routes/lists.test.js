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
});
