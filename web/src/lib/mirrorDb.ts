import { emptyMirror, upgradeStoredMirror, type MirrorState } from './mirror';

// Durable storage for the mirror: one account's whole mirror as a single IndexedDB record keyed by
// user id, so an account switch can't read or overwrite the other's unsynced work. The dataset is
// tens of kilobytes, so one atomic `put` per mutation is cheap and can't half-write. Where
// IndexedDB isn't available at all, the store falls back to memory and writes last the session.

const DB_NAME = 'sutamaya';
// Bumped whenever MirrorState's shape changes; the upgrade wipes rather than migrates, which costs
// a re-pull plus whatever local edits hadn't synced.
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
      // Recreated rather than migrated: a newer MirrorState wasn't written to read the old rows.
      if (request.result.objectStoreNames.contains(STORE)) request.result.deleteObjectStore(STORE);
      request.result.createObjectStore(STORE, { keyPath: 'userId' });
    };
    request.onsuccess = () => resolve(request.result);
    // Blocked, disabled or out of quota: fall back to memory rather than to no user data at all.
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

// The account's mirror as last saved, or an empty one for a device that has never held it — which
// a storage failure also yields, an empty mirror repopulating from the first pull. Everything
// comes back through upgradeStoredMirror, this being the one door an older build's records enter
// by.
export async function loadMirror(userId: string): Promise<MirrorState> {
  const db = await openDb();
  if (!db) return upgradeStoredMirror(memory.get(userId) ?? emptyMirror(userId));
  try {
    const stored = await transact<MirrorState | undefined>(db, 'readonly', (store) => store.get(userId));
    return upgradeStoredMirror(stored ?? emptyMirror(userId));
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

// Drops one id's mirror outright, for sign-out and for adoption — this device being done carrying
// that identity's data either way.
export async function deleteMirror(userId: string): Promise<void> {
  memory.delete(userId);
  const db = await openDb();
  if (!db) return;
  try {
    await transact(db, 'readwrite', (store) => store.delete(userId));
  } catch (e) {
    // Nothing depends on this having worked: a retired id's record is unreachable either way.
    console.error('mirror delete failed', e);
  }
}
