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
  resolveWebOrigin,
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

// Sends the browser off to Google. `?return=` is where to come back to once the flow ends —
// validated through safeReturnPath both on the way out and again on the way back in, since it
// travels through the provider in between.
authRouter.get('/google/start', async (c) => {
  // GoogleSignInButton sends `return` as an absolute URL, so which of the configured origins the
  // user is actually on travels with it — that's what lets one `npm run dev` serve both localhost
  // and the hostname a phone reaches it by. Only origins in WEB_ORIGIN are honoured
  // (resolveWebOrigin), and it's carried through the provider in the signed state so both legs of
  // the flow — and the redirect_uri Google matches — agree on one origin.
  const webOrigin = resolveWebOrigin(c.env.WEB_ORIGIN, c.req.query('return'));

  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    console.error('Google OAuth is not configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are both required.');
    return c.redirect(appUrl(webOrigin, withAuthError('/settings')), 302);
  }

  const nonce = crypto.randomUUID();
  const state = await signState(
    { n: nonce, r: safeReturnPath(c.req.query('return'), webOrigin), o: webOrigin, t: Date.now() },
    c.env.SESSION_SECRET
  );
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', nonceCookie(nonce, { secure }), { append: true });
  return c.redirect(
    googleAuthUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: googleRedirectUri(webOrigin),
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
  // Reassigned below once the state is verified, to whichever origin /google/start issued it for.
  // Until then there's nothing trustworthy saying which one this browser came in on, so failures
  // that early land on the canonical origin.
  let webOrigin = resolveWebOrigin(c.env.WEB_ORIGIN);
  const fail = (reason, returnTo = '/settings') => {
    console.error(`Google OAuth callback failed: ${reason}`);
    c.header('Set-Cookie', clearNonceCookie(), { append: true });
    return c.redirect(appUrl(webOrigin, withAuthError(returnTo)), 302);
  };

  const state = await verifyState(c.req.query('state'), c.env.SESSION_SECRET);
  if (!state) return fail('state was missing, malformed, expired or not issued by us');
  if (!state.n || state.n !== getCookie(c, OAUTH_NONCE_COOKIE)) {
    return fail('state nonce did not match this browser’s cookie');
  }
  webOrigin = resolveWebOrigin(c.env.WEB_ORIGIN, state.o);

  const returnTo = safeReturnPath(state.r, webOrigin);
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
      redirectUri: googleRedirectUri(webOrigin),
    });
    profile = await verifyGoogleCredential(idToken, c.env.GOOGLE_CLIENT_ID);
  } catch (err) {
    return fail(String(err), returnTo);
  }

  const user = await findOrCreateGoogleUser(c.env.DB, profile);
  c.header('Set-Cookie', clearNonceCookie(), { append: true });
  c.header('Set-Cookie', await createSessionCookie(user.id, c.env.SESSION_SECRET, { secure }), { append: true });
  return c.redirect(appUrl(webOrigin, returnTo), 302);
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
  const nowIso = new Date(now).toISOString();
  await c.env.DB.batch([
    // A code requested and never used would otherwise leave its row behind for good, the verify
    // path being the only other place one is removed. Sweeping here costs one statement in a round
    // trip that was happening anyway, and tidies the table exactly when it grows.
    c.env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(nowIso),
    c.env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         attempts = 0, created_at = excluded.created_at`
    ).bind(email, await hashCode(code, email, c.env.SESSION_SECRET), new Date(now + CODE_TTL_MS).toISOString(), nowIso),
  ]);

  try {
    await sendEmail({
      apiKey: c.env.RESEND_API_KEY,
      from: `sutamaya <${c.env.MAIL_FROM}>`,
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
