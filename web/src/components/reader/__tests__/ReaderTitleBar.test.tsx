import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ReaderTitleBar } from '../ReaderTitleBar';
import { jumpScrollBy } from '../../../lib/reader/segmentScroll';
import type { ThemeColors } from '../../../lib/types';

// HeadingOutOfView is an IntersectionObserver that reports the sutta's heading out of view.
class HeadingOutOfView {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback([{ isIntersecting: false } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
}

// renderBar renders the bar over a reading pane scrolled into the text, and returns the pane.
function renderBar() {
  const pane = document.createElement('div');
  Object.defineProperty(pane, 'scrollHeight', { value: 10000 });
  Object.defineProperty(pane, 'clientHeight', { value: 700 });
  pane.scrollTop = 2000;
  const heading = document.createElement('h1');
  pane.append(heading);
  const theme = { tint: 'transparent', bg: '#fff', rule: '#ccc' } as ThemeColors;
  render(<ReaderTitleBar scrollRef={{ current: pane }} headingRef={{ current: heading }} title="SN 1.1" top="0" theme={theme} />);
  return pane;
}

// scrollTo moves the pane as the reader does, with no touch reported.
function scrollTo(pane: HTMLElement, top: number) {
  act(() => {
    pane.scrollTop = top;
    pane.dispatchEvent(new Event('scroll'));
  });
}

// readerJump moves the pane as the Reader does by itself.
function readerJump(pane: HTMLElement, offset: number) {
  act(() => {
    jumpScrollBy(pane, offset);
    pane.dispatchEvent(new Event('scroll'));
  });
}

const bar = () => screen.getByRole('button', { hidden: true });

describe('ReaderTitleBar', () => {
  beforeEach(() => vi.stubGlobal('IntersectionObserver', HeadingOutOfView));
  afterEach(() => vi.unstubAllGlobals());

  it('slides out on a scroll back up with no touch reported, as when a finger stops a coasting page', () => {
    const pane = renderBar();
    scrollTo(pane, 1990);
    expect(bar()).toBeVisible();
  });

  it('tucks away on a scroll down', () => {
    const pane = renderBar();
    scrollTo(pane, 1990);
    scrollTo(pane, 2000);
    expect(bar()).not.toBeVisible();
  });

  it('stays hidden when the Reader scrolls back up by itself', () => {
    const pane = renderBar();
    readerJump(pane, -500);
    expect(bar()).not.toBeVisible();
  });

  it('follows the reader again once they scroll after the Reader has', () => {
    const pane = renderBar();
    readerJump(pane, -500);
    scrollTo(pane, 1490);
    expect(bar()).toBeVisible();
  });
});
