import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readSessionCookie } from './session.js';

// Reused across requests within an isolate — createRemoteJWKSet caches Google's public keys and
// only re-fetches them (from this same resolver) when a key id it hasn't seen before shows up.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyGoogleCredential(credential, clientId) {
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });
  if (!payload.email_verified) throw new Error('Google account email is not verified.');
  return { googleId: payload.sub, email: payload.email, name: payload.name || null, picture: payload.picture || null };
}

function rowToUser(row) {
  return { id: row.id, email: row.email, googleId: row.google_id, name: row.name, picture: row.picture };
}

export async function findOrCreateGoogleUser(db, { googleId, email, name, picture }) {
  const existing = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first();
  if (existing) {
    if (name !== existing.name || picture !== existing.picture) {
      await db.prepare('UPDATE users SET name = ?, picture = ? WHERE id = ?').bind(name, picture, existing.id).run();
    }
    return { id: existing.id, email: existing.email, googleId, name, picture };
  }
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO users (id, email, google_id, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email, googleId, name, picture, new Date().toISOString())
    .run();
  return { id, email, googleId, name, picture };
}

export async function findUserById(db, id) {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return row ? rowToUser(row) : null;
}

// The session cookie is signed (Hono's HMAC-SHA256 helpers, see session.js), so it's already
// trustworthy without a D1 round trip to confirm the user still exists — same reasoning as
// server/src/auth.js's requireAuth. Every route gated by this only ever reads c.get('userId');
// routes that need the full profile fetch it themselves via findUserById.
export const requireAuth = async (c, next) => {
  const userId = await readSessionCookie(c.req.raw, c.env.SESSION_SECRET);
  if (!userId) return c.json({ error: 'not_authenticated' }, 401);
  c.set('userId', userId);
  await next();
};
