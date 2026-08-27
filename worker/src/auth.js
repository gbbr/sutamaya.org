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

// `users.google_id` is NOT NULL UNIQUE, and dropping the constraint would need a destructive table
// rebuild, which migrations here don't do (docs/deploy.md). An account created by any other
// provider therefore gets an opaque value matching no real Google subject. Read `identities`
// instead.
function placeholderGoogleId() {
  return `no-google:${crypto.randomUUID()}`;
}

async function recordIdentity(db, provider, subject, userId) {
  await db
    .prepare('INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(provider, subject, userId, new Date().toISOString())
    .run();
}

export async function findOrCreateGoogleUser(db, { googleId, email, name, picture }) {
  const existing = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first();
  if (existing) {
    if (name !== existing.name || picture !== existing.picture) {
      await db.prepare('UPDATE users SET name = ?, picture = ? WHERE id = ?').bind(name, picture, existing.id).run();
    }
    await recordIdentity(db, 'google', googleId, existing.id);
    return { id: existing.id, email: existing.email, googleId, name, picture };
  }

  // Google has verified this address, and so has the emailed-code flow for anything it created —
  // so the same address is the same person, and signing in a new way joins the existing account
  // rather than forking a second one holding half the user's lists.
  const byEmail = await db.prepare('SELECT * FROM users WHERE email = ?').bind(normalizeEmailForLookup(email)).first();
  if (byEmail) {
    await db
      .prepare('UPDATE users SET google_id = ?, name = COALESCE(?, name), picture = COALESCE(?, picture) WHERE id = ?')
      .bind(googleId, name, picture, byEmail.id)
      .run();
    await recordIdentity(db, 'google', googleId, byEmail.id);
    return { id: byEmail.id, email: byEmail.email, googleId, name: name ?? byEmail.name, picture: picture ?? byEmail.picture };
  }

  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO users (id, email, google_id, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, normalizeEmailForLookup(email), googleId, name, picture, new Date().toISOString())
    .run();
  await recordIdentity(db, 'google', googleId, id);
  return { id, email: normalizeEmailForLookup(email), googleId, name, picture };
}

// Emails are stored and matched lowercased — `users.email` is uniquely indexed, and two spellings
// of one address must not become two accounts.
function normalizeEmailForLookup(email) {
  return String(email).trim().toLowerCase();
}

// The emailed-code flow's equivalent of findOrCreateGoogleUser: by this point the address is
// proven, so it either names an existing account (whichever way that account was first made) or
// makes one.
export async function findOrCreateEmailUser(db, email) {
  const address = normalizeEmailForLookup(email);
  const existing = await db.prepare('SELECT * FROM users WHERE email = ?').bind(address).first();
  if (existing) {
    await recordIdentity(db, 'email', address, existing.id);
    return rowToUser(existing);
  }

  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO users (id, email, google_id, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, address, placeholderGoogleId(), null, null, new Date().toISOString())
    .run();
  await recordIdentity(db, 'email', address, id);
  return { id, email: address, googleId: null, name: null, picture: null };
}

export async function findUserById(db, id) {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return row ? rowToUser(row) : null;
}

// The session cookie is signed (Hono's HMAC-SHA256 helpers, see session.js), so it's already
// trustworthy without a D1 round trip to confirm the user still exists. Every route gated by
// this only ever reads c.get('userId'); routes that need the full profile fetch it themselves
// via findUserById.
export const requireAuth = async (c, next) => {
  const userId = await readSessionCookie(c.req.raw, c.env.SESSION_SECRET);
  if (!userId) return c.json({ error: 'not_authenticated' }, 401);
  c.set('userId', userId);
  await next();
};
