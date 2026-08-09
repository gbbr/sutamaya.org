import express from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../firestore.js';
import { listsRouter } from '../routes/lists.js';
import { annotationsRouter } from '../routes/annotations.js';
import { dataRouter } from '../routes/data.js';

// A minimal Express app wired against the real routers and the real Firestore emulator (see
// firestore.js — FIRESTORE_EMULATOR_HOST defaults to localhost:8081 outside NODE_ENV=production).
// Deliberately skips cookie-session/CORS/rate-limiting from index.js: requireAuth (auth.js) only
// ever reads `req.session.userId`, however it got there, so a trivial header-driven fake session
// exercises the exact same auth/route code path production does without needing real cookie
// signing in tests. Session/rate-limiter wiring itself is out of scope here — see
// server/src/rateLimiters.test.js for that.
export function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header('x-test-user');
    req.session = userId ? { userId } : null;
    next();
  });
  app.use('/api/lists', listsRouter);
  app.use('/api', annotationsRouter);
  app.use('/api/data', dataRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'internal_error', message: err.message });
  });
  return app;
}

// Every test gets its own random userId (isolation on a shared, long-lived emulator instance —
// no data ever collides between tests or test runs).
export function testUserId() {
  return `test-${randomUUID()}`;
}

// Deletes every doc under users/{userId}/** created by a test. The emulator persists in memory
// for as long as it stays running (it's not restarted per test run), so tests must clean up
// after themselves or the collections would grow unbounded across repeated `npm test` runs.
export async function cleanupUser(userId) {
  const subcollections = ['lists', 'notes', 'highlights', 'visited'];
  for (const name of subcollections) {
    const snap = await db.collection('users').doc(userId).collection(name).get();
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    if (snap.docs.length) await batch.commit();
  }
  await db.collection('users').doc(userId).delete();
}
