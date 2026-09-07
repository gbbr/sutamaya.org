import { describe, expect, it } from 'vitest';
import { compareSegmentKeys, segmentIndex } from './segmentKeys';
// @ts-expect-error -- plain-JS build module, no .d.ts across the workspace boundary
import { compareSegmentKeys as buildCompare } from '../../../scripts/lib/segmentKeys.js';
import type { SegmentFile } from './corpus';

// Every highlight rests on this order. The mirror decides what a new selection displaces by
// comparing keys with no sutta text loaded, so an order that disagrees with the document's would
// retire the wrong highlights — silently, and on the device that made them.

const sorted = (keys: string[]) => [...keys].sort(compareSegmentKeys);

describe('compareSegmentKeys', () => {
  it('reads the numbers as numbers, not as text', () => {
    expect(sorted(['mn1:1.10', 'mn1:1.2', 'mn1:1.1'])).toEqual(['mn1:1.1', 'mn1:1.2', 'mn1:1.10']);
    expect(sorted(['mn1:10.1', 'mn1:9.1', 'mn1:2.1'])).toEqual(['mn1:2.1', 'mn1:9.1', 'mn1:10.1']);
  });

  it('orders a whole document the way it is read', () => {
    const document = ['dn1:1.1', 'dn1:1.2', 'dn1:1.10', 'dn1:2.1', 'dn1:2.1.1', 'dn1:10.1', 'dn1:11.1'];
    expect(sorted([...document].reverse())).toEqual(document);
  });

  it('puts a key before the longer key it prefixes', () => {
    expect(compareSegmentKeys('mn1:2.1', 'mn1:2.1.1')).toBeLessThan(0);
    expect(compareSegmentKeys('mn1:2.1.1', 'mn1:2.1')).toBeGreaterThan(0);
  });

  it('is zero only for the same key, and antisymmetric otherwise', () => {
    expect(compareSegmentKeys('sn12.1:3.4', 'sn12.1:3.4')).toBe(0);
    for (const [a, b] of [
      ['an1.1:1.1', 'an1.2:1.1'],
      ['sn1.1:1.2', 'sn1.1:1.20'],
      ['mn10:2.9', 'mn10:3.1'],
    ]) {
      expect(compareSegmentKeys(a, b)).toBeLessThan(0);
      expect(compareSegmentKeys(b, a)).toBeGreaterThan(0);
    }
  });

  // One text file holds several suttas' keys where the build groups them (an1.1-10 and its like),
  // so the order has to hold across the prefix too.
  it('orders across the suttas sharing one document', () => {
    const document = ['an1.1:1.1', 'an1.2:1.1', 'an1.10:1.1', 'an1.11:1.1'];
    expect(sorted([...document].reverse())).toEqual(document);
  });

  it('orders keys carrying a range, as a grouped document uses', () => {
    expect(sorted(['an1.142-149:1.1', 'an1.141:1.1', 'an1.140:1.1'])).toEqual([
      'an1.140:1.1',
      'an1.141:1.1',
      'an1.142-149:1.1',
    ]);
  });
});

// scripts/lib/segmentKeys.js is the build's own copy, nothing being shared across the two npm
// workspaces. build-corpus.mjs asserts the shipped text is in the build copy's order, and the reader
// resolves highlights in this one's; a divergence would mean the assertion passing on an order the
// reader doesn't use.
describe('the build’s copy of the comparator', () => {
  it('answers identically', () => {
    const keys = [
      'dn1:0.1', 'dn1:1.1', 'dn1:1.2', 'dn1:1.10', 'dn1:1.10.1', 'dn1:2.1', 'dn1:10.1',
      'an1.1:1.1', 'an1.10:1.1', 'an1.142-149:1.1', 'sn12.1:1.1', 'mn10:2.9', 'thag1.1:1.1',
    ];
    for (const a of keys) {
      for (const b of keys) {
        expect(Math.sign(compareSegmentKeys(a, b))).toBe(Math.sign(buildCompare(a, b)));
      }
    }
  });
});

describe('segmentIndex', () => {
  it('gives each segment its position', () => {
    const segments: SegmentFile[] = ['mn1:1.1', 'mn1:1.2', 'mn1:1.3'].map((key) => ({ key, pali: '', en: '' }));
    expect([...segmentIndex(segments)]).toEqual([
      ['mn1:1.1', 0],
      ['mn1:1.2', 1],
      ['mn1:1.3', 2],
    ]);
    expect(segmentIndex([]).size).toBe(0);
  });
});
