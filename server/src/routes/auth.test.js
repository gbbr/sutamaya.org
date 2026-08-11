import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieSession from 'cookie-session';

// Mocked the same way server/src/auth.test.js mocks Google's own verification — these route
// tests exercise the actual HTTP routes (session assignment/clearing, response shapes), not
// credential verification itself, which already has its own dedicated unit coverage.
const verifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken })),
}));

const { authRouter } = await import('./auth.js');
const { db } = await import('../firestore.js');

// A real cookie-session (not testApp.js's header-driven fake) — needed here, unlike the other
// route test suites, because these tests exercise session assignment/clearing itself (POST
// /google setting req.session.userId, POST /logout clearing it), which only a real session
// cookie persisted across requests by supertest's agent() can observe.
function buildAuthTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieSession({ name: 'test.sid', secret: 'test-secret-not-for-prod' }));
  app.use('/api/auth', authRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'internal_error', message: err.message });
  });
  return app;
}

const app = buildAuthTestApp();

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

describe('routes/auth.js (Firestore emulator, real cookie-session)', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const createdUserIds = [];
  let consoleErrorSpy;

  beforeEach(() => {
    verifyIdToken.mockReset();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    // routes/auth.js deliberately console.errors on a failed credential verification (see its own
    // comment) — expected here since two tests below exercise exactly that rejection path; silence
    // it so a passing test run doesn't print what looks like an error.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
    while (createdUserIds.length) {
      await db.collection('users').doc(createdUserIds.pop()).delete();
    }
  });

  it('GET /me returns a null user for a signed-out request', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('POST /google with a missing credential returns 400 without touching Firestore', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('signs in a new Google user, sets the session, and GET /me reflects it', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => mockPayload() });
    const agent = request.agent(app);

    const signIn = await agent.post('/api/auth/google').send({ credential: 'tok' });
    expect(signIn.status).toBe(200);
    expect(signIn.body.user).toMatchObject({ email: 'reader@example.com', name: 'Ann Reader', picture: 'https://example.com/pic.jpg' });
    expect(signIn.body.user.googleId).toBeUndefined(); // publicUser() strips it
    createdUserIds.push(signIn.body.user.id);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual(signIn.body.user);
  });

  it('a second sign-in with the same googleId updates the existing user instead of creating a duplicate', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => mockPayload() });
    const agent = request.agent(app);
    const first = await agent.post('/api/auth/google').send({ credential: 'tok' });
    createdUserIds.push(first.body.user.id);

    verifyIdToken.mockResolvedValue({ getPayload: () => mockPayload({ name: 'Ann R.', picture: 'https://example.com/new.jpg' }) });
    const second = await agent.post('/api/auth/google').send({ credential: 'tok2' });

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.name).toBe('Ann R.');

    const snap = await db.collection('users').where('googleId', '==', 'google-sub-1').get();
    expect(snap.docs).toHaveLength(1);
  });

  it('rejects an unverified-email credential with 401 and does not establish a session', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => mockPayload({ email_verified: false }) });
    const agent = request.agent(app);

    const signIn = await agent.post('/api/auth/google').send({ credential: 'tok' });
    expect(signIn.status).toBe(401);

    const me = await agent.get('/api/auth/me');
    expect(me.body).toEqual({ user: null });
  });

  it('rejects when Google credential verification itself throws (e.g. expired/forged token)', async () => {
    verifyIdToken.mockRejectedValue(new Error('invalid token signature'));
    const res = await request(app).post('/api/auth/google').send({ credential: 'bad' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Could not verify Google sign-in.' });
  });

  it('POST /logout clears an established session', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => mockPayload() });
    const agent = request.agent(app);
    const signIn = await agent.post('/api/auth/google').send({ credential: 'tok' });
    createdUserIds.push(signIn.body.user.id);

    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });

    const me = await agent.get('/api/auth/me');
    expect(me.body).toEqual({ user: null });
  });
});
