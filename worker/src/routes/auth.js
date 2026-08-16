import { Hono } from 'hono';
import { findOrCreateGoogleUser, findUserById, verifyGoogleCredential } from '../auth.js';
import { jsonBody } from '../jsonBody.js';
import { clearSessionCookie, createSessionCookie, readSessionCookie } from '../session.js';

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    picture: user.picture || null,
  };
}

export const authRouter = new Hono();

authRouter.post('/google', async (c) => {
  const { credential } = (await jsonBody(c)) || {};
  if (typeof credential !== 'string' || !credential) {
    return c.json({ error: 'Missing Google credential.' }, 400);
  }

  let profile;
  try {
    profile = await verifyGoogleCredential(credential, c.env.GOOGLE_CLIENT_ID);
  } catch (err) {
    // Logged here rather than left to the global error handler, since this deliberately
    // returns a generic 401 to the client either way regardless of the underlying cause
    // (expired token, bad signature, audience mismatch, ...).
    console.error('Google credential verification failed:', err);
    return c.json({ error: 'Could not verify Google sign-in.' }, 401);
  }

  const user = await findOrCreateGoogleUser(c.env.DB, profile);
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', await createSessionCookie(user.id, c.env.SESSION_SECRET, { secure }), { append: true });
  return c.json({ user: publicUser(user) });
});

authRouter.post('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie(), { append: true });
  return c.json({ ok: true });
});

authRouter.get('/me', async (c) => {
  const userId = await readSessionCookie(c.req.raw, c.env.SESSION_SECRET);
  const user = userId ? await findUserById(c.env.DB, userId) : null;
  return c.json({ user: user ? publicUser(user) : null });
});
