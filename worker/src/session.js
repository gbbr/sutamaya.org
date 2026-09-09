import { generateSignedCookie } from 'hono/cookie';
import { parseSigned } from 'hono/utils/cookie';
import { signPayload, verifyPayload } from './oauth.js';

// The cookie holding the signed session.
export const SESSION_COOKIE_NAME = 'sutamaya_session';
// How long a session lasts, in seconds. The web cookie's Max-Age and the native token's max age.
const MAX_AGE = 90 * 24 * 60 * 60;
const TOKEN_MAX_AGE_MS = MAX_AGE * 1000;
// A presented token older than this is re-minted and handed back for the client to store, so an
// app opened at least this often is never signed out. See readSessionToken.
const TOKEN_RENEW_AFTER_MS = TOKEN_MAX_AGE_MS / 2;

// Returns the Set-Cookie for a signed session cookie carrying `userId`. `secure` comes from
// whether the request arrived over https, so this works over plain http under `wrangler dev`.
export async function createSessionCookie(userId, secret, { secure = true } = {}) {
  return generateSignedCookie(SESSION_COOKIE_NAME, userId, secret, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE,
    secure,
  });
}

// Returns the userId in a request's signed session cookie, or null if there is none or its
// signature doesn't verify.
export async function readSessionCookie(request, secret) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const parsed = await parseSigned(cookieHeader, secret, SESSION_COOKIE_NAME);
  const value = parsed[SESSION_COOKIE_NAME];
  return typeof value === 'string' ? value : null;
}

// Returns the Set-Cookie that expires the session cookie.
export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

// Returns a signed bearer token carrying `userId` — the credential a Capacitor client sends in an
// Authorization header, the WebView no longer sharing an origin with the Worker for the cookie to
// ride. Same HMAC as the OAuth state; no database, no revocation list.
export function signSessionToken(userId, secret) {
  return signPayload({ uid: userId, t: Date.now() }, secret);
}

// Reads a bearer token. Returns `{ userId, refreshed }` — `refreshed` a freshly minted token when
// the presented one is past halfway to expiry, else null — or null if it does not verify or has
// aged out past TOKEN_MAX_AGE_MS. Re-minting on use is what keeps an active app signed in
// indefinitely while an untouched one still lapses after ~90 days into the existing re-auth path.
export async function readSessionToken(token, secret) {
  const payload = await verifyPayload(token, secret, TOKEN_MAX_AGE_MS);
  if (!payload || typeof payload.uid !== 'string') return null;
  const refreshed =
    Date.now() - payload.t > TOKEN_RENEW_AFTER_MS ? await signSessionToken(payload.uid, secret) : null;
  return { userId: payload.uid, refreshed };
}
