import { describe, expect, it } from 'vitest';
import { nextPosition, firstPosition } from './listPositions.js';

describe('nextPosition', () => {
  it('is 0 for an empty group', () => {
    expect(nextPosition([])).toBe(0);
  });

  it('is one past the current max', () => {
    expect(nextPosition([0, 1, 2])).toBe(3);
    expect(nextPosition([2, 0, 1])).toBe(3);
  });

  it('treats a missing/undefined position as 0', () => {
    expect(nextPosition([undefined, 1])).toBe(2);
  });
});

describe('firstPosition', () => {
  it('is 0 for an empty group', () => {
    expect(firstPosition([])).toBe(0);
  });

  it('is one before the current min', () => {
    expect(firstPosition([0, 1, 2])).toBe(-1);
    expect(firstPosition([2, 0, 1])).toBe(-1);
  });

  it('treats a missing/undefined position as 0', () => {
    expect(firstPosition([undefined, 1])).toBe(-1);
  });
});
