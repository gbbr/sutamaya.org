import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appUrl,
  clearNonceCookie,
  googleAuthUrl,
  googleRedirectUri,
  nonceCookie,
  OAUTH_NONCE_COOKIE,
  safeReturnPath,
  signState,
  verifyState,
  withAuthError,
} from './oauth.js';

const SECRET = 'test-secret-not-for-prod';
const WEB_ORIGIN = 'https://sutamaya.org';

afterEach(() => {
  vi.useRealTimers();
});

describe('signState / verifyState', () => {
  it('round-trips a payload', async () => {
    const state = await signState({ n: 'nonce-1', r: '/settings', t: Date.now() }, SECRET);
    expect(await verifyState(state, SECRET)).toMatchObject({ n: 'nonce-1', r: '/settings' });
  });

  it('rejects a state signed with a different secret', async () => {
    const state = await signState({ n: 'n', r: '/', t: Date.now() }, SECRET);
    expect(await verifyState(state, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const state = await signState({ n: 'n', r: '/settings', t: Date.now() }, SECRET);
    const [, signature] = state.split('.');
    const forged = `${btoa(JSON.stringify({ n: 'n', r: '/evil', t: Date.now() }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}.${signature}`;
    expect(await verifyState(forged, SECRET)).toBeNull();
  });

  it('rejects a state older than ten minutes', async () => {
    const state = await signState({ n: 'n', r: '/', t: Date.now() }, SECRET);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await verifyState(state, SECRET)).toBeNull();
  });

  it.each([undefined, '', 'not-a-state', 'a.b', '.'])('rejects malformed input %o', async (input) => {
    expect(await verifyState(input, SECRET)).toBeNull();
  });
});

describe('safeReturnPath', () => {
  it('keeps a same-origin path with its query and hash', () => {
    expect(safeReturnPath('/browse/dn/dn1?x=1#seg', WEB_ORIGIN)).toBe('/browse/dn/dn1?x=1#seg');
  });

  it('keeps a path given as a same-origin absolute URL', () => {
    expect(safeReturnPath(`${WEB_ORIGIN}/settings`, WEB_ORIGIN)).toBe('/settings');
  });

  // The open-redirect cases: anything that would send the browser off our own origin collapses
  // to '/', since this value arrives from a query parameter the attacker controls.
  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    undefined,
    null,
    42,
  ])('refuses %o', (candidate) => {
    expect(safeReturnPath(candidate, WEB_ORIGIN)).toBe('/');
  });
});

describe('withAuthError', () => {
  it('adds the marker to a bare path', () => {
    expect(withAuthError('/settings')).toBe('/settings?auth_error=1');
  });

  it('appends to a path that already has a query', () => {
    expect(withAuthError('/browse/dn?q=x')).toBe('/browse/dn?q=x&auth_error=1');
  });

  it('keeps the hash last', () => {
    expect(withAuthError('/read/dn1#seg')).toBe('/read/dn1?auth_error=1#seg');
  });
});

describe('urls and cookies', () => {
  it('builds app URLs without doubling the slash', () => {
    expect(appUrl('https://sutamaya.org/', '/settings')).toBe('https://sutamaya.org/settings');
  });

  it('points the redirect URI at the callback route', () => {
    expect(googleRedirectUri(WEB_ORIGIN)).toBe('https://sutamaya.org/api/auth/google/callback');
  });

  it('builds an authorization URL carrying the state and our redirect URI', () => {
    const url = new URL(googleAuthUrl({ clientId: 'cid', redirectUri: googleRedirectUri(WEB_ORIGIN), state: 'st' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sutamaya.org/api/auth/google/callback');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('scopes the nonce cookie to /api/auth and keeps it HttpOnly and Lax', () => {
    const cookie = nonceCookie('n1', { secure: true });
    expect(cookie).toContain(`${OAUTH_NONCE_COOKIE}=n1`);
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(nonceCookie('n1', { secure: false })).not.toContain('Secure');
    expect(clearNonceCookie()).toContain('Max-Age=0');
  });
});
