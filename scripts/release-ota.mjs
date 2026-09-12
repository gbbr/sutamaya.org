// Publishes an over-the-air bundle: builds the native web + corpus bundle, uploads the zip to the
// environment's R2 bucket, points the OTA vars in wrangler.jsonc at it, and deploys the Worker.
// The zip lands in R2 before the version pointer moves, so no device is ever told about a bundle
// that is not there yet.
//
// Usage: node scripts/release-ota.mjs --env production|staging [--force] [--skip-tests]
//                                     [--allow-native-drift]
//   --force               skip the clean-working-tree guard (the version embeds the commit id; a
//                         dirty tree publishes a "-dirty" version that can't be reproduced)
//   --skip-tests          staging only — forward --skip-tests to the deploy so it skips `npm test`
//   --allow-native-drift  publish even though the native contract has moved since the build in the
//                         stores — for a change that cannot affect the bundle, an icon say

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { API_ORIGINS } from './lib/apiOrigins.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const skipTests = args.includes('--skip-tests');
const allowNativeDrift = args.includes('--allow-native-drift');
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

// The binary in the stores: its build number, the commit its native projects were built from, and
// the lowest build number able to run bundles built from that commit.
const NATIVE_RELEASE = 'native-release.json';

// The files that decide what a bundle may call — plugins, permissions, deep-link claims — and so
// what an older binary cannot run. Everything else under web/ios and web/android is left out, to
// keep an icon or a rebuilt asset from reading as a contract change. The Capacitor plugin list is
// checked separately: it shares web/package.json with every web dependency, and it is also what
// capacitor.build.gradle restates, so that generated file is left out too.
const NATIVE_CONTRACT = [
  'web/capacitor.config.ts',
  'web/ios/App/App/Info.plist',
  'web/ios/App/App.xcodeproj/project.pbxproj',
  'web/android/app/src/main/AndroidManifest.xml',
  'web/android/app/build.gradle',
];

// The version fields, dropped before comparing: they move on every store release and say nothing
// about what a bundle may call, so left in they would fire the guard as a matter of routine.
const VERSION_FIELDS = [
  [/\b(versionCode|CURRENT_PROJECT_VERSION)\b\s*=?\s*\d+/g, '$1'],
  [/\b(versionName|MARKETING_VERSION)\b\s*=?\s*("[^"]*"|[\d.]+)/g, '$1'],
];

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

// Rewrites the named vars for one environment, leaving comments and the other environment's block
// untouched. Production's vars sit before the "env": key, staging's after it.
function patchWranglerConfig(values) {
  const text = readFileSync(WRANGLER_CONFIG, 'utf8');
  const split = text.indexOf('"env":');
  const region = env === 'production' ? [0, split] : [split, text.length];
  let slice = text.slice(region[0], region[1]);

  for (const [key, value] of Object.entries(values)) {
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

// The Capacitor plugin list as of one revision, as a comparable string.
function capacitorPlugins(rev) {
  const text = gitOut('show', `${rev}:web/package.json`);
  if (!text) {
    console.error(`error: cannot read web/package.json at ${rev}.`);
    process.exit(1);
  }
  return Object.keys(JSON.parse(text).dependencies ?? {})
    .filter((name) => name.startsWith('@capacitor/') || name.startsWith('@capgo/'))
    .sort()
    .join(' ');
}

const store = JSON.parse(readFileSync(NATIVE_RELEASE, 'utf8'));
if (!gitOut('rev-parse', '--verify', `${store.commit}^{commit}`)) {
  console.error(`error: ${NATIVE_RELEASE} names commit ${store.commit}, which is not in this clone.`);
  process.exit(1);
}

// One contract file as of one revision, versions stripped. A path absent at that revision reads as
// empty, so adding one counts as a change.
function contractText(rev, path) {
  return VERSION_FIELDS.reduce((text, [re, to]) => text.replace(re, to), gitOut('show', `${rev}:${path}`));
}

const drifted = NATIVE_CONTRACT.filter((path) => contractText(store.commit, path) !== contractText('HEAD', path));
if (capacitorPlugins(store.commit) !== capacitorPlugins('HEAD')) drifted.push('web/package.json (Capacitor plugins)');
if (drifted.length && !allowNativeDrift) {
  console.error(
    `error: the native projects have moved since build ${store.build}, the build in the stores:\n\n` +
      drifted.map((file) => `  ${file}`).join('\n') +
      `\n\nThis bundle may call a plugin, permission or link claim those binaries do not have, and\n` +
      `every installed app would run it. Ship a store release and record it in ${NATIVE_RELEASE} —\n` +
      `raising "floor" to the new build number if the bundle cannot run on the old one — or pass\n` +
      `--allow-native-drift if the change cannot affect the bundle.\n`,
  );
  process.exit(1);
}

// --- build -----------------------------------------------------------------

// The bundle talks to its own environment's API — a staging one showing the tree-pane build stamp.
const apiBase = API_ORIGINS[env];
sh('node', ['scripts/build-native.mjs', '--ota', '--env', env]);
const manifest = JSON.parse(readFileSync('web/ota/manifest.json', 'utf8'));
const { version, checksum, zip } = manifest;

console.log(`\nAbout to publish to ${env}:`);
console.log(`  bundle   web/ota/${zip}`);
console.log(`  version  ${version}`);
console.log(`  sha256   ${checksum}`);
console.log(`  api base ${apiBase}`);
console.log(`  bucket   ${bucket}`);
console.log(`  floor    build ${store.floor} and up${drifted.length ? '  (native drift allowed)' : ''}`);
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

patchWranglerConfig({ OTA_VERSION: version, OTA_CHECKSUM: checksum, OTA_MIN_NATIVE: String(store.floor) });
console.log(`\n${WRANGLER_CONFIG} now points ${env} at ${version}, floor build ${store.floor}.`);

sh('npm', skipTests ? ['run', deployScript, '--', '--skip-tests'] : ['run', deployScript]);

console.log(`\nPublished ${version} to ${env}. Commit the ${WRANGLER_CONFIG} change to record what is live.`);
