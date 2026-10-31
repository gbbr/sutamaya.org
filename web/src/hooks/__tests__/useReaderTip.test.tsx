import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReaderTip } from '../useReaderTip';

// The first line's distance from the top of an 800px pane, which the tip waits on.
let firstLineTop = 500;
let pane: HTMLDivElement;

beforeEach(() => {
  // Node's own built-in `localStorage` global shadows jsdom's here in a way that leaves it unusable
  // (see context/__tests__/LayoutContext.test.tsx) — stub a plain in-memory one.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });

  firstLineTop = 500;
  pane = document.createElement('div');
  const line = document.createElement('div');
  line.dataset.seg = '0';
  pane.append(line);
  pane.getBoundingClientRect = () => ({ top: 0, height: 800 }) as DOMRect;
  line.getBoundingClientRect = () => ({ top: firstLineTop }) as DOMRect;
});

function renderTip(overrides: Partial<Parameters<typeof useReaderTip>[0]> = {}) {
  return renderHook((props) => useReaderTip(props), {
    initialProps: { suttaId: 'dn1', scrollRef: { current: pane }, textShown: true, paliShowing: false, dictOpen: false, ...overrides },
  });
}

function scrollFirstLineTo(top: number) {
  firstLineTop = top;
  act(() => {
    pane.dispatchEvent(new Event('scroll'));
  });
}

describe('useReaderTip', () => {
  it('waits until the first line of text reaches the top quarter of the pane', () => {
    const { result } = renderTip();
    expect(result.current.visible).toBe(false);
    scrollFirstLineTo(300);
    expect(result.current.visible).toBe(false);
    scrollFirstLineTo(200);
    expect(result.current.visible).toBe(true);
  });

  it('shows at once when the text opens already scrolled into place', () => {
    firstLineTop = -400;
    expect(renderTip().result.current.visible).toBe(true);
  });

  it('waits again in each new sutta', () => {
    const { result, rerender } = renderTip();
    scrollFirstLineTo(100);
    expect(result.current.visible).toBe(true);
    firstLineTop = 500;
    rerender({ suttaId: 'dn2', scrollRef: { current: pane }, textShown: true, paliShowing: false, dictOpen: false });
    expect(result.current.visible).toBe(false);
  });

  it('ticks the first step once Pali shows, and keeps it ticked on this device', () => {
    const { result, rerender } = renderTip();
    expect(result.current.paliDone).toBe(false);
    rerender({ suttaId: 'dn1', scrollRef: { current: pane }, textShown: true, paliShowing: true, dictOpen: false });
    expect(result.current.paliDone).toBe(true);
    rerender({ suttaId: 'dn1', scrollRef: { current: pane }, textShown: true, paliShowing: false, dictOpen: false });
    expect(result.current.paliDone).toBe(true);
    expect(renderTip().result.current.paliDone).toBe(true);
  });

  it('retires for good on the first dictionary lookup', () => {
    firstLineTop = 0;
    const { result, rerender } = renderTip();
    expect(result.current.visible).toBe(true);
    rerender({ suttaId: 'dn1', scrollRef: { current: pane }, textShown: true, paliShowing: true, dictOpen: true });
    expect(result.current.visible).toBe(false);
    rerender({ suttaId: 'dn1', scrollRef: { current: pane }, textShown: true, paliShowing: true, dictOpen: false });
    expect(result.current.visible).toBe(false);
    expect(renderTip().result.current.visible).toBe(false);
  });

  it('retires for good when closed', () => {
    firstLineTop = 0;
    const { result } = renderTip();
    act(() => result.current.close());
    expect(result.current.visible).toBe(false);
    expect(renderTip().result.current.visible).toBe(false);
  });
});
