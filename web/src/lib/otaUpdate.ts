import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativeApp } from './platform';

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
