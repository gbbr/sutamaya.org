import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local dev had no story for GOOGLE_CLIENT_ID at all — scripts/deploy.sh sets it for the
// deployed service by reading web/.env.production (see deploy.md step 5), but `npm run
// dev:server` never had an equivalent, so auth.js's `verifyGoogleCredential` always failed
// with "GOOGLE_CLIENT_ID is not configured on the server" unless it happened to be exported in
// the shell already. Mirror the deploy script's trick here instead of asking for a second,
// easy-to-forget copy of the same public client id: read it out of web/.env.development.
//
// Must be imported *before* anything that reads process.env.GOOGLE_CLIENT_ID at module load
// time (server/src/auth.js) — ES module imports are evaluated in the order they're written, so
// this only works because index.js imports this file first, ahead of ./routes/auth.js.
if (process.env.NODE_ENV !== 'production' && !process.env.GOOGLE_CLIENT_ID) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  try {
    const envDev = fs.readFileSync(path.join(__dirname, '..', '..', 'web', '.env.development'), 'utf8');
    const match = envDev.match(/^VITE_GOOGLE_CLIENT_ID=(.+)$/m);
    if (match) process.env.GOOGLE_CLIENT_ID = match[1].trim();
  } catch {
    // web/.env.development missing/unreadable — Google sign-in just won't work locally, same
    // as before this fallback existed
  }
}
