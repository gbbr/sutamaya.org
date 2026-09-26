import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../../index.js';
import { PUSH_MAX_ITEMS } from '../data.js';
import { createSessionCookie } from '../../session.js';

// Same harness as lib/__tests__/listWrites.test.js (real signed session cookie, no explicit
// cleanup).

async function signIn(email) {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, email || `${userId}@example.com`, `google-${userId}`, new Date().toISOString())
    .run();
  const setCookie = await createSessionCookie(userId, env.SESSION_SECRET);
  return { userId, cookie: setCookie.split(';')[0] };
}

function api(path, { method = 'GET', body, cookie, headers } = {}) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
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
      { type: 'highlight', suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], span: { k0: 'sn1.1:1.1', o0: 0, k1: 'sn1.1:1.1', o1: 5 } },
      { type: 'note', suttaId: 'sn1.1', text: 'older note' },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    await push(cookie, [
      { type: 'highlight', suttaId: 'sn1.2', color: 'blue', g: 'group-b', erase: [], span: { k0: 'sn1.1:1.1', o0: 0, k1: 'sn1.1:1.1', o1: 5 } },
      { type: 'note', suttaId: 'sn1.2', text: 'newer note' },
    ]);

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.lists.find((l) => l.id === 'auto-highlights').items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.lists.find((l) => l.id === 'auto-notes').items).toEqual(['sn1.2', 'sn1.1']);
    expect(body.membership['sn1.1']).toEqual(expect.arrayContaining(['auto-highlights', 'auto-notes']));
  });

  it('returns highlights keyed by suttaId in the client-side shape', async () => {
    const { cookie } = await signIn();
    await write(cookie, { type: 'highlight', suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], span: { k0: 'sn1.1:1.3', o0: 5, k1: 'sn1.1:1.4', o1: 10 } });

    const body = await (await api('/api/data', { cookie })).json();
    expect(body.highlights['sn1.1']).toHaveLength(1);
    // `m` (the row's mtime) is part of that shape too — the reader needs it to decide which of two
    // overlapping groups paints the characters they contest.
    expect(body.highlights['sn1.1'][0]).toMatchObject({ id: 'group-a', k0: 'sn1.1:1.3', o0: 5, k1: 'sn1.1:1.4', o1: 10, c: 'yellow' });
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

// The tag GET /api/data serves its snapshot under, and the 304 a device already holding that
// snapshot is answered with (docs/offline-sync.md's "The flush").
describe('GET /api/data, tagged', () => {
  const tagOf = async (cookie, headers) => (await api('/api/data', { cookie, headers })).headers.get('ETag');

  // Wraps env.DB so every statement prepared through it is recorded.
  function recordingDb() {
    const prepared = [];
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql) => {
            prepared.push(sql);
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { db, prepared };
  }

  it('answers 304 to the tag it served, weakened or not, reading nothing past the account', async () => {
    const { cookie } = await signIn();
    await write(cookie, { type: 'note', suttaId: 'sn1.1', text: 'kept' });
    const tag = await tagOf(cookie);
    expect(tag).toMatch(/^".+"$/);

    for (const sent of [tag, `W/${tag}`, `"stale", ${tag}`]) {
      const { db, prepared } = recordingDb();
      const res = await app.request('/api/data', { headers: { Cookie: cookie, 'If-None-Match': sent } }, { ...env, DB: db });
      expect(res.status).toBe(304);
      expect(res.headers.get('ETag')).toBe(tag);
      expect(await res.text()).toBe('');
      expect(prepared).toEqual(['SELECT email, data_version FROM users WHERE id = ?']);
    }
  });

  it('serves the snapshot in full, under a new tag, after every kind of write', async () => {
    const { cookie } = await signIn();
    const span = { k0: 'mn10:1.4', o0: 0, k1: 'mn10:1.5', o1: 12 };
    const writes = [
      { type: 'list.create', id: 'l1', label: 'One', parentId: null, kind: 'list' },
      { type: 'list.create', id: 'l2', label: 'Two', parentId: null, kind: 'list' },
      { type: 'list.update', id: 'l1', label: 'Renamed', parentId: null },
      { type: 'item.add', listId: 'l1', suttaId: 'dn1' },
      { type: 'item.add', listId: 'l1', suttaId: 'dn2' },
      { type: 'item.order', listId: 'l1', order: ['dn2', 'dn1'] },
      { type: 'item.remove', listId: 'l1', suttaId: 'dn1' },
      { type: 'sibling.order', parentId: null, order: ['l1', 'l2'] },
      { type: 'note', suttaId: 'dn1', text: 'a note' },
      { type: 'note', suttaId: 'dn1', text: '' },
      { type: 'highlight', suttaId: 'mn10', span, color: 'yellow', g: 'h1', erase: [] },
      { type: 'highlight', suttaId: 'mn10', span, color: null, g: 'h2', erase: ['h1'] },
      { type: 'visited', suttaId: 'dn1', visitedAt: new Date().toISOString() },
      { type: 'list.delete', id: 'l2' },
    ];

    let tag = await tagOf(cookie);
    for (const item of writes) {
      // Distinct mtimes, so no write loses last-writer-wins to the one before it.
      await new Promise((r) => setTimeout(r, 2));
      expect(await write(cookie, { mtime: new Date().toISOString(), ...item }), item.type).toEqual({ ok: true });
      const res = await api('/api/data', { cookie, headers: { 'If-None-Match': tag } });
      expect(res.status, item.type).toBe(200);
      const next = res.headers.get('ETag');
      expect(next, item.type).not.toBe(tag);
      tag = next;
    }
  });

  // The native apps call the API cross-origin, so the tag only makes the round trip if CORS lets
  // them send If-None-Match and read the ETag.
  it('lets the native apps send the tag and read it', async () => {
    const { cookie } = await signIn();
    const Origin = 'capacitor://localhost';
    const preflight = await app.request(
      '/api/data',
      {
        method: 'OPTIONS',
        headers: { Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,if-none-match' },
      },
      env
    );
    expect(preflight.headers.get('Access-Control-Allow-Headers').toLowerCase().split(',')).toContain('if-none-match');

    const res = await app.request('/api/data', { headers: { Origin, Cookie: cookie } }, env);
    expect(res.headers.get('Access-Control-Expose-Headers').toLowerCase().split(',')).toContain('etag');
    expect(res.headers.get('ETag')).toBeTruthy();
  });

  it('never answers 304 to another account’s tag, or to one another deploy served', async () => {
    const a = await signIn();
    const b = await signIn();
    const tagA = await tagOf(a.cookie);
    expect((await api('/api/data', { cookie: b.cookie, headers: { 'If-None-Match': tagA } })).status).toBe(200);

    const deployed = (id) => ({ ...env, CF_VERSION_METADATA: { id } });
    const request = (headers, deploy) => app.request('/api/data', { headers: { Cookie: a.cookie, ...headers } }, deployed(deploy));
    const tag = (await request({}, 'deploy-1')).headers.get('ETag');
    expect((await request({ 'If-None-Match': tag }, 'deploy-1')).status).toBe(304);
    expect((await request({ 'If-None-Match': tag }, 'deploy-2')).status).toBe(200);
  });

  // A table the snapshot reads without all three triggers would leave a device answered "not
  // modified" over a change it never saw. The tables come from the snapshot's own queries rather
  // than a list here, so one added to it without its triggers fails this.
  it('reads only tables that raise the data version on every insert, update and delete', async () => {
    const { cookie } = await signIn();
    const { db, prepared } = recordingDb();
    const res = await app.request('/api/data', { headers: { Cookie: cookie } }, { ...env, DB: db });
    expect(res.status).toBe(200);

    const tables = new Set(prepared.flatMap((sql) => [...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map((m) => m[1])));
    // `users` holds the data version itself.
    tables.delete('users');
    expect([...tables]).toEqual(expect.arrayContaining(['lists', 'notes', 'highlights', 'visited']));

    const { results: triggers } = await env.DB.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger'").all();
    for (const table of tables) {
      for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
        const raises = triggers.some(
          (t) =>
            t.tbl_name === table &&
            new RegExp(`\\bAFTER ${event} ON ${table}\\b`, 'i').test(t.sql) &&
            /SET data_version = data_version \+ 1 WHERE id = (NEW|OLD)\.user_id/.test(t.sql)
        );
        expect(raises, `${table} raises the data version after ${event}`).toBe(true);
      }
    }
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
