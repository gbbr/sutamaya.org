import { describe, expect, it } from 'vitest';
import { latestIds } from './autoListRecency.js';

describe('latestIds', () => {
  it('sorts descending by `at`', () => {
    expect(
      latestIds(
        [
          { id: 'a', at: '2024-01-01' },
          { id: 'b', at: '2024-03-01' },
          { id: 'c', at: '2024-02-01' },
        ],
        10
      )
    ).toEqual(['b', 'c', 'a']);
  });

  it('dedupes repeated ids, keeping the most recent `at`', () => {
    expect(
      latestIds(
        [
          { id: 'a', at: '2024-01-01' },
          { id: 'a', at: '2024-05-01' },
          { id: 'a', at: '2024-03-01' },
        ],
        10
      )
    ).toEqual(['a']);
  });

  it('caps to `limit`, keeping the most recent entries', () => {
    expect(
      latestIds(
        [
          { id: 'a', at: '2024-01-01' },
          { id: 'b', at: '2024-02-01' },
          { id: 'c', at: '2024-03-01' },
        ],
        2
      )
    ).toEqual(['c', 'b']);
  });

  it('returns everything when under the cap', () => {
    expect(latestIds([{ id: 'a', at: '2024-01-01' }], 100)).toEqual(['a']);
  });

  it('returns an empty array for empty input', () => {
    expect(latestIds([], 100)).toEqual([]);
  });
});
