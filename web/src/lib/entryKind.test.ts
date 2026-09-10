import { describe, it, expect } from 'vitest';
import { NavigationType } from 'react-router';
import { RETURN_STATE, enteredByReturn } from './entryKind';

describe('enteredByReturn', () => {
  it('reads a page load, and back or forward, as a return', () => {
    // The load the app started with — a fresh tab, a refresh, a bookmarked or shared link — is a
    // POP, as is back/forward, iOS' swipe-back gesture included. A refresh must land where the
    // reader left off.
    expect(enteredByReturn(NavigationType.Pop, null)).toBe(true);
    expect(enteredByReturn(NavigationType.Pop, { from: '/browse/dn' })).toBe(true);
  });

  it('reads a destination chosen now as fresh, replace or not', () => {
    // A row tap, a search hit, Prev/Next — and the address bar's own corrections, which replace.
    expect(enteredByReturn(NavigationType.Push, null)).toBe(false);
    expect(enteredByReturn(NavigationType.Push, { from: '/browse/dn' })).toBe(false);
    expect(enteredByReturn(NavigationType.Replace, null)).toBe(false);
  });

  it('reads a redirect that finishes the load as a return', () => {
    // "/" restoring the last location, a bare-uid link resolving to /read/:id.
    expect(enteredByReturn(NavigationType.Replace, RETURN_STATE)).toBe(true);
  });
});
