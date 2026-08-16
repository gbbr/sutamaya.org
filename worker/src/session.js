import { generateSignedCookie } from 'hono/cookie';
import { parseSigned } from 'hono/utils/cookie';

export const SESSION_COOKIE_NAME = 'sutamaya_session';
const MAX_AGE = 90 * 24 * 60 * 60; // seconds — mirrors server/src/index.js's cookie-session maxAge

// Builds the Set-Cookie header value for a signed session cookie carrying `userId` (HMAC-SHA256
// via Web Crypto, through Hono's own cookie helpers). `secure` mirrors server/src/index.js's
// `secure: isProd` — the caller derives it from whether the request came in over https, so this
// still works over plain http under `wrangler dev`.
export async function createSessionCookie(userId, secret, { secure = true } = {}) {
  return generateSignedCookie(SESSION_COOKIE_NAME, userId, secret, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE,
    secure,
  });
}

// Reads and verifies the signed session cookie off `request`, returning the userId or null (no
// cookie, or a signature that fails verification — parseSigned returns `false` for that case).
export async function readSessionCookie(request, secret) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const parsed = await parseSigned(cookieHeader, secret, SESSION_COOKIE_NAME);
  const value = parsed[SESSION_COOKIE_NAME];
  return typeof value === 'string' ? value : null;
}

// Set-Cookie header value that clears the session cookie (logout) — same name/path/flags, expired.
export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}
