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

async function highlightsOf(userId, suttaId) {
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
    expect(data.notes['sn1.1']).toBe('hello');

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
    expect(data.notes['sn1.1']).toBe('newer');
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
    expect(data.notes['sn1.1']).toBe('second');
  });

  // The conditional write (WHERE excluded.mtime > notes.mtime) is the entire conflict
  // resolution: a stale offline edit replayed after a newer one must not win.
  it('does not let an older client mtime overwrite a note written with a newer one', async () => {
    const { cookie } = await signIn();
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'newer', mtime: '2026-01-02T00:00:00.000Z|a' } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'older', mtime: '2026-01-01T00:00:00.000Z|a' } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1']).toBe('newer');
  });

  it('does not let an equal client mtime overwrite a note either', async () => {
    const { cookie } = await signIn();
    const mtime = '2026-01-01T00:00:00.000Z|a';
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'first', mtime } });
    await api('/api/notes/sn1.1', { method: 'PUT', cookie, body: { text: 'second', mtime } });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.notes['sn1.1']).toBe('first');
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

  it('writes a single-segment highlight range', async () => {
    const { userId, cookie } = await signIn();
    const res = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5, e: 10 }] },
    });
    expect(res.status).toBe(200);

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sutta_id: 'sn1.1', i: 0, s: 5, e: 10, color: 'yellow' });
  });

  it('writes a cross-segment highlight with all rows sharing one groupId', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: {
        suttaId: 'sn1.1',
        color: 'blue',
        ranges: [
          { i: 0, s: 5, e: 10 },
          { i: 1, s: 0, e: 3 },
        ],
      },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.g)).size).toBe(1);
  });

  it('replaces an overlapping highlight atomically instead of leaving both', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    // Overlaps [0,10) with [5,15) — should replace the old highlight, not add a second one.
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'green', ranges: [{ i: 0, s: 5, e: 15 }] },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ s: 5, e: 15, color: 'green' });
  });

  // The overlap predicate moved from lib/highlightOverlap.js's rangesOverlap() into SQL, so the two
  // things it was careful about get pinned here: an edge-touching range is adjacent, not
  // overlapping, and a range in a different segment never matches.
  it('leaves an edge-touching highlight and a same-range highlight in another segment alone', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 1, s: 0, e: 10 }] },
    });

    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'green', ranges: [{ i: 0, s: 10, e: 20 }] },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(3);
  });

  it('replaces an existing highlight fully contained by the new range', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5, e: 10 }] },
    });

    // [0,15) fully contains the stored [5,10).
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'green', ranges: [{ i: 0, s: 0, e: 15 }] },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ s: 0, e: 15, color: 'green' });
  });

  it('replaces an existing highlight that fully contains the new, smaller range', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 20 }] },
    });

    // [5,10) is fully inside the stored [0,20).
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'green', ranges: [{ i: 0, s: 5, e: 10 }] },
    });

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ s: 5, e: 10, color: 'green' });
  });

  it('rejects a zero-width or inverted range instead of writing degenerate rows', async () => {
    const { userId, cookie } = await signIn();
    const zeroWidth = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5, e: 5 }] },
    });
    expect(zeroWidth.status).toBe(400);

    const inverted = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 10, e: 5 }] },
    });
    expect(inverted.status).toBe(400);

    expect(await highlightsOf(userId, 'sn1.1')).toHaveLength(0);
  });

  it('erases overlapping highlights when color is null, inserting nothing', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }] },
    });

    const res = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: null, ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    expect(res.status).toBe(200);
    expect(await highlightsOf(userId, 'sn1.1')).toHaveLength(0);
  });

  // `created_at`/`mtime` take the client's instant, so the Highlights auto-list orders by when
  // the user highlighted rather than by which request reached the server last.
  it('orders the Highlights auto-list by the client-supplied mtime rather than by arrival', async () => {
    const { cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 5 }], mtime: '2026-01-01T00:00:00.000Z|a' },
    });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.2', color: 'blue', ranges: [{ i: 0, s: 0, e: 5 }], mtime: '2026-01-02T00:00:00.000Z|a' },
    });
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === 'auto-highlights').items).toEqual(['sn1.2', 'sn1.1']);
  });

  it('rejects a range missing integer i/s/e', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 5 }] },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'each range needs integer i, s, e with s < e.' });
  });

  it('rejects a missing suttaId or empty ranges array', async () => {
    const { cookie } = await signIn();
    const noSutta = await api('/api/highlights/ranges', { method: 'PUT', cookie, body: { color: 'yellow', ranges: [{ i: 0, s: 0, e: 1 }] } });
    expect(noSutta.status).toBe(400);
    expect(await noSutta.json()).toEqual({ error: 'suttaId and a non-empty ranges array are required.' });

    const noRanges = await api('/api/highlights/ranges', { method: 'PUT', cookie, body: { suttaId: 'sn1.1', ranges: [] } });
    expect(noRanges.status).toBe(400);
  });

  // Tombstoned, not removed: the row has to stay behind to lose a merge against an offline device
  // pushing its still-live copy of the same highlight.
  it('tombstones a highlight by id rather than deleting the row', async () => {
    const { userId, cookie } = await signIn();
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie,
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    const [row] = await highlightsOf(userId, 'sn1.1');

    const res = await api(`/api/highlights/${row.id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);

    const rows = await highlightsOf(userId, 'sn1.1');
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted).toBe(1);

    // ...and invisible to the client regardless.
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.highlights['sn1.1']).toBeUndefined();
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
      body: { suttaId: 'sn1.1', color: 'yellow', ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    await api('/api/visited/sn1.1', { method: 'POST', cookie: owner.cookie });
    const [row] = await highlightsOf(owner.userId, 'sn1.1');

    const otherData = await (await api('/api/data', { cookie: other.cookie })).json();
    expect(otherData).toEqual({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });

    // Same-sutta writes by the other user must not touch the owner's rows.
    await api('/api/notes/sn1.1', { method: 'PUT', cookie: other.cookie, body: { text: '' } });
    await api('/api/highlights/ranges', {
      method: 'PUT',
      cookie: other.cookie,
      body: { suttaId: 'sn1.1', color: null, ranges: [{ i: 0, s: 0, e: 10 }] },
    });
    await api(`/api/highlights/${row.id}`, { method: 'DELETE', cookie: other.cookie });

    const ownerData = await (await api('/api/data', { cookie: owner.cookie })).json();
    expect(ownerData.notes['sn1.1']).toBe('private');
    expect(ownerData.highlights['sn1.1']).toHaveLength(1);
    expect(ownerData.visited['sn1.1']).toBeTruthy();
  });
});
