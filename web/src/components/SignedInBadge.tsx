import { useState } from 'react';
import { navigate } from '@reach/router';
import { UserRound } from 'lucide-react';
import { isIosBrowserTab } from '../lib/localAccount';
import type { User } from '../lib/types';

// The account entry point in TreePane's header, signed in or out; both open Settings. Sized by the
// caller, so mobile and desktop each match their surrounding chrome. `atRisk` adds a dot to the
// signed-out badge — the standing state of data only this device holds, so unlike the banner it
// can't be dismissed and stays until a sign-in resolves it.
export function SignedInBadge({ user, size, atRisk = false }: { user: User | null; size: number; atRisk?: boolean }) {
  const dim = { width: size, height: size };
  // Whether the avatar has loaded; until it has, and if it never does — the URL is unreachable
  // offline — the initials show rather than the browser's broken-image glyph.
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
    // Signed out: a neutral account glyph, which providers are on offer being the sign-in screen's
    // business, and nothing here requiring an account at all.
    <button
      data-component="SignedInBadge"
      className="relative flex-none rounded-full border border-ink/25 flex items-center justify-center text-ink-4 hover:bg-ink/[.06] hover:text-ink-2"
      style={dim}
      aria-label={atRisk ? 'Settings — your notes are saved only on this device' : 'Settings'}
      title={atRisk ? 'Settings — your notes are saved only on this device' : 'Settings'}
      onClick={() => navigate('/settings')}
    >
      <UserRound size={Math.round(size * 0.55)} strokeWidth={1.75} />
      {atRisk && (
        // The at-risk dot, bordered rather than ringed in a background colour, since this badge
        // sits on two different grounds. Amber, and red on an iOS browser tab, where the data is
        // on a deletion timer rather than merely unsynced — the pair the banner also uses.
        <span
          data-component="SignedInBadgeDot"
          className={`absolute rounded-full border border-ink/25 ${isIosBrowserTab() ? 'bg-danger-text' : 'bg-warning-text'}`}
          style={{ width: 11, height: 11, top: -2, right: -2 }}
        />
      )}
    </button>
  );
}
