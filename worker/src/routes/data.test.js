import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// Ported from server/src/routes/data.test.js — same harness differences as routes/lists.test.js
// (real signed session cookie, no explicit cleanup).

async function signIn(email) {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, email || `${userId}@example.com`, `google-${userId}`, new Date().toISOString())
    .run();
  const setCookie = await createSessionCookie(userId, env.SESSION_SECRET);
  return { userId, cookie: setCookie.split(';')[0] };
}

function api(path, { method = 'GET', body, cookie } = {}) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env
  );
}

describe('routes/data.js (D1)', () => {
  it('GET /api/data returns lists/membership/notes/highlights/visited for a fresh user', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/data', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });
  });

  it('synthesizes a non-persisted "Recent" auto-list from visited rows, most-recent first', async () => {
    const { cookie } = await signIn();
    await api('/api/visited/sn1.1', { method: 'POST', cookie });
    await new Promise((r) => setTimeout(r, 5));
    await api('/api/visited/sn1.2', { method: 'POST', cookie });

    const body = await (await api('/api/data', { cookie })).json();
    const recent = body.lists.find((l) => l.id === 'auto-recent');
    expect(recent).toBeTruthy();
    expect(recent.items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.membership['sn1.1']).toContain('auto-recent');
  });

  // The Highlights/Notes auto-lists come from the same synthesis, and depend on buildUserData
  // adapting the highlight rows' createdAt / note rows' updatedAt back out of snake_case columns —
  // which is exactly what latestIds() sorts by.
  it('synthesizes "Highlights" and "Notes" auto-lists, most-recent first', async () => {
    const { cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 5 }] },
    });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'older note' } });
    await new Promise((r) => setTimeout(r, 5));
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.2', color: 'blue', ranges: [{ i: 0, s: 0, e: 5 }] },
    });
    await api('/api/notes/sn1.2', { method: 'PUT', cookie, body: { text: 'newer note' } });

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.lists.find((l) => l.id === 'auto-highlights').items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.lists.find((l) => l.id === 'auto-notes').items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.membership['sn1.1']).toEqual(expect.arrayContaining(['auto-highlights', 'auto-notes']));
  });

  it('returns highlights keyed by suttaId in the client-side shape', async () => {
    const { cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 2, s: 5, e: 10 }] },
    });

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.highlights['sn1.1']).toHaveLength(1);
    expect(body.highlights['sn1.1'][0]).toMatchObject({ i: 2, s: 5, e: 10, c: 'yellow' });
    expect(body.highlights['sn1.1'][0].g).toBeTruthy();
  });

  it('membership reflects a real list a sutta was added to', async () => {
    const { cookie } = await signIn();
    const list = (await (await api('/api/lists', { method: 'POST', cookie, body: { label: 'My list' } })).json()).list;
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.membership['sn1.1']).toEqual([list.id]);
    expect(body.lists.find((l) => l.id === list.id).items).toEqual(['sn1.1']);
  });

  // The client renders lists as a tree in stored sibling order, so the ORDER BY position that
  // replaces Firestore's .orderBy('position') has to survive.
  it('returns lists in stored position order', async () => {
    const { cookie } = await signIn();
    const first = (await (await api('/api/lists', { method: 'POST', cookie, body: { label: 'First' } })).json()).list;
    const second = (await (await api('/api/lists', { method: 'POST', cookie, body: { label: 'Second' } })).json()).list;

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.lists.map((l) => l.id)).toEqual([second.id, first.id]);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await api('/api/data');
    expect(res.status).toBe(401);
  });

  it('GET /api/data/export adds email/exportedAt and a download disposition', async () => {
    const { cookie } = await signIn('exporter@example.com');
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'keep me' } });

    const res = await api('/api/data/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="sutamaya-export.json"');
    const body = await res.json();
    expect(body.email).toBe('exporter@example.com');
    expect(body.exportedAt).toBeTruthy();
    expect(body.notes['sn1.1']).toBe('keep me');
    expect(body.lists).toBeInstanceOf(Array);
  });

  it('rejects an unauthenticated export', async () => {
    const res = await api('/api/data/export');
    expect(res.status).toBe(401);
  });
});
