import { OAuth2Client } from 'google-auth-library';
import { usersCol } from './firestore.js';
import { asyncHandler } from './asyncHandler.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('GOOGLE_CLIENT_ID is not configured on the server.');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.email_verified) throw new Error('Google account email is not verified.');
  return { googleId: payload.sub, email: payload.email, name: payload.name || null, picture: payload.picture || null };
}

export async function findOrCreateGoogleUser({ googleId, email, name, picture }) {
  const existing = await usersCol().where('googleId', '==', googleId).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    const data = doc.data();
    if (name !== data.name || picture !== data.picture) await doc.ref.update({ name, picture });
    return { id: doc.id, ...data, name, picture };
  }
  const ref = await usersCol().add({ email, googleId, name, picture, createdAt: new Date().toISOString() });
  return { id: ref.id, email, googleId, name, picture };
}

export async function findUserById(id) {
  const doc = await usersCol().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// `req.session.userId` is only ever set by POST /api/auth/google after Google's own credential
// verification (routes/auth.js), and the session cookie itself is signed (cookie-session) — so
// it's already trustworthy without a Firestore round trip to confirm the user still exists.
// Every route gated by this middleware (lists.js, data.js, annotations.js) only ever reads
// `req.user.id`; routes that need the full profile (email/name/picture) — GET /me,
// GET /api/data/export — fetch it themselves via findUserById instead of paying for it here on
// every single authenticated request, including the GET /api/data call fired on every app load
// and after every optimistic-update resync.
export const requireAuth = asyncHandler(async (req, res, next) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });
  req.user = { id: userId };
  next();
});
