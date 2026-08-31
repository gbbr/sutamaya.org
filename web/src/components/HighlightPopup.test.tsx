import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HighlightPopup } from './HighlightPopup';
import { HIGHLIGHT_COLORS } from '../lib/theme';
import type { PopState } from '../hooks/useHighlightPopup';
import type { ThemeColors } from '../lib/types';

vi.mock('../lib/uiPrefs', () => ({ getUiScale: vi.fn(() => 1) }));

const theme: ThemeColors = { bg: '#fff', fg: '#000', dim: '#888', rule: '#ccc', panel: '#fff', pali: '#333', tint: '#eee', paliTint: '#e8dcc8', focusTint: '#f5f5f5', highlightPalette: null, selection: '#ddd' };

function renderPopup(mobile: boolean, pop: Partial<PopState> = {}) {
  const onPick = vi.fn();
  const onRemove = vi.fn();
  const onClose = vi.fn();
  render(
    <HighlightPopup
      pop={{ span: { i0: 0, o0: 0, i1: 0, o1: 4 }, x: 120, top: 200, bottom: 220, on: null, ...pop }}
      theme={theme}
      mobile={mobile}
      onPick={onPick}
      onRemove={onRemove}
      onClose={onClose}
      onStop={() => {}}
    />
  );
  // Last, not first — one test renders twice to compare the two variants side by side.
  const els = document.querySelectorAll<HTMLElement>('[data-component="HighlightPopup"]');
  return { el: els[els.length - 1], onPick, onRemove, onClose };
}

describe('HighlightPopup', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
  });

  // jsdom lays nothing out, so the popup's own size — the only thing the placement measures — has
  // to be supplied. The viewport it's placed within is jsdom's default 1024x768.
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 40);
  });

  it('sits above the selection on desktop', () => {
    const { el } = renderPopup(false);
    expect(el.style.top).toBe('200px');
    expect(el.style.transform).toBe('translate(-50%,-100%)');
    expect(el.style.left).toBe('120px');
    expect(el.className).not.toContain('bottom-0');
  });

  // Above is the default, but a selection near the top of the viewport has no room up there.
  it('flips below the selection when it would clip the top of the viewport', () => {
    const { el } = renderPopup(false, { top: 30, bottom: 50 });
    expect(el.style.top).toBe('50px');
    expect(el.style.transform).toBe('translate(-50%,0)');
  });

  // The popup is centered on the anchor, so one within half its width of an edge has to be pushed
  // back inside — otherwise a selection ending at the right margin opens a picker half off-screen.
  it('shifts back inside the viewport when the anchor is near an edge', () => {
    const { el } = renderPopup(false, { x: 1020 });
    expect(el.style.left).toBe('914px');
  });

  // The mobile bar exists to stay out from under the OS's own selection menu, so what matters is
  // that it's pinned to the bottom edge rather than positioned from the selection's coordinates.
  it('pins to the bottom edge on mobile, ignoring the selection anchor', () => {
    const { el } = renderPopup(true);
    expect(el.className).toContain('bottom-0');
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
  });

  it('picks a color from the mobile bar', () => {
    const { el, onPick } = renderPopup(true);
    fireEvent.click(el.querySelectorAll('button')[1]);
    expect(onPick).toHaveBeenCalledWith(HIGHLIGHT_COLORS[1]);
  });

  it('offers Remove on the mobile bar only for an existing highlight', () => {
    const { el, onRemove } = renderPopup(true, { on: HIGHLIGHT_COLORS[0] });
    fireEvent.click(screen.getByText('Remove'));
    expect(onRemove).toHaveBeenCalled();

    const fresh = renderPopup(true).el;
    expect(el.textContent).toContain('Remove');
    expect(fresh.textContent).not.toContain('Remove');
  });

  it('closes from the mobile bar', () => {
    const { onClose } = renderPopup(true);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
