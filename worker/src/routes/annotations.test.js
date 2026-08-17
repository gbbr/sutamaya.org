import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// Same harness as routes/lists.test.js: assertions read rows straight out of env.DB, a
// signed-in caller is a real signed session cookie, and D1 rows need no explicit cleanup
// (vitest-pool-workers rolls back each test's storage writes).

async function signIn() {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, `${userId}@example.com`, `google-${userId}`, new Date().toISOString())
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

// Live rows only — a retired highlight stays in the table as a tombstone, so counting raw rows
// would count highlights the user can no longer see. allHighlightsOf is for the tests that are
// specifically about those tombstones.
async function highlightsOf(userId, suttaId) {
  const { results } = await env.DB.prepare('SELECT * FROM highlights WHERE user_id = ? AND sutta_id = ? AND deleted = 0')
    .bind(userId, suttaId)
    .all();
  return results;
}

async function allHighlightsOf(userId, suttaId) {
  const { results } = await env.DB.prepare('SELECT * FROM highlights WHERE user_id = ? AND sutta_id = ?')
    .bind(userId, suttaId)
    .all();
  return results;
}

describe('routes/annotations.js (D1)', () => {
  it('requires authentication', async () => {
    const res = await api('/api/visited/sn1.1', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_authenticated' });
  });

  it('sets and clears a note (blank text tombstones it)', async () => {
    const { cookie } = await signIn();
    const set = await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'hello' } });
    expect(set.status).toBe(200);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1'].text).toBe('hello');

    const clear = await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: '' } });
    expect(clear.status).toBe(200);
    const data2 = await (await api('/api/data', { cookie })).json();
    expect(data2.notes['sn1.1']).toBeUndefined();
  });

  // The note case is the sharpest tombstone-filtering trap: assembleUserData's auto-notes list
  // treats "a row exists" as "this sutta has a note", so a tombstone that slipped past the filter
  // would put a cleared note back on screen — in the notes map *and* the Notes auto-list.
  it('keeps a cleared note as a tombstone row, absent from both the notes map and the Notes auto-list', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'hello' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: '' } });

    const row = await env.DB.prepare('SELECT * FROM notes WHERE user_id = ? AND sutta_id = ?').bind(userId, 'sn1.1').first();
    expect(row).toBeTruthy();
    expect(row.deleted).toBe(1);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1']).toBeUndefined();
    expect(data.lists.find((l) => l.id === 'auto-notes')).toBeUndefined();
  });

  // A clear is just another state on the same clock, so it must lose to a newer edit the same way
  // an edit loses to a newer clear.
  it('does not let a stale clear tombstone a note edited more recently', async () => {
    const { cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'newer', mtime: '2030-01-02T00:00:00.000Z|a' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: '', mtime: '2030-01-01T00:00:00.000Z|a' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1'].text).toBe('newer');
  });

  it('does not let a stale edit undo a more recent clear', async () => {
    const { cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'original', mtime: '2030-01-01T00:00:00.000Z|a' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: '', mtime: '2030-01-03T00:00:00.000Z|a' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'stale offline edit', mtime: '2030-01-02T00:00:00.000Z|a' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1']).toBeUndefined();
  });

  // The upsert must replace the row's whole text rather than leave the first write's text
  // behind.
  it('overwrites an existing note', async () => {
    const { cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'first' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'second' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1'].text).toBe('second');
  });

  // The conditional write (WHERE excluded.mtime > notes.mtime) is the entire conflict
  // resolution: a stale offline edit replayed after a newer one must not win.
  it('does not let an older client mtime overwrite a note written with a newer one', async () => {
    const { cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'newer', mtime: '2026-01-02T00:00:00.000Z|a' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'older', mtime: '2026-01-01T00:00:00.000Z|a' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1'].text).toBe('newer');
  });

  it('does not let an equal client mtime overwrite a note either', async () => {
    const { cookie } = await signIn();
    const mtime = '2026-01-01T00:00:00.000Z|a';
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'first', mtime } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'second', mtime } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1'].text).toBe('first');
  });

  // A note written with an explicit mtime still orders the Notes auto-list by that timestamp,
  // not by which request happened to reach the server last.
  it('orders the Notes auto-list by the client-supplied mtime rather than by arrival', async () => {
    const { cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'written later, dated earlier', mtime: '2026-01-01T00:00:00.000Z|a' } });
    await api('/api/notes/sn1.2', { method: 'PUT', cookie, body: { text: 'written first, dated later', mtime: '2026-01-02T00:00:00.000Z|a' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === 'auto-notes').items).toEqual(['sn1.2', 'sn1.1']);
  });

  // Every write below carries the two ids the client owns: `g`, naming the group it creates, and
  // `erase`, naming the groups its selection displaces. Both are required — the server never works
  // either out from live rows, since that is exactly what a replayed write gets wrong.
  const GROUP_A = { g: 'group-a', erase: [], mtime: '2026-01-01T00:00:00.000Z|a' };

  it('writes a single-segment highlight range', async () => {
    const { userId, cookie } = await signIn();
    const res = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5, e: 10 }], ...GROUP_A },
    });
    expect(res.status).toBe(200);

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sutta_id: 'sn1.1', i: 0, s: 5, e: 10, color: 'yellow', g: 'group-a' });
  });

  it('writes a cross-segment highlight with all rows sharing one groupId', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: {
        suttaId: 'sn1.1',
        color: 'blue',
        ...GROUP_A,
        ranges: [
          { i: 0, s: 5, e: 10 },
          { i: 1, s: 0, e: 3 },
        ],
      },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.g))).toEqual(new Set(['group-a']));
  });

  // A recolour is a tombstone plus a brand new group, so the sutta is left with one live highlight
  // rather than two overlapping ones.
  it('replaces a highlight it says it displaces instead of leaving both', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }], ...GROUP_A },
    });

    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: {
        suttaId: 'sn1.1',
        color: 'green',
        g: 'group-b',
        erase: ['group-a'],
        mtime: '2026-01-02T00:00:00.000Z|a',
        ranges: [{ i: 0, s: 5, e: 15 }],
      },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ s: 5, e: 15, color: 'green' });
  });

  it('rejects a zero-width or inverted range instead of writing degenerate rows', async () => {
    const { userId, cookie } = await signIn();
    const zeroWidth = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5, e: 5 }], ...GROUP_A },
    });
    expect(zeroWidth.status).toBe(400);

    const inverted = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 10, e: 5 }], ...GROUP_A },
    });
    expect(inverted.status).toBe(400);

    expect(await highlightsOf(userId, 'sn1.1')).toHaveLength(0);
  });

  // A group is immutable and named by the client, so re-sending one — a flush retried after a lost
  // response — has to land on the same rows rather than creating a second highlight over the same
  // text. (user_id, g, i) is what makes the insert a no-op.
  it('is a no-op when a group the client already sent is pushed again', async () => {
    const { userId, cookie } = await signIn();
    const body = {
      suttaId: 'sn1.1',
      color: 'yellow',
      g: 'group-a',
      erase: [],
      mtime: '2026-01-01T00:00:00.000Z|a',
      ranges: [
        { i: 0, s: 0, e: 10 },
        { i: 1, s: 0, e: 4 },
      ],
    };
    await api('/api/highlights/ranges', { method: 'PUT', cookie, body });
    const first = await highlightsOf(userId, 'sn1.1');

    const again = await api('/api/highlights/ranges', { method: 'PUT', cookie, body });
    expect(again.status).toBe(200);

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
    expect(new Set(rows.map((r) => r.g))).toEqual(new Set(['group-a']));
  });

  // The client names the groups its selection displaces, and a group is atomic: erasing it takes
  // every segment it spans, not just the one the new selection happened to overlap.
  it('retires every segment of a displaced group and leaves an untouched group alone', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: {
        suttaId: 'sn1.1',
        color: 'yellow',
        g: 'group-a',
        erase: [],
        mtime: '2026-01-01T00:00:00.000Z|a',
        ranges: [
          { i: 0, s: 0, e: 10 },
          { i: 1, s: 0, e: 4 },
        ],
      },
    });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'blue', g: 'group-b', erase: [], mtime: '2026-01-02T00:00:00.000Z|a', ranges: [{ i: 5, s: 0, e: 3 }] },
    });

    // Recolour: one tombstone for what it displaces, one brand new group.
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: {
        suttaId: 'sn1.1',
        color: 'green',
        g: 'group-c',
        erase: ['group-a'],
        mtime: '2026-01-03T00:00:00.000Z|a',
        ranges: [{ i: 0, s: 2, e: 6 }],
      },
    });

    const live = await highlightsOf(userId, 'sn1.1');
    expect(live.map((r) => r.g).sort()).toEqual(['group-b', 'group-c']);
    // group-a's own rows are still there, both of them, just retired.
    const dead = (await allHighlightsOf(userId, 'sn1.1')).filter((r) => r.deleted === 1);
    expect(dead).toHaveLength(2);
    expect(new Set(dead.map((r) => r.g))).toEqual(new Set(['group-a']));
  });

  it('erases a group without writing anything when color is null', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], mtime: '2026-01-01T00:00:00.000Z|a', ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: null, erase: ['group-a'], mtime: '2026-01-02T00:00:00.000Z|a', ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    expect(await highlightsOf(userId, 'sn1.1')).toHaveLength(0);
    const rows = await allHighlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted).toBe(1);

    // ...and invisible to the client regardless.
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.highlights['sn1.1']).toBeUndefined();
  });

  // Same conditional-write rule as everything else: an erase queued offline before the group it
  // names was (re)created elsewhere must lose rather than retire newer work.
  it('does not let a stale erase retire a group created more recently', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], mtime: '2026-01-05T00:00:00.000Z|a', ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: null, erase: ['group-a'], mtime: '2026-01-01T00:00:00.000Z|a', ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    expect(await highlightsOf(userId, 'sn1.1')).toHaveLength(1);
  });

  // Two devices highlighting overlapping spans offline both survive — the reader resolves who
  // paints the contested characters (see web/src/lib/highlights.ts), the server keeps both.
  it('keeps two overlapping groups when neither says it displaces the other', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], mtime: '2026-01-01T00:00:00.000Z|a', ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'green', g: 'group-b', erase: [], mtime: '2026-01-02T00:00:00.000Z|a', ranges: [{ i: 0, s: 5, e: 15 }] },
    });

    expect(await highlightsOf(userId, 'sn1.1')).toHaveLength(2);
  });

  // Reachable through the API even though the client never sends it: an erase naming no groups
  // has nothing to run, and D1 rejects an empty batch.
  it('accepts an erase that displaces nothing', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: null, erase: [], ranges: [{ i: 0, s: 0, e: 5 }] },
    });
    expect(res.status).toBe(200);
  });

  // Both ids are the client's to supply, and a write missing one can't be honoured — a create
  // without `g` loses its idempotence, and a selection that doesn't say what it displaces would
  // leave the old highlight underneath the new one.
  it('rejects a write that omits or malforms the group id or the erase list', async () => {
    const { userId, cookie } = await signIn();
    const cases = [
      { suttaId: 'sn1.1', color: 'yellow', erase: [], ranges: [{ i: 0, s: 0, e: 5 }] }, // no g
      { suttaId: 'sn1.1', color: 'yellow', g: '', erase: [], ranges: [{ i: 0, s: 0, e: 5 }] },
      { suttaId: 'sn1.1', color: 'yellow', g: 'group-a', ranges: [{ i: 0, s: 0, e: 5 }] }, // no erase
      { suttaId: 'sn1.1', color: null, erase: [42], ranges: [{ i: 0, s: 0, e: 5 }] },
      { suttaId: 'sn1.1', color: null, erase: 'group-a', ranges: [{ i: 0, s: 0, e: 5 }] },
    ];
    for (const body of cases) {
      expect((await api('/api/highlights/ranges', { method: 'PUT', cookie, body })).status).toBe(400);
    }
    expect(await allHighlightsOf(userId, 'sn1.1')).toHaveLength(0);
  });

  // `created_at`/`mtime` take the client's instant, so the Highlights auto-list orders by when
  // the user highlighted rather than by which request reached the server last.
  it('orders the Highlights auto-list by the client-supplied mtime rather than by arrival', async () => {
    const { cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], ranges: [{ i: 0, s: 0, e: 5 }], mtime: '2026-01-01T00:00:00.000Z|a' },
    });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.2', color: 'blue', g: 'group-b', erase: [], ranges: [{ i: 0, s: 0, e: 5 }], mtime: '2026-01-02T00:00:00.000Z|a' },
    });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === 'auto-highlights').items).toEqual(['sn1.2', 'sn1.1']);
  });

  it('rejects a range missing integer i/s/e', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', g: 'group-a', erase: [], ranges: [{ i: 0, s: 5 }] },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'each range needs integer i, s, e with s < e.' });
  });

  it('rejects a missing suttaId or empty ranges array', async () => {
    const { cookie } = await signIn();
    const noSutta = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { color: 'yellow', g: 'group-a', erase: [], ranges: [{ i: 0, s: 0, e: 1 }] },
    });
    expect(noSutta.status).toBe(400);
    expect(await noSutta.json()).toEqual({ error: 'suttaId and a non-empty ranges array are required.' });

    const noRanges = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', g: 'group-a', erase: [], ranges: [] },
    });
    expect(noRanges.status).toBe(400);
  });

  it('records a visited sutta', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/visited/sn1.1', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.visited['sn1.1']).toBeTruthy();
  });

  // POST /visited is fired on every qualifying read, so the second one has to refresh the
  // timestamp rather than fail the primary key.
  it('re-visiting a sutta updates its timestamp instead of conflicting', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/visited/sn1.1', { method: 'POST', cookie });
    const first = await env.DB.prepare('SELECT visited_at FROM visited WHERE user_id = ? AND sutta_id = ?')
      .bind(userId, 'sn1.1')
      .first();

    await new Promise((r) => setTimeout(r, 5));
    const res = await api('/api/visited/sn1.1', { method: 'POST', cookie });
    expect(res.status).toBe(200);

    const { results } = await env.DB.prepare('SELECT visited_at FROM visited WHERE user_id = ?').bind(userId).all();
    expect(results).toHaveLength(1);
    expect(results[0].visited_at > first.visited_at).toBe(true);
  });

  // A stale offline visit replayed after a newer one must not jump the sutta back up Recent.
  it('does not let an older client visitedAt overwrite a newer one', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/visited/sn1.1', { method: 'POST', cookie, body: { visitedAt: '2026-01-02T00:00:00.000Z|a' } });
    await api('/api/visited/sn1.1', { method: 'POST', cookie, body: { visitedAt: '2026-01-01T00:00:00.000Z|a' } });
    const row = await env.DB.prepare('SELECT visited_at FROM visited WHERE user_id = ? AND sutta_id = ?')
      .bind(userId, 'sn1.1')
      .first();
    expect(row.visited_at).toBe('2026-01-02T00:00:00.000Z|a');
  });

  // Client-supplied visitedAt values, not call order, drive the Recent auto-list.
  it('orders the Recent auto-list by the client-supplied visitedAt rather than by arrival', async () => {
    const { cookie } = await signIn();
    await api('/api/visited/sn1.1', { method: 'POST', cookie, body: { visitedAt: '2026-01-01T00:00:00.000Z|a' } });
    await api('/api/visited/sn1.2', { method: 'POST', cookie, body: { visitedAt: '2026-01-02T00:00:00.000Z|a' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === 'auto-recent').items).toEqual(['sn1.2', 'sn1.1']);
  });

  // As in routes/lists.js, `AND user_id = ?` is the only thing isolating one user's annotations
  // from another's.
  it("never reads or writes another user's annotations", async () => {
    const owner = await signIn();
    const other = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie: owner.cookie, body: { text: 'private' } });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie: owner.cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', g: 'owner-group', erase: [], ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    await api('/api/visited/sn1.1', { method: 'POST', cookie: owner.cookie });

    const otherData = await (await api('/api/data', { cookie: other.cookie })).json();
    expect(otherData).toEqual({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });

    // Same-sutta writes by the other user must not touch the owner's rows — including an erase
    // naming the owner's own group id, which every statement's `AND user_id = ?` is what stops.
    await api('/api/notes/sn1.1', { method: 'PUT', cookie: other.cookie, body: { text: '' } });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie: other.cookie,
      body: { suttaId: 'sn1.1', color: null, erase: ['owner-group'], ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    const ownerData = await (await api('/api/data', { cookie: owner.cookie })).json();
    expect(ownerData.notes['sn1.1'].text).toBe('private');
    expect(ownerData.highlights['sn1.1']).toHaveLength(1);
    expect(ownerData.visited['sn1.1']).toBeTruthy();
  });
});
