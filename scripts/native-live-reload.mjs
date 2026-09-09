// Waits for the web dev server and the Worker to come up, then launches the native app in
// live-reload mode pointed at the dev server — web edits reload in the simulator with no rebuild.
// Run by `npm run dev:ios` / `npm run dev:android`, which start the two servers alongside it.
//
// The WebView loads from `localhost:5173`, so `/api/*` is same-origin and rides Vite's proxy to the
// Worker — no CORS, unlike a bundled build pointed straight at the Worker. The iOS simulator shares
// the host's loopback; for Android, `--forwardPorts` runs `adb reverse` so the emulator's
// `localhost:5173` reaches the host too (which also keeps Google happy — it only allows
// `http://localhost` as an OAuth redirect host, not `10.0.2.2`).
//
// A one-time `npm run build:native` must have run first, so the native projects have the current
// bundle; this passes `--no-sync` to `cap run` and never rebuilds it.

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: native-live-reload.mjs <ios|android>');
  process.exit(1);
}

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const adbBin = process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';

// The device to deploy to, resolved here rather than left to `cap run`'s interactive picker — its
// arrow-key prompt doesn't get a usable TTY through `concurrently`.
function bootedTarget() {
  if (platform === 'ios') {
    const out = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' });
    const runtimes = JSON.parse(out.stdout || '{}').devices ?? {};
    for (const list of Object.values(runtimes)) {
      if (list[0]) return list[0].udid;
    }
    return null;
  }
  const out = spawnSync(adbBin, ['devices'], { encoding: 'utf8' });
  const line = (out.stdout || '').split('\n').find((l) => /\tdevice$/.test(l));
  return line ? line.split('\t')[0] : null;
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
  if ((await reachable('http://localhost:5173')) && (await reachable('http://localhost:8787/api/health'))) {
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

const target = bootedTarget();
if (!target) {
  if (platform === 'ios') {
    console.error('\nno booted simulator. Boot one with `xcrun simctl boot "<name>"` — available:');
    const list = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available'], { encoding: 'utf8' });
    console.error(
      (list.stdout || '')
        .split('\n')
        .filter((l) => /\([0-9A-F-]{36}\)/.test(l))
        .map((l) => '  ' + l.replace(/\s*\([0-9A-F-]{36}\).*$/, '').trim())
        .join('\n')
    );
  } else {
    console.error('\nno running emulator. Start one with `emulator -avd <name>` — available:');
    const emu = process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME, 'emulator/emulator') : 'emulator';
    console.error((spawnSync(emu, ['-list-avds'], { encoding: 'utf8' }).stdout || '').trim());
  }
  process.exit(1);
}

const args = ['cap', 'run', platform, '--live-reload', '--host', 'localhost', '--port', '5173', '--no-sync', '--target', target];
if (platform === 'android') args.push('--forwardPorts', '5173:5173');

const child = spawn('npx', args, { cwd: webDir, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
