import { env } from 'cloudflare:test';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// Sign in with Apple end to end against D1, with Apple itself played by a stubbed fetch: a real
// ES256 key signs the id_tokens, and its public half is served as Apple's key set.

const SERVICES_ID = 'org.sutamaya.web';
const APP_CLIENT_ID = 'org.sutamaya.app';
let appleKey;
let appleJwk;
let signingKeyPem;
let APPLE_ENV;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  appleKey = pair.privateKey;
  appleJwk = { ...(await exportJWK(pair.publicKey)), kid: 'apple-test', alg: 'ES256', use: 'sig' };
  signingKeyPem = await exportPKCS8((await generateKeyPair('ES256', { extractable: true })).privateKey);
  APPLE_ENV = {
    ...env,
    WEB_ORIGIN: 'https://app.sutamaya.org',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: signingKeyPem,
    APPLE_SERVICES_ID: SERVICES_ID,
  };
});

// Returns an Apple id_token for `claims`, issued to `aud`.
function idToken(claims, aud) {
  return new SignJWT({ email_verified: 'true', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'apple-test' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(appleKey);
}

// Stubs Apple's key set, token and revoke endpoints. The token endpoint answers `tokenFor(body)`.
function stubApple(tokenFor) {
  const fetchMock = vi.fn(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://appleid.apple.com/auth/keys') return Response.json({ keys: [appleJwk] });
    const body = new URLSearchParams(String(init?.body ?? ''));
    if (url === 'https://appleid.apple.com/auth/token') return Response.json(await tokenFor(body));
    if (url === 'https://appleid.apple.com/auth/revoke') return new Response(null, { status: 200 });
    return new Response('unexpected', { status: 500 });
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function cookies(res) {
  return res.headers.getSetCookie();
}

function sessionCookieFrom(res) {
  const cookie = cookies(res).find((c) => c.startsWith('sutamaya_session=') && !c.includes('Max-Age=0'));
  return cookie ? cookie.split(';')[0] : undefined;
}

// Drives the website's round trip: start, then Apple's cross-site form POST carrying the state and
// the nonce cookie the start handed out.
async function webSignIn(claims, { user, returnTo = '/settings' } = {}) {
  const start = await app.request(`/api/auth/apple/start?return=${encodeURIComponent(returnTo)}`, {}, APPLE_ENV);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const nonce = cookies(start).find((c) => c.startsWith('sutamaya_oauth=')).split(';')[0];
  stubApple(async () => ({ id_token: await idToken(claims, SERVICES_ID), refresh_token: `rt-${claims.sub}` }));
  const form = new URLSearchParams({ state, code: 'web-code' });
  if (user) form.set('user', JSON.stringify(user));
  return app.request(
    '/api/auth/apple/callback',
    { method: 'POST', headers: { Cookie: nonce, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form },
    APPLE_ENV
  );
}

async function me(cookie) {
  const res = await app.request('/api/auth/me', { headers: { Cookie: cookie } }, APPLE_ENV);
  return (await res.json()).user;
}

describe('Sign in with Apple', () => {
  const realFetch = globalThis.fetch;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    consoleErrorSpy.mockRestore();
  });

  it('starts at Apple with a form-post response and a cross-site nonce cookie', async () => {
    const res = await app.request('https://app.sutamaya.org/api/auth/apple/start?return=%2Fsettings', {}, APPLE_ENV);
    const location = new URL(res.headers.get('Location'));
    expect(location.origin + location.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(location.searchParams.get('client_id')).toBe(SERVICES_ID);
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.sutamaya.org/api/auth/apple/callback');
    expect(cookies(res).find((c) => c.startsWith('sutamaya_oauth='))).toMatch(/SameSite=None; Secure/);
  });

  it('signs in a new reader on the website, taking the name from the first sign-in', async () => {
    const res = await webSignIn(
      { sub: 'apple-web-1', email: 'web1@example.com' },
      { user: { name: { firstName: 'Ann', lastName: 'Reader' } }, returnTo: '/browse' }
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('https://app.sutamaya.org/browse');
    expect(await me(sessionCookieFrom(res))).toMatchObject({ email: 'web1@example.com', name: 'Ann Reader' });

    const identity = await env.DB.prepare("SELECT client_id, refresh_token FROM identities WHERE provider = 'apple' AND subject = ?")
      .bind('apple-web-1')
      .first();
    expect(identity).toEqual({ client_id: SERVICES_ID, refresh_token: 'rt-apple-web-1' });
  });

  it('joins the account that already holds the verified address', async () => {
    const userId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users (id, email, google_id, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, 'joined@example.com', `google-${userId}`, 'Existing Name', new Date().toISOString())
      .run();
    const res = await webSignIn({ sub: 'apple-join', email: 'Joined@Example.com' }, { user: { name: { firstName: 'Other' } } });
    expect(await me(sessionCookieFrom(res))).toMatchObject({ id: userId, name: 'Existing Name' });
  });

  it('gives a Hide My Email address an account of its own, and finds it again without the address', async () => {
    const first = await webSignIn({ sub: 'apple-hidden', email: 'abc123@privaterelay.appleid.com' });
    const firstUser = await me(sessionCookieFrom(first));
    const again = await webSignIn({ sub: 'apple-hidden' });
    expect((await me(sessionCookieFrom(again))).id).toBe(firstUser.id);
  });

  it('returns a reader who backed out at Apple without an error', async () => {
    const start = await app.request('/api/auth/apple/start?return=%2Fbrowse', {}, APPLE_ENV);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const nonce = cookies(start).find((c) => c.startsWith('sutamaya_oauth=')).split(';')[0];
    const res = await app.request(
      '/api/auth/apple/callback',
      {
        method: 'POST',
        headers: { Cookie: nonce, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state, error: 'user_cancelled_authorize' }),
      },
      APPLE_ENV
    );
    expect(res.headers.get('Location')).toBe('https://app.sutamaya.org/browse');
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  it('refuses a callback without the nonce cookie its state was issued with', async () => {
    const start = await app.request('/api/auth/apple/start', {}, APPLE_ENV);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const res = await app.request(
      '/api/auth/apple/callback',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state, code: 'web-code' }),
      },
      APPLE_ENV
    );
    expect(res.headers.get('Location')).toMatch(/auth_error=1/);
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  it('signs in the iOS app from the sheet’s code, checking the token was issued to the app', async () => {
    const fetchMock = stubApple(async (body) => {
      expect(body.get('client_id')).toBe(APP_CLIENT_ID);
      expect(body.has('redirect_uri')).toBe(false);
      return { id_token: await idToken({ sub: 'apple-ios-1', email: 'ios1@example.com' }, APP_CLIENT_ID), refresh_token: 'rt-ios' };
    });
    const res = await app.request(
      '/api/auth/apple/native',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'ios-code', givenName: 'Ian' }) },
      APPLE_ENV
    );
    expect(res.status).toBe(200);
    const { user, token } = await res.json();
    expect(user).toMatchObject({ email: 'ios1@example.com', name: 'Ian' });
    expect(token).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('redeems a code for the development copy of the app under its own bundle id, and no one else’s', async () => {
    const clients = [];
    stubApple(async (body) => {
      clients.push(body.get('client_id'));
      return { id_token: await idToken({ sub: 'apple-dev-1', email: 'dev1@example.com' }, body.get('client_id')) };
    });
    const signIn = (clientId) =>
      app.request(
        '/api/auth/apple/native',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c', clientId }) },
        APPLE_ENV
      );
    expect((await signIn('org.sutamaya.app.dev')).status).toBe(200);
    await signIn('com.example.other');
    expect(clients).toEqual(['org.sutamaya.app.dev', APP_CLIENT_ID]);
  });

  it('refuses an iOS sign-in whose token was issued to the website', async () => {
    stubApple(async () => ({ id_token: await idToken({ sub: 'apple-ios-2', email: 'ios2@example.com' }, SERVICES_ID) }));
    const res = await app.request(
      '/api/auth/apple/native',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'ios-code' }) },
      APPLE_ENV
    );
    expect(res.status).toBe(401);
  });

  it('revokes the Apple token with the client it was issued to when the account is deleted', async () => {
    const signIn = await webSignIn({ sub: 'apple-delete', email: 'delete@example.com' });
    const { id } = await me(sessionCookieFrom(signIn));
    const fetchMock = stubApple(async () => ({}));
    const res = await app.request(
      '/api/auth/account',
      { method: 'DELETE', headers: { Cookie: (await createSessionCookie(id, env.SESSION_SECRET)).split(';')[0] } },
      APPLE_ENV
    );
    expect(res.status).toBe(200);
    const revoke = fetchMock.mock.calls.find(([url]) => String(url) === 'https://appleid.apple.com/auth/revoke');
    const body = new URLSearchParams(String(revoke[1].body));
    expect(body.get('token')).toBe('rt-apple-delete');
    expect(body.get('client_id')).toBe(SERVICES_ID);
    expect(await env.DB.prepare('SELECT 1 FROM identities WHERE user_id = ?').bind(id).first()).toBeNull();
  });
});
