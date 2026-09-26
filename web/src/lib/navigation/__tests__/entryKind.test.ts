import { afterEach, describe, it, expect, vi } from 'vitest';
import { NavigationType } from 'react-router';
import { RETURN_STATE, enteredByReturn } from '../entryKind';

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

describe('takeAddressArrival', () => {
  // A fresh copy of the module, as a page load has, with the load made the way `type` says.
  async function pageLoadedBy(type: NavigationTimingType) {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type } as PerformanceNavigationTiming]);
    vi.resetModules();
    return (await import('../entryKind')).takeAddressArrival;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads an address typed, pasted or followed from another site as an arrival, once', async () => {
    const take = await pageLoadedBy('navigate');
    expect(take('default')).toBe(true);
    // Back to that location later in the visit, from Settings or a sutta.
    expect(take('default')).toBe(false);
  });

  it('reads a refresh, and Back or Forward into the page, as a return', async () => {
    expect((await pageLoadedBy('reload'))('default')).toBe(false);
    expect((await pageLoadedBy('back_forward'))('default')).toBe(false);
  });

  it('reads a location the app navigated to as no arrival', async () => {
    // "/" restoring the last location replaces the entry the page loaded on with one of its own.
    expect((await pageLoadedBy('navigate'))('x7k2q')).toBe(false);
  });
});
