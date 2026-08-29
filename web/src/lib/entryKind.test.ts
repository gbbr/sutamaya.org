import { describe, it, expect } from 'vitest';
import { navigate } from '@reach/router';
import { enteredByReturn, markReturnNavigation } from './entryKind';

// One module-level classifier fed by @reach/router's own history, so these assertions run in
// sequence against the same singleton rather than in isolation — which is also how it's used.
//
// `navigate()` is deliberately not awaited: the promise it returns settles only once a mounted
// <Router> reports the transition complete, and there's none here. The classification itself
// happens synchronously, in the history listener navigate() calls before returning.
describe('entryKind', () => {
  it('classifies every way into a location', () => {
    // The load the app started with: a fresh tab, a refresh, a bookmarked or shared link. There's
    // no navigation to inspect, and a refresh must land where the reader left off.
    expect(enteredByReturn()).toBe(true);

    // Choosing somewhere to go: a row tap, a search hit, Prev/Next.
    navigate('/browse/dn/dn1');
    expect(enteredByReturn()).toBe(false);

    // Back/forward, including iOS' swipe-back gesture.
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(enteredByReturn()).toBe(true);

    navigate('/read/dn2');
    expect(enteredByReturn()).toBe(false);

    // The redirects that finish the load the user already started ("/" restoring the last
    // location, a bare-uid link resolving to /read/:id) opt back in explicitly, since a
    // `replace: true` navigate is indistinguishable from any other on the way through.
    markReturnNavigation();
    navigate('/read/dn3', { replace: true });
    expect(enteredByReturn()).toBe(true);

    // Marking is one-shot: the navigation after it is classified on its own merits.
    navigate('/read/dn4');
    expect(enteredByReturn()).toBe(false);
  });
});
