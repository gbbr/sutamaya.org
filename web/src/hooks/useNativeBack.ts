import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { App } from '@capacitor/app';
import { platformName } from '../lib/platform';
import { runTopBackHandler } from '../lib/native/backButton';
import { transitionPage } from '../lib/motion';

// Routes to '/' rather than being a screen with its own back target.
const ESCAPE_TO_HOME = new Set(['/settings', '/help']);

// The window event the iOS app sends for a swipe in from the left edge (web/ios/App/App/ViewController.swift).
const SWIPE_BACK_EVENT = 'swipeback';

/**
 * useNativeBack wires the native apps' Back, once, at the app root: Android's back button and the
 * iOS app's swipe in from the left edge, which take the same steps.
 *   1. dismiss whatever is open — the back-handler stack: overlays, drawers, a phone's sutta list, the Reader
 *   2. leave Settings and Help for the library
 *   3. with neither left, Android sends the app to the background and iOS does nothing
 */
export function useNativeBack(): void {
  const navigate = useNavigate();
  useEffect(() => {
    // back takes Back's next step, returning whether there was one.
    function back(): boolean {
      if (runTopBackHandler()) return true;
      if (!ESCAPE_TO_HOME.has(window.location.pathname)) return false;
      transitionPage('pop', () => navigate('/', { flushSync: true }));
      return true;
    }

    const platform = platformName();
    if (platform === 'ios') {
      window.addEventListener(SWIPE_BACK_EVENT, back);
      return () => window.removeEventListener(SWIPE_BACK_EVENT, back);
    }
    if (platform !== 'android') return;
    let handle: { remove: () => void } | undefined;
    let removed = false;
    void App.addListener('backButton', () => {
      if (!back()) void App.minimizeApp();
    }).then((h) => {
      if (removed) h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      handle?.remove();
    };
  }, [navigate]);
}
