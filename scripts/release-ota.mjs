// Publishes an over-the-air bundle: builds the native web + corpus bundle, uploads the zip to the
// environment's R2 bucket, points the OTA vars in wrangler.jsonc at it, and deploys the Worker.
// The zip lands in R2 before the version pointer moves, so no device is ever told about a bundle
// that is not there yet. A production release also writes its notes into CHANGELOG.md, tags its
// commit and creates its GitHub Release (docs/native-apps.md's "Release notes").
//
// Usage: node scripts/release-ota.mjs --env production|staging [--force] [--skip-tests]
//                                     [--allow-native-drift]
//   --force               skip the clean-working-tree guard (the version embeds the commit id; a
//                         dirty tree publishes a "-dirty" version that can't be reproduced)
//   --skip-tests          staging only — forward --skip-tests to the deploy so it skips `npm test`
//   --allow-native-drift  publish even though the native contract has moved since a platform's build
//                         in the stores — for a change that cannot affect the bundle, an icon say

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { API_ORIGINS } from './lib/apiOrigins.js';
import { comparableContract } from './lib/nativeContract.js';
import { staleBundles } from './lib/otaBundles.js';

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

// Bundles left in the bucket after a release, the one just published included.
const KEEP_BUNDLES = 3;

// Each platform's binary in its store: its build number, the commit its native project was built
// from, and `minNative`, the lowest build number able to run bundles built from that commit.
const NATIVE_RELEASE = 'native-release.json';

// The platforms native-release.json records, by their names in it and in messages.
const PLATFORMS = { ios: 'iOS', android: 'Android' };

// The files that decide what a bundle may call — plugins, permissions, deep-link claims — and so
// what an older binary cannot run, by the platform whose binary they shape. Everything else under
// web/ios and web/android is left out, to keep an icon or a rebuilt asset from reading as a
// contract change. The Capacitor plugin list is checked separately: it shares web/package.json with
// every web dependency, and it is also what capacitor.build.gradle restates, so that generated file
// is left out too.
const NATIVE_CONTRACT = {
  ios: ['web/capacitor.config.ts', 'web/ios/App/App/Info.plist', 'web/ios/App/App.xcodeproj/project.pbxproj'],
  android: ['web/capacitor.config.ts', 'web/android/app/src/main/AndroidManifest.xml', 'web/android/app/build.gradle'],
};

// The record of each production release, for readers, newest first.
const CHANGELOG = 'CHANGELOG.md';

// The tags naming production releases: the day each went out, with ".2", ".3"… for a second that day.
const RELEASE_TAG = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*';

// The address a release's notes link each commit to, before its id.
const COMMIT_URL = 'https://github.com/gbbr/sutamaya.org/commit/';

// Commit subjects left out of a release's notes: the records of releases and store builds.
const BOOKKEEPING = /^(release:ota|ota:release) |^Mark build \d+ as /;

// Where each platform's store version is set, and the pattern reading it.
const STORE_VERSION = {
  ios: ['web/ios/App/App.xcodeproj/project.pbxproj', /MARKETING_VERSION = ([^;]+);/],
  android: ['web/android/app/build.gradle', /versionName "([^"]+)"/],
};

function sh(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r;
}

function gitOut(...a) {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

// confirm asks a yes-or-no question and resolves to the answer; Ctrl-C answers no.
function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.on('SIGINT', () => (rl.close(), console.log(), resolve(false)));
    rl.question(question, (a) => (rl.close(), resolve(/^y(es)?$/i.test(a.trim()))));
  });
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

// pruneBundles deletes the bundles staleBundles picks, through Cloudflare's API with wrangler's
// login. A failure only warns: the release is already live, and a leftover zip costs nothing.
async function pruneBundles(live) {
  try {
    const { accounts } = JSON.parse(spawnSync('npx', ['wrangler', 'whoami', '--json'], { encoding: 'utf8' }).stdout);
    if (accounts?.length !== 1) throw new Error(`expected one Cloudflare account, found ${accounts?.length ?? 0}`);
    const token = spawnSync('npx', ['wrangler', 'auth', 'token'], { encoding: 'utf8' }).stdout.trim().split('\n').pop().trim();
    const api = `https://api.cloudflare.com/client/v4/accounts/${accounts[0].id}/r2/buckets/${bucket}/objects`;
    const headers = { Authorization: `Bearer ${token}` };

    const listing = await (await fetch(`${api}?per_page=1000`, { headers })).json();
    if (!listing.success) throw new Error(`listing ${bucket} failed: ${JSON.stringify(listing.errors)}`);
    const stale = staleBundles(listing.result, live, KEEP_BUNDLES);
    for (const key of stale) {
      const res = await fetch(`${api}/${encodeURIComponent(key)}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(`deleting ${key} failed with HTTP ${res.status}`);
    }
    console.log(`Deleted ${stale.length} older bundle(s) from ${bucket}.`);
  } catch (err) {
    console.warn(`warning: older bundles were left in ${bucket}: ${err.message}`);
  }
}

// releaseName returns today's date, with ".2", ".3"… appended when an earlier release today holds it.
function releaseName() {
  const d = new Date();
  const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
  let name = day;
  for (let n = 2; gitOut('tag', '--list', name); n++) name = `${day}.${n}`;
  return name;
}

// releaseSummary returns the line opening a release's notes: the update's id as Settings shows it,
// and the store version of each platform whose build was recorded since the previous release.
function releaseSummary(bundleId) {
  const before = JSON.parse(gitOut('show', `${previousRelease}:${NATIVE_RELEASE}`) || '{}');
  const sent = Object.entries(PLATFORMS)
    .filter(([platform]) => before[platform]?.build !== store[platform].build)
    .map(([platform, name]) => {
      const [path, re] = STORE_VERSION[platform];
      const version = gitOut('show', `${store[platform].commit}:${path}`).match(re)?.[1];
      return `${name} ${version ?? `build ${store[platform].build}`}`;
    });
  return (
    `Over-the-air update ${bundleId} for the iOS and Android apps, also live on the web.` +
    (sent.length ? ` New app versions sent to the stores since the last update: ${sent.join(', ')}.` : '')
  );
}

// publishRelease tags the bundle's commit with the release's name and creates its GitHub Release
// from its CHANGELOG.md section. A failure only warns: the release is already live.
function publishRelease(name) {
  const section = readFileSync(CHANGELOG, 'utf8').split(/^(?=## )/m).find((s) => s.startsWith(`## ${name}\n`)) ?? '';
  const notes = section.slice(section.indexOf('\n') + 1).trim();
  const run = (cmd, cmdArgs, input) =>
    spawnSync(cmd, cmdArgs, { stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], input })
      .status === 0;
  const ok =
    run('git', ['tag', '-a', name, '-m', notes.split('\n')[0] || name, head]) &&
    run('git', ['push', 'origin', `refs/tags/${name}`]) &&
    run('gh', ['release', 'create', name, '--verify-tag', '--title', name, '--notes-file', '-'], notes);
  if (ok) console.log(`Tagged ${name} and created its GitHub Release.`);
  else console.warn(`warning: ${name} is live, but tagging it or creating its GitHub Release failed (see above).`);
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

// The newest release tag behind HEAD, where a production release's notes begin.
const previousRelease =
  env === 'production' ? gitOut('describe', '--tags', '--abbrev=0', '--match', RELEASE_TAG, 'HEAD') : '';
if (env === 'production' && !previousRelease) {
  console.error('error: no release tag behind HEAD to start the notes from. Run: git fetch --tags');
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
for (const [platform, name] of Object.entries(PLATFORMS)) {
  const { commit, minNative } = store[platform] ?? {};
  if (!commit || !gitOut('rev-parse', '--verify', `${commit}^{commit}`)) {
    console.error(`error: ${NATIVE_RELEASE} names ${name} commit ${commit}, which is not in this clone.`);
    process.exit(1);
  }
  if (!Number.isInteger(minNative) || minNative < 1) {
    console.error(`error: ${NATIVE_RELEASE} gives ${name} no "minNative" build number (found ${minNative}).`);
    process.exit(1);
  }
}

// One contract file as of one revision, as comparableContract reads it. A path absent at that
// revision reads as empty, so adding one counts as a change.
function contractText(rev, path) {
  return comparableContract(gitOut('show', `${rev}:${path}`));
}

// The contract files that have moved since each platform's build in the stores, one line each.
const drifted = Object.entries(PLATFORMS).flatMap(([platform, name]) => {
  const { build, commit } = store[platform];
  const files = NATIVE_CONTRACT[platform].filter((path) => contractText(commit, path) !== contractText('HEAD', path));
  if (capacitorPlugins(commit) !== capacitorPlugins('HEAD')) files.push('web/package.json (Capacitor plugins)');
  return files.map((file) => `${name} build ${build}: ${file}`);
});
if (drifted.length && !allowNativeDrift) {
  console.error(
    `error: the native projects have moved since the builds in the stores:\n\n` +
      drifted.map((line) => `  ${line}`).join('\n') +
      `\n\nThis bundle may call a plugin, permission or link claim those binaries do not have, and\n` +
      `every installed app would run it. Ship a store release and record it in ${NATIVE_RELEASE} —\n` +
      `raising that platform's "minNative" to the new build number if the bundle cannot run on the\n` +
      `old one — or pass --allow-native-drift if the change cannot affect the bundle.\n`,
  );
  process.exit(1);
}

// --- build -----------------------------------------------------------------

// The bundle talks to its own environment's API — a staging one showing the tree-pane build stamp.
const apiBase = API_ORIGINS[env];
// The commit the bundle is built from, and its id as Settings shows it.
const head = gitOut('rev-parse', 'HEAD');
const bundleId = gitOut('log', '-1', '--pretty=%h') + (gitOut('status', '--porcelain') ? '*' : '');
sh('node', ['scripts/build-native.mjs', '--ota', '--env', env]);
const manifest = JSON.parse(readFileSync('web/ota/manifest.json', 'utf8'));
const { version, checksum, zip } = manifest;

console.log(`\nAbout to publish to ${env}:`);
console.log(`  bundle   web/ota/${zip}`);
console.log(`  version  ${version}`);
console.log(`  sha256   ${checksum}`);
console.log(`  api base ${apiBase}`);
console.log(`  bucket   ${bucket}, keeping the newest ${KEEP_BUNDLES} bundles, this one included`);
console.log(
  `  native   iOS build ${store.ios.minNative} and up, Android build ${store.android.minNative} and up` +
    (drifted.length ? '  (native drift allowed)' : ''),
);
console.log(`  deploy   npm run ${deployScript}\n`);

// A production release's notes, drafted at the top of CHANGELOG.md for trimming before the deploy.
let release;
if (env === 'production') {
  const name = releaseName();
  const changes = gitOut('log', '--no-merges', '--format=%h %s', `${previousRelease}..${head}`)
    .split('\n')
    .map((line) => ({ id: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1) }))
    .filter(({ subject }) => subject && !BOOKKEEPING.test(subject));
  const section =
    [
      `## ${name}`,
      releaseSummary(bundleId),
      changes.map(({ id, subject }) => `- ${subject} ([${id}](${COMMIT_URL}${id}))`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n') + '\n';
  const text = readFileSync(CHANGELOG, 'utf8');
  const at = text.search(/^## /m);
  writeFileSync(CHANGELOG, at === -1 ? `${text.trimEnd()}\n\n${section}` : `${text.slice(0, at)}${section}\n${text.slice(at)}`);
  release = { name, changelog: text };
  console.log(
    `Release ${name}, drafted at the top of ${CHANGELOG}:\n\n${section}\n` +
      `Edit ${CHANGELOG} now if needed and save; the GitHub Release is made from it after the deploy.\n`,
  );
}

if (!(await confirm('Upload, point wrangler.jsonc at it, and deploy? [y/N] '))) {
  if (release) writeFileSync(CHANGELOG, release.changelog);
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

patchWranglerConfig({
  OTA_VERSION: version,
  OTA_CHECKSUM: checksum,
  OTA_MIN_NATIVE_IOS: String(store.ios.minNative),
  OTA_MIN_NATIVE_ANDROID: String(store.android.minNative),
});
console.log(
  `\n${WRANGLER_CONFIG} now points ${env} at ${version}, ` +
    `for iOS build ${store.ios.minNative} and up, Android build ${store.android.minNative} and up.`,
);

sh('npm', skipTests ? ['run', deployScript, '--', '--skip-tests'] : ['run', deployScript]);

// After the deploy, which exits on failure, so nothing is pruned while the Worker may still serve an
// older bundle.
await pruneBundles(zip);
if (release) publishRelease(release.name);

const toCommit = release ? `${CHANGELOG} and the ${WRANGLER_CONFIG} change` : `the ${WRANGLER_CONFIG} change`;
console.log(`\nPublished ${version} to ${env}. Commit ${toCommit} to record what is live.`);
