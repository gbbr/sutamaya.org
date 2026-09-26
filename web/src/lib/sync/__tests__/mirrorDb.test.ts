// A real (in-memory) IndexedDB, since everything worth asserting here is about what the store
// actually does with a record — persisting it across a reload, keying it by account, and throwing
// it away on a version bump. A hand-written stub would only assert the calls this file makes.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMirror, setNoteRecord, type MirrorState } from '../mirror';

// mirrorDb caches its open database in a module-level promise, so every test that wants a fresh
// database (or a different version of one) has to re-import the module rather than reuse it.
async function freshDb() {
  vi.resetModules();
  return import('../mirrorDb');
}

// A "reload": the same underlying IndexedDB, a new module instance reading it.
beforeEach(() => {
  indexedDB = new IDBFactory();
});

const noted = (userId: string, text: string, suttaId = 'dn1'): MirrorState =>
  setNoteRecord(emptyMirror(userId), suttaId, text);

// The rebase of a write that should find nothing newer to rebase over.
const unreached = (): MirrorState => {
  throw new Error('rebased');
};

describe('loadMirror / writeMirror', () => {
  it('gives a device that has never held this account an empty mirror rather than failing', async () => {
    const { loadMirror } = await freshDb();
    expect(await loadMirror('u1')).toEqual({ state: emptyMirror('u1'), rev: null });
  });

  it('reads back what it stored, dirty flags and queue included', async () => {
    const { writeMirror } = await freshDb();
    const state = noted('u1', 'kept offline');

    await writeMirror(state, null, unreached);
    const db = await freshDb();

    expect((await db.loadMirror('u1')).state).toEqual(state);
  });

  it('keeps two accounts apart, so an account switch cannot cross-write', async () => {
    const { loadMirror, writeMirror } = await freshDb();

    await writeMirror(noted('u1', 'mine'), null, unreached);
    await writeMirror(noted('u2', 'theirs'), null, unreached);

    expect((await loadMirror('u1')).state.notes.dn1.data.text).toBe('mine');
    expect((await loadMirror('u2')).state.notes.dn1.data.text).toBe('theirs');
  });

  it('ignores a state with no user id, which has no key to store it under', async () => {
    const { loadMirror, writeMirror } = await freshDb();
    await writeMirror(emptyMirror(null), null, unreached);
    expect(await loadMirror('')).toEqual({ state: emptyMirror(''), rev: null });
  });

  it('writes over the revision it read, and leaves a new one', async () => {
    const { loadMirror, writeMirror } = await freshDb();
    const first = await writeMirror(noted('u1', 'first'), null, unreached);
    const read = await loadMirror('u1');
    expect(read.rev).toBe(first.rev);

    const second = await writeMirror(noted('u1', 'second'), read.rev, unreached);

    expect(second.rev).not.toBe(first.rev);
    expect(await loadMirror('u1')).toEqual(second);
    expect(second.state.notes.dn1.data.text).toBe('second');
  });

  it('rebases a write over another tab’s newer save instead of writing over it', async () => {
    const { loadMirror, writeMirror } = await freshDb();
    await writeMirror(noted('u1', 'shared'), null, unreached);
    const mine = await loadMirror('u1');
    const theirs = await loadMirror('u1');
    await writeMirror(setNoteRecord(theirs.state, 'dn2', 'from the other tab'), theirs.rev, unreached);

    const written = await writeMirror(setNoteRecord(mine.state, 'dn3', 'from this tab'), mine.rev, (stored) =>
      setNoteRecord(stored, 'dn3', 'from this tab')
    );

    const stored = await loadMirror('u1');
    expect(stored.rev).toBe(written.rev);
    expect(stored.state).toEqual(written.state);
    expect(stored.state.notes.dn2.data.text).toBe('from the other tab');
    expect(stored.state.notes.dn3.data.text).toBe('from this tab');
  });

  it('writes a mirror no longer stored as it stands', async () => {
    const { deleteMirror, loadMirror, writeMirror } = await freshDb();
    const first = await writeMirror(noted('u1', 'first'), null, unreached);
    await deleteMirror('u1');

    const state = noted('u1', 'still here');
    const written = await writeMirror(state, first.rev, unreached);

    expect(written.state).toBe(state);
    expect((await loadMirror('u1')).state).toEqual(state);
  });

  it('reads a record stored without a revision as revision "", and writes over it', async () => {
    const { loadMirror, writeMirror } = await freshDb();
    await writeMirror(noted('u1', 'placeholder'), null, unreached);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('sutamaya');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('mirrors', 'readwrite');
      tx.objectStore('mirrors').put(noted('u1', 'no revision'));
      tx.oncomplete = resolve;
    });
    db.close();

    const read = await loadMirror('u1');
    expect(read.rev).toBe('');
    expect(read.state).not.toHaveProperty('rev');
    expect(read.state.notes.dn1.data.text).toBe('no revision');
    await writeMirror(noted('u1', 'over it'), read.rev, unreached);
    expect((await loadMirror('u1')).state.notes.dn1.data.text).toBe('over it');
  });
});

describe('loadAccountMirror', () => {
  it('moves the signed-out mirror onto the account in one step, under a new revision', async () => {
    const { loadAccountMirror, loadMirror, writeMirror } = await freshDb();
    const account = await writeMirror(noted('u1', 'on the account'), null, unreached);
    await writeMirror(noted('local-1', 'made signed out', 'dn2'), null, unreached);

    const loaded = await loadAccountMirror('u1', 'local-1');

    expect(loaded.adopted).toBe(true);
    expect(loaded.rev).not.toBe(account.rev);
    expect(loaded.state.notes.dn1.data.text).toBe('on the account');
    expect(loaded.state.notes.dn2.data.text).toBe('made signed out');
    expect(await loadMirror('u1')).toEqual({ state: loaded.state, rev: loaded.rev });
    expect(await loadMirror('local-1')).toEqual({ state: emptyMirror('local-1'), rev: null });
  });

  it('reads the account as it stands when nothing was made signed out', async () => {
    const { loadAccountMirror, writeMirror } = await freshDb();
    const account = await writeMirror(noted('u1', 'on the account'), null, unreached);

    const loaded = await loadAccountMirror('u1', 'local-1');

    expect(loaded).toEqual({ state: account.state, rev: account.rev, adopted: false });
  });
});

describe('DB_VERSION', () => {
  // docs/offline-sync.md's invariant 13. A record written under an older MirrorState shape is not
  // valid input for code written against the new one, and IndexedDB will not touch it on its own —
  // which is exactly what changing the notes payload to `{text, m}` did to a mirror still holding
  // the bare-string form. onupgradeneeded wipes rather than migrates, and that is deliberate: the
  // mirror is a cache of the server plus whatever is still dirty, so the cost is a re-pull.
  it('drops everything stored under an older version rather than handing it to newer code', async () => {
    // A device that last ran an older build: a database at version 1, holding a record written to
    // whatever MirrorState looked like then. The handle is closed before mirrorDb opens its own,
    // since an upgrade blocks while another connection is still open.
    const stale = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('sutamaya', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('mirrors', { keyPath: 'userId' });
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve) => {
      const tx = stale.transaction('mirrors', 'readwrite');
      tx.objectStore('mirrors').put({ userId: 'u1', notes: { dn1: 'a bare string, the shape before {text, m}' } });
      tx.oncomplete = resolve;
    });
    stale.close();

    // Opening at the current DB_VERSION runs mirrorDb's own onupgradeneeded, which deletes the
    // store rather than migrating it — so the newer code never sees the older record at all.
    const { loadMirror } = await freshDb();
    expect(await loadMirror('u1')).toEqual({ state: emptyMirror('u1'), rev: null });
  });
});

describe('without IndexedDB', () => {
  // A locked-down or private-browsing context. Writes then last only for the session, which is
  // what the app did before the mirror existed — rather than the app failing to open at all.
  it('falls back to memory, so the app still works for the session', async () => {
    const original = indexedDB;
    // @ts-expect-error -- deliberately removing the global the module probes for
    indexedDB = undefined;
    try {
      const { loadMirror, writeMirror } = await freshDb();
      await writeMirror(noted('u1', 'session only'), null, unreached);
      expect((await loadMirror('u1')).state.notes.dn1.data.text).toBe('session only');
      expect(await loadMirror('u2')).toEqual({ state: emptyMirror('u2'), rev: null });
    } finally {
      indexedDB = original;
    }
  });

  it('falls back to memory when opening the database throws outright', async () => {
    const original = indexedDB;
    // @ts-expect-error -- a stand-in for a browser that refuses the open call
    indexedDB = {
      open() {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    try {
      const { loadMirror, writeMirror } = await freshDb();
      await writeMirror(noted('u1', 'still kept'), null, unreached);
      expect((await loadMirror('u1')).state.notes.dn1.data.text).toBe('still kept');
    } finally {
      indexedDB = original;
    }
  });
});
