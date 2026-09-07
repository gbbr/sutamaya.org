import { describe, expect, it } from 'vitest';
import { computeGutterLayout } from './highlightGutterLayout';
import type { SegmentFile } from './corpus';
import type { Highlight } from './types';

// The loaded text a mark's position is resolved against, and the key of the segment at position `i`.
const key = (i: number) => `dn1:1.${i + 1}`;
const segments: SegmentFile[] = Array.from({ length: 8 }, (_, i) => ({ key: key(i), pali: '', en: 'x'.repeat(10) }));

// `at` is the position the highlight sits on, named as the key of the segment there.
function group({ at = 0, ...overrides }: Partial<Highlight> & { at?: number } = {}): Highlight {
  return { id: 'g1', c: 'yellow', k0: key(at), o0: 0, k1: key(at), o1: 5, m: '1|d', ...overrides };
}

describe('computeGutterLayout', () => {
  it('positions a mark proportionally to its distance down the scrollable content', () => {
    const { track, marks } = computeGutterLayout(
      [group({ at: 0 })],
      segments,
      { top: 100, height: 500 },
      1000,
      0,
      1,
      () => 350 // 250px into the content (350 - containerRect.top 100)
    );
    expect(track).toEqual({ top: 100, height: 500 });
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 125 }]); // 0.25 * 500
  });

  it('divides post-zoom screen coordinates by scale before mixing them with pre-zoom scroll units', () => {
    // Same logical layout as the test above, reported at 2x zoom: containerRect and segTop are
    // both doubled, scrollHeight (a pre-zoom unit) is not.
    const { track, marks } = computeGutterLayout([group({ at: 0 })], segments, { top: 200, height: 1000 }, 1000, 0, 2, () => 700);
    expect(track).toEqual({ top: 100, height: 500 });
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 125 }]);
  });

  it('accounts for scrollTop so a mark reflects position in the content, not on screen', () => {
    // Container has been scrolled 100px down; the segment now reports at screen-top 50 (above
    // the container's own top of 0) but is still 150px into the actual content.
    const { marks } = computeGutterLayout([group({ at: 0 })], segments, { top: 0, height: 500 }, 1000, 100, 1, () => 50);
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 75 }]); // (150/1000) * 500
  });

  it('clamps a mark whose segment is unmeasured (offscreen/not yet rendered) to the top of the track', () => {
    const { marks } = computeGutterLayout([group({ at: 3 })], segments, { top: 0, height: 500 }, 1000, 0, 1, () => undefined);
    expect(marks).toEqual([{ key: 'g1', i: 3, c: 'yellow', top: 0 }]);
  });

  it('clamps ratio to [0, 1] for content above/below the measured range', () => {
    const belowRange = computeGutterLayout([group({ at: 0 })], segments, { top: 0, height: 500 }, 1000, 0, 1, () => 5000);
    expect(belowRange.marks[0].top).toBe(500); // clamped ratio 1

    const aboveRange = computeGutterLayout([group({ at: 0 })], segments, { top: 0, height: 500 }, 1000, 0, 1, () => -5000);
    expect(aboveRange.marks[0].top).toBe(0); // clamped ratio 0
  });

  it('returns a ratio of 0 when the content has no scrollable height', () => {
    const { marks } = computeGutterLayout([group({ at: 0 })], segments, { top: 0, height: 500 }, 0, 0, 1, () => 100);
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 0 }]);
  });

  it('positions one mark per highlight group, independently', () => {
    const { marks } = computeGutterLayout(
      [group({ id: 'a', at: 0 }), group({ id: 'b', at: 1 })],
      segments,
      { top: 0, height: 1000 },
      1000,
      0,
      1,
      (i) => (i === 0 ? 0 : 500)
    );
    expect(marks).toEqual([
      { key: 'a', i: 0, c: 'yellow', top: 0 },
      { key: 'b', i: 1, c: 'yellow', top: 500 },
    ]);
  });

  // A mark has nowhere to sit if the text has no segment by that name, so it is left off the track
  // rather than drawn at the top pointing nowhere.
  it('draws no mark for a highlight naming a segment the text lacks', () => {
    const orphan = group({ id: 'x', k0: 'dn1:9.9', k1: 'dn1:9.9' });
    const { marks } = computeGutterLayout([orphan, group({ at: 0 })], segments, { top: 0, height: 500 }, 1000, 0, 1, () => 0);
    expect(marks.map((m) => m.key)).toEqual(['g1']);
  });
});
