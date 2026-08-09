import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, cleanupUser, testUserId } from '../testUtils/testApp.js';

const app = buildTestApp();

describe('routes/data.js (Firestore emulator)', () => {
  let userId;

  afterEach(async () => {
    if (userId) await cleanupUser(userId);
  });

  it('GET /api/data returns lists/membership/notes/highlights/visited for a fresh user', async () => {
    userId = testUserId();
    const res = await request(app).get('/api/data').set('x-test-user', userId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });
  });

  it('synthesizes a non-persisted "Recent" auto-list from visited docs, most-recent first', async () => {
    userId = testUserId();
    await request(app).post('/api/visited/sn1.1').set('x-test-user', userId);
    await new Promise((r) => setTimeout(r, 5));
    await request(app).post('/api/visited/sn1.2').set('x-test-user', userId);

    const res = await request(app).get('/api/data').set('x-test-user', userId);
    const recent = res.body.lists.find((l) => l.id === 'auto-recent');
    expect(recent).toBeTruthy();
    expect(recent.items).toEqual(['sn1.2', 'sn1.1']);
    expect(res.body.membership['sn1.1']).toContain('auto-recent');
  });

  it('membership reflects a real list a sutta was added to', async () => {
    userId = testUserId();
    const list = await request(app).post('/api/lists').set('x-test-user', userId).send({ label: 'My list' });
    await request(app).post(`/api/lists/${list.body.list.id}/items`).set('x-test-user', userId).send({ suttaId: 'sn1.1' });

    const res = await request(app).get('/api/data').set('x-test-user', userId);
    expect(res.body.membership['sn1.1']).toEqual([list.body.list.id]);
    expect(res.body.lists.find((l) => l.id === list.body.list.id).items).toEqual(['sn1.1']);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(401);
  });
});
