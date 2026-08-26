import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ancestorsOf,
  compareIds,
  flatSuttaOrder,
  loadSuttaText,
  nodeBlurb,
  peekSuttaText,
  resolveCanonicalSuttaId,
  searchCorpus,
  sortByIdAsc,
} from './corpus';
import type { Corpus, ListDef, Sutta } from './types';

// Only the fields compareIds/sortByIdAsc actually touch (the id key) matter here; the rest
// of Sutta is irrelevant filler to satisfy the type.
const stub = (id: string): Sutta => ({ ref: id, node: 'x', en: id, pali: id, blurb: '', min: 1 });

// The build's provenance/versioning fields, spread into each fixture below. Nothing here reads
// them — they exist for the reader's source attribution and the offline staleness check.
const meta = { sujatoCommit: 'abc1234', dataVersion: 'd1', dictionaryVersion: 'k1' };

describe('compareIds', () => {
  it('sorts a double-digit chapter after a single-digit one numerically, not lexically', () => {
    expect(compareIds('mn9', 'mn10')).toBeLessThan(0);
  });

  it('sorts a double-digit sutta number after a single-digit one within the same chapter', () => {
    expect(compareIds('an1.2', 'an1.10')).toBeLessThan(0);
  });

  it('treats equal ids as equal', () => {
    expect(compareIds('sn22.11', 'sn22.11')).toBe(0);
  });

  it('falls back to lexical comparison for non-numeric runs', () => {
    expect(compareIds('dn1', 'mn1')).toBeLessThan(0);
  });

  it('sorts an id that is a strict prefix of another before the longer one', () => {
    // Tokenizes to ['an', '1'] vs ['an', '1', '.', '1'] — the shorter array's missing
    // trailing token falls back to '' via the `ta[i] ?? ''` guard.
    expect(compareIds('an1', 'an1.1')).toBeLessThan(0);
    expect(compareIds('an1.1', 'an1')).toBeGreaterThan(0);
  });
});

describe('sortByIdAsc', () => {
  it('sorts entries by numeric-aware id order without mutating the input array', () => {
    const input: Array<[string, Sutta]> = [
      ['an1.10', stub('an1.10')],
      ['an1.2', stub('an1.2')],
      ['an1.1', stub('an1.1')],
    ];
    const original = [...input];
    expect(sortByIdAsc(input).map(([id]) => id)).toEqual(['an1.1', 'an1.2', 'an1.10']);
    expect(input).toEqual(original);
  });
});

describe('ancestorsOf', () => {
  const corpus: Corpus = {
    ...meta,
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: '', count: 1 },
      {
        id: 'an',
        label: 'Numbered Discourses',
        sub: '',
        count: 1,
        chapters: [
          {
            id: 'an1',
            ref: 'AN 1',
            label: 'Book of Ones',
            count: 1,
            chapters: [{ id: 'an1-v1', ref: 'AN 1.1–10', label: 'Vagga One', count: 1 }],
          },
        ],
      },
    ],
    suttas: {},
  };

  it('returns every ancestor chapter id up to (not including) the found node', () => {
    expect(ancestorsOf(corpus, 'an1-v1')).toEqual({ an: true, an1: true });
  });

  it('returns an empty object for a nikaya id (no chapter ancestors)', () => {
    expect(ancestorsOf(corpus, 'an')).toEqual({});
  });

  it('returns an empty object when nodeId or corpus is missing', () => {
    expect(ancestorsOf(corpus, undefined)).toEqual({});
    expect(ancestorsOf(null, 'an1-v1')).toEqual({});
  });

  it('returns an empty object for an id not found in the corpus', () => {
    expect(ancestorsOf(corpus, 'sn1')).toEqual({});
  });
});

describe('nodeBlurb', () => {
  // SN's shape, which is the whole reason the lookup walks up at all: the description sits on the
  // saṁyutta, the page that displays it is the vagga below. `sn2` stands for the leaf that has
  // its own, `sn1-v2` for one that has to borrow.
  const corpus: Corpus = {
    ...meta,
    nikayas: [
      {
        id: 'sn',
        label: 'Linked Discourses',
        sub: '',
        count: 3,
        chapters: [
          {
            id: 'sn-book',
            ref: 'SN1–11',
            label: 'Verses',
            count: 3,
            blurb: 'the book',
            chapters: [
              {
                id: 'sn1',
                ref: 'SN1',
                label: 'Deities',
                count: 2,
                blurb: 'the saṁyutta',
                chapters: [
                  { id: 'sn1-v1', ref: 'SN1.1–10', label: 'Reed', count: 1, blurb: 'the vagga' },
                  { id: 'sn1-v2', ref: 'SN1.11–20', label: 'Garden', count: 1 },
                ],
              },
              { id: 'sn2', ref: 'SN2', label: 'Godlings', count: 1, blurb: 'the other saṁyutta' },
            ],
          },
        ],
      },
      { id: 'an', label: 'Numbered Discourses', sub: '', count: 0, chapters: [{ id: 'an1', ref: 'AN1', label: 'Ones', count: 0 }] },
    ],
    suttas: {},
  };

  it('prefers the node’s own blurb, unattributed', () => {
    expect(nodeBlurb(corpus, 'sn1-v1')).toEqual({ blurb: 'the vagga' });
    expect(nodeBlurb(corpus, 'sn2')).toEqual({ blurb: 'the other saṁyutta' });
  });

  it('borrows the nearest ancestor’s blurb and names where it came from', () => {
    expect(nodeBlurb(corpus, 'sn1-v2')).toEqual({ blurb: 'the saṁyutta', from: 'SN1 · Deities' });
  });

  it('stops at the nearest ancestor, leaving a further-up blurb unused', () => {
    // sn1 has its own, so the book's never reaches sn1-v2 — the more specific description wins.
    expect(nodeBlurb(corpus, 'sn1-v2').blurb).not.toBe('the book');
  });

  it('returns nothing when neither the node nor any ancestor has one', () => {
    expect(nodeBlurb(corpus, 'an1')).toEqual({});
  });

  it('returns nothing for an unknown id, a missing id or a missing corpus', () => {
    expect(nodeBlurb(corpus, 'mn1')).toEqual({});
    expect(nodeBlurb(corpus, undefined)).toEqual({});
    expect(nodeBlurb(null, 'sn1-v2')).toEqual({});
  });
});

describe('flatSuttaOrder', () => {
  // Two nikayas, one flat and one nesting a chapter down to two leaf vaggas, so the walk has to
  // recurse and to keep group order — plus ids that sort lexically the wrong way within a group.
  const corpus: Corpus = {
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: '', count: 2 },
      {
        id: 'an',
        label: 'Numbered Discourses',
        sub: '',
        count: 3,
        chapters: [
          {
            id: 'an1',
            ref: 'AN 1',
            label: 'Book of Ones',
            count: 3,
            chapters: [
              { id: 'an1-v1', ref: 'AN 1.1–10', label: 'Vagga One', count: 2 },
              { id: 'an1-v2', ref: 'AN 1.11–20', label: 'Vagga Two', count: 1 },
            ],
          },
        ],
      },
    ],
    suttas: {
      'dn10': { ...stub('dn10'), node: 'dn' },
      'dn2': { ...stub('dn2'), node: 'dn' },
      'an1.11': { ...stub('an1.11'), node: 'an1-v2' },
      'an1.10': { ...stub('an1.10'), node: 'an1-v1' },
      'an1.2': { ...stub('an1.2'), node: 'an1-v1' },
    },
    sujatoCommit: '',
    dataVersion: '',
    dictionaryVersion: '',
  };

  it('walks nikaya by nikaya and leaf group by leaf group, id-ascending within each', () => {
    expect(flatSuttaOrder(corpus)).toEqual(['dn2', 'dn10', 'an1.2', 'an1.10', 'an1.11']);
  });

  it('omits a sutta whose node is not a leaf group in the tree', () => {
    // 'an1' is expandable, so it is never itself a leaf group — a sutta parked on it has no
    // position in the browse order and must not appear.
    const orphaned: Corpus = { ...corpus, suttas: { ...corpus.suttas, 'an1.99': { ...stub('an1.99'), node: 'an1' } } };
    expect(flatSuttaOrder(orphaned)).not.toContain('an1.99');
  });

  it('returns an empty array for a corpus with no suttas', () => {
    expect(flatSuttaOrder({ ...corpus, suttas: {} })).toEqual([]);
  });
});

describe('searchCorpus', () => {
  const corpus: Corpus = {
    ...meta,
    nikayas: [],
    suttas: {
      'mn1': { ref: 'MN 1', node: 'x', en: 'The Root of All Things', pali: 'Mūlapariyāyasutta', blurb: 'The Buddha analyzes how the mind relates to experience.', min: 30 },
      'mn10': { ref: 'MN 10', node: 'x', en: 'The Establishment of Mindfulness', pali: 'Satipaṭṭhānasutta', blurb: 'On the four kinds of mindfulness meditation.', min: 20 },
    },
  };

  it('is case- and diacritic-insensitive', () => {
    expect(searchCorpus(corpus, 'MULAPARIYAYA', {}).map((h) => h.id)).toEqual(['mn1']);
  });

  it('ranks a ref/title/Pali match above a blurb-only match', () => {
    // "mindfulness" is in mn10's own title, but only in mn1's blurb ("mind" appears in both,
    // so use a query that's a title match for one and a blurb-only match for the other).
    expect(searchCorpus(corpus, 'mind', {}).map((h) => h.id)).toEqual(['mn10', 'mn1']);
  });

  it('matches the user\'s own note on a sutta even when nothing else does', () => {
    expect(searchCorpus(corpus, 'apple', { mn1: 'tastes like an apple' }).map((h) => h.id)).toEqual(['mn1']);
  });

  it('returns nothing for a blank query', () => {
    expect(searchCorpus(corpus, '   ', {})).toEqual([]);
  });

  it('finds a batched range document by an individual number inside its range', () => {
    const batched: Corpus = {
      ...meta,
      nikayas: [],
      suttas: {
        'dhp306-319': { ref: 'Dhp306–319', node: 'dhp', en: '22. The Underworld', pali: 'Nirayavagga', blurb: '', min: 2 },
        'dhp320-333': { ref: 'Dhp320–333', node: 'dhp', en: '23. Elephants', pali: 'Nāgavagga', blurb: '', min: 2 },
      },
    };
    expect(searchCorpus(batched, 'dhp325', {}).map((h) => h.id)).toEqual(['dhp320-333']);
    expect(searchCorpus(batched, 'dhp340', {}).map((h) => h.id)).toEqual([]);
  });

  it('respects the range query\'s own prefix, not just the numeric overlap', () => {
    const batched: Corpus = {
      ...meta,
      nikayas: [],
      suttas: {
        'sn35.180-182': { ref: 'SN35.180–182', node: 'sn', en: 'x', pali: 'x', blurb: '', min: 1 },
        'an1.180-182': { ref: 'AN1.180–182', node: 'an', en: 'y', pali: 'y', blurb: '', min: 1 },
      },
    };
    expect(searchCorpus(batched, 'sn35.181', {}).map((h) => h.id)).toEqual(['sn35.180-182']);
  });

  it('surfaces the specific inner sutta id on a range-query match, so a caller can open that instead of the batch', () => {
    const batched: Corpus = {
      ...meta,
      nikayas: [],
      suttas: {
        'dhp320-333': { ref: 'Dhp320–333', node: 'dhp', en: '23. Elephants', pali: 'Nāgavagga', blurb: '', min: 2 },
      },
    };
    const [hit] = searchCorpus(batched, 'dhp325', {});
    expect(hit).toMatchObject({ id: 'dhp320-333', matchedId: 'dhp325' });
  });

  it('leaves matchedId unset for a plain title/blurb match (no per-inner-sutta data to attribute it to)', () => {
    expect(searchCorpus(corpus, 'mindfulness', {})[0].matchedId).toBeUndefined();
  });

  it('still surfaces matchedId when the query is a batch\'s own first inner uid', () => {
    // A batch's ref is always exactly `${prefix}${start}` with no separator (e.g. "Dhp320–333"),
    // so a query for its first inner uid ("dhp320") already satisfies the plain title match on
    // its own, before the range-query fallback ever runs — matchedId must still get attached in
    // that case, not just for a query that misses the literal ref text (e.g. "dhp325" above).
    const batched: Corpus = {
      ...meta,
      nikayas: [],
      suttas: {
        'dhp320-333': { ref: 'Dhp320–333', node: 'dhp', en: '23. Elephants', pali: 'Nāgavagga', blurb: '', min: 2 },
      },
    };
    const [hit] = searchCorpus(batched, 'dhp320', {});
    expect(hit).toMatchObject({ id: 'dhp320-333', matchedId: 'dhp320' });
  });

  describe('matching against list/group names', () => {
    const list = (over: Partial<ListDef>): ListDef => ({
      id: 'x', label: 'x', parentId: null, kind: 'list', items: [], ...over,
    });

    it('surfaces every sutta in a list matched by its own name', () => {
      const lists = [list({ id: 'l1', label: 'Favourites', items: ['mn1', 'mn10'] })];
      expect(searchCorpus(corpus, 'favourites', {}, lists).map((h) => h.id).sort()).toEqual(['mn1', 'mn10']);
    });

    it('matches a nested list by its "group/list" path, not just its own label', () => {
      const lists = [
        list({ id: 'g1', label: 'Group', kind: 'group' }),
        list({ id: 'l1', label: 'Favourites', parentId: 'g1', items: ['mn1'] }),
      ];
      expect(searchCorpus(corpus, 'group/favourites', {}, lists).map((h) => h.id)).toEqual(['mn1']);
      // A bare label search still works at any depth, not just for top-level lists.
      expect(searchCorpus(corpus, 'favourites', {}, lists).map((h) => h.id)).toEqual(['mn1']);
    });

    it('expands a matched group name into every sutta in every list nested under it', () => {
      const lists = [
        list({ id: 'g1', label: 'Study', kind: 'group' }),
        list({ id: 'l1', label: 'Week 1', parentId: 'g1', items: ['mn1'] }),
        list({ id: 'l2', label: 'Week 2', parentId: 'g1', items: ['mn10'] }),
      ];
      expect(searchCorpus(corpus, 'study', {}, lists).map((h) => h.id).sort()).toEqual(['mn1', 'mn10']);
    });

    it('is case- and diacritic-insensitive on list names, same as everything else', () => {
      const lists = [list({ id: 'l1', label: 'Satipaṭṭhāna', items: ['mn10'] })];
      expect(searchCorpus(corpus, 'satipatthana', {}, lists).map((h) => h.id)).toEqual(['mn10']);
    });

    it('does not match a list whose name does not contain the query', () => {
      const lists = [list({ id: 'l1', label: 'Favourites', items: ['mn1'] })];
      expect(searchCorpus(corpus, 'nonexistent', {}, lists)).toEqual([]);
    });

    it('ranks a list-only match alongside a blurb-only match, below a title match', () => {
      // mn10's title itself matches "mind" (rank 0); mn1 only matches via the list name here.
      const lists = [list({ id: 'l1', label: 'mind', items: ['mn1'] })];
      expect(searchCorpus(corpus, 'mind', {}, lists).map((h) => h.id)).toEqual(['mn10', 'mn1']);
    });

    it('narrows to the suttas in every named list when two list names are typed', () => {
      const lists = [
        list({ id: 'l1', label: 'Retreat', items: ['mn1', 'mn10'] }),
        list({ id: 'l2', label: 'Memorize', items: ['mn10'] }),
      ];
      expect(searchCorpus(corpus, 'retreat memorize', {}, lists).map((h) => h.id)).toEqual(['mn10']);
    });
  });

  describe('multi-word queries', () => {
    it('matches words found apart, in any order', () => {
      // "The Establishment of Mindfulness" holds both words, with two others between them.
      expect(searchCorpus(corpus, 'mindfulness establishment', {}).map((h) => h.id)).toEqual(['mn10']);
    });

    it('matches words split across different fields', () => {
      // "root" is in mn1's title, "apple" only in the reader's own note on it.
      expect(searchCorpus(corpus, 'root apple', { mn1: 'tastes like an apple' }).map((h) => h.id)).toEqual(['mn1']);
    });

    it('requires every word, not just one of them', () => {
      expect(searchCorpus(corpus, 'mindfulness nonexistent', {})).toEqual([]);
    });

    it('ranks the sutta whose title has the words together above one that merely has both', () => {
      const both: Corpus = {
        ...corpus,
        suttas: {
          // Holds "mind" and "four" apart, in the title and the blurb respectively.
          scattered: { ref: 'X 1', node: 'x', en: 'The Mind', pali: 'x', blurb: 'On the four kinds.', min: 1 },
          contiguous: { ref: 'X 2', node: 'x', en: 'The Four Minds', pali: 'x', blurb: '', min: 1 },
        },
      };
      expect(searchCorpus(both, 'four mind', {}).map((h) => h.id)).toEqual(['contiguous', 'scattered']);
    });

    it('ignores surrounding and repeated whitespace', () => {
      expect(searchCorpus(corpus, '  mindfulness   establishment  ', {}).map((h) => h.id)).toEqual(['mn10']);
    });
  });
});

describe('resolveCanonicalSuttaId', () => {
  const corpus: Corpus = {
    ...meta,
    nikayas: [],
    suttas: {
      mn1: { ref: 'MN 1', node: 'x', en: 'x', pali: 'x', blurb: '', min: 1 },
      'dhp320-333': { ref: 'Dhp320–333', node: 'dhp', en: '23. Elephants', pali: 'Nāgavagga', blurb: '', min: 2 },
    },
  };

  it('resolves a real id to itself', () => {
    expect(resolveCanonicalSuttaId(corpus, 'mn1')).toBe('mn1');
  });

  it('resolves a bare inner-sutta id to its enclosing batch', () => {
    expect(resolveCanonicalSuttaId(corpus, 'dhp321')).toBe('dhp320-333');
  });

  it('leaves an id matching no batch and no real entry unchanged', () => {
    expect(resolveCanonicalSuttaId(corpus, 'dhp999')).toBe('dhp999');
    expect(resolveCanonicalSuttaId(corpus, 'not-a-real-id')).toBe('not-a-real-id');
  });
});

// The reader prefetches the suttas either side of the one being read, then takes them straight
// out of this cache when the reader steps — synchronously, so the text lands in the same commit
// as the title above it rather than a frame later. See useSuttaText.
describe('peekSuttaText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty until a load for that sutta has actually resolved', async () => {
    const segments = [{ key: 'mn1:1.1', pali: 'evaṁ', en: 'so' }];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return { ok: true, json: async () => segments } as Response;
      })
    );

    const pending = loadSuttaText('mn1');
    expect(peekSuttaText('mn1')).toBeUndefined();
    release!();
    await pending;
    expect(peekSuttaText('mn1')).toEqual(segments);
  });

  it('has nothing for a sutta nobody asked for, or for no sutta at all', () => {
    expect(peekSuttaText('an-id-never-loaded')).toBeUndefined();
    expect(peekSuttaText(undefined)).toBeUndefined();
  });

  it('stays empty when the fetch failed, so a retry refetches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 }) as Response));
    await expect(loadSuttaText('mn404')).rejects.toThrow();
    expect(peekSuttaText('mn404')).toBeUndefined();
  });
});
