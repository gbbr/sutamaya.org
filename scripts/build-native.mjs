// Builds the native web + corpus bundle (service worker off) and syncs it into web/ios and
// web/android. Pass `-- --no-sync` to stop after the bundle — no Xcode or Android SDK needed, for
// CI and the OTA channel.

import { spawnSync } from 'node:child_process';

const noSync = process.argv.includes('--no-sync');

function run(args) {
  const r = spawnSync('npm', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(['run', 'build:corpus']);
run(['run', 'build:native', '--workspace', 'web']);

if (noSync) process.exit(0);

const sync = spawnSync('npm', ['run', 'cap:sync', '--workspace', 'web'], { stdio: 'inherit' });
if (sync.status !== 0) {
  console.error(
    '\ncap sync failed. If Xcode / the Android SDK are not installed, build the bundle only with:\n' +
      '  npm run build:native -- --no-sync\n'
  );
  process.exit(sync.status ?? 1);
}
