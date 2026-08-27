import { authApi } from './api';
import { clearScrollMemory } from '../hooks/useScrollMemory';

// `window.__dangerWipeLocal()` — put this device back to a cold, signed-out first run, and reload.
// A development and demo-recording tool: there is no UI for it, and the name is what stops it being
// typed by accident.
//
// Signing out is the first step and the load-bearing one. Wiping local storage alone changes almost
// nothing visible while a session cookie survives: the next load simply pulls /api/data and puts the
// account's lists, notes and highlights straight back.
//
// **Nothing here is a sync operation.** It signs out, then deletes rows; it never marks them
// deleted. That distinction is what keeps it safe to ship: lib/sync.ts pushes rows the mirror still
// holds and marks `dirty`, and a delete travels as a row carrying `deleted: true`. Deleting the
// database leaves nothing to push, so the account on the server is untouched and signing back in
// restores it. Going through the ordinary mutators instead would replicate the erasure to the
// server and to every other device.
//
// What it does destroy for good is local-only work: edits made offline that hadn't synced yet, and
// — signed out, where there is no server copy at all — everything.

declare global {
  interface Window {
    __dangerWipeLocal?: () => string;
  }
}

// Resolves on success, error *or* `blocked` rather than only on success. The mirror holds an open
// connection, so `blocked` is the expected answer: awaiting only `onsuccess` would hang here and the
// reload that closes the connection — and so lets the deletion finish — would never happen.
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

// Every step is independently guarded: this is a reset, so getting most of the way is strictly
// better than stopping at the first thing this browser happens to refuse.
async function wipeLocalData(): Promise<void> {
  // The session first — see the note above on why the rest is close to pointless without it.
  try {
    await authApi.logout();
  } catch (e) {
    console.warn('__dangerWipeLocal: sign-out failed, wiping anyway', e);
  }

  // Before the storage clear, so nothing still in memory can outlive it. The scroll positions in
  // particular would otherwise be written straight back by the `pagehide` that the reload fires.
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

// Bound as a *synchronous* wrapper so it can be called bare in the console. An async function would
// hand back a pending Promise and need `await` in front of every call to read as anything useful.
if (typeof window !== 'undefined') {
  window.__dangerWipeLocal = () => {
    wipeLocalData().then(() => location.reload());
    return 'wiping — the page will reload';
  };
}
