import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ancestorsOf, compareIds, loadDictionary, resolveCanonicalSuttaId, searchCorpus, sortByIdAsc } from './corpus';
import type { Corpus, ListDef, Sutta } from './types';

vi.mock('./offline', () => ({ clearCachedDictionary: vi.fn(async () => {}) }));

// Only the fields compareIds/sortByIdAsc actually touch (the id key) matter here; the rest
// of Sutta is irrelevant filler to satisfy the type.
const stub = (id: string): Sutta => ({ ref: id, node: 'x', en: id, pali: id, blurb: '', min: 1 });

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

describe('searchCorpus', () => {
  const corpus: Corpus = {
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
  });
});

describe('resolveCanonicalSuttaId', () => {
  const corpus: Corpus = {
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


// The dictionary worker's own fetch/parse is covered by the browser it runs in; what matters here
// is that loadDictionary always *settles*. A promise left hanging is the one failure the callers
// can't recover from — retryWithBackoff never retries it and CorpusContext never marks the
// dictionary failed, so the reader sits on "Loading dictionary…" for the rest of the session.
describe('loadDictionary', () => {
  const WATCHDOG_MS = 60_000;
  let posted: Array<Record<string, unknown>>;
  let terminated: number;
  let instance: { onmessage: ((e: MessageEvent) => void) | null; onerror: ((e: ErrorEvent) => void) | null };

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    terminated = 0;
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(data: Record<string, unknown>) {
        posted.push(data);
      }
      terminate() {
        terminated += 1;
      }
      constructor() {
        instance = this;
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const reply = (data: Record<string, unknown>) => instance.onmessage?.({ data } as MessageEvent);

  it('rejects once the worker has gone silent, rather than hanging forever', async () => {
    const p = loadDictionary();
    const settled = expect(p).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    await settled;
    expect(terminated).toBe(1);
  });

  it('keeps waiting while the worker is still pinging — a slow download is not a dead worker', async () => {
    const p = loadDictionary();
    let resolved = false;
    void p.then(() => {
      resolved = true;
    });
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1_000);
      reply({ ping: true });
    }
    reply({ ok: true, dictionary: { dhamma: ['teaching'] } });
    await expect(p).resolves.toEqual({ dhamma: ['teaching'] });
    expect(resolved).toBe(true);
  });

  it('drops the cached response when the bytes that arrived are not the dictionary', async () => {
    const { clearCachedDictionary } = await import('./offline');
    const p = loadDictionary();
    reply({ ok: false, corrupt: true, error: 'SyntaxError: Unexpected token <' });
    await expect(p).rejects.toThrow('Unexpected token');
    // Without this the SW's CacheFirst copy — a captive portal's page, a truncated write — is
    // replayed by every later attempt for the whole year it stays cached.
    expect(clearCachedDictionary).toHaveBeenCalled();
  });

  it('leaves the cache alone when the fetch itself failed — there is nothing poisoned to drop', async () => {
    const { clearCachedDictionary } = await import('./offline');
    const p = loadDictionary();
    reply({ ok: false, error: 'TypeError: Failed to fetch' });
    await expect(p).rejects.toThrow('Failed to fetch');
    expect(clearCachedDictionary).not.toHaveBeenCalled();
  });
});
