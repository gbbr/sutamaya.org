import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// See worker/src/auth.test.js's comment on vi.resetModules()/vi.doMock() — same workaround,
// same reason (cloudflare/workers-sdk#10201).
const jwtVerify = vi.fn();

beforeEach(() => {
  vi.resetModules();
  jwtVerify.mockReset();
  vi.doMock('jose', () => ({
    createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
    jwtVerify,
  }));
});

afterEach(() => {
  vi.doUnmock('jose');
});

function mockPayload(overrides = {}) {
  return {
    sub: 'google-sub-1',
    email: 'reader@example.com',
    email_verified: true,
    name: 'Ann Reader',
    picture: 'https://example.com/pic.jpg',
    ...overrides,
  };
}

function cookieFrom(res) {
  const setCookie = res.headers.get('Set-Cookie');
  return setCookie ? setCookie.split(';')[0] : undefined;
}

describe('routes/auth.js (D1, real signed cookies)', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // routes/auth.js deliberately console.errors on a failed credential verification (see its
    // own comment) — expected here since a couple of tests below exercise exactly that
    // rejection path; silence it so a passing run doesn't print what looks like an error.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('GET /me returns a null user for a signed-out request', async () => {
    const { default: app } = await import('../index.js');
    const res = await app.request('/api/auth/me', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('POST /google with a missing credential returns 400 without verifying anything', async () => {
    const { default: app } = await import('../index.js');
    const res = await app.request('/api/auth/google', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }, env);
    expect(res.status).toBe(400);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('signs in a new Google user, sets the session cookie, and GET /me reflects it', async () => {
    const { default: app } = await import('../index.js');
    jwtVerify.mockResolvedValue({ payload: mockPayload() });

    const signIn = await app.request(
      '/api/auth/google',
      { method: 'POST', body: JSON.stringify({ credential: 'tok' }), headers: { 'Content-Type': 'application/json' } },
      env
    );
    expect(signIn.status).toBe(200);
    const signInBody = await signIn.json();
    expect(signInBody.user).toMatchObject({ email: 'reader@example.com', name: 'Ann Reader', picture: 'https://example.com/pic.jpg' });
    expect(signInBody.user.googleId).toBeUndefined(); // publicUser() strips it
    const cookie = cookieFrom(signIn);
    expect(cookie).toBeTruthy();

    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: signInBody.user });
  });

  it('a second sign-in with the same googleId updates the existing user instead of creating a duplicate', async () => {
    const { default: app } = await import('../index.js');
    jwtVerify.mockResolvedValue({ payload: mockPayload() });
    const first = await app.request(
      '/api/auth/google',
      { method: 'POST', body: JSON.stringify({ credential: 'tok' }), headers: { 'Content-Type': 'application/json' } },
      env
    );
    const firstBody = await first.json();

    jwtVerify.mockResolvedValue({ payload: mockPayload({ name: 'Ann R.', picture: 'https://example.com/new.jpg' }) });
    const second = await app.request(
      '/api/auth/google',
      { method: 'POST', body: JSON.stringify({ credential: 'tok2' }), headers: { 'Content-Type': 'application/json' } },
      env
    );
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.user.id).toBe(firstBody.user.id);
    expect(secondBody.user.name).toBe('Ann R.');

    const rows = await env.DB.prepare('SELECT id FROM users WHERE google_id = ?').bind('google-sub-1').all();
    expect(rows.results).toHaveLength(1);
  });

  it('rejects an unverified-email credential with 401 and does not establish a session', async () => {
    const { default: app } = await import('../index.js');
    jwtVerify.mockResolvedValue({ payload: mockPayload({ email_verified: false }) });

    const signIn = await app.request(
      '/api/auth/google',
      { method: 'POST', body: JSON.stringify({ credential: 'tok' }), headers: { 'Content-Type': 'application/json' } },
      env
    );
    expect(signIn.status).toBe(401);
    expect(cookieFrom(signIn)).toBeUndefined();

    const me = await app.request('/api/auth/me', {}, env);
    expect(await me.json()).toEqual({ user: null });
  });

  it('rejects when Google credential verification itself throws (e.g. expired/forged token)', async () => {
    const { default: app } = await import('../index.js');
    jwtVerify.mockRejectedValue(new Error('invalid token signature'));

    const res = await app.request(
      '/api/auth/google',
      { method: 'POST', body: JSON.stringify({ credential: 'bad' }), headers: { 'Content-Type': 'application/json' } },
      env
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Could not verify Google sign-in.' });
  });

  it('POST /logout clears an established session', async () => {
    const { default: app } = await import('../index.js');
    jwtVerify.mockResolvedValue({ payload: mockPayload() });
    const signIn = await app.request(
      '/api/auth/google',
      { method: 'POST', body: JSON.stringify({ credential: 'tok' }), headers: { 'Content-Type': 'application/json' } },
      env
    );
    const cookie = cookieFrom(signIn);

    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } }, env);
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ ok: true });

    // A real browser would drop the cookie after Max-Age=0 rather than resend it — simulate that.
    const me = await app.request('/api/auth/me', {}, env);
    expect(await me.json()).toEqual({ user: null });
  });
});
