import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativeApp } from './platform';

// Confirms to the updater plugin that the running bundle booted far enough to render. Until this
// call lands, a bundle is provisional: if the plugin's `appReadyTimeout` (capacitor.config.ts)
// elapses first, the bundle is marked broken and the device rolls back to the last good one. It
// guards the built-in bundle too, so it runs on every native launch, not only after an
// over-the-air update.
//
// Called from main.tsx at first paint — as early as possible, so a slow device never trips the
// rollback on a bundle that is merely loading. Statically imported: a Capacitor plugin behind a
// dynamic import can deadlock in the WebView on the startup path. Inert on web.
export function notifyBundleReady(): void {
  if (!isNativeApp()) return;
  void CapacitorUpdater.notifyAppReady().catch(() => {
    // The plugin resolves this even with no active update; a rejection means the native side is
    // unavailable, and there is nothing to recover here.
  });
}
