// crypto.randomUUID() exists only in secure contexts (https, or http on localhost), so plain http
// on a LAN IP — the dev server opened from a phone — doesn't have it, and calling it throws. The
// fallback isn't cryptographic; these ids need to be unique, not unguessable.
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
