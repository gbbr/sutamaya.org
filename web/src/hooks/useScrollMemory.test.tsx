import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollMemory, type ScrollRestore } from './useScrollMemory';

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
  restore,
  skipRestore,
  readyToRestore,
}: {
  scrollKey: string | null;
  active?: boolean;
  restore?: ScrollRestore;
  skipRestore?: boolean;
  readyToRestore?: boolean;
}) {
  const ref = useScrollMemory<HTMLDivElement>(scrollKey, active, { restore, skipRestore, readyToRestore });
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

  it("restore='top' opens at the top, ignoring the remembered position", () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 300);
    first.unmount();

    // A fresh entry to a sutta (row tap / search hit / Prev/Next) starts at the top even though
    // 300 is remembered for it — and, unlike skipRestore, actively *writes* 0 rather than leaving
    // the container wherever it was. That write is what the reader depends on: the same scroll
    // container is reused across Prev/Next, so without it the next sutta would open at the
    // previous one's offset. Modelled here as a key change on a mounted container, which is
    // exactly what a Prev/Next is.
    const view = render(<TestBox scrollKey={freshKey()} />);
    const el = view.getByTestId('box');
    scrollTo(el, 120);
    view.rerender(<TestBox scrollKey={key} restore="top" />);
    expect(el.scrollTop).toBe(0);

    // Same navigation classified as a return instead: the remembered position wins.
    // `view` above is still mounted, so this scopes to its own container rather than the shared
    // document body, where two boxes now match.
    const returning = render(<TestBox scrollKey={key} />);
    expect(returning.container.querySelector<HTMLDivElement>('[data-testid="box"]')!.scrollTop).toBe(300);
  });

  // The whole of the restore's timing: it waits for the caller to say every async source has
  // landed, and then writes once. Deferring is the only thing standing between a remembered
  // position and a container that is still growing — restoring against the first wave and
  // correcting afterwards is what this hook used to do, and what a single well-timed write
  // replaces.
  it('waits for readyToRestore rather than writing against a container that is still filling', () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 800);
    first.unmount();

    // Mounted with the text (and the separately-fetched chips) still in flight.
    const second = render(<TestBox scrollKey={key} readyToRestore={false} />);
    const el = second.getByTestId('box');
    // Nothing written yet: a real browser would clamp an 800 here back to 0 for lack of content,
    // and then persist that 0 as the remembered position.
    expect(el.scrollTop).toBe(0);

    // Both sources land, the container now has the height to hold the position, and the restore
    // happens — once.
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
    second.rerender(<TestBox scrollKey={key} readyToRestore />);
    expect(el.scrollTop).toBe(800);
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

  it('leaves a deliberate scroll made after the restore alone', () => {
    const key = freshKey();
    const first = render(<TestBox scrollKey={key} />);
    scrollTo(first.getByTestId('box'), 800);
    first.unmount();

    const second = render(<TestBox scrollKey={key} />);
    const el = second.getByTestId('box');
    expect(el.scrollTop).toBe(800);

    // Sized so the container could hold 800 — the condition under which this hook used to keep
    // re-applying the remembered position as content arrived, which is exactly what must not
    // happen to a jump the reader asked for.
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });

    // A jump elsewhere in the app — useSuttaReading's scrollToSegment, the dictionary dock
    // centring a word — lands after the restore has already happened, and nothing puts the
    // remembered position back over it. Content arriving later doesn't either.
    scrollTo(el, 50);
    el.appendChild(document.createElement('span'));
    second.rerender(<TestBox scrollKey={key} />);

    expect(el.scrollTop).toBe(50);
  });
});
