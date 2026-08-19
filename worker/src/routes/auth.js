import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { findOrCreateEmailUser, findOrCreateGoogleUser, findUserById, verifyGoogleCredential } from '../auth.js';
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  codeEmail,
  generateCode,
  hashCode,
  isPlausibleEmail,
  normalizeEmail,
  sendEmail,
  timingSafeEqual,
} from '../emailAuth.js';
import { jsonBody } from '../jsonBody.js';
import {
  OAUTH_NONCE_COOKIE,
  appUrl,
  clearNonceCookie,
  exchangeGoogleCode,
  googleAuthUrl,
  googleRedirectUri,
  nonceCookie,
  safeReturnPath,
  signState,
  verifyState,
  withAuthError,
} from '../oauth.js';
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

// Sends the browser off to Google. `?return=` is where to come back to once the flow ends —
// validated through safeReturnPath both on the way out and again on the way back in, since it
// travels through the provider in between.
authRouter.get('/google/start', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    console.error('Google OAuth is not configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are both required.');
    return c.redirect(appUrl(c.env.WEB_ORIGIN, withAuthError('/settings')), 302);
  }

  const nonce = crypto.randomUUID();
  const state = await signState(
    { n: nonce, r: safeReturnPath(c.req.query('return'), c.env.WEB_ORIGIN), t: Date.now() },
    c.env.SESSION_SECRET
  );
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', nonceCookie(nonce, { secure }), { append: true });
  return c.redirect(
    googleAuthUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: googleRedirectUri(c.env.WEB_ORIGIN),
      state,
    }),
    302
  );
});

// Where Google sends the browser back. Every failure path ends the same way — clear the nonce and
// redirect into the app with ?auth_error=1 — because this is a top-level navigation the user is
// watching, so a JSON error body would strand them on a blank page with no way back.
authRouter.get('/google/callback', async (c) => {
  const secure = new URL(c.req.url).protocol === 'https:';
  const fail = (reason, returnTo = '/settings') => {
    console.error(`Google OAuth callback failed: ${reason}`);
    c.header('Set-Cookie', clearNonceCookie(), { append: true });
    return c.redirect(appUrl(c.env.WEB_ORIGIN, withAuthError(returnTo)), 302);
  };

  const state = await verifyState(c.req.query('state'), c.env.SESSION_SECRET);
  if (!state) return fail('state was missing, malformed, expired or not issued by us');
  if (!state.n || state.n !== getCookie(c, OAUTH_NONCE_COOKIE)) {
    return fail('state nonce did not match this browser’s cookie');
  }

  const returnTo = safeReturnPath(state.r, c.env.WEB_ORIGIN);
  const providerError = c.req.query('error');
  if (providerError) return fail(`Google returned ${providerError}`, returnTo);
  const code = c.req.query('code');
  if (!code) return fail('no authorization code in the callback', returnTo);

  let profile;
  try {
    const idToken = await exchangeGoogleCode({
      code,
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
      redirectUri: googleRedirectUri(c.env.WEB_ORIGIN),
    });
    profile = await verifyGoogleCredential(idToken, c.env.GOOGLE_CLIENT_ID);
  } catch (err) {
    return fail(String(err), returnTo);
  }

  const user = await findOrCreateGoogleUser(c.env.DB, profile);
  c.header('Set-Cookie', clearNonceCookie(), { append: true });
  c.header('Set-Cookie', await createSessionCookie(user.id, c.env.SESSION_SECRET, { secure }), { append: true });
  return c.redirect(appUrl(c.env.WEB_ORIGIN, returnTo), 302);
});

// --- Sign in by emailed code ------------------------------------------------------------------

// Sends a fresh six-digit code, replacing whatever was outstanding for that address. Answers
// {ok:true} for any plausible address whether or not an account exists — an endpoint that says
// otherwise is a way to ask this app which addresses have accounts.
authRouter.post('/email/request', async (c) => {
  const email = normalizeEmail((await jsonBody(c))?.email);
  if (!isPlausibleEmail(email)) return c.json({ error: 'Enter a valid email address.' }, 400);

  const now = Date.now();
  const pending = await c.env.DB.prepare('SELECT created_at FROM login_codes WHERE email = ?').bind(email).first();
  if (pending && now - Date.parse(pending.created_at) < RESEND_COOLDOWN_MS) {
    // Still ok:true — from the user's side a code is on its way, which is true; the one already
    // sent is still valid. Sending a second would only make it ambiguous which to type.
    return c.json({ ok: true });
  }

  const code = generateCode();
  await c.env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, created_at = excluded.created_at`
  )
    .bind(email, await hashCode(code, email, c.env.SESSION_SECRET), new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString())
    .run();

  try {
    await sendEmail({
      apiKey: c.env.RESEND_API_KEY,
      from: `Sutamaya <${c.env.MAIL_FROM}>`,
      to: email,
      message: codeEmail({ code }),
    });
  } catch (err) {
    // The row is already written, so a retry from the user re-sends against the same code rather
    // than stranding them. Reported as a failure because nothing arrived and they'd otherwise sit
    // waiting for mail that isn't coming.
    console.error('Failed to send sign-in code:', err);
    return c.json({ error: 'Could not send the code. Please try again.' }, 502);
  }
  return c.json({ ok: true });
});

// Checks a code and, on success, establishes the session. The account is created here rather than
// at request time, so asking for a code for an address never creates anything.
authRouter.post('/email/verify', async (c) => {
  const body = (await jsonBody(c)) || {};
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isPlausibleEmail(email) || !/^\d{6}$/.test(code)) {
    return c.json({ error: 'Enter the six-digit code from your email.' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind(email).first();
  // One message for every failure below: which of "no code was asked for", "it expired" and "that
  // is the wrong code" applies is not something to tell whoever is typing.
  const reject = () => c.json({ error: 'That code is not valid. Request a new one.' }, 401);
  if (!row) return reject();

  if (Date.parse(row.expires_at) <= Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) {
    await c.env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return reject();
  }

  if (!timingSafeEqual(row.code_hash, await hashCode(code, email, c.env.SESSION_SECRET))) {
    // Counted in the row rather than in a limiter, so the budget belongs to this code and is gone
    // for good when it's spent — a new IP doesn't buy five more guesses at the same code.
    await c.env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    return reject();
  }

  await c.env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
  const user = await findOrCreateEmailUser(c.env.DB, email);
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
