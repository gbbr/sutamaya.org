import { describe, expect, it, vi } from 'vitest';
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionCookie,
  readSessionToken,
  signSessionToken,
  SESSION_COOKIE_NAME,
} from './session.js';

const SECRET = 'test-secret-not-for-prod';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

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

describe('signSessionToken / readSessionToken', () => {
  it('round-trips a userId through a signed bearer token', async () => {
    const token = await signSessionToken('user-1', SECRET);
    const result = await readSessionToken(token, SECRET);
    expect(result).toEqual({ userId: 'user-1', refreshed: null });
  });

  it('returns null for a token signed with a different secret', async () => {
    const token = await signSessionToken('user-1', SECRET);
    expect(await readSessionToken(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for a malformed or empty token', async () => {
    expect(await readSessionToken('', SECRET)).toBeNull();
    expect(await readSessionToken('not.a.token', SECRET)).toBeNull();
    expect(await readSessionToken(undefined, SECRET)).toBeNull();
  });

  it('returns null once the token is older than ninety days', async () => {
    const token = await signSessionToken('user-1', SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + NINETY_DAYS_MS + 1000);
    try {
      expect(await readSessionToken(token, SECRET)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('hands back a fresh token once the presented one is past halfway to expiry', async () => {
    const token = await signSessionToken('user-1', SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + NINETY_DAYS_MS / 2 + 1000);
    try {
      const result = await readSessionToken(token, SECRET);
      expect(result.userId).toBe('user-1');
      expect(result.refreshed).toBeTruthy();
      expect(result.refreshed).not.toBe(token);
      // The re-minted token is stamped now, so reading it straight back triggers no further re-mint.
      expect(await readSessionToken(result.refreshed, SECRET)).toEqual({ userId: 'user-1', refreshed: null });
    } finally {
      vi.restoreAllMocks();
    }
  });
});
