import { describe, expect, it } from 'vitest';
import {
  flattenLeaves,
  findLeafGroups,
  findChapterNodes,
  findNodeByKey,
  suttaNumRange,
  rangeNote,
  chapterSpanNote,
} from './collections.js';

// A miniature stand-in for SN's shape: chapters (sn1, sn2) nested under a super-vagga, each
// chapter split into vagga-level "leaf groups" (plain arrays of uids) wrapped in an unnamed
// "fifty" grouping layer that should be walked through, never surfaced as its own row.
const snLikeTree = {
  'sn-somevagga': {
    sn1: {
      'sn1-fifty-1': {
        'sn1-vagga-a': ['sn1.1', 'sn1.2'],
        'sn1-vagga-b': ['sn1.3'],
      },
    },
    sn2: {
      'sn2-vagga-a': ['sn2.1', 'sn2.2', 'sn2.3'],
    },
  },
};

describe('flattenLeaves', () => {
  it('collects every leaf uid regardless of nesting depth', () => {
    expect(flattenLeaves(snLikeTree).sort()).toEqual(['sn1.1', 'sn1.2', 'sn1.3', 'sn2.1', 'sn2.2', 'sn2.3'].sort());
  });
});

describe('findLeafGroups', () => {
  it('finds only terminal groups (arrays of leaf uids), passing through non-terminal wrappers', () => {
    const groups = findLeafGroups(snLikeTree);
    const keys = groups.map((g) => g.key).sort();
    // The "fifty" wrapper ('sn1-fifty-1') and the chapter keys ('sn1', 'sn2') are not
    // themselves arrays of uids, so they must not appear as their own rows.
    expect(keys).toEqual(['sn1-vagga-a', 'sn1-vagga-b', 'sn2-vagga-a']);
    expect(groups.find((g) => g.key === 'sn1-vagga-a').leaves).toEqual(['sn1.1', 'sn1.2']);
  });
});

describe('findChapterNodes', () => {
  it('locates chapter keys at whatever depth they occur, with their flattened leaves', () => {
    const chapters = findChapterNodes(snLikeTree, /^sn\d+$/);
    const byKey = Object.fromEntries(chapters.map((c) => [c.key, c.leaves.sort()]));
    expect(byKey).toEqual({
      sn1: ['sn1.1', 'sn1.2', 'sn1.3'],
      sn2: ['sn2.1', 'sn2.2', 'sn2.3'],
    });
  });
});

describe('findNodeByKey', () => {
  it('finds a named group by exact key at whatever depth it occurs', () => {
    expect(findNodeByKey(snLikeTree, 'sn1-vagga-b')).toEqual(['sn1.3']);
    expect(findNodeByKey(snLikeTree, 'sn2')).toEqual(snLikeTree['sn-somevagga'].sn2);
  });

  it('returns null when the key is not present anywhere in the tree', () => {
    expect(findNodeByKey(snLikeTree, 'sn99')).toBeNull();
  });

  it('matches the shorter of two keys that share a prefix ("sn1" vs "sn1-vagga-a")', () => {
    expect(findNodeByKey(snLikeTree, 'sn1')).toEqual(snLikeTree['sn-somevagga'].sn1);
  });

  it('descends through array-of-siblings nodes, not just keyed objects', () => {
    const withArraySiblings = [{ 'sn-a': { target: ['x.1'] } }, { 'sn-b': { other: ['y.1'] } }];
    expect(findNodeByKey(withArraySiblings, 'target')).toEqual(['x.1']);
  });
});

describe('suttaNumRange', () => {
  it('reads the trailing number for a single, undotted uid', () => {
    expect(suttaNumRange('mn1')).toEqual([1, 1]);
  });

  it('reads the number after the last dot for a chaptered uid', () => {
    expect(suttaNumRange('sn22.11')).toEqual([11, 11]);
  });

  it('reads a dotted (chapter.n-n) batched range as [start, end]', () => {
    expect(suttaNumRange('an1.1-10')).toEqual([1, 10]);
  });

  it('reads an undotted (nikaya-number-only) batched range as [start, end]', () => {
    expect(suttaNumRange('dhp1-20')).toEqual([1, 20]);
  });
});

describe('rangeNote', () => {
  it('formats a single-sutta range without a dash', () => {
    expect(rangeNote('SN35', ['sn35.1'], true)).toBe('SN35.1');
  });

  it('formats a multi-sutta dotted range', () => {
    expect(rangeNote('SN35', ['sn35.1', 'sn35.2', 'sn35.12'], true)).toBe('SN35.1–12');
  });

  it('formats a multi-sutta undotted range', () => {
    expect(rangeNote('MN', ['mn1', 'mn2', 'mn10'], false)).toBe('MN1–10');
  });
});

describe('chapterSpanNote', () => {
  it('formats a single-chapter span without a dash', () => {
    expect(chapterSpanNote('SN', 'sn1', 'sn1')).toBe('SN1');
  });

  it('formats a multi-chapter span by chapter number, not sutta number', () => {
    expect(chapterSpanNote('SN', 'sn1', 'sn11')).toBe('SN1–11');
  });
});
