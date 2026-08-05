import { describe, expect, it } from 'vitest';
import { flattenLeaves, findLeafGroups, findChapterNodes, rangeNote } from './collections.js';

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
