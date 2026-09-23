import { describe, expect, it } from 'vitest';
import { staleBundles } from './otaBundles.js';

const bundle = (key, day) => ({ key, last_modified: `2026-09-${day}T10:00:00.000Z` });

describe('staleBundles', () => {
  it('keeps the newest ones, the live one among them', () => {
    const objects = [bundle('a.zip', 10), bundle('d.zip', 13), bundle('b.zip', 11), bundle('c.zip', 12)];
    expect(staleBundles(objects, 'd.zip', 3)).toEqual(['a.zip']);
  });

  it('never deletes the live bundle, even when others look newer', () => {
    const objects = [bundle('live.zip', 10), bundle('b.zip', 11), bundle('c.zip', 12), bundle('d.zip', 13)];
    const stale = staleBundles(objects, 'live.zip', 3);
    expect(stale).not.toContain('live.zip');
    expect(stale).toEqual(['b.zip']);
  });

  it('deletes nothing when the live bundle is not in the listing', () => {
    const objects = [bundle('a.zip', 10), bundle('b.zip', 11), bundle('c.zip', 12), bundle('d.zip', 13)];
    expect(staleBundles(objects, 'missing.zip', 1)).toEqual([]);
  });

  it('deletes nothing when there are no more than it keeps', () => {
    expect(staleBundles([bundle('a.zip', 10), bundle('b.zip', 11)], 'b.zip', 3)).toEqual([]);
  });
});
