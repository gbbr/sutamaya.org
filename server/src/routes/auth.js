import { Router } from 'express';
import { createUser, findUserByEmail, verifyPassword, findUserById } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const authRouter = Router();

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Enter a valid email and a password of at least 6 characters.' });
    }
    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const user = await createUser(email, password);
    req.session.userId = user.id;
    res.json({ user });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await findUserByEmail(email || '');
    if (!user || !verifyPassword(password || '', user.salt, user.passwordHash)) {
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email } });
  })
);

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const userId = req.session && req.session.userId;
    const user = userId ? await findUserById(userId) : null;
    res.json({ user: user ? { id: user.id, email: user.email } : null });
  })
);
