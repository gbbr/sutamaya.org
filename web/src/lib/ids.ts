// A unique id. crypto.randomUUID() exists only in a secure context, which plain http on a LAN IP —
// the dev server opened from a phone — is not, so there is a fallback; it isn't cryptographic,
// these ids needing to be unique rather than unguessable.
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
