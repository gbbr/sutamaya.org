import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HighlightPopup } from './HighlightPopup';
import { HIGHLIGHT_COLORS } from '../lib/theme';
import type { PopState } from '../hooks/useHighlightPopup';
import type { ThemeColors } from '../lib/types';

vi.mock('../lib/uiPrefs', () => ({ getUiScale: vi.fn(() => 1) }));

const theme: ThemeColors = { bg: '#fff', fg: '#000', dim: '#888', rule: '#ccc', panel: '#fff', pali: '#333', tint: '#eee', focusTint: '#f5f5f5', highlightPalette: null, selection: '#ddd' };

function renderPopup(mobile: boolean, pop: Partial<PopState> = {}) {
  const onPick = vi.fn();
  const onRemove = vi.fn();
  const onClose = vi.fn();
  render(
    <HighlightPopup
      pop={{ ranges: [{ i: 0, s: 0, e: 4 }], x: 120, y: 200, on: null, ...pop }}
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
  it('anchors to the selection on desktop', () => {
    const { el } = renderPopup(false);
    expect(el.style.top).toBe('200px');
    expect(el.style.left).not.toBe('');
    expect(el.className).not.toContain('bottom-0');
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
