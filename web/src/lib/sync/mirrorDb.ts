import { adoptMirror, emptyMirror, hasContent, type MirrorState } from './mirror';
import { randomId } from '../ids';

// Durable storage for the mirror: one account's whole mirror as a single IndexedDB record keyed by
// user id, so an account switch can't read or overwrite the other's unsynced work. Every tab reads
// and writes the same record (docs/offline-sync.md's "Tabs"), so a write reads it again in the same
// transaction and checks its revision first. The dataset is tens of kilobytes, so a read and a
// `put` per mutation is cheap and can't half-write. Where IndexedDB isn't available at all, the
// store falls back to memory and writes last the session.

const DB_NAME = 'sutamaya';
// The mirror's IndexedDB version; an upgrade wipes the mirror (CLAUDE.md's "Rules that span files").
const DB_VERSION = 2;
const STORE = 'mirrors';

// A mirror as IndexedDB holds it: the state, and the revision its last write left.
type MirrorRecord = MirrorState & { rev?: string };

// A mirror as read or written. `rev` is a fresh id per write, which a writer compares to tell
// whether another tab has written since it read: null for a mirror never stored, empty for a
// record stored without one.
export interface StoredMirror {
  state: MirrorState;
  rev: string | null;
}

const memory = new Map<string, MirrorRecord>();

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

// Runs `run` in one read-write transaction, resolving with what it returns once the transaction
// has committed.
function transactWrite<T>(db: IDBDatabase, run: (store: IDBObjectStore, done: (result: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    let result: T;
    run(tx.objectStore(STORE), (r) => {
      result = r;
    });
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
  });
}

function fromRecord(record: MirrorRecord | undefined, userId: string): StoredMirror {
  if (!record) return { state: emptyMirror(userId), rev: null };
  const { rev = '', ...state } = record;
  return { state, rev };
}

// The account's mirror as last saved, or an empty one for a device that has never held it — which
// a storage failure also yields, an empty mirror repopulating from the first pull. Records come
// back as they were stored: a highlight anchored on segment positions is re-anchored when its
// sutta's text loads (mirror.ts's anchorHighlights), that text being what the conversion needs and
// nothing here has.
export async function loadMirror(userId: string): Promise<StoredMirror> {
  const db = await openDb();
  if (!db) return fromRecord(memory.get(userId), userId);
  try {
    return fromRecord(await transact<MirrorRecord | undefined>(db, 'readonly', (store) => store.get(userId)), userId);
  } catch {
    return { state: emptyMirror(userId), rev: null };
  }
}

// Writes `state`, read at revision `rev`, and returns what was written under its new revision.
// Where another tab has written since, `rebase` is given that tab's save and its result is written
// instead, so neither tab's changes are lost. A mirror no longer stored is written as it stands.
export async function writeMirror(
  state: MirrorState,
  rev: string | null,
  rebase: (stored: MirrorState) => MirrorState
): Promise<StoredMirror & { rev: string }> {
  const next = randomId();
  const userId = state.userId;
  if (!userId) return { state, rev: next };
  const decide = (record: MirrorRecord | undefined): MirrorState =>
    !record || (record.rev ?? '') === rev ? state : rebase(fromRecord(record, userId).state);
  const db = await openDb();
  if (!db) {
    const written = decide(memory.get(userId));
    memory.set(userId, { ...written, rev: next });
    return { state: written, rev: next };
  }
  return transactWrite(db, (store, done) => {
    const read = store.get(userId);
    read.onsuccess = () => {
      const written = decide(read.result);
      store.put({ ...written, rev: next });
      done({ state: written, rev: next });
    };
  });
}

// Reads an account's mirror, first moving onto it whatever the signed-out mirror `localId` holds,
// in one transaction, so no tab writes either in between. `adopted` says whether anything moved.
export async function loadAccountMirror(
  accountId: string,
  localId: string
): Promise<StoredMirror & { adopted: boolean }> {
  const adopt = (account: MirrorRecord | undefined, local: MirrorRecord | undefined) => {
    const current = fromRecord(account, accountId);
    const signedOut = fromRecord(local, localId).state;
    if (!hasContent(signedOut)) return { ...current, adopted: false };
    return { state: adoptMirror(current.state, signedOut), rev: randomId(), adopted: true };
  };
  const db = await openDb();
  if (!db) {
    const loaded = adopt(memory.get(accountId), memory.get(localId));
    if (loaded.adopted) {
      memory.set(accountId, { ...loaded.state, rev: loaded.rev! });
      memory.delete(localId);
    }
    return loaded;
  }
  return transactWrite(db, (store, done) => {
    const account = store.get(accountId);
    const local = store.get(localId);
    // Requests on one store complete in order, so the account's has landed by now.
    local.onsuccess = () => {
      const loaded = adopt(account.result, local.result);
      if (loaded.adopted) {
        store.put({ ...loaded.state, rev: loaded.rev! });
        store.delete(localId);
      }
      done(loaded);
    };
  });
}

// Drops one id's mirror outright, for sign-out — this device being done carrying that identity's
// data.
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
