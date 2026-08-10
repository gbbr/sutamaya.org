import { describe, expect, it } from 'vitest';
import { computeSegmentScrollOffset } from './segmentScroll';

describe('computeSegmentScrollOffset', () => {
  it("'start' offsets to the element's top minus a fixed margin", () => {
    const offset = computeSegmentScrollOffset({ top: 100, height: 500 }, { top: 250, height: 40 }, 'start', 1);
    expect(offset).toBe(250 - 100 - 24);
  });

  it("'center' offsets to align the element's midpoint with the container's midpoint", () => {
    const offset = computeSegmentScrollOffset({ top: 0, height: 500 }, { top: 300, height: 40 }, 'center', 1);
    // element midpoint: 320, container midpoint: 250
    expect(offset).toBe(320 - 250);
  });

  it('divides post-zoom screen coordinates by scale before using them as a scroll delta', () => {
    // Same logical layout as the 'start' case above, reported at 2x zoom: both rects doubled.
    const offset = computeSegmentScrollOffset({ top: 200, height: 1000 }, { top: 500, height: 80 }, 'start', 2);
    expect(offset).toBe(250 - 100 - 24);
  });

  it('divides a centered offset by scale the same way', () => {
    const offset = computeSegmentScrollOffset({ top: 0, height: 1000 }, { top: 600, height: 80 }, 'center', 2);
    expect(offset).toBe(320 - 250);
  });

  it('is zero when the element and container midpoints already coincide (center mode)', () => {
    const offset = computeSegmentScrollOffset({ top: 0, height: 500 }, { top: 230, height: 40 }, 'center', 1);
    expect(offset).toBe(0);
  });
});
