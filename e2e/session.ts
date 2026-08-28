import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
// The Worker's own cookie helper, so a test session is signed exactly the way a real one is —
// there is no second implementation to drift.
import { createSessionCookie, SESSION_COOKIE_NAME } from '../worker/src/session.js';

const run = promisify(execFile);

/**
 * The signed-in specs draw from a pool of accounts, one per test, rather than sharing one and
 * wiping it between tests.
 *
 * This is about the database, not about tidiness. `wrangler d1 execute --local` opens the same
 * SQLite file the Worker holds, and the two contend: a write that lands while the Worker is
 * starting kills it — `SQLITE_BUSY … The Workers runtime failed to start` — and every test after
 * that fails on an API that is no longer there. So the pool is written once by the global setup
 * and removed once by the teardown, both outside the run, and nothing touches D1 in between. It
 * gives better isolation besides: no test can see another's data, because no two share an account.
 *
 * The size is a ceiling on signed-in tests per run, and deliberately generous: overrunning it
 * fails loudly rather than quietly reusing an account.
 */
const POOL_SIZE = 24;
const userId = (n: number) => `e2e-user-${String(n).padStart(2, '0')}`;

let handedOut = 0;

/** Every table holding user data, for the teardown. */
const USER_TABLES = ['lists', 'notes', 'highlights', 'visited'];

function sessionSecret(): string {
  // .dev.vars is the same file wrangler dev reads, so the secret here is the one the running
  // Worker will verify against.
  const raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const match = /^\s*SESSION_SECRET\s*=\s*(.*)$/.exec(line);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('SESSION_SECRET is not set in .dev.vars — the signed-in specs cannot mint a session');
}

/**
 * One `wrangler d1 execute` call, retried: even at two calls a run, this can arrive while the
 * Worker holds the database, and losing that race should cost a second rather than the run.
 */
async function d1(sql: string) {
  const cwd = new URL('..', import.meta.url).pathname;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await run('npx', ['wrangler', 'd1', 'execute', 'sutamaya', '--local', '--command', sql], { cwd });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Creates the pool. Called once per run, from the global setup — see the note there for why that
 * is the only safe moment to write to this database.
 *
 * `google_id` is a placeholder: the column survives from before `identities` existed and is still
 * NOT NULL UNIQUE, so a row can't be written without one, and nothing reads it (see the note in
 * migration 0003). An account needs a real row even though `requireAuth` never looks at one —
 * AuthContext asks GET /api/auth/me for a profile, and a session naming an account that isn't
 * there reads as signed out in the UI.
 */
export async function seedTestUsers() {
  const now = new Date().toISOString();
  const rows = Array.from({ length: POOL_SIZE }, (_, i) => {
    const id = userId(i);
    return `('${id}', '${id}@example.invalid', '${id}-placeholder', 'End to end', '${now}')`;
  });
  await d1(
    `INSERT OR REPLACE INTO users (id, email, google_id, name, created_at) VALUES ${rows.join(', ')}`
  );
}

/** Removes the pool and everything it owns. Called from the global teardown. */
export async function removeTestUsers() {
  const like = `'e2e-user-%'`;
  const wipes = USER_TABLES.map((t) => `DELETE FROM ${t} WHERE user_id LIKE ${like}`);
  await d1([...wipes, `DELETE FROM users WHERE id LIKE ${like}`].join('; '));
}

/**
 * Signs this page's browser context into an account of its own, by minting the same signed cookie
 * the Worker's own OAuth and email-code flows set. Neither of those can be scripted — Google won't
 * be driven, and the emailed code doesn't arrive anywhere a test can read — and `requireAuth`
 * verifies the cookie without a database round trip, so this is the whole of what "signed in"
 * means to the API.
 *
 * Call it before the first navigation: cookies set afterwards are not on the requests the app has
 * already made. Pass the id returned by an earlier call to put a second browser context on the
 * same account, which is how the two-device specs are built.
 */
export async function signIn(page: Page, existing?: string): Promise<string> {
  const id = existing ?? nextUserId();
  const setCookie = await createSessionCookie(id, sessionSecret(), { secure: false });
  const value = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));

  // Addressed by url rather than domain/path: WebKit does not reliably accept a cookie injected
  // with a bare `localhost` domain, and the url form is what Playwright normalizes for each
  // engine. Cookies ignore the port, so this one also covers the preview server on 5273.
  await page.context().addCookies([
    { name: SESSION_COOKIE_NAME, value, url: 'http://localhost', httpOnly: true, sameSite: 'Lax' },
  ]);
  return id;
}

function nextUserId(): string {
  if (handedOut >= POOL_SIZE) {
    throw new Error(
      `the end-to-end account pool holds ${POOL_SIZE} accounts and this run wanted another — raise POOL_SIZE in e2e/session.ts`
    );
  }
  return userId(handedOut++);
}
