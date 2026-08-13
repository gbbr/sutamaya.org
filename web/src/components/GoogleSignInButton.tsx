import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getUiScale } from '../lib/uiPrefs';

// Renders Google's own Sign in with Google button (via the Identity Services script tag in
// index.html) instead of a plain click handler that calls `prompt()` — the rendered button is
// what Chrome's FedCM flow actually expects, so it's more reliable than One Tap alone. Only ever
// used full-width on the Settings page (Google's "standard" pill button) — no other variant/size
// has been needed, so this doesn't take props for one.
export function GoogleSignInButton() {
  const { googleReady } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  // Google's rendered button has a fixed pixel width baked into its iframe (no "100%" option),
  // so measure the container instead of hardcoding a value that'd either overflow a narrow
  // phone or leave a gap on a wide one.
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);

  // Measured once (plus on a genuine window resize, debounced) rather than via a live
  // ResizeObserver — the button below is destroyed and recreated every time `measuredWidth`
  // changes (Google's iframe has no resize API), and a ResizeObserver fires on any incidental
  // content shift (a scrollbar toggling, a web font swapping in), not just real viewport resizes.
  // That was tearing out and rebuilding the live button, with a real window where a click lands on
  // an empty/mid-replacement container and is silently lost.
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => setMeasuredWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    let timeout: number | undefined;
    const onResize = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(measure, 250);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!googleReady || !ref.current || !window.google || !measuredWidth) return; // wait for the first measurement
    ref.current.innerHTML = '';
    window.google.accounts.id.renderButton(ref.current, {
      type: 'standard',
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      // measuredWidth comes from getBoundingClientRect(), which reports the container's actual
      // on-screen (already-zoomed) width. The `width` option below, in contrast, becomes a CSS
      // length assigned *inside* the zoomed <html> (applyUiScale, lib/uiPrefs.ts) — same as
      // index.css's <html> height rule, it gets zoomed a second time at paint time unless
      // divided back down by getUiScale() first, or the button ends up wider than its own
      // container (worse the higher the UI-size setting). Also clamp to Google's own supported
      // width range (200-400px, in that same local/zoomed unit space) — it silently ignores
      // values outside that range, so a narrower/wider container shouldn't silently end up with
      // a button wider than its box either.
      width: Math.min(400, Math.max(200, Math.round(measuredWidth / getUiScale()))),
    });
  }, [googleReady, measuredWidth]);

  // Fixed height to match Google's own rendered button height and avoid a layout flicker while
  // it loads in.
  return <div ref={ref} style={{ height: '40px', display: 'flex' }} data-component="GoogleSignInButton" className="w-full" />;
}
