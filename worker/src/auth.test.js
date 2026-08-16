import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findOrCreateGoogleUser, findUserById, requireAuth } from './auth.js';
import { createSessionCookie } from './session.js';

// vi.mock()/vi.doMock() only take effect on modules imported *after* they're registered, and this
// project's worker/test/apply-migrations.js setupFile imports from 'cloudflare:test', which is a
// known vitest-pool-workers interaction that otherwise swallows vi.mock() entirely (see
// cloudflare/workers-sdk#10201) — vi.resetModules() before each doMock/dynamic-import pair below is
// the documented workaround, not incidental.
describe('verifyGoogleCredential', () => {
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

  it('verifies the credential and returns the profile shape', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    jwtVerify.mockResolvedValue({
      payload: { sub: 'sub-1', email: 'a@example.com', email_verified: true, name: 'A', picture: 'pic.jpg' },
    });

    const result = await verifyGoogleCredential('token', 'client-a');

    expect(jwtVerify).toHaveBeenCalledWith('token', 'mock-jwks', {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: 'client-a',
    });
    expect(result).toEqual({ googleId: 'sub-1', email: 'a@example.com', name: 'A', picture: 'pic.jpg' });
  });

  it('defaults a missing name/picture to null', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    jwtVerify.mockResolvedValue({ payload: { sub: 'sub-1', email: 'a@example.com', email_verified: true } });

    const result = await verifyGoogleCredential('token', 'client-a');

    expect(result).toEqual({ googleId: 'sub-1', email: 'a@example.com', name: null, picture: null });
  });

  it('rejects when the Google account email is not verified', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    jwtVerify.mockResolvedValue({ payload: { sub: 'sub-1', email: 'a@example.com', email_verified: false } });

    await expect(verifyGoogleCredential('token', 'client-a')).rejects.toThrow(
      'Google account email is not verified.'
    );
  });

  it('propagates a jwtVerify rejection (expired/forged token)', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    jwtVerify.mockRejectedValue(new Error('invalid signature'));

    await expect(verifyGoogleCredential('token', 'client-a')).rejects.toThrow('invalid signature');
  });
});

// No manual per-test cleanup here: this project's vitest-pool-workers version defaults
// isolatedStorage to true, so each test's D1 writes are rolled back automatically at test end.
describe('findOrCreateGoogleUser / findUserById', () => {
  it('creates a new user for a googleId not seen before', async () => {
    const user = await findOrCreateGoogleUser(env.DB, {
      googleId: 'google-1',
      email: 'a@example.com',
      name: 'A',
      picture: 'pic.jpg',
    });

    expect(user).toMatchObject({ email: 'a@example.com', googleId: 'google-1', name: 'A', picture: 'pic.jpg' });
    expect(await findUserById(env.DB, user.id)).toEqual(user);
  });

  it('a second sign-in with the same googleId updates the existing row instead of creating a duplicate', async () => {
    const first = await findOrCreateGoogleUser(env.DB, {
      googleId: 'google-2',
      email: 'b@example.com',
      name: 'B',
      picture: 'old.jpg',
    });

    const second = await findOrCreateGoogleUser(env.DB, {
      googleId: 'google-2',
      email: 'b@example.com',
      name: 'B.',
      picture: 'new.jpg',
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('B.');
    const rows = await env.DB.prepare('SELECT id FROM users WHERE google_id = ?').bind('google-2').all();
    expect(rows.results).toHaveLength(1);
  });

  it('findUserById returns null for an unknown id', async () => {
    expect(await findUserById(env.DB, 'no-such-user')).toBeNull();
  });
});

describe('requireAuth', () => {
  function buildTestApp() {
    const app = new Hono();
    app.use(requireAuth);
    app.get('/protected', (c) => c.json({ userId: c.get('userId') }));
    return app;
  }

  it('rejects a request with no session cookie', async () => {
    const res = await buildTestApp().request('/protected', {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_authenticated' });
  });

  it('sets userId on the context for a valid session cookie', async () => {
    const setCookie = await createSessionCookie('user-1', env.SESSION_SECRET);
    const res = await buildTestApp().request(
      '/protected',
      { headers: { Cookie: setCookie.split(';')[0] } },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-1' });
  });

  it('rejects a session cookie signed with a different secret', async () => {
    const setCookie = await createSessionCookie('user-1', 'a-different-secret');
    const res = await buildTestApp().request(
      '/protected',
      { headers: { Cookie: setCookie.split(';')[0] } },
      env
    );
    expect(res.status).toBe(401);
  });
});
