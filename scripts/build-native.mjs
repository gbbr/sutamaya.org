// Builds the native web + corpus bundle (service worker off) and syncs it into web/ios and
// web/android. Pass `-- --no-sync` to stop after the bundle — no Xcode or Android SDK needed, for
// CI and the OTA channel. Pass `-- --ota` to also package that bundle as a versioned zip under
// web/ota/ for `npm run release:ota` (implies --no-sync).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ota = process.argv.includes('--ota');
const noSync = ota || process.argv.includes('--no-sync');

function run(args, opts = {}) {
  const r = spawnSync('npm', args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

run(['run', 'build:corpus']);
run(['run', 'build:native', '--workspace', 'web']);

if (ota) packageOta();

if (noSync) process.exit(0);

const sync = spawnSync('npm', ['run', 'cap:sync', '--workspace', 'web'], { stdio: 'inherit' });
if (sync.status !== 0) {
  console.error(
    '\ncap sync failed. If Xcode / the Android SDK are not installed, build the bundle only with:\n' +
      '  npm run build:native -- --no-sync\n'
  );
  process.exit(sync.status ?? 1);
}

// Zips web/dist (index.html at the zip root, no dotfiles) into web/ota/sutamaya-<version>.zip and
// writes web/ota/manifest.json with the version and the zip's SHA-256. The version is the web
// package version plus the short commit id, with a "-dirty" tag when the tree has uncommitted
// changes — `release:ota` refuses to publish those.
function packageOta() {
  const dist = join('web', 'dist');
  const outDir = join('web', 'ota');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`\n${dist}/index.html is missing — the web build did not produce a bundle.\n`);
    process.exit(1);
  }

  const pkgVersion = JSON.parse(readFileSync(join('web', 'package.json'), 'utf8')).version;
  const sha = git('rev-parse', '--short', 'HEAD') || 'nogit';
  const dirty = git('status', '--porcelain') ? '-dirty' : '';
  const version = `${pkgVersion}-${sha}${dirty}`;
  const zipPath = join(outDir, `sutamaya-${version}.zip`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // `-X` drops the extra file attributes that would make the zip differ between machines for the
  // same bundle. Top-level dotfiles are left out of the entry list rather than zipped: the plugin
  // skips them when it flattens the archive, so they are weight the device downloads and discards.
  // Run from web/dist so paths in the zip are bundle-relative.
  const entries = readdirSync(dist).filter((name) => !name.startsWith('.'));
  const zip = spawnSync('zip', ['-r', '-X', '-q', join('..', 'ota', `sutamaya-${version}.zip`), ...entries], {
    cwd: dist,
    stdio: 'inherit',
  });
  if (zip.status !== 0) {
    console.error('\nzip failed — is the `zip` command available?\n');
    process.exit(zip.status ?? 1);
  }

  const checksum = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify({ version, checksum, zip: `sutamaya-${version}.zip`, builtAt: new Date().toISOString() }, null, 2) + '\n'
  );
  console.log(`\nOTA bundle: ${zipPath}\n  version  ${version}\n  sha256   ${checksum}\n`);
}
