import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { HighlightGutter } from './HighlightGutter';
import type { HighlightGroup } from '../lib/highlights';
import type { ThemeColors } from '../lib/types';

vi.mock('../lib/uiPrefs', () => ({ getUiScale: vi.fn(() => 1) }));
import { getUiScale } from '../lib/uiPrefs';

const theme: ThemeColors = { bg: '#fff', fg: '#000', dim: '#888', rule: '#ccc', panel: '#fff', pali: '#333', tint: '#eee', focusTint: '#f5f5f5', highlightAlpha: 1, selection: '#ddd' };

function group(overrides: Partial<HighlightGroup> = {}): HighlightGroup {
  return { key: 'g1', c: 'yellow', i: 0, items: [], ...overrides };
}

// Builds a fake scrollable container with `[data-seg]` children, each with a controllable
// getBoundingClientRect — jsdom does no real layout, so every measurement HighlightGutter reads
// (container rect, scrollHeight/scrollTop, each segment's rect) has to be stubbed by hand.
function buildContainer({
  containerRect,
  scrollHeight,
  scrollTop = 0,
  segRects,
}: {
  containerRect: { top: number; height: number };
  scrollHeight: number;
  scrollTop?: number;
  segRects: Record<number, { top: number }>;
}) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ top: containerRect.top, height: containerRect.height }) as DOMRect;
  Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true });

  for (const [i, rect] of Object.entries(segRects)) {
    const seg = document.createElement('div');
    seg.dataset.seg = i;
    seg.getBoundingClientRect = () => ({ top: rect.top }) as DOMRect;
    container.appendChild(seg);
  }
  document.body.appendChild(container);
  return container;
}

describe('HighlightGutter', () => {
  it('renders nothing when there are no highlight groups', () => {
    const container = buildContainer({ containerRect: { top: 0, height: 500 }, scrollHeight: 1000, segRects: {} });
    const { container: root } = render(
      <HighlightGutter scrollRef={{ current: container }} highlightGroups={[]} theme={theme} onJump={vi.fn()} />
    );
    expect(root.querySelector('[data-component="HighlightGutter"]')).toBeNull();
  });

  it('positions a mark proportionally to its segment\'s distance down the scrollable content', () => {
    // Container starts at screen y=100, is 500px tall; scrollable content is 1000px tall.
    // The segment sits 250px into the content from the top (scrollTop 0) — that's 25% down,
    // so its mark should land at 25% of the 500px track: y=125.
    const container = buildContainer({
      containerRect: { top: 100, height: 500 },
      scrollHeight: 1000,
      segRects: { 0: { top: 100 + 250 } }, // screen-space: container top (100) + 250 into content
    });
    render(
      <HighlightGutter scrollRef={{ current: container }} highlightGroups={[group({ i: 0 })]} theme={theme} onJump={vi.fn()} />
    );
    const mark = screen.getByTitle('Jump to highlight') as HTMLElement;
    expect(mark.style.top).toBe('122px'); // ratio(0.25) * height(500) - 3 (half the mark's own height)
  });

  it('divides post-zoom screen coordinates by the UI scale before mixing them with pre-zoom scroll units', () => {
    // Regression coverage for a real bug (see HighlightGutter's own comment): getBoundingClientRect
    // reports real, post-zoom screen pixels, but scrollTop/scrollHeight are pre-zoom local units.
    // At 2x zoom, the same logical position reports rects at 2x the pixel values — recompute()
    // must divide by scale before computing the ratio, or a zoomed page would misplace every mark.
    vi.mocked(getUiScale).mockReturnValue(2);
    const container = buildContainer({
      containerRect: { top: 200, height: 1000 }, // = logical {top: 100, height: 500} at 2x
      scrollHeight: 1000, // pre-zoom unit, unaffected by scale
      segRects: { 0: { top: 200 + 500 } }, // logical 250 into content, doubled to 500 on screen
    });
    render(
      <HighlightGutter scrollRef={{ current: container }} highlightGroups={[group({ i: 0 })]} theme={theme} onJump={vi.fn()} />
    );
    const mark = screen.getByTitle('Jump to highlight') as HTMLElement;
    // Same logical ratio (0.25) as the 1x test above, against the logical (post-division) track
    // height of 500 — i.e. identical output to the unzoomed case once scale is correctly divided out.
    expect(mark.style.top).toBe('122px');
    vi.mocked(getUiScale).mockReturnValue(1);
  });

  it('clamps a mark whose segment is offscreen/unmeasured to the top of the track', () => {
    const container = buildContainer({
      containerRect: { top: 0, height: 500 },
      scrollHeight: 1000,
      segRects: {}, // segment 3 has no matching [data-seg] element in the container
    });
    render(
      <HighlightGutter scrollRef={{ current: container }} highlightGroups={[group({ i: 3 })]} theme={theme} onJump={vi.fn()} />
    );
    const mark = screen.getByTitle('Jump to highlight') as HTMLElement;
    expect(mark.style.top).toBe('-3px'); // ratio 0 * height - 3
  });

  it('calls onJump with the segment index and highlight id when a mark is clicked', async () => {
    const onJump = vi.fn();
    const container = buildContainer({
      containerRect: { top: 0, height: 500 },
      scrollHeight: 1000,
      segRects: { 7: { top: 0 } },
    });
    render(
      <HighlightGutter scrollRef={{ current: container }} highlightGroups={[group({ i: 7 })]} theme={theme} onJump={onJump} />
    );
    const mark = screen.getByTitle('Jump to highlight');
    await act(async () => {
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onJump).toHaveBeenCalledWith(7, 'g1');
  });
});
