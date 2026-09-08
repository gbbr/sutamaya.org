import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// Account deletion spans the two routers: the deed is DELETE /api/auth/account, and what another
// device makes of it afterwards is /api/data answering 410. Same harness as routes/data.test.js —
// a real signed session cookie, fixtures seeded through the one write endpoint.

async function signIn(email) {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, email || `${userId}@example.com`, `google-${userId}`, new Date().toISOString())
    .run();
  await env.DB.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)')
    .bind('email', email || `${userId}@example.com`, userId, new Date().toISOString())
    .run();
  const setCookie = await createSessionCookie(userId, env.SESSION_SECRET);
  return { userId, email: email || `${userId}@example.com`, cookie: setCookie.split(';')[0] };
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

// Fills an account with one row in every table deletion has to reach.
async function seed(cookie) {
  const mtime = `${new Date().toISOString()}|device`;
  await api('/api/data/push', {
    method: 'POST',
    cookie,
    body: {
      items: [
        { type: 'list.create', id: 'l1', label: 'Favourites', parentId: null, kind: 'list', mtime },
        { type: 'item.add', listId: 'l1', suttaId: 'mn10' },
        { type: 'note', suttaId: 'mn10', text: 'a note', mtime },
        {
          type: 'highlight',
          suttaId: 'mn10',
          span: { k0: 'mn10:1.1', o0: 0, k1: 'mn10:1.1', o1: 4 },
          color: 'amber',
          g: 'h1',
          erase: [],
          mtime,
        },
        { type: 'visited', suttaId: 'mn10', visitedAt: new Date().toISOString() },
      ],
    },
  });
}

async function countsFor(userId) {
  const tables = ['lists', 'notes', 'highlights', 'visited', 'identities'];
  const counts = {};
  for (const table of tables) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(userId).first();
    counts[table] = row.n;
  }
  const user = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(userId).first();
  counts.users = user.n;
  return counts;
}

describe('account deletion (D1)', () => {
  it('erases the account and every row filed under it', async () => {
    const { userId, cookie } = await signIn();
    await seed(cookie);
    expect(await countsFor(userId)).toEqual({ lists: 1, notes: 1, highlights: 1, visited: 1, identities: 1, users: 1 });

    const res = await api('/api/auth/account', { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await countsFor(userId)).toEqual({ lists: 0, notes: 0, highlights: 0, visited: 0, identities: 0, users: 0 });
  }, 30_000);

  it('clears the session cookie and stops answering /api/auth/me', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/auth/account', { method: 'DELETE', cookie });
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sutamaya_session=') && c.includes('Max-Age=0'))).toBe(
      true
    );

    // The deleted account's own cookie is still signed and valid, so /me proves the account is
    // gone rather than the cookie being rejected.
    const me = await api('/api/auth/me', { cookie });
    expect(await me.json()).toEqual({ user: null });
  });

  it('leaves another account untouched', async () => {
    const mine = await signIn();
    const theirs = await signIn();
    await seed(theirs.cookie);

    await api('/api/auth/account', { method: 'DELETE', cookie: mine.cookie });

    expect(await countsFor(theirs.userId)).toEqual({
      lists: 1,
      notes: 1,
      highlights: 1,
      visited: 1,
      identities: 1,
      users: 1,
    });
  });

  it('drops an outstanding sign-in code for the address', async () => {
    const { email, cookie } = await signIn();
    await env.DB.prepare(
      'INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)'
    )
      .bind(email, 'hash', new Date(Date.now() + 600_000).toISOString(), new Date().toISOString())
      .run();

    await api('/api/auth/account', { method: 'DELETE', cookie });

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ?').bind(email).first();
    expect(row.n).toBe(0);
  });

  it('refuses a request with no session', async () => {
    const res = await api('/api/auth/account', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('is idempotent — a second delete on the same session still answers ok', async () => {
    const { cookie } = await signIn();
    await api('/api/auth/account', { method: 'DELETE', cookie });
    const again = await api('/api/auth/account', { method: 'DELETE', cookie });
    expect(again.status).toBe(200);
  });

  // What another signed-in device sees. Its session cookie is signed and self-contained, so
  // nothing about it has expired — only the account behind it is gone.
  describe('another device still holding a valid session', () => {
    it('answers 410 account_deleted rather than handing back an empty account', async () => {
      const { cookie } = await signIn();
      await seed(cookie);
      await api('/api/auth/account', { method: 'DELETE', cookie });

      const read = await api('/api/data', { cookie });
      expect(read.status).toBe(410);
      expect(await read.json()).toEqual({ error: 'account_deleted' });
    });

    it('refuses the push that would otherwise recreate the account’s rows', async () => {
      const { userId, cookie } = await signIn();
      await api('/api/auth/account', { method: 'DELETE', cookie });

      const mtime = `${new Date().toISOString()}|device`;
      const push = await api('/api/data/push', {
        method: 'POST',
        cookie,
        body: { items: [{ type: 'list.create', id: 'l9', label: 'Back again', parentId: null, kind: 'list', mtime }] },
      });
      expect(push.status).toBe(410);

      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?').bind(userId).first();
      expect(row.n).toBe(0);
    });

    it('refuses the export too', async () => {
      const { cookie } = await signIn();
      await api('/api/auth/account', { method: 'DELETE', cookie });
      expect((await api('/api/data/export', { cookie })).status).toBe(410);
    });
  });
});
