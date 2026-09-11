// Picks the simulator or device each platform will run on, then starts the Worker, the web dev
// server and one launcher per platform under `concurrently`. Run by `npm run dev:ios` /
// `dev:android` / `dev:native`.
//
// Resolving the target here, before anything starts, is what lets the dev server be told the right
// API origin: `SUTAMAYA_API_BASE` is a build-time define (web/vite.config.ts), fixed when Vite
// boots, and which address the app must call depends on the target — a simulator or emulator reaches
// this machine on `localhost`, a physical device only at its LAN address. Resolving first also means
// an unreachable or ambiguous target fails with a picklist instead of after two servers have come
// up. The chosen target rides to the launcher in the environment, where a device name with spaces or
// an apostrophe needs no quoting.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.WEB_PORT) || 5173;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const platforms = args.filter((a) => !a.startsWith('--'));
if (platforms.length === 0 || platforms.some((p) => p !== 'ios' && p !== 'android')) {
  console.error('usage: dev-native.mjs <ios|android> [ios|android] [--list]');
  process.exit(1);
}

const adbBin = process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';

// The native projects hold the synced web assets `cap run` and `xcodebuild` build against — produced
// only by `npm run build:native` and git-ignored, so absent on a fresh checkout. Without them the
// build fails deep in the native toolchain with nothing pointing back here. Listing targets builds
// nothing, so it is allowed without them.
for (const platform of listOnly ? [] : platforms) {
  const assets = {
    ios: resolve(rootDir, 'web/ios/App/App/public'),
    android: resolve(rootDir, 'web/android/app/src/main/assets/public'),
  }[platform];
  if (!existsSync(assets)) {
    console.error(`\nthe ${platform} project has no synced bundle yet — run \`npm run build:native\` once first.`);
    process.exit(1);
  }
}

function json(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

// This machine's current LAN IP — read on every run, never cached or hardcoded, so it tracks
// whatever network this machine is on. Takes the interface behind the default route rather than
// guessing a name like `en0`, which breaks the moment a USB-Ethernet dongle or a VPN is involved.
function lanIp() {
  const iface = spawnSync('route', ['get', '1.1.1.1'], { encoding: 'utf8' }).stdout.match(/interface: (\S+)/)?.[1];
  if (iface) {
    const ip = spawnSync('ipconfig', ['getifaddr', iface], { encoding: 'utf8' }).stdout.trim();
    if (ip) return ip;
  }
  for (const list of Object.values(networkInterfaces())) {
    const found = list?.find((i) => i.family === 'IPv4' && !i.internal);
    if (found) return found.address;
  }
  return null;
}

function simulatorTargets() {
  const out = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' });
  return Object.values(json(out.stdout).devices ?? {})
    .flat()
    .map((d) => ({
      platform: 'ios',
      kind: 'simulator',
      id: d.udid,
      name: d.name,
      running: d.state === 'Booted',
      note: d.state === 'Booted' ? 'booted' : undefined,
    }));
}

// Physical devices, by way of CoreDevice. Both of its ids are kept: an `xcodebuild` destination
// takes the hardware udid, `devicectl` its own identifier. A device that is paired but out of reach
// is left out — it can be neither built for nor installed to.
function deviceTargets() {
  const out = join(mkdtempSync(join(tmpdir(), 'sutamaya-devices-')), 'devices.json');
  spawnSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', out], { encoding: 'utf8' });
  if (!existsSync(out)) return [];
  return (json(readFileSync(out, 'utf8')).result?.devices ?? [])
    .filter(
      (d) =>
        d.hardwareProperties?.platform === 'iOS' &&
        d.connectionProperties?.pairingState === 'paired' &&
        d.connectionProperties?.tunnelState !== 'unavailable'
    )
    .map((d) => ({
      platform: 'ios',
      kind: 'device',
      id: d.hardwareProperties.udid,
      deviceId: d.identifier,
      name: d.deviceProperties?.name ?? d.identifier,
      running: true,
    }));
}

// Real devices first, then simulators, each carrying the index `IOS_DEVICE` accepts — held on the
// target itself so a subset of the list can still be printed against its true indices.
function iosTargets() {
  return [...deviceTargets(), ...simulatorTargets()].map((t, index) => ({ ...t, index }));
}

// `note` is whatever is worth saying about a target beyond its kind, in each platform's own
// vocabulary — a booted simulator, an emulator that isn't up yet.
function targetLines(targets, log = console.error) {
  for (const t of targets) log(`  ${t.index}  ${t.name}  (${t.kind}${t.note ? `, ${t.note}` : ''})`);
}

function printTargets(targets, envVar, platform) {
  targetLines(targets);
  console.error(`\nName one with ${envVar} — an index, or enough of the name to be unambiguous:`);
  console.error(`  ${envVar}=${targets[0]?.index ?? 0} npm run dev:${platform}`);
}

// Resolves an override: an index into the list as printed, or a case-insensitive fragment of a name,
// which survives the reordering an index doesn't. Returns the matches rather than one target, so an
// ambiguous fragment can be answered with the handful it matched instead of the whole list.
function matchTargets(override, targets) {
  if (/^\d+$/.test(override)) {
    const byIndex = targets.find((t) => t.index === Number(override));
    return byIndex ? [byIndex] : [];
  }
  return targets.filter((t) => t.name.toLowerCase().includes(override.toLowerCase()));
}

// The one target an override names, or a report of why it didn't name one.
function resolveOverride(override, targets, envVar, platform) {
  const matches = matchTargets(override, targets);
  if (matches.length === 1) return matches[0];
  console.error(
    matches.length === 0
      ? `\n${envVar}=${override} matched no target:`
      : `\n${envVar}=${override} matched ${matches.length} targets — narrow it:`
  );
  printTargets(matches.length > 1 ? matches : targets, envVar, platform);
  process.exit(1);
}

// A running simulator is the default, so the everyday run needs no arguments; anything else — another
// simulator, or a physical device — is named through `IOS_DEVICE`, which takes precedence over a
// booted one. Resolved here rather than left to `cap run`'s interactive picker, whose arrow-key
// prompt doesn't get a usable TTY through `concurrently`.
function iosTarget() {
  const targets = iosTargets();
  const override = process.env.IOS_DEVICE;
  if (override) return resolveOverride(override, targets, 'IOS_DEVICE', 'ios');

  const running = targets.find((t) => t.running);
  if (running) return running;

  console.error('\nno booted simulator. Pick a target:');
  printTargets(targets, 'IOS_DEVICE', 'ios');
  process.exit(1);
}

const emulatorBin = process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME, 'emulator/emulator') : 'emulator';

function adb(args) {
  return (spawnSync(adbBin, args, { encoding: 'utf8' }).stdout || '').trim();
}

function runningSerials() {
  return adb(['devices'])
    .split('\n')
    .filter((l) => /\tdevice$/.test(l))
    .map((l) => l.split('\t')[0]);
}

// What a serial is actually called: an emulator answers with its AVD name over the emulator console,
// a phone with its model. Either way better to choose from than `emulator-5554`.
function androidName(serial) {
  if (serial.startsWith('emulator-')) {
    const avd = adb(['-s', serial, 'emu', 'avd', 'name'])
      .split('\n')[0]
      .trim();
    return avd && avd !== 'OK' ? avd : serial;
  }
  return adb(['-s', serial, 'shell', 'getprop', 'ro.product.model']) || serial;
}

// Everything running, then the AVDs that aren't — which can be named too, and are booted on demand.
// An AVD already running is listed once, as the running one.
function androidTargets() {
  const running = runningSerials().map((serial) => ({
    platform: 'android',
    kind: serial.startsWith('emulator-') ? 'emulator' : 'device',
    id: serial,
    name: androidName(serial),
    running: true,
  }));
  const offline = (spawnSync(emulatorBin, ['-list-avds'], { encoding: 'utf8' }).stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((avd) => avd && !running.some((t) => t.name === avd))
    .map((avd) => ({ platform: 'android', kind: 'emulator', avd, name: avd, running: false, note: 'not running' }));
  return [...running, ...offline].map((t, index) => ({ ...t, index }));
}

// Starts an AVD and waits for it to finish booting, since `adb` only accepts a device once it has.
// Detached, so it outlives this script the way an emulator started by hand does.
async function bootAndroid(target) {
  const before = new Set(runningSerials());
  console.log(`booting ${target.avd} — this takes a while`);
  spawn(emulatorBin, ['-avd', target.avd], { detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const serial = runningSerials().find((s) => !before.has(s));
    if (serial && adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']) === '1') {
      return { ...target, id: serial, running: true };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`\n${target.avd} didn't finish booting in time.`);
  process.exit(1);
}

// A running device or emulator is the default; `ANDROID_DEVICE` names another, an AVD that isn't up
// included — that one alone is booted here, since booting is slow enough to be worth asking for
// rather than having happen by surprise.
async function androidTarget() {
  const targets = androidTargets();
  const override = process.env.ANDROID_DEVICE;
  if (override) {
    const chosen = resolveOverride(override, targets, 'ANDROID_DEVICE', 'android');
    return chosen.running ? chosen : bootAndroid(chosen);
  }

  const running = targets.find((t) => t.running);
  if (running) return running;

  console.error('\nnothing running. Pick a target:');
  printTargets(targets, 'ANDROID_DEVICE', 'android');
  process.exit(1);
}

// `--list` answers "what can I name?" without starting anything, the everyday run otherwise printing
// only the target it picked. Indices are per platform, each list starting at 0.
if (listOnly) {
  const envVars = { ios: 'IOS_DEVICE', android: 'ANDROID_DEVICE' };
  for (const platform of platforms) {
    const targets = platform === 'ios' ? iosTargets() : androidTargets();
    console.log(`\n${platform}:`);
    if (targets.length === 0) console.log('  none — boot a simulator/emulator, or connect a device');
    else targetLines(targets, console.log);
  }
  console.log('\nWhatever is already running is the default. Pick another with an index, or enough of a name:');
  for (const platform of platforms) console.log(`  ${envVars[platform]}=0 npm run dev:${platform}`);
  console.log('\nAn Android AVD that is not running is booted for you when named; a simulator is booted by `cap run`.');
  process.exit(0);
}

const targets = await Promise.all(platforms.map((p) => (p === 'ios' ? iosTarget() : androidTarget())));

// One address for the whole session, since one dev server serves it: the LAN IP as soon as a physical
// iPhone or iPad is among the targets, which a simulator and an emulator can reach just as well as
// `localhost`. Plain `localhost` otherwise, that being the only host Google accepts as an OAuth
// redirect — so a simulator run keeps Google sign-in, and an iOS device run trades it for the emailed
// code (see docs/native-apps.md). A physical *Android* phone stays on `localhost`: `adb reverse` gives
// it the host's loopback over the cable, so it keeps Google sign-in too.
const host = targets.some((t) => t.platform === 'ios' && t.kind === 'device') ? lanIp() : 'localhost';
if (!host) {
  console.error("\ncould not determine this machine's LAN IP, which a physical device needs to reach it.");
  process.exit(1);
}

for (const target of targets) {
  console.log(`${target.platform}: ${target.name} (${target.kind}) — live reload from http://${host}:${PORT}`);
}

const colors = { ios: 'magenta', android: 'yellow' };
const child = spawn(
  'npx',
  [
    'concurrently',
    '-k',
    '-n',
    ['worker', 'web', ...platforms].join(','),
    '-c',
    ['blue', 'green', ...platforms.map((p) => colors[p])].join(','),
    'npm run dev:worker',
    'npm run dev:web',
    ...platforms.map((p) => `node scripts/native-live-reload.mjs ${p}`),
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      SUTAMAYA_API_BASE: `http://${host}:${PORT}`,
      SUTAMAYA_DEV_HOST: host,
      ...Object.fromEntries(targets.map((t) => [`SUTAMAYA_TARGET_${t.platform.toUpperCase()}`, JSON.stringify(t)])),
    },
  }
);
child.on('exit', (code) => process.exit(code ?? 0));
