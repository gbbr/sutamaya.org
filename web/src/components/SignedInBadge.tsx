import { useState } from 'react';
import { navigate } from '@reach/router';
import { UserRound } from 'lucide-react';
import { isIosBrowserTab } from '../lib/localAccount';
import type { User } from '../lib/types';

// The single account/settings entry point in TreePane's header, signed in or out — which is why
// both branches just navigate to /settings rather than the signed-out one starting a sign-in.
// Parameterized on size so mobile and desktop can each size it to match their own surrounding
// chrome (mobile much bigger — see TreePane's header).
//
// `atRisk` marks the signed-out branch with a notification dot: work exists that only this device
// holds. Unlike the "keep this safe" banner it can't be dismissed, because it isn't a nudge — it's
// the standing state of the data, and it stays until a sign-in actually resolves it.
export function SignedInBadge({ user, size, atRisk = false }: { user: User | null; size: number; atRisk?: boolean }) {
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
    // is the sign-in screen's business. It opens Settings rather than a sign-in, since nothing
    // here requires an account — signing in is one of the things on that page, not the point of
    // it (the "keep this safe" banner is what actually asks for one, when there's a reason to).
    <button
      data-component="SignedInBadge"
      className="relative flex-none rounded-full border border-ink/25 flex items-center justify-center text-ink/50 hover:bg-ink/[.06] hover:text-ink/70"
      style={dim}
      aria-label={atRisk ? 'Settings — your notes are saved only on this device' : 'Settings'}
      title={atRisk ? 'Settings — your notes are saved only on this device' : 'Settings'}
      onClick={() => navigate('/settings')}
    >
      <UserRound size={Math.round(size * 0.55)} strokeWidth={1.75} />
      {atRisk && (
        // Bordered rather than ringed in a background colour: this badge sits on `paper` on mobile
        // and `treepane` on desktop, so a ring painted to match one of them would be a visible
        // patch on the other. The badge's own border token separates the dot from the glyph
        // beneath it on either.
        //
        // Amber, and red on an iOS browser tab — the same pair the banner and the Settings line use
        // under the same conditions, since all three are saying one thing. Red is reserved for the
        // iOS case, where the data is on a deletion timer rather than merely unsynced.
        <span
          data-component="SignedInBadgeDot"
          className={`absolute rounded-full border border-ink/25 ${isIosBrowserTab() ? 'bg-danger-text' : 'bg-warning-text'}`}
          style={{ width: 8, height: 8, top: -1, right: -1 }}
        />
      )}
    </button>
  );
}
