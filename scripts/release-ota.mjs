// Publishes an over-the-air bundle: builds the native web + corpus bundle, uploads the zip to the
// environment's R2 bucket, points OTA_VERSION / OTA_CHECKSUM in wrangler.jsonc at it, and deploys
// the Worker. The zip lands in R2 before the version pointer moves, so no device is ever told
// about a bundle that is not there yet.
//
// Usage: node scripts/release-ota.mjs --env production|staging [--force] [--skip-tests]
//   --force       skip the clean-working-tree guard (the version embeds the commit id; a dirty
//                 tree publishes a "-dirty" version that can't be reproduced)
//   --skip-tests  staging only — forward --skip-tests to the deploy so it skips `npm test`

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const force = args.includes('--force');
const skipTests = args.includes('--skip-tests');
const env = args[args.indexOf('--env') + 1];
if (env !== 'production' && env !== 'staging') {
  console.error('error: name an environment — --env production or --env staging');
  process.exit(1);
}
if (skipTests && env !== 'staging') {
  console.error('error: --skip-tests is staging only');
  process.exit(1);
}

const bucket = env === 'production' ? 'sutamaya-ota' : 'sutamaya-ota-staging';
const deployScript = env === 'production' ? 'deploy:prod' : 'deploy:staging';
const WRANGLER_CONFIG = 'wrangler.jsonc';

function sh(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r;
}

function gitOut(...a) {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(/^y(es)?$/i.test(a.trim())))));
}

// Rewrites OTA_VERSION / OTA_CHECKSUM for one environment, leaving comments and the other
// environment's block untouched. Production's vars sit before the "env": key, staging's after it.
function patchWranglerConfig(version, checksum) {
  const text = readFileSync(WRANGLER_CONFIG, 'utf8');
  const split = text.indexOf('"env":');
  const region = env === 'production' ? [0, split] : [split, text.length];
  let slice = text.slice(region[0], region[1]);

  for (const [key, value] of [
    ['OTA_VERSION', version],
    ['OTA_CHECKSUM', checksum],
  ]) {
    const re = new RegExp(`("${key}":\\s*)"[^"]*"`, 'g');
    const hits = slice.match(re) || [];
    if (hits.length !== 1) {
      console.error(`error: expected exactly one ${key} in the ${env} block of ${WRANGLER_CONFIG}, found ${hits.length}`);
      process.exit(1);
    }
    slice = slice.replace(re, `$1"${value}"`);
  }
  writeFileSync(WRANGLER_CONFIG, text.slice(0, region[0]) + slice + text.slice(region[1]));
}

// --- guards -------------------------------------------------------------------

if (!force && gitOut('status', '--porcelain')) {
  console.error('error: working tree is dirty. Commit first, or pass --force to publish a -dirty version.');
  process.exit(1);
}
// wrangler writes the auth notice to stderr, so both streams are read — checking stdout alone lets
// an unauthenticated run through the whole build and the confirmation prompt before failing.
const whoami = spawnSync('npx', ['wrangler', 'whoami'], { encoding: 'utf8' });
if (`${whoami.stdout ?? ''}${whoami.stderr ?? ''}`.includes('You are not authenticated')) {
  console.error('error: not logged in to Cloudflare. Run: npx wrangler login');
  process.exit(1);
}

// --- build -----------------------------------------------------------------

// A staging bundle talks to the staging API (and so shows the tree-pane build stamp); a
// production bundle uses the default origin baked into lib/platform.ts.
const apiBase = env === 'staging' ? 'https://app.staging.sutamaya.org' : 'https://app.sutamaya.org';
const buildEnv = env === 'staging' ? { ...process.env, SUTAMAYA_API_BASE: apiBase } : process.env;
sh('node', ['scripts/build-native.mjs', '--ota'], { env: buildEnv });
const manifest = JSON.parse(readFileSync('web/ota/manifest.json', 'utf8'));
const { version, checksum, zip } = manifest;

console.log(`\nAbout to publish to ${env}:`);
console.log(`  bundle   web/ota/${zip}`);
console.log(`  version  ${version}`);
console.log(`  sha256   ${checksum}`);
console.log(`  api base ${apiBase}`);
console.log(`  bucket   ${bucket}`);
console.log(`  deploy   npm run ${deployScript}\n`);
if (!(await confirm('Upload, point wrangler.jsonc at it, and deploy? [y/N] '))) {
  console.log('Aborted. Nothing was uploaded.');
  process.exit(0);
}

// --- publish -------------------------------------------------------------------

// The zip first, so the version pointer is never ahead of the bundle.
sh('npx', [
  'wrangler',
  'r2',
  'object',
  'put',
  `${bucket}/${zip}`,
  '--file',
  `web/ota/${zip}`,
  '--content-type',
  'application/zip',
  '--remote',
]);

patchWranglerConfig(version, checksum);
console.log(`\n${WRANGLER_CONFIG} now points ${env} at ${version}.`);

sh('npm', skipTests ? ['run', deployScript, '--', '--skip-tests'] : ['run', deployScript]);

console.log(`\nPublished ${version} to ${env}. Commit the ${WRANGLER_CONFIG} change to record what is live.`);
