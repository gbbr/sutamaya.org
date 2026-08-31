import { describe, expect, it } from 'vitest';
import { computeGutterLayout } from './highlightGutterLayout';
import type { Highlight } from './types';

function group(overrides: Partial<Highlight> = {}): Highlight {
  return { id: 'g1', c: 'yellow', i0: 0, o0: 0, i1: 0, o1: 5, m: '1|d', ...overrides };
}

describe('computeGutterLayout', () => {
  it('positions a mark proportionally to its distance down the scrollable content', () => {
    const { track, marks } = computeGutterLayout(
      [group({ i0: 0 })],
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
    const { track, marks } = computeGutterLayout([group({ i0: 0 })], { top: 200, height: 1000 }, 1000, 0, 2, () => 700);
    expect(track).toEqual({ top: 100, height: 500 });
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 125 }]);
  });

  it('accounts for scrollTop so a mark reflects position in the content, not on screen', () => {
    // Container has been scrolled 100px down; the segment now reports at screen-top 50 (above
    // the container's own top of 0) but is still 150px into the actual content.
    const { marks } = computeGutterLayout([group({ i0: 0 })], { top: 0, height: 500 }, 1000, 100, 1, () => 50);
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 75 }]); // (150/1000) * 500
  });

  it('clamps a mark whose segment is unmeasured (offscreen/not yet rendered) to the top of the track', () => {
    const { marks } = computeGutterLayout([group({ i0: 3 })], { top: 0, height: 500 }, 1000, 0, 1, () => undefined);
    expect(marks).toEqual([{ key: 'g1', i: 3, c: 'yellow', top: 0 }]);
  });

  it('clamps ratio to [0, 1] for content above/below the measured range', () => {
    const belowRange = computeGutterLayout([group({ i0: 0 })], { top: 0, height: 500 }, 1000, 0, 1, () => 5000);
    expect(belowRange.marks[0].top).toBe(500); // clamped ratio 1

    const aboveRange = computeGutterLayout([group({ i0: 0 })], { top: 0, height: 500 }, 1000, 0, 1, () => -5000);
    expect(aboveRange.marks[0].top).toBe(0); // clamped ratio 0
  });

  it('returns a ratio of 0 when the content has no scrollable height', () => {
    const { marks } = computeGutterLayout([group({ i0: 0 })], { top: 0, height: 500 }, 0, 0, 1, () => 100);
    expect(marks).toEqual([{ key: 'g1', i: 0, c: 'yellow', top: 0 }]);
  });

  it('positions one mark per highlight group, independently', () => {
    const { marks } = computeGutterLayout(
      [group({ id: 'a', i0: 0 }), group({ id: 'b', i0: 1 })],
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
});
