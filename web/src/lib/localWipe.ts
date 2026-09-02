import { authApi } from './api';
import { clearScrollMemory } from '../hooks/useScrollMemory';

// `window.__dangerWipeLocal()` — puts this device back to a cold, signed-out first run and
// reloads. A development and demo-recording tool, with no UI; the name is what keeps it from being
// typed by accident.
//
// It signs out first, which is load-bearing: while a session cookie survives, the next load pulls
// /api/data and puts the account's data straight back.
//
// **Nothing here is a sync operation.** It deletes rows rather than marking them deleted, so
// there is nothing left for a flush to push and the account on the server is untouched — signing
// back in restores it. What it destroys for good is local-only work: offline edits that hadn't
// synced, and, signed out, everything.

declare global {
  interface Window {
    __dangerWipeLocal?: () => string;
  }
}

// Deletes one IndexedDB database, resolving on `blocked` as well as on success or error: the
// mirror holds an open connection, so blocked is the expected answer, and it is the reload that
// closes the connection and lets the deletion finish.
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch {
      return resolve();
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

// Clears the session, service worker, caches, IndexedDB and both storages. Every step is guarded
// on its own, so a browser refusing one still gets the rest of the reset.
async function wipeLocalData(): Promise<void> {
  // The session first: the rest is close to pointless without it.
  try {
    await authApi.logout();
  } catch (e) {
    console.warn('__dangerWipeLocal: sign-out failed, wiping anyway', e);
  }

  // Before the storage clear, or the reload's `pagehide` writes the scroll positions straight back.
  clearScrollMemory();

  try {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      await registration.unregister();
    }
  } catch (e) {
    console.warn('__dangerWipeLocal: service worker unregister failed', e);
  }

  try {
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  } catch (e) {
    console.warn('__dangerWipeLocal: cache clear failed', e);
  }

  try {
    const databases = (await indexedDB.databases()) ?? [];
    await Promise.all(databases.map((db) => (db.name ? deleteDatabase(db.name) : Promise.resolve())));
  } catch (e) {
    console.warn('__dangerWipeLocal: indexedDB clear failed', e);
  }

  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.warn('__dangerWipeLocal: storage clear failed', e);
  }
}

// Bound as a synchronous wrapper, so it can be called bare in the console rather than awaited.
if (typeof window !== 'undefined') {
  window.__dangerWipeLocal = () => {
    // Lands on "/" rather than reloading in place, a cold start meaning the first-visit route
    // rather than wherever the console happened to be open.
    wipeLocalData().then(() => location.replace('/'));
    return 'wiping — the page will reload at /';
  };
}
