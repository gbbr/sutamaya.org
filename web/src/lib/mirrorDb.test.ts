// A real (in-memory) IndexedDB, since everything worth asserting here is about what the store
// actually does with a record — persisting it across a reload, keying it by account, and throwing
// it away on a version bump. A hand-written stub would only assert the calls this file makes.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMirror, setNoteRecord, type MirrorState } from './mirror';

// mirrorDb caches its open database in a module-level promise, so every test that wants a fresh
// database (or a different version of one) has to re-import the module rather than reuse it.
async function freshDb() {
  vi.resetModules();
  return import('./mirrorDb');
}

// A "reload": the same underlying IndexedDB, a new module instance reading it.
beforeEach(() => {
  indexedDB = new IDBFactory();
});

const noted = (userId: string, text: string): MirrorState => setNoteRecord(emptyMirror(userId), 'dn1', text);

describe('loadMirror / saveMirror', () => {
  it('gives a device that has never held this account an empty mirror rather than failing', async () => {
    const { loadMirror } = await freshDb();
    expect(await loadMirror('u1')).toEqual(emptyMirror('u1'));
  });

  it('reads back what it stored, dirty flags and queue included', async () => {
    const { loadMirror, saveMirror } = await freshDb();
    const state = noted('u1', 'kept offline');

    await saveMirror(state);
    const db = await freshDb();

    expect(await db.loadMirror('u1')).toEqual(state);
  });

  it('keeps two accounts apart, so an account switch cannot cross-write', async () => {
    const { loadMirror, saveMirror } = await freshDb();

    await saveMirror(noted('u1', 'mine'));
    await saveMirror(noted('u2', 'theirs'));

    expect((await loadMirror('u1')).notes.dn1.data.text).toBe('mine');
    expect((await loadMirror('u2')).notes.dn1.data.text).toBe('theirs');
  });

  it('ignores a state with no user id, which has no key to store it under', async () => {
    const { loadMirror, saveMirror } = await freshDb();
    await saveMirror(emptyMirror(null));
    expect(await loadMirror('')).toEqual(emptyMirror(''));
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
    expect(await loadMirror('u1')).toEqual(emptyMirror('u1'));
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
      const { loadMirror, saveMirror } = await freshDb();
      await saveMirror(noted('u1', 'session only'));
      expect((await loadMirror('u1')).notes.dn1.data.text).toBe('session only');
      expect(await loadMirror('u2')).toEqual(emptyMirror('u2'));
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
      const { loadMirror, saveMirror } = await freshDb();
      await saveMirror(noted('u1', 'still kept'));
      expect((await loadMirror('u1')).notes.dn1.data.text).toBe('still kept');
    } finally {
      indexedDB = original;
    }
  });
});
