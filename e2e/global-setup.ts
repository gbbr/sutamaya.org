import { seedTestUsers } from './session';

// Writes the account pool the signed-in specs draw from.
//
// Here, and nowhere else, because this is the one moment in a run when the local SQLite file is
// not being held by a Worker that is starting up: a global setup runs before Playwright starts
// any web server. `wrangler d1 execute --local` opens that same file, and a write landing while
// the Worker is starting kills it outright — `SQLITE_BUSY … The Workers runtime failed to start` —
// after which every test in the run fails against an API that is no longer there.
//
// Skipped when the run targets a deployment: E2E_BASE_URL means there is no local database to
// seed, and the signed-in specs don't run there.
export default async function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  await seedTestUsers();
}
