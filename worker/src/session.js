import { generateSignedCookie } from 'hono/cookie';
import { parseSigned } from 'hono/utils/cookie';

// The cookie holding the signed session.
export const SESSION_COOKIE_NAME = 'sutamaya_session';
// How long a session lasts, in seconds.
const MAX_AGE = 90 * 24 * 60 * 60;

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
