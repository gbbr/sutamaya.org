import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, cleanupUser, testUserId } from '../testUtils/testApp.js';
import { highlightsCol } from '../firestore.js';

const app = buildTestApp();

describe('routes/annotations.js (Firestore emulator)', () => {
  let userId;

  afterEach(async () => {
    if (userId) await cleanupUser(userId);
  });

  it('sets and clears a note (blank text deletes the doc)', async () => {
    userId = testUserId();
    const set = await request(app).put('/api/notes/sn1.1').set('x-test-user', userId).send({ text: 'hello' });
    expect(set.status).toBe(200);

    const data = await request(app).get('/api/data').set('x-test-user', userId);
    expect(data.body.notes['sn1.1']).toBe('hello');

    const clear = await request(app).put('/api/notes/sn1.1').set('x-test-user', userId).send({ text: '' });
    expect(clear.status).toBe(200);
    const data2 = await request(app).get('/api/data').set('x-test-user', userId);
    expect(data2.body.notes['sn1.1']).toBeUndefined();
  });

  it('writes a single-segment highlight range', async () => {
    userId = testUserId();
    const res = await request(app)
      .put('/api/highlights/ranges')
      .set('x-test-user', userId)
      .send({ suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5, e: 10 }] });
    expect(res.status).toBe(200);

    const snap = await highlightsCol(userId).where('suttaId', '==', 'sn1.1').get();
    expect(snap.docs).toHaveLength(1);
    expect(snap.docs[0].data()).toMatchObject({ suttaId: 'sn1.1', i: 0, s: 5, e: 10, color: 'yellow' });
  });

  it('writes a cross-segment highlight with all docs sharing one groupId', async () => {
    userId = testUserId();
    await request(app)
      .put('/api/highlights/ranges')
      .set('x-test-user', userId)
      .send({
        suttaId: 'sn1.1',
        color: 'blue',
        ranges: [
          { i: 0, s: 5, e: 10 },
          { i: 1, s: 0, e: 3 },
        ],
      });

    const snap = await highlightsCol(userId).where('suttaId', '==', 'sn1.1').get();
    expect(snap.docs).toHaveLength(2);
    const groupIds = new Set(snap.docs.map((d) => d.data().g));
    expect(groupIds.size).toBe(1);
  });

  it('replaces an overlapping highlight atomically instead of leaving both', async () => {
    userId = testUserId();
    await request(app)
      .put('/api/highlights/ranges')
      .set('x-test-user', userId)
      .send({ suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }] });

    // Overlaps [0,10) with [5,15) — should replace the old highlight, not add a second one.
    await request(app)
      .put('/api/highlights/ranges')
      .set('x-test-user', userId)
      .send({ suttaId: 'sn1.1', color: 'green', ranges: [{ i: 0, s: 5, e: 15 }] });

    const snap = await highlightsCol(userId).where('suttaId', '==', 'sn1.1').get();
    expect(snap.docs).toHaveLength(1);
    expect(snap.docs[0].data()).toMatchObject({ s: 5, e: 15, color: 'green' });
  });

  it('rejects a range missing integer i/s/e', async () => {
    userId = testUserId();
    const res = await request(app)
      .put('/api/highlights/ranges')
      .set('x-test-user', userId)
      .send({ suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5 }] });
    expect(res.status).toBe(400);
  });

  it('records a visited sutta', async () => {
    userId = testUserId();
    const res = await request(app).post('/api/visited/sn1.1').set('x-test-user', userId);
    expect(res.status).toBe(200);
    const data = await request(app).get('/api/data').set('x-test-user', userId);
    expect(data.body.visited['sn1.1']).toBeTruthy();
  });
});
