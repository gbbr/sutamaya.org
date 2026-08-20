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

// Two Set-Cookie headers come back from a successful callback (the nonce being cleared, and the
// session), so these pick the one being asked about rather than taking the first.
function nonceCookieFrom(res) {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sutamaya_oauth='));
  return cookie ? cookie.split(';')[0] : undefined;
}

function sessionCookieFrom(res) {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sutamaya_session=') && !c.includes('Max-Age=0'));
  return cookie ? cookie.split(';')[0] : undefined;
}

// `WEB_ORIGIN` is pinned rather than taken from .dev.vars so the redirect assertions don't depend
// on local config.
const OAUTH_ENV = { ...env, WEB_ORIGIN: 'https://sutamaya.org', GOOGLE_CLIENT_SECRET: 'client-secret' };

// Drives the whole Google round trip the way a browser does — start, then callback carrying both
// the state and the nonce cookie the start handed out. Sign-in has no other entry point now, so
// every test that needs a session goes through this.
async function signInWithGoogle(app, payload = mockPayload(), returnTo = '/settings') {
  const start = await app.request(`/api/auth/google/start?return=${encodeURIComponent(returnTo)}`, {}, OAUTH_ENV);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  globalThis.fetch = vi.fn(async () => Response.json({ id_token: 'id-tok' }));
  jwtVerify.mockResolvedValue({ payload });
  return app.request(
    `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: nonceCookieFrom(start) } },
    OAUTH_ENV
  );
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

  // First in the file, so this is the one that pays for loading the Worker's whole module graph
  // inside workerd. Milliseconds once warm, but a loaded CI runner needs more headroom for that
  // first import than the default 5s timeout gives.
  it('GET /me returns a null user for a signed-out request', async () => {
    const { default: app } = await import('../index.js');
    const res = await app.request('/api/auth/me', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  }, 30_000);

  it('signs in a new Google user, sets the session cookie, and GET /me reflects it', async () => {
    const { default: app } = await import('../index.js');
    const signIn = await signInWithGoogle(app);

    const cookie = sessionCookieFrom(signIn);
    expect(cookie).toBeTruthy();

    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } }, OAUTH_ENV);
    expect(me.status).toBe(200);
    const { user } = await me.json();
    expect(user).toMatchObject({ email: 'reader@example.com', name: 'Ann Reader', picture: 'https://example.com/pic.jpg' });
    expect(user.googleId).toBeUndefined(); // publicUser() strips it
  });

  it('a second sign-in with the same googleId updates the existing user instead of creating a duplicate', async () => {
    const { default: app } = await import('../index.js');
    const first = await signInWithGoogle(app);
    const firstMe = await app.request('/api/auth/me', { headers: { Cookie: sessionCookieFrom(first) } }, OAUTH_ENV);
    const firstUser = (await firstMe.json()).user;

    const second = await signInWithGoogle(app, mockPayload({ name: 'Ann R.', picture: 'https://example.com/new.jpg' }));
    const secondMe = await app.request('/api/auth/me', { headers: { Cookie: sessionCookieFrom(second) } }, OAUTH_ENV);
    const secondUser = (await secondMe.json()).user;

    expect(secondUser.id).toBe(firstUser.id);
    expect(secondUser.name).toBe('Ann R.');

    const rows = await env.DB.prepare('SELECT id FROM users WHERE google_id = ?').bind('google-sub-1').all();
    expect(rows.results).toHaveLength(1);
  });

  it('rejects an unverified-email credential and does not establish a session', async () => {
    const { default: app } = await import('../index.js');
    const signIn = await signInWithGoogle(app, mockPayload({ email_verified: false }));

    expect(signIn.headers.get('Location')).toBe('https://sutamaya.org/settings?auth_error=1');
    expect(sessionCookieFrom(signIn)).toBeUndefined();

    const me = await app.request('/api/auth/me', {}, OAUTH_ENV);
    expect(await me.json()).toEqual({ user: null });
  });

  it('rejects when Google credential verification itself throws (e.g. expired/forged token)', async () => {
    const { default: app } = await import('../index.js');
    const start = await app.request('/api/auth/google/start?return=%2Fsettings', {}, OAUTH_ENV);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    globalThis.fetch = vi.fn(async () => Response.json({ id_token: 'id-tok' }));
    jwtVerify.mockRejectedValue(new Error('invalid token signature'));

    const res = await app.request(
      `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: nonceCookieFrom(start) } },
      OAUTH_ENV
    );
    expect(res.headers.get('Location')).toBe('https://sutamaya.org/settings?auth_error=1');
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  // --- OAuth redirect flow -------------------------------------------------------------------
  //
  // The whole round trip, driven the way a browser does it: GET /google/start hands back a 302
  // plus a nonce cookie, and GET /google/callback only accepts a state that matches both our
  // signature and that cookie. `WEB_ORIGIN` is pinned here rather than taken from .dev.vars so
  // the redirect assertions don't depend on local config.
  describe('GET /google/start and /google/callback', () => {
    // The token exchange is the one place this Worker calls out to the network, through the
    // global fetch — stubbed per test, and put back afterwards so nothing else in the suite
    // inherits it.
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    async function beginFlow(app, returnTo = '/settings') {
      const res = await app.request(`/api/auth/google/start?return=${encodeURIComponent(returnTo)}`, {}, OAUTH_ENV);
      const state = new URL(res.headers.get('Location')).searchParams.get('state');
      return { state, nonce: nonceCookieFrom(res) };
    }

    it('redirects to Google with our redirect URI, a state, and a matching nonce cookie', async () => {
      const { default: app } = await import('../index.js');
      const res = await app.request('/api/auth/google/start?return=%2Fbrowse%2Fdn', {}, OAUTH_ENV);

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('Location'));
      expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location.searchParams.get('redirect_uri')).toBe('https://sutamaya.org/api/auth/google/callback');
      expect(location.searchParams.get('state')).toBeTruthy();
      expect(nonceCookieFrom(res)).toBeTruthy();
    });

    it('refuses to carry an off-origin return path through the flow', async () => {
      const { default: app } = await import('../index.js');
      const { state, nonce } = await beginFlow(app, 'https://evil.example/phish');
      globalThis.fetch = vi.fn(async () => Response.json({ id_token: 'id-tok' }));
      jwtVerify.mockResolvedValue({ payload: mockPayload() });

      const res = await app.request(
        `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: nonce } },
        OAUTH_ENV
      );
      expect(res.headers.get('Location')).toBe('https://sutamaya.org/');
    });

    it('completes the round trip: exchanges the code, sets a session, returns to the app', async () => {
      const { default: app } = await import('../index.js');
      const { state, nonce } = await beginFlow(app, '/browse/dn/dn1');
      const fetchMock = vi.fn(async () => Response.json({ id_token: 'id-tok' }));
      globalThis.fetch = fetchMock;
      jwtVerify.mockResolvedValue({ payload: mockPayload() });

      const res = await app.request(
        `/api/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: nonce } },
        OAUTH_ENV
      );

      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('https://sutamaya.org/browse/dn/dn1');

      // The code went to Google's token endpoint with the client secret and the same redirect URI.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
      expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
      const posted = new URLSearchParams(tokenInit.body.toString());
      expect(posted.get('code')).toBe('auth-code');
      expect(posted.get('client_secret')).toBe('client-secret');
      expect(posted.get('grant_type')).toBe('authorization_code');
      expect(posted.get('redirect_uri')).toBe('https://sutamaya.org/api/auth/google/callback');

      const session = sessionCookieFrom(res);
      expect(session).toBeTruthy();
      const me = await app.request('/api/auth/me', { headers: { Cookie: session } }, OAUTH_ENV);
      expect((await me.json()).user).toMatchObject({ email: 'reader@example.com' });
    });

    it('rejects a state whose nonce does not match the browser cookie (login CSRF)', async () => {
      const { default: app } = await import('../index.js');
      const { state } = await beginFlow(app);
      const other = await beginFlow(app); // a different browser's cookie
      globalThis.fetch = vi.fn();

      const res = await app.request(
        `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: other.nonce } },
        OAUTH_ENV
      );

      expect(res.headers.get('Location')).toBe('https://sutamaya.org/settings?auth_error=1');
      expect(sessionCookieFrom(res)).toBeUndefined();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects a forged state before spending the code', async () => {
      const { default: app } = await import('../index.js');
      const { nonce } = await beginFlow(app);
      globalThis.fetch = vi.fn();

      const res = await app.request(
        '/api/auth/google/callback?code=abc&state=not-a-real-state',
        { headers: { Cookie: nonce } },
        OAUTH_ENV
      );

      expect(res.headers.get('Location')).toBe('https://sutamaya.org/settings?auth_error=1');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('sends the user back with an error marker when Google itself declines', async () => {
      const { default: app } = await import('../index.js');
      const { state, nonce } = await beginFlow(app, '/read/dn1');

      const res = await app.request(
        `/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: nonce } },
        OAUTH_ENV
      );

      expect(res.headers.get('Location')).toBe('https://sutamaya.org/read/dn1?auth_error=1');
      expect(sessionCookieFrom(res)).toBeUndefined();
    });

    it('sends the user back with an error marker when the token exchange fails', async () => {
      const { default: app } = await import('../index.js');
      const { state, nonce } = await beginFlow(app);
      globalThis.fetch = vi.fn(async () => new Response('invalid_grant', { status: 400 }));

      const res = await app.request(
        `/api/auth/google/callback?code=stale&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: nonce } },
        OAUTH_ENV
      );

      expect(res.headers.get('Location')).toBe('https://sutamaya.org/settings?auth_error=1');
      expect(sessionCookieFrom(res)).toBeUndefined();
    });

    it('redirects with an error rather than starting a flow it cannot finish, when unconfigured', async () => {
      const { default: app } = await import('../index.js');
      const res = await app.request('/api/auth/google/start', {}, { ...OAUTH_ENV, GOOGLE_CLIENT_SECRET: '' });
      expect(res.headers.get('Location')).toBe('https://sutamaya.org/settings?auth_error=1');
    });
  });

  // --- Sign in by emailed code ----------------------------------------------------------------
  describe('POST /email/request and /email/verify', () => {
    let sent;

    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    // Mail goes out as a plain REST call to Resend, so the stub is fetch — `sent` collects the
    // JSON bodies that would have been posted.
    function emailEnv({ failSend = false } = {}) {
      sent = [];
      globalThis.fetch = vi.fn(async (url, init) => {
        expect(url).toBe('https://api.resend.com/emails');
        expect(init.headers.Authorization).toBe('Bearer test-resend-key');
        if (failSend) return new Response('service unavailable', { status: 503 });
        sent.push(JSON.parse(init.body));
        return Response.json({ id: 'msg-1' });
      });
      return { ...env, MAIL_FROM: 'no-reply@sutamaya.org', RESEND_API_KEY: 'test-resend-key' };
    }

    function post(app, path, body, envOverride) {
      return app.request(
        `/api/auth/${path}`,
        { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
        envOverride
      );
    }

    // The code only ever exists in the mail we captured — the table holds a hash — so this is
    // also the assertion that nothing readable is stored.
    function codeFromMail() {
      return sent.at(-1).subject.match(/\d{6}/)[0];
    }

    it('emails a six-digit code and stores only its hash', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();

      const res = await post(app, 'email/request', { email: 'Reader@Example.com ' }, testEnv);
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toEqual(['reader@example.com']); // normalized before sending
      expect(sent[0].from).toBe('Sutamaya <no-reply@sutamaya.org>');
      expect(sent[0].text).toContain(codeFromMail());

      const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind('reader@example.com').first();
      expect(row.code_hash).not.toContain(codeFromMail());
      expect(row.attempts).toBe(0);
    });

    it('rejects a malformed address without sending anything', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      const res = await post(app, 'email/request', { email: 'not-an-address' }, testEnv);
      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    });

    it('signs in with a valid code, creating the account at verify time', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'new@example.com' }, testEnv);

      // Asking for a code must not have created anything yet.
      const before = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('new@example.com').first();
      expect(before).toBeNull();

      const res = await post(app, 'email/verify', { email: 'new@example.com', code: codeFromMail() }, testEnv);
      expect(res.status).toBe(200);
      const { user } = await res.json();
      expect(user.email).toBe('new@example.com');

      const cookie = cookieFrom(res);
      const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } }, testEnv);
      expect((await me.json()).user.id).toBe(user.id);

      // The code is spent, and an identity row records how the account was made.
      const spent = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind('new@example.com').first();
      expect(spent).toBeNull();
      const identity = await env.DB.prepare('SELECT * FROM identities WHERE provider = ? AND subject = ?')
        .bind('email', 'new@example.com')
        .first();
      expect(identity.user_id).toBe(user.id);
    });

    it('lands on the existing account when the address already signed in with Google', async () => {
      const { default: app } = await import('../index.js');
      const viaGoogle = await signInWithGoogle(app, mockPayload({ email: 'shared@example.com', sub: 'google-shared' }));
      const googleMe = await app.request(
        '/api/auth/me',
        { headers: { Cookie: sessionCookieFrom(viaGoogle) } },
        OAUTH_ENV
      );
      const googleUser = (await googleMe.json()).user;

      // emailEnv() re-stubs fetch for Resend, so it has to come after the Google round trip above.
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'shared@example.com' }, testEnv);
      const res = await post(app, 'email/verify', { email: 'shared@example.com', code: codeFromMail() }, testEnv);

      // Same account, not a second one holding half the user's lists.
      expect((await res.json()).user.id).toBe(googleUser.id);
      const rows = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('shared@example.com').all();
      expect(rows.results).toHaveLength(1);
    });

    it('rejects a wrong code, and spends the row after five tries', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'guess@example.com' }, testEnv);
      const real = codeFromMail();
      const wrong = real === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        const res = await post(app, 'email/verify', { email: 'guess@example.com', code: wrong }, testEnv);
        expect(res.status).toBe(401);
      }

      // Even the correct code is now refused — the budget belongs to the code, not to the caller,
      // so a new IP buys no further guesses.
      const res = await post(app, 'email/verify', { email: 'guess@example.com', code: real }, testEnv);
      expect(res.status).toBe(401);
      expect(cookieFrom(res)).toBeUndefined();
    });

    it('refuses an expired code', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'stale@example.com' }, testEnv);
      const code = codeFromMail();
      await env.DB.prepare('UPDATE login_codes SET expires_at = ? WHERE email = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), 'stale@example.com')
        .run();

      const res = await post(app, 'email/verify', { email: 'stale@example.com', code }, testEnv);
      expect(res.status).toBe(401);
      expect(cookieFrom(res)).toBeUndefined();
    });

    it('invalidates the previous code when a new one is requested', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'rotate@example.com' }, testEnv);
      const first = codeFromMail();

      // Past the resend cooldown, so this really does send a second code.
      await env.DB.prepare('UPDATE login_codes SET created_at = ? WHERE email = ?')
        .bind(new Date(Date.now() - 60_000).toISOString(), 'rotate@example.com')
        .run();
      await post(app, 'email/request', { email: 'rotate@example.com' }, testEnv);
      const second = codeFromMail();
      expect(second).not.toBe(first);

      expect((await post(app, 'email/verify', { email: 'rotate@example.com', code: first }, testEnv)).status).toBe(401);
      expect((await post(app, 'email/verify', { email: 'rotate@example.com', code: second }, testEnv)).status).toBe(200);
    });

    it('does not send a second mail inside the resend cooldown', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'flood@example.com' }, testEnv);
      const res = await post(app, 'email/request', { email: 'flood@example.com' }, testEnv);

      expect(res.status).toBe(200); // still "a code is on its way" — the first one is still valid
      expect(sent).toHaveLength(1);
    });

    // A code requested and never used has no other route out of the table — the verify path only
    // runs if the user comes back — so it would sit there indefinitely without this.
    it('sweeps expired rows for other addresses when a new code is requested', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      const past = new Date(Date.now() - 60_000).toISOString();
      await env.DB.prepare('INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)')
        .bind('abandoned@example.com', 'dead-hash', past, past)
        .run();

      await post(app, 'email/request', { email: 'fresh@example.com' }, testEnv);

      const swept = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind('abandoned@example.com').first();
      expect(swept).toBeNull();
      // The row just written is untouched — its expiry is in the future.
      const kept = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind('fresh@example.com').first();
      expect(kept).not.toBeNull();
    });

    it('still issues a working code when the requester’s own row had expired', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'lapsed@example.com' }, testEnv);
      const past = new Date(Date.now() - 60_000).toISOString();
      await env.DB.prepare('UPDATE login_codes SET expires_at = ?, created_at = ? WHERE email = ?')
        .bind(past, past, 'lapsed@example.com')
        .run();

      await post(app, 'email/request', { email: 'lapsed@example.com' }, testEnv);
      const res = await post(app, 'email/verify', { email: 'lapsed@example.com', code: codeFromMail() }, testEnv);
      expect(res.status).toBe(200);
    });

    it('rejects a code for an address that never asked for one', async () => {
      const { default: app } = await import('../index.js');
      const res = await post(app, 'email/verify', { email: 'nobody@example.com', code: '123456' }, emailEnv());
      expect(res.status).toBe(401);
    });

    it('rejects a malformed code without touching the stored one', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv();
      await post(app, 'email/request', { email: 'shape@example.com' }, testEnv);

      expect((await post(app, 'email/verify', { email: 'shape@example.com', code: '12345' }, testEnv)).status).toBe(400);
      expect((await post(app, 'email/verify', { email: 'shape@example.com', code: 'abcdef' }, testEnv)).status).toBe(400);
      const row = await env.DB.prepare('SELECT attempts FROM login_codes WHERE email = ?').bind('shape@example.com').first();
      expect(row.attempts).toBe(0);

      expect((await post(app, 'email/verify', { email: 'shape@example.com', code: codeFromMail() }, testEnv)).status).toBe(200);
    });

    it('reports a send failure rather than leaving the user waiting for mail', async () => {
      const { default: app } = await import('../index.js');
      const testEnv = emailEnv({ failSend: true });
      const res = await post(app, 'email/request', { email: 'down@example.com' }, testEnv);
      expect(res.status).toBe(502);
    });
  });

  it('POST /logout clears an established session', async () => {
    const { default: app } = await import('../index.js');
    const signIn = await signInWithGoogle(app);
    const cookie = sessionCookieFrom(signIn);

    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } }, env);
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ ok: true });

    // A real browser would drop the cookie after Max-Age=0 rather than resend it — simulate that.
    const me = await app.request('/api/auth/me', {}, env);
    expect(await me.json()).toEqual({ user: null });
  });
});
