import crypto from 'node:crypto';
import { usersCol } from './firestore.js';
import { asyncHandler } from './asyncHandler.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === check.length && crypto.timingSafeEqual(stored, check);
}

export async function createUser(email, password) {
  const { salt, hash } = hashPassword(password);
  const ref = await usersCol().add({ email, passwordHash: hash, salt, createdAt: new Date().toISOString() });
  return { id: ref.id, email };
}

export async function findUserByEmail(email) {
  const snap = await usersCol().where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function findUserById(id) {
  const doc = await usersCol().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });
  const user = await findUserById(userId);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  next();
});
