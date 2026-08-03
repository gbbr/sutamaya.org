import { Router } from 'express';
import { findUserById, verifyGoogleCredential, findOrCreateGoogleUser } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name || null, picture: user.picture || null };
}

export const authRouter = Router();

authRouter.post(
  '/google',
  asyncHandler(async (req, res) => {
    const { credential } = req.body || {};
    if (typeof credential !== 'string' || !credential) {
      return res.status(400).json({ error: 'Missing Google credential.' });
    }
    let profile;
    try {
      profile = await verifyGoogleCredential(credential);
    } catch (err) {
      return res.status(401).json({ error: 'Could not verify Google sign-in.' });
    }
    const user = await findOrCreateGoogleUser(profile);
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
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
    res.json({ user: user ? publicUser(user) : null });
  })
);
