// Starts the OAuth redirect flow as a plain same-origin link: no SDK to load, and no cross-origin
// iframe for Safari's storage partitioning to break. An <a> rather than a button, this being a
// navigation, so it behaves like one — a visible target, and a middle-click opens a working tab.
//
// `returnTo` is where the reader was when they were sent to sign in, so the round trip ends there
// rather than on Settings; it falls back to the current URL. The Worker validates it on both legs,
// so this is a convenience rather than a trust boundary.
export function GoogleSignInButton({ returnTo }: { returnTo?: string }) {
  const here = typeof window === 'undefined' ? '/settings' : window.location.pathname + window.location.search;
  // Absolute, the origin being the half the Worker can't infer — in dev it sits behind Vite's
  // proxy, which rewrites Host — and what lets one dev server serve both localhost and the
  // hostname a phone reaches it by. Only configured origins are honoured.
  const target =
    typeof window === 'undefined' ? returnTo || here : new URL(returnTo || here, window.location.href).href;
  const href = `/api/auth/google/start?return=${encodeURIComponent(target)}`;

  return (
    <a
      data-component="GoogleSignInButton"
      href={href}
      className="flex items-center justify-center gap-2 w-full py-[12px] rounded-field border border-ink/[.18] font-sans text-ui-base font-medium text-ink hover:text-ink hover:bg-ink/[.04]"
    >
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" className="flex-none">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        />
      </svg>
      Sign in with Google
    </a>
  );
}
