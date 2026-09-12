import { afterEach, describe, expect, it, vi } from 'vitest';
import { READING_TOP, readingPositionOf } from './readingPosition';
import { SEGMENT_START_MARGIN } from './segmentScroll';
import { getUiScale } from './uiPrefs';
import type { SegmentFile } from './corpus';

vi.mock('./uiPrefs', () => ({ getUiScale: vi.fn(() => 1) }));

// The one rule a reading position has to keep: reading it back straight after restoring it names
// the same segment. Anything else and a sutta reopened from the put-aside bar climbs a segment on
// every round trip, which is a place quietly lost.
//
// The pane is faked rather than rendered — jsdom lays nothing out, so a real one would report every
// rect as zero and prove nothing about which segment is under the top edge.

const segments: SegmentFile[] = ['mn10:1.1', 'mn10:1.2', 'mn10:1.3', 'mn10:1.4'].map((key) => ({ key, pali: '', en: '' }));

const SEG_H = 60;
const CONTAINER_TOP = 100;

afterEach(() => vi.mocked(getUiScale).mockReturnValue(1));

/**
 * A pane scrolled so that `atIndex`'s top sits `margin` below the pane's own top edge — the state
 * `scrollToSegment(atIndex, 'start')` leaves behind. Segments are flush, each one's top on the
 * previous one's bottom, which is what makes a threshold three pixels out land on the wrong one.
 */
function paneShowing(atIndex: number, margin = SEGMENT_START_MARGIN, count = segments.length): HTMLElement {
  const rendered = Array.from({ length: count }, (_, i) => {
    // Rounded as a browser reports them, which is what puts a boundary landing on the measuring
    // line a fraction of a pixel to one side of it or the other.
    const top = Math.round(CONTAINER_TOP + margin + (i - atIndex) * SEG_H);
    return {
      dataset: { seg: String(i) },
      getBoundingClientRect: () => ({ top, bottom: top + SEG_H, height: SEG_H }),
    };
  });
  return {
    getBoundingClientRect: () => ({ top: CONTAINER_TOP, height: 800 }),
    querySelectorAll: () => rendered,
  } as unknown as HTMLElement;
}

describe('readingPositionOf', () => {
  it('reads an unscrolled pane as the head of the document, not as its first segment', () => {
    // The two are different places: the head shows the sutta's title, the first segment opens under
    // it. Anchored to the segment, a sutta set aside before it was ever scrolled comes back with
    // its whole heading gone.
    expect(readingPositionOf(paneShowing(0, 240), segments)).toEqual({ key: READING_TOP, pct: 0 });
  });

  it('stays at the head while the heading is still crossing the line', () => {
    // Read a little way down — into a batched document's contents, say — with the first segment
    // still below the edge. The reader has not reached the text yet, so neither has the position.
    expect(readingPositionOf(paneShowing(0, 40), segments)?.key).toBe(READING_TOP);
  });

  it('hands over to the first segment exactly where any other segment would count', () => {
    // Its top on the line: from here it is the segment under the edge, on the same terms as every
    // other, so the head has nothing left to hold.
    expect(readingPositionOf(paneShowing(0), segments)?.key).toBe('mn10:1.1');
  });

  it('names the segment a restore just scrolled to, not the one whose tail is still showing', () => {
    // Segment 2 sits at the top with the start margin above it, so segment 1's bottom lands exactly
    // on the pane's own top edge. Measured against that bare edge, segment 1 would still count.
    expect(readingPositionOf(paneShowing(2), segments)?.key).toBe('mn10:1.3');
  });

  it('holds the same position over repeated round trips', () => {
    let key = readingPositionOf(paneShowing(2), segments)!.key;
    for (let i = 0; i < 5; i++) {
      const at = segments.findIndex((s) => s.key === key);
      key = readingPositionOf(paneShowing(at), segments)!.key;
    }
    expect(key).toBe('mn10:1.3');
  });

  it('holds it under a UI scale, where a restore lands the segment further down the screen', () => {
    // The margin is written in scroll units and `zoom` multiplies it on the way to the screen, so
    // at 120% a restore leaves the segment 17px down, not 14 — and the segment above it ends on
    // that same line.
    vi.mocked(getUiScale).mockReturnValue(1.2);
    let key = readingPositionOf(paneShowing(2, SEGMENT_START_MARGIN * 1.2), segments)!.key;
    for (let i = 0; i < 5; i++) {
      const at = segments.findIndex((s) => s.key === key);
      key = readingPositionOf(paneShowing(at, SEGMENT_START_MARGIN * 1.2), segments)!.key;
    }
    expect(key).toBe('mn10:1.3');
  });

  it('names the segment under the top edge when the reader stopped part way into one', () => {
    // Scrolled a third of the way into segment 2, so its own text is what fills the top edge.
    expect(readingPositionOf(paneShowing(2, -SEG_H / 3), segments)?.key).toBe('mn10:1.3');
  });

  it('reads the end of the sutta when everything has scrolled past', () => {
    expect(readingPositionOf(paneShowing(segments.length), segments)).toEqual({ key: 'mn10:1.4', pct: 100 });
  });

  it('reads nothing from a pane with no text in it yet', () => {
    expect(readingPositionOf(paneShowing(0, SEGMENT_START_MARGIN, 0), segments)).toBeNull();
    expect(readingPositionOf(paneShowing(0), null)).toBeNull();
    expect(readingPositionOf(null, segments)).toBeNull();
  });
});
