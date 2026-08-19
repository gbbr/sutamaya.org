import { useState } from 'react';
import { navigate } from '@reach/router';
import { UserRound } from 'lucide-react';
import type { User } from '../lib/types';

// Both branches navigate to /settings either way (see promptGoogleSignIn in AuthContext.tsx) —
// this badge and the Settings gear are always redundant, but only actually removed for the
// signed-in case below (the "G" sign-in badge is offered alongside the gear, not instead of it).
// Parameterized on size so mobile and desktop can each size it to match their own surrounding
// chrome (mobile much bigger — see TreePane's header).
export function SignedInBadge({ user, size, promptGoogleSignIn }: { user: User | null; size: number; promptGoogleSignIn: () => void }) {
  const dim = { width: size, height: size };
  // The initials render first and stay put until the <img> actually finishes loading — Google's
  // avatar URL is unreachable offline (it's not something the PWA precaches), and revealing the
  // <img> only on success means an offline/failed load just leaves the initials showing, rather
  // than flashing the browser's broken-image glyph before falling back. `key` resets `loaded`
  // on a real account switch, so a new picture gets its own fresh attempt.
  const [loaded, setLoaded] = useState(false);
  return user ? (
    <button
      data-component="SignedInBadge"
      className="flex-none rounded-full overflow-hidden border border-ink/25 flex items-center justify-center bg-accent/15 font-sans font-semibold text-accent"
      style={{ ...dim, fontSize: Math.round(size * 0.42) }}
      aria-label={`Signed in as ${user.email}`}
      title={`Signed in as ${user.email}`}
      onClick={() => navigate('/settings')}
    >
      {user.picture && (
        <img
          key={user.picture}
          src={user.picture}
          alt=""
          className="w-full h-full object-cover"
          style={{ display: loaded ? undefined : 'none' }}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
        />
      )}
      {(!user.picture || !loaded) && user.email[0]?.toUpperCase()}
    </button>
  ) : (
    // A neutral account glyph rather than any one provider's mark: which providers are on offer
    // is the sign-in screen's business, and this badge only has to say "there's an account here
    // and you're not in it". Wired to `promptGoogleSignIn`, which takes the user to Settings'
    // sign-in section rather than starting a redirect from under them (see AuthContext.tsx).
    <button
      data-component="SignedInBadge"
      className="flex-none rounded-full border border-ink/25 flex items-center justify-center text-ink/50 hover:bg-ink/[.06] hover:text-ink/70"
      style={dim}
      aria-label="Sign in"
      title="Sign in"
      onClick={promptGoogleSignIn}
    >
      <UserRound size={Math.round(size * 0.55)} strokeWidth={1.75} />
    </button>
  );
}
