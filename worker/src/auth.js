import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readSessionCookie } from './session.js';

// Google's public keys, cached for the life of the isolate and re-fetched only on an unseen key id.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Verifies a Google id_token and returns the profile in it. Throws if it doesn't verify or the
// address is unconfirmed.
export async function verifyGoogleCredential(credential, clientId) {
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });
  if (!payload.email_verified) throw new Error('Google account email is not verified.');
  return { googleId: payload.sub, email: payload.email, name: payload.name || null, picture: payload.picture || null };
}

// Maps a users row to the shape the app uses.
function rowToUser(row) {
  return { id: row.id, email: row.email, googleId: row.google_id, name: row.name, picture: row.picture };
}

// Returns a value for `users.google_id`, which is NOT NULL UNIQUE, on an account made another way.
// It matches no real Google subject; `identities` is the authoritative record.
function placeholderGoogleId() {
  return `no-google:${crypto.randomUUID()}`;
}

// Records how an account can be signed into, ignoring an identity already on file.
async function recordIdentity(db, provider, subject, userId) {
  await db
    .prepare('INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(provider, subject, userId, new Date().toISOString())
    .run();
}

// Returns the account for a verified Google profile, creating it if it is new.
export async function findOrCreateGoogleUser(db, { googleId, email, name, picture }) {
  const existing = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first();
  if (existing) {
    if (name !== existing.name || picture !== existing.picture) {
      await db.prepare('UPDATE users SET name = ?, picture = ? WHERE id = ?').bind(name, picture, existing.id).run();
    }
    await recordIdentity(db, 'google', googleId, existing.id);
    return { id: existing.id, email: existing.email, googleId, name, picture };
  }

  // Both flows verify the address, so an account already holding it is joined rather than forked.
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

// Lowercases and trims an address, the form every account is stored and matched under.
function normalizeEmailForLookup(email) {
  return String(email).trim().toLowerCase();
}

// Returns the account for an address the emailed-code flow has proven, creating it if it is new.
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

// Returns the account with this id, or null.
export async function findUserById(db, id) {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return row ? rowToUser(row) : null;
}

// Rejects a request with no valid session and otherwise sets `userId` on the context. The cookie
// is signed, so nothing is read from D1 here; a route needing the profile calls findUserById.
export const requireAuth = async (c, next) => {
  const userId = await readSessionCookie(c.req.raw, c.env.SESSION_SECRET);
  if (!userId) return c.json({ error: 'not_authenticated' }, 401);
  c.set('userId', userId);
  await next();
};
