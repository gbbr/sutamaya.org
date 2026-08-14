import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useScrollMemory, cancelPendingRestore } from './useScrollMemory';

// `positions` (useScrollMemory.ts's module-level remembered-offset map) is a singleton shared by
// every hook instance for the lifetime of this test file — each test below uses its own unique
// key so a remembered value written by one test can't leak into another.
let keyCounter = 0;
function freshKey() {
  return `test-key-${++keyCounter}`;
}

function TestBox({
  scrollKey,
  active,
  skipRestore,
  readyToRestore,
}: {
  scrollKey: string | null;
  active?: boolean;
  skipRestore?: boolean;
  readyToRestore?: boolean;
}) {
  const ref = useScrollMemory<HTMLDivElement>(scrollKey, active, skipRestore, readyToRestore);
  return <div ref={ref} data-testid="box" />;
}

// Simulates a real scroll: sets scrollTop and fires the 'scroll' event the hook listens on, which
// is what actually records the new value into the `positions` map (see useScrollMemory.ts).
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  // Same in-memory localStorage stub used by other tests in this suite (e.g.
  // hooks/useReaderOrigin.test.tsx) — useScrollMemory persists to it, and Node's own global here
  // otherwise makes every call throw.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe('useScrollMemory', () => {
  it('restores a remembered scrollTop on a later mount with the same key', () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 240);
    first.unmount(); // persists the final scrollTop under `key`

    const second = render(<TestBox scrollKey={key} />);
    expect(second.getByTestId('box').scrollTop).toBe(240);
  });

  it('skipRestore leaves scrollTop untouched even when a remembered position exists', () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 300);
    first.unmount();

    // Same key still has 300 remembered — a caller passing skipRestore (ReaderPage's deep-link
    // case, so its own jump-to-segment is the only scroll write on this mount) must not have that
    // position silently applied underneath it.
    const second = render(<TestBox scrollKey={key} skipRestore />);
    expect(second.getByTestId('box').scrollTop).toBe(0);
  });

  it('the MutationObserver reapplies a remembered position once enough content has loaded', async () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 800);
    first.unmount();

    const second = render(<TestBox scrollKey={key} />);
    const el = second.getByTestId('box');
    // Real browsers clamp `scrollTop = 800` back to 0 here since the container has no scrollable
    // content yet (sutta text is still being fetched) — jsdom doesn't clamp, so this reproduces
    // that starting condition by hand.
    el.scrollTop = 0;
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true }); // 900 >= 800

    await act(async () => {
      el.appendChild(document.createElement('span')); // simulates the sutta text finishing rendering
      // MutationObserver callbacks fire as a microtask, after this synchronous block returns.
      await Promise.resolve();
    });

    expect(el.scrollTop).toBe(800);
  });

  it('keeps correcting drift from a second, later content wave (e.g. notes/highlight chips loading after the text)', async () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 800);
    first.unmount();

    const second = render(<TestBox scrollKey={key} />);
    const el = second.getByTestId('box');
    el.scrollTop = 0;
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });

    await act(async () => {
      el.appendChild(document.createElement('span')); // the sutta text finishing rendering
      await Promise.resolve();
    });
    expect(el.scrollTop).toBe(800);

    // A separate, later fetch (ReaderPage's notes/highlight-count/list chips, from
    // UserDataContext) inserts more content above the text, growing the container further and —
    // in a real browser — nudging scrollTop via CSS scroll anchoring. Simulated here as an
    // ordinary further mutation that also moves scrollTop away from `desired`, the same shape
    // that anchoring compensation takes.
    await act(async () => {
      Object.defineProperty(el, 'scrollHeight', { value: 1080, configurable: true });
      el.scrollTop = 880; // anchoring's own compensating bump, not a real user scroll
      el.appendChild(document.createElement('div'));
      await Promise.resolve();
    });

    expect(el.scrollTop).toBe(800);
  });

  it('stops correcting once real user scroll input arrives, even if content grows again afterward', async () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 800);
    first.unmount();

    const second = render(<TestBox scrollKey={key} />);
    const el = second.getByTestId('box');
    el.scrollTop = 0;
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });

    await act(async () => {
      el.appendChild(document.createElement('span'));
      await Promise.resolve();
    });
    expect(el.scrollTop).toBe(800);

    // The user actually scrolls themselves — this must give up the restore for good.
    el.dispatchEvent(new Event('wheel'));
    el.scrollTop = 500;

    await act(async () => {
      Object.defineProperty(el, 'scrollHeight', { value: 1080, configurable: true });
      el.appendChild(document.createElement('div'));
      await Promise.resolve();
    });

    expect(el.scrollTop).toBe(500);
  });

  it('a readyToRestore dip mid-mount (e.g. Prev/Next\'s segments -> null -> new gap) does not corrupt the saved position', () => {
    const key = freshKey();
    // Seed a remembered position for this key, as if it was already scrolled to 500 in an
    // earlier reading session.
    const seed = render(<TestBox scrollKey={key} />);
    scrollTo(seed.getByTestId('box'), 500);
    seed.unmount();

    // Mounts already ready — the reader's Prev/Next doesn't remount ReaderPage, it lands on a
    // fresh key with the *previous* sutta's segments still non-null for one render (see
    // useSuttaText's own effect timing), so readyToRestore can already be true at this first
    // commit for the new key.
    const view = render(<TestBox scrollKey={key} readyToRestore />);
    const el = view.getByTestId('box');
    expect(el.scrollTop).toBe(500);

    // useSuttaText then clears segments to null while it fetches the next sutta's text —
    // ReaderPage swaps SegmentedText for its "Loading…" placeholder on the very same mount
    // (same scroll-memory key), collapsing this container's scrollHeight as part of applying
    // *that same render's* DOM changes — a real browser clamps scrollTop down to fit as an
    // intrinsic part of that, before any effect cleanup below even runs (jsdom doesn't clamp on
    // its own — see the earlier "Real browsers clamp…" test's own comment — so this sets it by
    // hand first, to land before the rerender the same way the real clamp would). The bug this
    // guards is a cleanup that blindly persists whatever scrollTop reads as at that point.
    el.scrollTop = 0;
    view.rerender(<TestBox scrollKey={key} readyToRestore={false} />);

    // The next sutta's real text finishes loading — readyToRestore flips back true on the same
    // key/mount (ReaderPage never remounted).
    view.rerender(<TestBox scrollKey={key} readyToRestore />);
    expect(el.scrollTop).toBe(500);

    view.unmount();
    // The remembered position itself must have survived the round trip too, not just this
    // element's own scrollTop.
    const reopened = render(<TestBox scrollKey={key} readyToRestore />);
    expect(reopened.getByTestId('box').scrollTop).toBe(500);
  });

  it('cancelPendingRestore stops that reapply from clobbering a scroll made in the meantime', async () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 800);
    first.unmount();

    const second = render(<TestBox scrollKey={key} />);
    const el = second.getByTestId('box');
    el.scrollTop = 0;
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });

    // A deliberate scroll elsewhere in the app (useSuttaReading's scrollToSegment) cancels the
    // still-armed restore before landing its own jump — simulated here as a jump to 50.
    cancelPendingRestore(el);
    el.scrollTop = 50;

    await act(async () => {
      el.appendChild(document.createElement('span'));
      await Promise.resolve();
    });

    // Without the cancel, this would have been forced back to 800 (see the previous test).
    expect(el.scrollTop).toBe(50);
  });
});
