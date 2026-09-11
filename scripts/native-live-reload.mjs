// Waits for the web dev server and the Worker to come up, then launches the native app against
// them in live-reload mode — web edits reload with no rebuild. Started by scripts/dev-native.mjs,
// which picks the target and hands it over in the environment (see there for why it is chosen first).
//
// The WebView loads the dev server itself, so `/api/*` is same-origin and rides Vite's proxy to the
// Worker — no CORS, unlike a bundled build pointed straight at the Worker.
//
// A simulator or emulator goes through `cap run`, which handles them well. A physical device is
// built and installed here instead: Capacitor hands device installs to `native-run`, whose path is
// the legacy usbmux one (DeveloperDiskImage mount, AFC upload, `installation_proxy`) that modern iOS
// has moved off — it cannot see a device paired only over the network, and is several times slower
// when it can. `xcodebuild` plus `xcrun devicectl` is the CoreDevice path Xcode itself uses.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: native-live-reload.mjs <ios|android>');
  process.exit(1);
}

const target = JSON.parse(process.env[`SUTAMAYA_TARGET_${platform.toUpperCase()}`] ?? 'null');
const host = process.env.SUTAMAYA_DEV_HOST;
if (!target || !host) {
  console.error(`\nno resolved ${platform} target — run \`npm run dev:${platform}\`, which picks one first.`);
  process.exit(1);
}

const PORT = process.env.WEB_PORT || '5173';
const WORKER_PORT = process.env.WORKER_PORT || '8787';
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const iosAppDir = resolve(webDir, 'ios/App');
const iosNativeConfig = resolve(iosAppDir, 'App/capacitor.config.json');

function run(command, args, opts = {}) {
  const res = spawnSync(command, args, { encoding: 'utf8', ...opts });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0) {
    // A locked phone refuses the launch with a page of CoreDevice error detail that says one thing.
    if (/could not be, unlocked|BSErrorCodeDescription = Locked/.test(output)) {
      console.error(`\nunlock ${target.name} and run again — iOS won't launch an app onto a locked device.`);
    } else {
      console.error(`\n${command} ${args[0]} failed:\n${output}`);
    }
    process.exit(1);
  }
  return res.stdout ?? '';
}

// Builds, installs and launches on a physical device, the dev server's address compiled in:
// `server.url` in the native config is how Capacitor points a WebView at a dev server, and the build
// reads it from there. It is put back as soon as the build has read it, so an interrupted run can't
// leave the file naming a dev server that a later bundled build would try to load.
function launchOnDevice() {
  const original = readFileSync(iosNativeConfig, 'utf8');
  const config = JSON.parse(original);
  const derivedData = resolve(webDir, 'ios/DerivedData', target.id);
  const url = `http://${host}:${PORT}`;

  console.log(`\nbuilding for ${target.name}`);
  writeFileSync(iosNativeConfig, `${JSON.stringify({ ...config, server: { ...config.server, url } }, null, '\t')}\n`);
  const startedAt = Date.now();
  try {
    // The same invocation `cap run` makes, including the derived-data location, so the two paths
    // share one incremental build rather than each keeping a cold cache of its own.
    run(
      'xcrun',
      ['xcodebuild', '-project', 'App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', `id=${target.id}`, '-derivedDataPath', derivedData],
      { cwd: iosAppDir }
    );
  } finally {
    writeFileSync(iosNativeConfig, original);
  }

  console.log(`built in ${Math.round((Date.now() - startedAt) / 1000)}s — installing`);
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', target.deviceId, join(derivedData, 'Build/Products/Debug-iphoneos/App.app')]);
  run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', target.deviceId, config.appId]);
  console.log(`launched on ${target.name} against ${url}. Press Ctrl+C to quit.`);
}

// A simulator or emulator, through `cap run`: it writes the same `server.url`, builds, installs, and
// stays in the foreground until interrupted. `--forwardPorts` is `adb reverse`, which is what lets an
// emulator reach this machine's `localhost`.
function launchWithCapRun() {
  const args = ['cap', 'run', platform, '--live-reload', '--host', host, '--port', PORT, '--no-sync', '--target', target.id];
  if (platform === 'android') args.push('--forwardPorts', `${PORT}:${PORT}`);
  const child = spawn('npx', args, { cwd: webDir, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function reachable(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

const deadline = Date.now() + 90_000;
process.stdout.write('waiting for the web dev server and the Worker');
while (Date.now() < deadline) {
  if ((await reachable(`http://localhost:${PORT}`)) && (await reachable(`http://localhost:${WORKER_PORT}/api/health`))) {
    process.stdout.write('\n');
    break;
  }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 1000));
}
if (Date.now() >= deadline) {
  console.error('\ntimed out waiting for the dev server / Worker');
  process.exit(1);
}

if (target.kind === 'device') {
  launchOnDevice();
  // Held open so `concurrently -k` keeps the dev server and the Worker up behind the running app,
  // the way `cap run --live-reload` does on the simulator path.
  await new Promise((r) => setTimeout(r, 2 ** 31 - 1));
} else {
  launchWithCapRun();
}
