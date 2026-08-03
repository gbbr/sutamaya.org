import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!googleReady || !ref.current || !window.google) return;
    ref.current.innerHTML = '';
    window.google.accounts.id.renderButton(
      ref.current,
      variant === 'icon'
        ? { type: 'icon', shape: 'circle', theme: 'outline', size: 'small' }
        : { type: 'standard', theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width }
    );
  }, [googleReady, variant, width]);

  return <div ref={ref} className="flex-none" />;
}
