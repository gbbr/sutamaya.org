#!/usr/bin/env node
// Runs the given command with the Firestore emulator guaranteed to be up — starts it first if
// nothing's already listening on its configured port, and stops the instance *it* started
// afterward (an emulator someone already had running, e.g. via `npm run dev:server`, is left
// alone). Needed because server/src/routes/*.test.js exercises the real routes against a real
// Firestore instance (server/src/testUtils/testApp.js) — this makes `npm test`/`npm run deploy`
// work without a manually-started emulator as a precondition.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync } from 'node:fs';

const firebaseConfig = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const PORT = firebaseConfig.emulators?.firestore?.port ?? 8081;
const HOST = '127.0.0.1';

function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port, host)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const [, , command, ...args] = process.argv;
if (!command) {
  console.error('Usage: with-emulator.mjs <command> [args...]');
  process.exit(1);
}

const alreadyRunning = await isPortOpen(PORT, HOST);
let emulator = null;

if (!alreadyRunning) {
  console.log(`with-emulator: starting Firestore emulator on ${HOST}:${PORT}…`);
  // `detached: true` puts the emulator (and the Java process it spawns) in its own process
  // group, so `process.kill(-pid, …)` below can stop both together.
  emulator = spawn(
    'npx',
    ['firebase-tools', 'emulators:start', '--only', 'firestore', '--project', 'sutamaya-local'],
    { stdio: 'inherit', detached: true }
  );
  const ready = await waitForPort(PORT, HOST, 45000);
  if (!ready) {
    console.error('with-emulator: Firestore emulator did not become ready in time.');
    if (emulator.pid) {
      try {
        process.kill(-emulator.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    process.exit(1);
  }
} else {
  console.log(`with-emulator: reusing Firestore emulator already running on ${HOST}:${PORT}.`);
}

const exitCode = await run(command, args);

if (emulator && emulator.pid) {
  console.log('with-emulator: stopping the emulator instance this script started…');
  try {
    process.kill(-emulator.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

process.exit(exitCode);
