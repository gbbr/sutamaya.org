import { useEffect } from 'react';
import { navigate } from '@reach/router';
import { App } from '@capacitor/app';
import { platformName } from '../lib/platform';
import { runTopBackHandler } from '../lib/backButton';

// Routes to '/' rather than being a screen with its own back target.
const ESCAPE_TO_HOME = new Set(['/settings', '/help']);

// Wires Android's hardware / gesture back button, once, at the app root. It dismisses whatever is
// open first (the back-handler stack — overlays, drawers, the mobile list sub-view, the reader
// itself), then leaves Settings and Help for the library, then sends the app to the background
// rather than exiting. iOS has no such button and web ignores the event, so this only ever fires
// inside the Android shell.
export function useAndroidBackButton(): void {
  useEffect(() => {
    if (platformName() !== 'android') return;
    let handle: { remove: () => void } | undefined;
    let removed = false;
    void App.addListener('backButton', () => {
      if (runTopBackHandler()) return;
      if (ESCAPE_TO_HOME.has(window.location.pathname)) {
        void navigate('/');
        return;
      }
      void App.minimizeApp();
    }).then((h) => {
      if (removed) h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      handle?.remove();
    };
  }, []);
}
