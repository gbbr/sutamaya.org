import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface GoogleSignInButtonProps {
  // "icon" is a bare circular G, for the compact sign-in badge; "standard" is Google's full
  // pill button with "Sign in with Google" text, for the Settings page.
  variant: 'icon' | 'standard';
  width?: number;
}

// Renders Google's own Sign in with Google button (via the Identity Services script tag in
// index.html) instead of a plain click handler that calls `prompt()` — the rendered button is
// what Chrome's FedCM flow actually expects, so it's both more reliable than One Tap alone and
// unmistakably a Google sign-in affordance (the "G" logo the icon variant shows).
export function GoogleSignInButton({ variant, width }: GoogleSignInButtonProps) {
  const { googleReady } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  // Google's rendered button has a fixed pixel width baked into its iframe (no "100%" option),
  // so for the standard variant — used full-width on the Settings page — measure the container
  // instead of hardcoding a value that'd either overflow a narrow phone or leave a gap on a
  // wide one.
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(width);

  // Measured once (plus on a genuine window resize, debounced) rather than via a live
  // ResizeObserver — the button below is destroyed and recreated every time `measuredWidth`
  // changes (Google's iframe has no resize API), and a ResizeObserver fires on any incidental
  // content shift (a scrollbar toggling, a web font swapping in), not just real viewport resizes.
  // That was tearing out and rebuilding the live button, with a real window where a click lands on
  // an empty/mid-replacement container and is silently lost.
  useEffect(() => {
    if (variant !== 'standard' || width != null || !ref.current) return;
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
  }, [variant, width]);

  useEffect(() => {
    if (!googleReady || !ref.current || !window.google) return;
    if (variant === 'standard' && width == null && !measuredWidth) return; // wait for the first measurement
    ref.current.innerHTML = '';
    window.google.accounts.id.renderButton(
      ref.current,
      variant === 'icon'
        ? { type: 'icon', shape: 'circle', theme: 'outline', size: 'small' }
        : { type: 'standard', theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: measuredWidth }
    );
  }, [googleReady, variant, measuredWidth]);

  return <div ref={ref} data-component="GoogleSignInButton" className={variant === 'standard' ? 'w-full' : 'flex-none'} />;
}
