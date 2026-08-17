// crypto.randomUUID() only exists in secure contexts (https, or http on localhost) — plain http on
// a LAN IP (e.g. opening the dev server from a phone) has no crypto.randomUUID, and calling it
// throws. That is a real way to run this app, and the callers here are load-bearing: the id a
// highlight group is named by, this device's own id, the id one navigate() call is told apart by.
// The fallback isn't cryptographic; none of those need unguessable, only unique.
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
