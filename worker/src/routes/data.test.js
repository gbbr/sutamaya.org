import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { PUSH_MAX_ITEMS } from './data.js';
import { createSessionCookie } from '../session.js';

// Same harness as lib/listWrites.test.js (real signed session cookie, no explicit cleanup).

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

// Seeds fixtures through the real write path, which is the one push endpoint. Returns the results
// array so a test can assert on how each item was answered.
async function push(cookie, items) {
  const res = await api('/api/data/push', { method: 'POST', cookie, body: { items } });
  return { status: res.status, body: await res.json() };
}

async function write(cookie, item) {
  return (await push(cookie, [item])).body.results[0];
}

describe('routes/data.js (D1)', () => {
  it('GET /api/data returns lists/membership/notes/highlights/visited for a fresh user', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/data', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });
  });

  it('synthesizes a non-persisted "Visited" auto-list from visited rows, most-recent first', async () => {
    const { cookie } = await signIn();
    await write(cookie, { type: 'visited', suttaId: 'sn1.1' });
    await new Promise((r) => setTimeout(r, 5));
    await write(cookie, { type: 'visited', suttaId: 'sn1.2' });

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
    await push(cookie, [
      { type: 'highlight', suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], ranges: [{ i: 0, s: 0, e: 5 }] },
      { type: 'note', suttaId: 'sn1.1', text: 'older note' },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    await push(cookie, [
      { type: 'highlight', suttaId: 'sn1.2', color: 'blue', g: 'group-b', erase: [], ranges: [{ i: 0, s: 0, e: 5 }] },
      { type: 'note', suttaId: 'sn1.2', text: 'newer note' },
    ]);

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.lists.find((l) => l.id === 'auto-highlights').items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.lists.find((l) => l.id === 'auto-notes').items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.membership['sn1.1']).toEqual(expect.arrayContaining(['auto-highlights', 'auto-notes']));
  });

  it('returns highlights keyed by suttaId in the client-side shape', async () => {
    const { cookie } = await signIn();
    await write(cookie, { type: 'highlight', suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], ranges: [{ i: 2, s: 5, e: 10 }] });

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.highlights['sn1.1']).toHaveLength(1);
    // `m` (the row's mtime) is part of that shape too — the reader needs it to decide which of two
    // overlapping groups paints the characters they contest.
    expect(body.highlights['sn1.1'][0]).toMatchObject({ i: 2, s: 5, e: 10, c: 'yellow', g: 'group-a' });
    expect(body.highlights['sn1.1'][0].m).toBeTruthy();
  });

  it('membership reflects a real list a sutta was added to', async () => {
    const { cookie } = await signIn();
    // A create and the membership op that names it, in one push — the ordinary shape of a flush,
    // and the reason items run in the order they arrive rather than as a batch.
    const { body: pushed } = await push(cookie, [
      { type: 'list.create', id: 'my-list', label: 'My list', parentId: null, kind: 'list' },
      { type: 'item.add', listId: 'my-list', suttaId: 'sn1.1' },
    ]);
    expect(pushed.results).toEqual([{ ok: true }, { ok: true }]);

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.membership['sn1.1']).toEqual(['my-list']);
    expect(body.lists.find((l) => l.id === 'my-list').items).toEqual(['sn1.1']);
  });

  // The client renders lists as a tree in stored sibling order, so the ORDER BY position in
  // buildUserData's query has to survive.
  it('returns lists in stored position order', async () => {
    const { cookie } = await signIn();
    await write(cookie, { type: 'list.create', id: 'first', label: 'First', parentId: null, kind: 'list' });
    await write(cookie, { type: 'list.create', id: 'second', label: 'Second', parentId: null, kind: 'list' });

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.lists.map((l) => l.id)).toEqual(['second', 'first']);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await api('/api/data');
    expect(res.status).toBe(401);
  });

  it('GET /api/data/export adds email/exportedAt and a download disposition', async () => {
    const { cookie } = await signIn('exporter@example.com');
    await write(cookie, { type: 'note', suttaId: 'sn1.1', text: 'keep me' });

    const res = await api('/api/data/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="sutamaya-export.json"');
    const body = await res.json();
    expect(body.email).toBe('exporter@example.com');
    expect(body.exportedAt).toBeTruthy();
    expect(body.notes['sn1.1'].text).toBe('keep me');
    expect(body.lists).toBeInstanceOf(Array);
  });

  it('rejects an unauthenticated export', async () => {
    const res = await api('/api/data/export');
    expect(res.status).toBe(401);
  });
});

// The envelope around lib/writes.js — what the endpoint itself promises, as opposed to what any
// individual write does. lib/{listWrites,annotationWrites}.test.js cover the writes themselves.
describe('POST /api/data/push', () => {
  it('rejects an unauthenticated push', async () => {
    const res = await api('/api/data/push', { method: 'POST', body: { items: [] } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_authenticated' });
  });

  it('answers one result per item, positionally', async () => {
    const { cookie } = await signIn();
    const { status, body } = await push(cookie, [
      { type: 'note', suttaId: 'sn1.1', text: 'first' },
      { type: 'note', suttaId: 'sn1.2', text: 'second' },
      { type: 'visited', suttaId: 'sn1.3' },
    ]);
    expect(status).toBe(200);
    expect(body.results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  });

  // Not atomic, like CouchDB's _bulk_docs: the point of per-item results is that one item the
  // server won't take can't hold up everything queued behind it.
  it('refuses one item without rolling back or blocking the rest', async () => {
    const { cookie } = await signIn();
    const { status, body } = await push(cookie, [
      { type: 'note', suttaId: 'sn1.1', text: 'before' },
      { type: 'list.delete', id: 'no-such-list' },
      { type: 'note', suttaId: 'sn1.2', text: 'after' },
    ]);

    expect(status).toBe(200);
    expect(body.results).toEqual([{ ok: true }, { error: 'not_found', status: 404 }, { ok: true }]);

    // Both notes are stored: the one before the refusal was not rolled back, the one after it ran.
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1'].text).toBe('before');
    expect(data.notes['sn1.2'].text).toBe('after');
  });

  // Ops are order-sensitive — this is why the items run one at a time rather than as a db.batch.
  it('applies items in the order they arrive', async () => {
    const { cookie } = await signIn();
    await push(cookie, [
      { type: 'list.create', id: 'l1', label: 'L', parentId: null, kind: 'list' },
      { type: 'item.add', listId: 'l1', suttaId: 'sn1.1' },
      { type: 'item.add', listId: 'l1', suttaId: 'sn1.2' },
      { type: 'item.remove', listId: 'l1', suttaId: 'sn1.1' },
    ]);

    // The remove followed the add, so the sutta is gone. Reversed, it would still be there.
    const row = await env.DB.prepare('SELECT items FROM lists WHERE id = ?').bind('l1').first();
    expect(JSON.parse(row.items)).toEqual(['sn1.2']);
  });

  it('names an item type it does not recognize rather than silently accepting it', async () => {
    const { cookie } = await signIn();
    expect(await write(cookie, { type: 'list.rename', id: 'l1' })).toEqual({ error: 'unknown_type', status: 400 });
  });

  it('rejects a push with no items array, and one over the size cap', async () => {
    const { cookie } = await signIn();
    const missing = await api('/api/data/push', { method: 'POST', cookie, body: {} });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'items_required' });

    // The client chunks at the same number; anything larger is a client bug, and the cap is what
    // keeps a long queue from becoming one request that runs past the Worker's subrequest budget.
    const tooMany = Array.from({ length: PUSH_MAX_ITEMS + 1 }, (_, i) => ({ type: 'visited', suttaId: `sn1.${i}` }));
    const { status, body } = await push(cookie, tooMany);
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'too_many_items' });
  });
});
