import { navigate } from '@reach/router';
import type { User } from '../lib/types';

// Both branches navigate to /settings either way (see promptGoogleSignIn in AuthContext.tsx) —
// this badge and the Settings gear are always redundant, but only actually removed for the
// signed-in case below (the "G" sign-in badge is offered alongside the gear, not instead of it).
// Parameterized on size so mobile and desktop can each size it to match their own surrounding
// chrome (mobile much bigger — see TreePane's header).
export function SignedInBadge({ user, size, promptGoogleSignIn }: { user: User | null; size: number; promptGoogleSignIn: () => void }) {
  const dim = { width: size, height: size };
  return user ? (
    <button
      className="flex-none rounded-full overflow-hidden border-2 border-ink/25 flex items-center justify-center bg-accent/15 font-sans font-semibold text-accent"
      style={{ ...dim, fontSize: Math.round(size * 0.42) }}
      aria-label={`Signed in as ${user.email}`}
      title={`Signed in as ${user.email}`}
      onClick={() => navigate('/settings')}
    >
      {user.picture ? (
        <img src={user.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        user.email[0]?.toUpperCase()
      )}
    </button>
  ) : (
    // Google's own rendered "icon" button (google.accounts.id.renderButton with type: 'icon')
    // has an unpredictable natural size that doesn't fit cleanly into a small badge — at small
    // sizes it clips down to what reads as a blank white circle. This is deliberately just a
    // plain button showing Google's "G" mark, wired to `promptGoogleSignIn` (which navigates to
    // Settings — see the comment on it in AuthContext.tsx for why sign-in itself has to happen
    // from a real, full-size rendered button there rather than inline here).
    <button
      className="flex-none rounded-full border-2 border-ink/25 flex items-center justify-center hover:bg-ink/[.06]"
      style={dim}
      aria-label="Sign in with Google"
      title="Sign in with Google"
      onClick={promptGoogleSignIn}
    >
      <svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
      </svg>
    </button>
  );
}
