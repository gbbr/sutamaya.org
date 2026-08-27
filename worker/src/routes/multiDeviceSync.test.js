import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// The single-item tests elsewhere (lib/annotationWrites.test.js, lib/listWrites.test.js) each fix
// one arrival order and check the winner. What they don't check is the thing the whole
// mtime/tombstone/op design exists for: two devices, each offline and unaware of the other, produce
// the *same* final state no matter which one's queued writes happen to reach the server first.
// These tests replay the same two devices' work in both arrival orders against two independent
// signed-in users and diff the resulting GET /api/data — real convergence, not just "the later
// mtime won this once".

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

// One device's flush: a push carrying whatever that device had queued.
async function flush(cookie, ...items) {
  const res = await api('/api/data/push', { method: 'POST', cookie, body: { items } });
  if (!res.ok) throw new Error(`push itself failed: ${res.status} ${await res.text()}`);
  return (await res.json()).results;
}

// `lists.id` is a global primary key, so the two simulated worlds in each test below — different
// users standing in for "arrival order A" vs "arrival order B" — can't share a literal id.
let nextId = 0;

async function createList(cookie, { label, kind = 'list', parentId = null } = {}) {
  const id = `list-${(nextId += 1)}`;
  await flush(cookie, { type: 'list.create', id, label, parentId, kind });
  return { id, label, kind, parentId };
}

async function dataFor(cookie) {
  return (await api('/api/data', { cookie })).json();
}

describe('multi-device convergence (D1)', () => {
  // Two devices each edit the same note offline, unaware of each other, then both flush. Whichever
  // one's push happens to land first, the row's own mtime — not arrival order — decides the winner,
  // so the reader's final GET /api/data must not depend on which device's push the server saw first.
  it('a note conflict between two devices converges the same way regardless of arrival order', async () => {
    const deviceA = { type: 'note', suttaId: 'sn1.1', text: 'from phone', mtime: '2030-01-01T00:00:02.000Z|phone' };
    const deviceB = { type: 'note', suttaId: 'sn1.1', text: 'from laptop', mtime: '2030-01-01T00:00:01.000Z|laptop' };

    const { cookie: cookieAFirst } = await signIn();
    await flush(cookieAFirst, deviceA);
    await flush(cookieAFirst, deviceB);

    const { cookie: cookieBFirst } = await signIn();
    await flush(cookieBFirst, deviceB);
    await flush(cookieBFirst, deviceA);

    const [dataAFirst, dataBFirst] = await Promise.all([dataFor(cookieAFirst), dataFor(cookieBFirst)]);
    expect(dataAFirst.notes['sn1.1'].text).toBe('from phone');
    expect(dataBFirst.notes['sn1.1'].text).toBe('from phone');
  });

  // Device A files sutta X into a shared list, device B files sutta Y into the same list, both
  // offline and each unaware of the other's add. Membership is operation-based specifically so both
  // stick regardless of which reaches the server first — this is the property that distinguishes
  // an op from a record.
  it('two devices adding different suttas to the same list converge on both items regardless of order', async () => {
    const { cookie: cookieAFirst } = await signIn();
    const listAFirst = await createList(cookieAFirst, { label: 'Shared' });
    await flush(cookieAFirst, { type: 'item.add', listId: listAFirst.id, suttaId: 'sn1.1' });
    await flush(cookieAFirst, { type: 'item.add', listId: listAFirst.id, suttaId: 'sn1.2' });

    const { cookie: cookieBFirst } = await signIn();
    const listBFirst = await createList(cookieBFirst, { label: 'Shared' });
    await flush(cookieBFirst, { type: 'item.add', listId: listBFirst.id, suttaId: 'sn1.2' });
    await flush(cookieBFirst, { type: 'item.add', listId: listBFirst.id, suttaId: 'sn1.1' });

    const [dataAFirst, dataBFirst] = await Promise.all([dataFor(cookieAFirst), dataFor(cookieBFirst)]);
    const itemsOf = (data, listId) => new Set(data.lists.find((l) => l.id === listId).items);
    expect(itemsOf(dataAFirst, listAFirst.id)).toEqual(new Set(['sn1.1', 'sn1.2']));
    expect(itemsOf(dataBFirst, listBFirst.id)).toEqual(new Set(['sn1.1', 'sn1.2']));
  });

  // Device A deletes a group while, offline and unaware, device B files a sutta into a list nested
  // inside that same group. The add has to land on the dead row either way (suttaListRow is
  // deliberately unfiltered on `deleted`) so the read-time cascade in repairListTree hides it from
  // both devices' next pull identically, whichever push the server happened to see first.
  it('a group delete racing an offline add into its child converges to the cascade winning, either order', async () => {
    async function setup(cookie) {
      const group = await createList(cookie, { label: 'Group', kind: 'group' });
      const child = await createList(cookie, { label: 'Child', parentId: group.id });
      return { group, child };
    }

    const { cookie: deleteFirstCookie } = await signIn();
    const deleteFirstIds = await setup(deleteFirstCookie);
    await flush(deleteFirstCookie, { type: 'list.delete', id: deleteFirstIds.group.id });
    await flush(deleteFirstCookie, { type: 'item.add', listId: deleteFirstIds.child.id, suttaId: 'sn1.1' });

    const { cookie: addFirstCookie } = await signIn();
    const addFirstIds = await setup(addFirstCookie);
    await flush(addFirstCookie, { type: 'item.add', listId: addFirstIds.child.id, suttaId: 'sn1.1' });
    await flush(addFirstCookie, { type: 'list.delete', id: addFirstIds.group.id });

    const [dataDeleteFirst, dataAddFirst] = await Promise.all([dataFor(deleteFirstCookie), dataFor(addFirstCookie)]);
    const ids = (d) => new Set([d.group.id, d.child.id]);
    expect(dataDeleteFirst.lists.filter((l) => ids(deleteFirstIds).has(l.id))).toEqual([]);
    expect(dataAddFirst.lists.filter((l) => ids(addFirstIds).has(l.id))).toEqual([]);
  });

  // Same order-independence property as the note test above, but for a list's own record write
  // (rename + reparent share one conditional write, per lib/writes.js) — the identical mtime-guard
  // mechanism.
  it('a list rename/reparent conflict between two devices converges the same way regardless of arrival order', async () => {
    async function setup(cookie) {
      const folder = await createList(cookie, { label: 'Folder', kind: 'group' });
      const list = await createList(cookie, { label: 'Original' });
      return { folder, list };
    }
    const fromPhone = (ids) => ({
      type: 'list.update',
      id: ids.list.id,
      label: 'from phone',
      parentId: ids.folder.id,
      mtime: '2030-01-01T00:00:02.000Z|phone',
    });
    const fromLaptop = (ids) => ({
      type: 'list.update',
      id: ids.list.id,
      label: 'from laptop',
      parentId: null,
      mtime: '2030-01-01T00:00:01.000Z|laptop',
    });

    const { cookie: cookieAFirst } = await signIn();
    const idsAFirst = await setup(cookieAFirst);
    await flush(cookieAFirst, fromPhone(idsAFirst));
    await flush(cookieAFirst, fromLaptop(idsAFirst));

    const { cookie: cookieBFirst } = await signIn();
    const idsBFirst = await setup(cookieBFirst);
    await flush(cookieBFirst, fromLaptop(idsBFirst));
    await flush(cookieBFirst, fromPhone(idsBFirst));

    const [dataAFirst, dataBFirst] = await Promise.all([dataFor(cookieAFirst), dataFor(cookieBFirst)]);
    const listOf = (data, ids) => data.lists.find((l) => l.id === ids.list.id);
    expect(listOf(dataAFirst, idsAFirst)).toMatchObject({ label: 'from phone', parentId: idsAFirst.folder.id });
    expect(listOf(dataBFirst, idsBFirst)).toMatchObject({ label: 'from phone', parentId: idsBFirst.folder.id });
  });

  // Unlike a record write, an item op carries no mtime guard at all (see ADD_ITEM_SQL/
  // REMOVE_ITEM_SQL in lib/writes.js) — the two ops in the earlier test only "commute" because they
  // touch different suttas. The same sutta added by one device and removed by the other is a genuine
  // conflict, and this documents what actually happens: whichever op the server ran last decides the
  // outcome, not a timestamp. It is also why a push applies its items strictly in order.
  it('add and remove of the same sutta from two devices is decided by arrival order, not a timestamp', async () => {
    const { cookie: addLastCookie } = await signIn();
    const listAddLast = await createList(addLastCookie, { label: 'L' });
    await flush(
      addLastCookie,
      { type: 'item.add', listId: listAddLast.id, suttaId: 'sn1.1' },
      { type: 'item.remove', listId: listAddLast.id, suttaId: 'sn1.1' },
      { type: 'item.add', listId: listAddLast.id, suttaId: 'sn1.1' }
    );

    const { cookie: removeLastCookie } = await signIn();
    const listRemoveLast = await createList(removeLastCookie, { label: 'L' });
    await flush(
      removeLastCookie,
      { type: 'item.add', listId: listRemoveLast.id, suttaId: 'sn1.1' },
      { type: 'item.add', listId: listRemoveLast.id, suttaId: 'sn1.1' },
      { type: 'item.remove', listId: listRemoveLast.id, suttaId: 'sn1.1' }
    );

    const [dataAddLast, dataRemoveLast] = await Promise.all([dataFor(addLastCookie), dataFor(removeLastCookie)]);
    expect(dataAddLast.lists.find((l) => l.id === listAddLast.id).items).toEqual(['sn1.1']);
    expect(dataRemoveLast.lists.find((l) => l.id === listRemoveLast.id).items).toEqual([]);
  });

  // Two devices each highlight an overlapping span in the same segment, offline and unaware of each
  // other, so neither names the other's group in `erase`. Per docs/offline-sync.md, both survive as
  // stored rows (the reader settles the contested characters by mtime/g at render time) — this must
  // hold regardless of which device's write the server saw first.
  it('two devices highlighting overlapping spans converge on both groups surviving, either order', async () => {
    const groupA = {
      type: 'highlight',
      suttaId: 'sn1.1',
      g: 'group-a',
      erase: [],
      mtime: '2030-01-01T00:00:01.000Z|phone',
      color: 'yellow',
      ranges: [{ i: 0, s: 0, e: 10 }],
    };
    const groupB = {
      type: 'highlight',
      suttaId: 'sn1.1',
      g: 'group-b',
      erase: [],
      mtime: '2030-01-01T00:00:02.000Z|laptop',
      color: 'green',
      ranges: [{ i: 0, s: 5, e: 15 }],
    };

    const { userId: userAFirst, cookie: cookieAFirst } = await signIn();
    await flush(cookieAFirst, groupA);
    await flush(cookieAFirst, groupB);

    const { userId: userBFirst, cookie: cookieBFirst } = await signIn();
    await flush(cookieBFirst, groupB);
    await flush(cookieBFirst, groupA);

    for (const userId of [userAFirst, userBFirst]) {
      const { results } = await env.DB.prepare('SELECT g FROM highlights WHERE user_id = ? AND deleted = 0').bind(userId).all();
      expect(new Set(results.map((r) => r.g))).toEqual(new Set(['group-a', 'group-b']));
    }
  });
});
