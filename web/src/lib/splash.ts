import { SplashScreen } from '@capacitor/splash-screen';
import { isNativeApp } from './platform';

// Dismisses the native launch splash once the web layer has painted its first frame. The app's own
// loading screen (App.tsx's <Splash>) takes over from there while the corpus loads, so there is no
// white flash between the two. capacitor.config.ts's `launchAutoHide` is only a backstop for a
// launch that never paints. Inert on web.
//
// Statically imported: a Capacitor plugin behind a dynamic import can deadlock in the WebView on
// the startup path, which this is.
export function hideNativeSplash(): void {
  if (!isNativeApp()) return;
  requestAnimationFrame(() => {
    void SplashScreen.hide().catch(() => {
      // Already hidden, or the call failed — nothing to recover.
    });
  });
}
