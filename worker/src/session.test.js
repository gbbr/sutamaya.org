import { describe, expect, it } from 'vitest';
import { clearSessionCookie, createSessionCookie, readSessionCookie, SESSION_COOKIE_NAME } from './session.js';

const SECRET = 'test-secret-not-for-prod';

function requestWithCookie(cookieHeader) {
  return new Request('https://x/', { headers: cookieHeader ? { Cookie: cookieHeader } : {} });
}

describe('createSessionCookie / readSessionCookie', () => {
  it('round-trips a userId through a signed cookie', async () => {
    const setCookie = await createSessionCookie('user-1', SECRET);
    const cookiePair = setCookie.split(';')[0]; // "sutamaya_session=<value>"
    const userId = await readSessionCookie(requestWithCookie(cookiePair), SECRET);
    expect(userId).toBe('user-1');
  });

  it('sets the expected cookie attributes', async () => {
    const setCookie = await createSessionCookie('user-1', SECRET, { secure: true });
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Max-Age=7776000');
  });

  it('omits Secure when the request came in over plain http', async () => {
    const setCookie = await createSessionCookie('user-1', SECRET, { secure: false });
    expect(setCookie).not.toContain('Secure');
  });

  it('returns null when there is no cookie header', async () => {
    expect(await readSessionCookie(requestWithCookie(undefined), SECRET)).toBeNull();
  });

  it('returns null when the cookie was signed with a different secret', async () => {
    const setCookie = await createSessionCookie('user-1', SECRET);
    const cookiePair = setCookie.split(';')[0];
    expect(await readSessionCookie(requestWithCookie(cookiePair), 'wrong-secret')).toBeNull();
  });

  it('returns null for a tampered cookie value', async () => {
    const setCookie = await createSessionCookie('user-1', SECRET);
    const [name] = setCookie.split('=');
    const tampered = `${name}=not-a-real-signed-value`;
    expect(await readSessionCookie(requestWithCookie(tampered), SECRET)).toBeNull();
  });
});

describe('clearSessionCookie', () => {
  it('expires the cookie immediately', () => {
    const cleared = clearSessionCookie();
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain('Max-Age=0');
  });
});
