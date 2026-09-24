import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The updater plugin as these tests drive it: the listeners the app registered, whether it runs,
// the checks asked of it, the bundle running, the one waiting, and the Worker's answer to a check.
const updater = vi.hoisted(() => ({
  listeners: {} as Record<string, (event?: unknown) => void>,
  enabled: true,
  checks: 0,
  running: { id: 'b1', version: '0.1.0-aaaa' },
  waiting: null as unknown,
  latest: { version: '0.1.0-aaaa' } as { version: string; kind?: string; error?: string },
}));

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: {
    addListener: async (event: string, listener: (event?: unknown) => void) => {
      updater.listeners[event] = listener;
      return { remove: async () => {} };
    },
    isAutoUpdateEnabled: async () => ({ enabled: updater.enabled }),
    triggerUpdateCheck: async () => {
      updater.checks += 1;
      return { status: 'queued', queued: true };
    },
    current: async () => ({ bundle: updater.running, native: '1.0.0' }),
    getNextBundle: async () => updater.waiting,
    getLatest: async () => updater.latest,
  },
}));

// A fresh copy of the module, since it records the updater's reports for the whole launch.
async function freshModule() {
  vi.resetModules();
  return import('./otaUpdate');
}

beforeEach(() => {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  updater.listeners = {};
  updater.enabled = true;
  updater.checks = 0;
  updater.waiting = null;
  updater.latest = { version: updater.running.version };
});

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe('watchUpdates', () => {
  it('records a download under way, then the bundle it left waiting', async () => {
    const ota = await freshModule();
    ota.watchUpdates();
    const told = vi.fn();
    ota.subscribeUpdateReports(told);

    updater.listeners.download();
    expect(ota.updateReport()).toBe('downloading');
    updater.listeners.updateAvailable();
    expect(ota.updateReport()).toBe('ready');
    expect(told).toHaveBeenCalledTimes(2);
  });

  it('records a failed download, even one whose start it missed', async () => {
    const ota = await freshModule();
    ota.watchUpdates();

    updater.listeners.downloadFailed();
    expect(ota.updateReport()).toBe('failed');
  });

  it('ignores the failure that follows a failed version check', async () => {
    const ota = await freshModule();
    ota.watchUpdates();

    updater.listeners.updateCheckResult({ kind: 'failed' });
    updater.listeners.downloadFailed();
    expect(ota.updateReport()).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('asks the updater to check, unless it does not run', async () => {
    const ota = await freshModule();
    expect(await ota.checkForUpdate()).toBe(true);
    expect(updater.checks).toBe(1);

    updater.enabled = false;
    expect(await ota.checkForUpdate()).toBe(false);
    expect(updater.checks).toBe(1);
  });
});

describe('readUpdateStatus', () => {
  it('is ready while a downloaded bundle waits, whatever was reported', async () => {
    const ota = await freshModule();
    updater.waiting = { id: 'b2', version: '0.1.0-bbbb', status: 'pending' };
    expect(await ota.readUpdateStatus('downloading', true)).toBe('ready');
  });

  it('takes the empty result the plugin gives with nothing waiting as nothing waiting', async () => {
    const ota = await freshModule();
    updater.waiting = {};
    expect(await ota.readUpdateStatus('failed', true)).toBe('failed');
  });

  it('is current when the Worker names the running bundle, and downloading when it names another', async () => {
    const ota = await freshModule();
    expect(await ota.readUpdateStatus(null, true)).toBe('current');

    updater.latest = { version: '0.1.0-bbbb' };
    expect(await ota.readUpdateStatus(null, true)).toBe('downloading');
    // Nothing downloads where the updater doesn't run.
    expect(await ota.readUpdateStatus(null, false)).toBeNull();
  });

  it('sends a build below the minimum native build to the store, and tells nothing else withheld', async () => {
    const ota = await freshModule();
    // A withheld bundle comes back with the running version echoed.
    updater.latest = { version: updater.running.version, kind: 'blocked', error: 'below_min_native' };
    expect(await ota.readUpdateStatus(null, true)).toBe('store');

    updater.latest = { version: updater.running.version, kind: 'blocked', error: 'update_withheld' };
    expect(await ota.readUpdateStatus(null, true)).toBeNull();
  });
});
