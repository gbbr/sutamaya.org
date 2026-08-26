import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderSwipeNav } from './useReaderSwipeNav';

// jsdom has no touch input, so the gesture is replayed as the three raw events the hook listens
// for. Only clientX/clientY are read, and `touches`/`changedTouches` are plain arrays — enough
// for the axis and threshold logic, which is all this hook decides.
function touch(el: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y: number, count = 1) {
  const points = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
  const e = new Event(type, { bubbles: true }) as unknown as {
    touches: unknown;
    changedTouches: unknown;
  };
  e.touches = type === 'touchend' || type === 'touchcancel' ? [] : points;
  e.changedTouches = points;
  el.dispatchEvent(e as unknown as Event);
}

// One whole gesture: down at the origin, a move that establishes the axis, then release at
// (dx, dy) from where it started.
function swipe(el: HTMLElement, dx: number, dy: number) {
  touch(el, 'touchstart', 200, 300);
  touch(el, 'touchmove', 200 + dx / 2, 300 + dy / 2);
  touch(el, 'touchend', 200 + dx, 300 + dy);
}

function setup(overrides: { panel?: boolean; root?: HTMLElement | null } = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const step = vi.fn();
  const props = { root: el as HTMLElement | null, panel: false, step, ...overrides };
  const { rerender, unmount } = renderHook((p: typeof props) => useReaderSwipeNav(p), { initialProps: props });
  return {
    el,
    step,
    unmount,
    rerender: (next: Partial<typeof props>) => rerender({ ...props, ...next }),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('useReaderSwipeNav', () => {
  it('steps forward on a leftward swipe and back on a rightward one', () => {
    const { el, step } = setup();
    swipe(el, -120, 0);
    expect(step).toHaveBeenCalledWith(1);
    swipe(el, 120, 0);
    expect(step).toHaveBeenCalledWith(-1);
  });

  it('ignores a horizontal drag that is too short to be deliberate', () => {
    const { el, step } = setup();
    swipe(el, -60, 0);
    expect(step).not.toHaveBeenCalled();
  });

  // The reading pane scrolls natively on any vertical component of a drag (`touch-action: pan-y`),
  // so a diagonal gesture both scrolls the text and — before this — changed the sutta.
  it('ignores a long swipe that is not clearly horizontal', () => {
    const { el, step } = setup();
    swipe(el, -100, -60);
    expect(step).not.toHaveBeenCalled();
  });

  it('accepts a long swipe with only slight vertical drift', () => {
    const { el, step } = setup();
    swipe(el, -100, -20);
    expect(step).toHaveBeenCalledWith(1);
  });

  it('ignores a drag that ends far down the page even when it travelled further sideways', () => {
    const { el, step } = setup();
    swipe(el, 400, 150);
    expect(step).not.toHaveBeenCalled();
  });

  it('ignores a two-finger gesture', () => {
    const { el, step } = setup();
    touch(el, 'touchstart', 200, 300, 2);
    touch(el, 'touchend', 80, 300, 2);
    expect(step).not.toHaveBeenCalled();
  });

  it('does nothing while the side panel is open', () => {
    const { el, step } = setup({ panel: true });
    swipe(el, -120, 0);
    expect(step).not.toHaveBeenCalled();
  });

  it('calls the newest step() after a re-render', () => {
    const { el, step, rerender } = setup();
    const nextStep = vi.fn();
    rerender({ step: nextStep });
    swipe(el, -120, 0);
    expect(nextStep).toHaveBeenCalledWith(1);
    expect(step).not.toHaveBeenCalled();
  });

  // iOS's swipe-from-the-edge to go back is a long rightward drag over the reading pane that the
  // browser takes over partway through — committing it as a step would change the sutta on top of
  // the history navigation the browser is already performing.
  it('abandons a gesture the browser cancels', () => {
    const { el, step } = setup();
    touch(el, 'touchstart', 20, 300);
    touch(el, 'touchmove', 90, 300);
    touch(el, 'touchcancel', 200, 300);
    expect(step).not.toHaveBeenCalled();
  });

  it('starts working once the reader element exists', () => {
    // ReaderPage renders a bare "Loading…" screen until the corpus arrives, so the first run of
    // this hook has no element to attach to.
    const el = document.createElement('div');
    document.body.appendChild(el);
    const step = vi.fn();
    const props = { root: null as HTMLElement | null, panel: false, step };
    const { rerender } = renderHook((p: typeof props) => useReaderSwipeNav(p), { initialProps: props });
    swipe(el, -120, 0);
    expect(step).not.toHaveBeenCalled();
    rerender({ ...props, root: el });
    swipe(el, -120, 0);
    expect(step).toHaveBeenCalledWith(1);
  });

  it('stops listening once unmounted', () => {
    const { el, step, unmount } = setup();
    unmount();
    swipe(el, -120, 0);
    expect(step).not.toHaveBeenCalled();
  });
});
