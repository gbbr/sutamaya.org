import { emptyMirror, type MirrorState } from './mirror';

// Durable storage for the mirror. The whole of one account's mirror is a single IndexedDB record
// keyed by user id — the dataset is tens of kilobytes, so a per-record store would buy nothing but
// partial-write hazards, and one `put` per mutation is both atomic and trivially cheap. Keying by
// user id is what stops an account switch from ever reading or overwriting the other account's
// unsynced work.
//
// IndexedDB rather than localStorage because this is durable user data, not a display preference:
// it is written off the main thread, survives a several-megabyte dataset without the 5MB string
// cap, and never blocks paint. Where it isn't available at all (a locked-down or private browsing
// context), the app falls back to an in-memory store: writes then last only for the session, which
// is exactly what the app did before the mirror existed, rather than failing outright.

const DB_NAME = 'sutamaya';
// Bump this whenever MirrorState's shape changes. A record persisted under an older shape isn't
// valid input for code written against the new one — see onupgradeneeded, which wipes rather than
// migrates it, which is safe because the mirror is a cache: the server is the durable copy, so
// losing it costs only a re-pull (and, for anything still dirty, replaying whatever local edits
// hadn't synced yet).
const DB_VERSION = 2;
const STORE = 'mirrors';

const memory = new Map<string, MirrorState>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      // A version bump means the shape changed since whatever wrote the existing store — delete
      // and recreate rather than keep rows a newer MirrorState wasn't written to read.
      if (request.result.objectStoreNames.contains(STORE)) request.result.deleteObjectStore(STORE);
      request.result.createObjectStore(STORE, { keyPath: 'userId' });
    };
    request.onsuccess = () => resolve(request.result);
    // Blocked, disabled, or out of quota — fall back to memory rather than leaving the app with no
    // user data at all.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error);
  });
}

// The account's mirror as it was last saved, or a fresh empty one for a device that has never held
// this account's data. A storage failure is not fatal: an empty mirror repopulates from the first
// pull, so the app opens rather than refusing to.
export async function loadMirror(userId: string): Promise<MirrorState> {
  const db = await openDb();
  if (!db) return memory.get(userId) ?? emptyMirror(userId);
  try {
    const stored = await transact<MirrorState | undefined>(db, 'readonly', (store) => store.get(userId));
    return stored ?? emptyMirror(userId);
  } catch {
    return emptyMirror(userId);
  }
}

export async function saveMirror(state: MirrorState): Promise<void> {
  if (!state.userId) return;
  const db = await openDb();
  if (!db) {
    memory.set(state.userId, state);
    return;
  }
  await transact(db, 'readwrite', (store) => store.put(state));
}

// Drops one id's mirror outright. Two callers, both of which mean "this device is done carrying
// that identity's data": sign-out, where leaving a departed account's notes readable and writable
// on the device is both a privacy leak and a lie about who the app belongs to now, and adoption,
// which has just copied the signed-out mirror onto a real account and would otherwise leave a
// duplicate behind for the next sign-out to resurrect.
export async function deleteMirror(userId: string): Promise<void> {
  memory.delete(userId);
  const db = await openDb();
  if (!db) return;
  try {
    await transact(db, 'readwrite', (store) => store.delete(userId));
  } catch (e) {
    // Nothing downstream depends on this having worked — the record is unreachable either way once
    // the id it was filed under is retired.
    console.error('mirror delete failed', e);
  }
}
