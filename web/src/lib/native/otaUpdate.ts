import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativeApp } from '../platform';

// Confirms to the updater plugin that the running bundle's code loaded and ran. Until this call
// lands, a bundle is provisional: if the plugin's `appReadyTimeout` (capacitor.config.ts) elapses
// first, the bundle is marked broken and the device rolls back to the last good one. It guards the
// built-in bundle too, so it runs on every native launch, not only after an over-the-air update.
//
// main.tsx calls it as its first statement, so nothing on the startup path can throw ahead of it
// and cost a working bundle a rollback. A render-time crash is not its business — that reaches
// ErrorBoundary and would reach it on a store build too. Statically imported: a Capacitor plugin
// behind a dynamic import can deadlock in the WebView on the startup path. Inert on web.
export function notifyBundleReady(): void {
  if (!isNativeApp()) return;
  void CapacitorUpdater.notifyAppReady().catch(() => {
    // The plugin resolves this even with no active update; a rejection means the native side is
    // unavailable, and there is nothing to recover here.
  });
}

/**
 * What an over-the-air update is doing, as the version line at the foot of Settings names it:
 *   current     – the running bundle is the published one
 *   downloading – a newer bundle is downloading in the background
 *   ready       – a downloaded bundle is waiting to be switched to
 *   failed      – a download failed; the updater tries again the next time the app opens
 *   store       – this build is below the minimum native build; the update comes from the store
 */
export type UpdateStatus = 'current' | 'downloading' | 'ready' | 'failed' | 'store';

// What the updater reports as it works, which is everything but `current` and `store`.
export type UpdateReport = Exclude<UpdateStatus, 'current' | 'store'>;

// The updater's latest report since launch, null before its first.
let latestReport: UpdateReport | null = null;
// Whoever is showing the reports, told when a new one lands.
const reportListeners = new Set<() => void>();
// Whether the updater's last version check failed, which it follows with a `downloadFailed` of its own.
let checkFailed = false;

// Records a report from the updater and tells whoever is showing it.
function record(report: UpdateReport) {
  latestReport = report;
  reportListeners.forEach((listener) => listener());
}

// Starts recording the updater's reports — a download starting, finishing or failing — from launch,
// since the plugin doesn't replay them to a listener that subscribes later. Inert on web.
export function watchUpdates(): void {
  if (!isNativeApp()) return;
  Promise.all([
    CapacitorUpdater.addListener('download', () => record('downloading')),
    CapacitorUpdater.addListener('updateAvailable', () => record('ready')),
    CapacitorUpdater.addListener('updateCheckResult', ({ kind }) => {
      checkFailed = kind === 'failed';
    }),
    CapacitorUpdater.addListener('downloadFailed', () => {
      if (!checkFailed) record('failed');
      checkFailed = false;
    }),
  ]).catch(() => {
    // A rejection means the native side is unavailable, and there is nothing to record.
  });
}

/**
 * Asks the updater to look for a newer bundle now, as it does each time the app comes to the
 * foreground, and resolves whether the updater runs at all. It doesn't under live reload, where
 * the app loads the dev server instead of a bundle.
 */
export async function checkForUpdate(): Promise<boolean> {
  const { enabled } = await CapacitorUpdater.isAutoUpdateEnabled();
  if (enabled) await CapacitorUpdater.triggerUpdateCheck();
  return enabled;
}

// Returns the updater's latest report since launch, or null before its first.
export function updateReport(): UpdateReport | null {
  return latestReport;
}

// Subscribes to the updater's reports, in useSyncExternalStore's shape; returns the unsubscribe.
export function subscribeUpdateReports(listener: () => void): () => void {
  reportListeners.add(listener);
  return () => reportListeners.delete(listener);
}

/**
 * Returns what an update is doing, once checkForUpdate has run: `ready` while a downloaded bundle
 * waits, else the updater's latest report, else what the Worker publishes — `current` when it names
 * the running bundle, `downloading` when it names another, which the check has the updater fetch,
 * `store` when it withholds the bundle from a build below the minimum native build. Null when that
 * can't be told: no answer from the Worker, a bundle withheld for another reason, or an updater
 * that doesn't run.
 */
export async function readUpdateStatus(
  report: UpdateReport | null,
  // What checkForUpdate resolved.
  updaterRuns: boolean
): Promise<UpdateStatus | null> {
  const [{ bundle }, next] = await Promise.all([CapacitorUpdater.current(), CapacitorUpdater.getNextBundle()]);
  // With nothing waiting, the plugin resolves an empty result rather than null.
  if (next?.id && next.id !== bundle.id && next.status !== 'error') return 'ready';
  if (report) return report;
  const latest = await CapacitorUpdater.getLatest();
  if (latest.kind === 'blocked') return latest.error === 'below_min_native' ? 'store' : null;
  if (latest.version === bundle.version) return 'current';
  return updaterRuns ? 'downloading' : null;
}

// Switches to the downloaded bundle now, rather than the next time the app goes to the background.
// The WebView reloads into it, so nothing after this call runs.
export function applyUpdate(): void {
  void CapacitorUpdater.reload().catch(() => {
    // The bundle still switches in the next time the app goes to the background.
  });
}
