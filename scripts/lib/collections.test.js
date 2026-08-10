import { describe, expect, it } from 'vitest';
import {
  flattenLeaves,
  findLeafGroups,
  findChapterNodes,
  findNodeByKey,
  suttaNumRange,
  rangeNote,
  chapterSpanNote,
  headerTitle,
  roleFor,
  cleanNote,
  buildBodySegments,
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

describe('headerTitle', () => {
  it('returns the highest "0.N" segment for a single-document uid', () => {
    const map = new Map([
      ['dn1:0.1', 'Long Discourses '],
      ['dn1:0.2', ' The Root Sequence '],
    ]);
    expect(headerTitle(map, 'dn1')).toBe('The Root Sequence');
  });

  it('returns null when the uid has no "0.N" segments at all', () => {
    const map = new Map([['dn1:1.1', 'Some body text']]);
    expect(headerTitle(map, 'dn1')).toBeNull();
  });

  it('does not match a batched-range document, whose keys are prefixed by inner sub-uids', () => {
    // "an1.1-10" batches an1.1..an1.10 — its segment keys are prefixed by the inner uids
    // (an1.1:0.1), never by the batch id itself, so headerTitle('an1.1-10') must find nothing.
    const map = new Map([['an1.1:0.1', 'The First'], ['an1.2:0.1', 'The Second']]);
    expect(headerTitle(map, 'an1.1-10')).toBeNull();
  });

  it('does not match a different uid that merely shares a numeric prefix', () => {
    const map = new Map([['dn10:0.1', 'Wrong sutta']]);
    expect(headerTitle(map, 'dn1')).toBeNull();
  });
});

describe('roleFor', () => {
  it('returns undefined for an empty/missing template', () => {
    expect(roleFor(undefined)).toBeUndefined();
    expect(roleFor('')).toBeUndefined();
  });

  it('detects a heading and its level', () => {
    expect(roleFor('<h2>{}</h2>')).toEqual({ role: 'heading', headingLevel: 2 });
    expect(roleFor('<h3>{}</h3>')).toEqual({ role: 'heading', headingLevel: 3 });
  });

  it('detects a verse line', () => {
    expect(roleFor("<span class='verse-line'>{}</span>")).toEqual({ role: 'verse' });
  });

  it('detects a colophon end marker, including the uddana-intro variant', () => {
    expect(roleFor("<p class='endsutta'>{}</p>")).toEqual({ role: 'end' });
    expect(roleFor("<p class='uddana-intro'>{}</p>")).toEqual({ role: 'end' });
  });

  it('detects a speaker attribution', () => {
    expect(roleFor("<span class='speaker'>{}</span>")).toEqual({ role: 'speaker' });
  });

  it('returns undefined for plain prose', () => {
    expect(roleFor('<p>{}</p>')).toBeUndefined();
  });
});

describe('cleanNote', () => {
  it('strips a suttacentral.net cross-reference link down to its plain text', () => {
    expect(cleanNote("See <a href='https://suttacentral.net/sn1.2'>SN 1.2</a> for more.")).toBe(
      'See SN 1.2 for more.'
    );
  });

  it('keeps other inline HTML as-is', () => {
    expect(cleanNote('An <i>emphasized</i> word.')).toBe('An <i>emphasized</i> word.');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanNote('  padded  ')).toBe('padded');
  });

  it('strips multiple links in the same note', () => {
    expect(cleanNote("<a href='#a'>One</a> and <a href='#b'>Two</a>")).toBe('One and Two');
  });
});

describe('buildBodySegments', () => {
  function maps({ pali = [], en = [], html = [], notes = [] } = {}) {
    return [new Map(pali), new Map(en), new Map(html), new Map(notes)];
  }

  it('skips title ("0"/"0.*") segments', () => {
    const [pali, en, html, notes] = maps({
      pali: [
        ['sn1.1:0', 'Title line'],
        ['sn1.1:0.1', 'Subtitle line'],
        ['sn1.1:1.1', 'Body text'],
      ],
      en: [['sn1.1:1.1', 'Body text (en)']],
    });
    const segs = buildBodySegments(pali, en, html, notes);
    expect(segs).toEqual([{ key: 'sn1.1:1.1', pali: 'Body text', en: 'Body text (en)' }]);
  });

  it('skips a segment with neither pali nor english text', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:1.1', '   ']],
      en: [['sn1.1:1.1', '']],
    });
    expect(buildBodySegments(pali, en, html, notes)).toEqual([]);
  });

  it('orders by the pali map when present, falling back to the sujato map otherwise', () => {
    const [pali, en, html, notes] = maps({
      en: [
        ['sn1.1:1.2', 'second'],
        ['sn1.1:1.1', 'first'],
      ],
    });
    const segs = buildBodySegments(pali, en, html, notes);
    expect(segs.map((s) => s.key)).toEqual(['sn1.1:1.2', 'sn1.1:1.1']);
  });

  it('attaches role/headingLevel derived from the html structure map', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:1.1', 'Heading text']],
      en: [['sn1.1:1.1', 'Heading text (en)']],
      html: [['sn1.1:1.1', '<h2>{}</h2>']],
    });
    const [seg] = buildBodySegments(pali, en, html, notes);
    expect(seg).toMatchObject({ role: 'heading', headingLevel: 2 });
  });

  it('falls back to pali for an "end" (colophon) segment with no english translation', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:9.9', 'Suttaṁ niṭṭhitaṁ.']],
      html: [['sn1.1:9.9', "<p class='endsutta'>{}</p>"]],
    });
    const [seg] = buildBodySegments(pali, en, html, notes);
    expect(seg.en).toBe('Suttaṁ niṭṭhitaṁ.');
    expect(seg.role).toBe('end');
  });

  it('does not fall back to pali for a non-"end" segment missing english', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:1.1', 'Pali only']],
    });
    const [seg] = buildBodySegments(pali, en, html, notes);
    expect(seg.en).toBe('');
  });

  it('attaches a cleaned note when one exists for the segment', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:1.1', 'text']],
      en: [['sn1.1:1.1', 'text (en)']],
      notes: [['sn1.1:1.1', "See <a href='https://suttacentral.net/sn1.2'>SN 1.2</a>."]],
    });
    const [seg] = buildBodySegments(pali, en, html, notes);
    expect(seg.note).toBe('See SN 1.2.');
  });

  it('omits `note` entirely when there is no note for the segment', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:1.1', 'text']],
      en: [['sn1.1:1.1', 'text (en)']],
    });
    const [seg] = buildBodySegments(pali, en, html, notes);
    expect(seg.note).toBeUndefined();
  });

  it('strips a verse enjambment "<j>" marker out of the english text', () => {
    const [pali, en, html, notes] = maps({
      pali: [['sn1.1:1.1', 'text']],
      en: [['sn1.1:1.1', 'comprehending Gopaka, <j>they were struck with urgency.']],
    });
    const [seg] = buildBodySegments(pali, en, html, notes);
    expect(seg.en).toBe('comprehending Gopaka, they were struck with urgency.');
  });
});
