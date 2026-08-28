import { removeTestUsers } from './session';

// Leaves the local database as the run found it, so a dev session afterwards doesn't have stray
// accounts and their data sitting in it.
export default async function globalTeardown() {
  if (process.env.E2E_BASE_URL) return;
  await removeTestUsers();
}
