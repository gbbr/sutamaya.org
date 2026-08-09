import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdToken = vi.fn();
const constructedWith = [];

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation((clientId) => {
    constructedWith.push(clientId);
    return { verifyIdToken };
  }),
}));

vi.mock('./firestore.js', () => ({ usersCol: vi.fn() }));

// Regression coverage for making GOOGLE_CLIENT_ID lazy (read on first real use, not at
// module-load time) — previously this only worked because index.js imported env.js before
// auth.js, so process.env.GOOGLE_CLIENT_ID was populated before this module's top-level code
// ran. A lazy read means auth.js no longer cares what order it's imported in.
describe('verifyGoogleCredential', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    verifyIdToken.mockReset();
    constructedWith.length = 0;
    delete process.env.GOOGLE_CLIENT_ID;
  });

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  });

  it('throws when GOOGLE_CLIENT_ID is unset at call time, not import time', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    await expect(verifyGoogleCredential('token')).rejects.toThrow(
      'GOOGLE_CLIENT_ID is not configured on the server.'
    );
    expect(constructedWith).toEqual([]);
  });

  it('picks up GOOGLE_CLIENT_ID set after the module was first imported', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    process.env.GOOGLE_CLIENT_ID = 'client-a';
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'sub-1', email: 'a@example.com', email_verified: true, name: 'A', picture: null }),
    });

    const result = await verifyGoogleCredential('token');

    expect(constructedWith).toEqual(['client-a']);
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'token', audience: 'client-a' });
    expect(result).toEqual({ googleId: 'sub-1', email: 'a@example.com', name: 'A', picture: null });
  });

  it('rejects when the Google account email is not verified', async () => {
    const { verifyGoogleCredential } = await import('./auth.js');
    process.env.GOOGLE_CLIENT_ID = 'client-a';
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'sub-1', email: 'a@example.com', email_verified: false }),
    });

    await expect(verifyGoogleCredential('token')).rejects.toThrow('Google account email is not verified.');
  });
});
