import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { isNativeApp } from '../lib/platform';
import { hasNativeAppleSignIn } from '../lib/native/appleSignIn';
import { useAuth } from '../context/AuthContext';

// AppleSignInButton starts Sign in with Apple, beside Google's button and with the same face. On
// the website it is a plain link into the Worker's redirect flow, as GoogleSignInButton is; in the
// iOS app it opens the system sheet. It renders nothing in a native shell without the plugin —
// the Android app, and iOS builds that predate it.

const CLASSES =
  'flex items-center justify-center gap-2 w-full py-[12px] rounded-field border border-ink/[.18] font-sans text-ui-base font-medium text-ink hover:text-ink hover:bg-ink/[.04] disabled:opacity-60 disabled:hover:bg-transparent';

function AppleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 814 1000" aria-hidden="true" className="flex-none" fill="currentColor">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

export function AppleSignInButton({ returnTo }: { returnTo?: string }) {
  const { signInWithAppleNative } = useAuth();
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);

  if (isNativeApp()) {
    if (!hasNativeAppleSignIn()) return null;
    const signIn = async () => {
      setWorking(true);
      const signedIn = await signInWithAppleNative();
      setWorking(false);
      if (signedIn && returnTo) navigate(returnTo);
    };
    return (
      <button type="button" data-component="AppleSignInButton" onClick={() => void signIn()} disabled={working} className={CLASSES}>
        {working ? <Loader2 size={16} strokeWidth={2.25} className="flex-none animate-spin" aria-hidden /> : <AppleMark />}
        {working ? 'Signing in…' : 'Sign in with Apple'}
      </button>
    );
  }

  const here = typeof window === 'undefined' ? '/settings' : window.location.pathname + window.location.search;
  // Absolute, for the same reason as GoogleSignInButton's: the origin is the half the Worker can't infer.
  const target =
    typeof window === 'undefined' ? returnTo || here : new URL(returnTo || here, window.location.href).href;
  const href = `/api/auth/apple/start?return=${encodeURIComponent(target)}`;

  return (
    <a data-component="AppleSignInButton" href={href} className={CLASSES}>
      <AppleMark />
      Sign in with Apple
    </a>
  );
}
