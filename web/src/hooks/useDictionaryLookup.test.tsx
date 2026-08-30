import { createRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDictionaryLookup } from './useDictionaryLookup';
import { lookupHeadword, peekHeadword, prefetchHeadwordShard } from '../lib/dictionaryShards';
import type { SegmentFile } from '../lib/corpus';

vi.mock('../lib/dictionaryShards', () => ({
  lookupHeadword: vi.fn(),
  peekHeadword: vi.fn(),
  prefetchHeadwordShard: vi.fn(),
}));

const LOADING_DELAY_MS = 150;

const segments: SegmentFile[] = [
  { key: 'dn1:1.1', pali: 'evaṁ me sutaṁ', en: 'So I have heard.' },
  { key: 'dn1:1.2', pali: 'ekaṁ samayaṁ', en: 'At one time.' },
];

function setup(suttaId = 'dn1') {
  return renderHook(() =>
    useDictionaryLookup({
      suttaId,
      segments,
      // Null container — scrollToWordIfCovered bails out, which is all this hook's own logic needs.
      scrollRef: createRef<HTMLElement>(),
      scrollToSegment: vi.fn(),
      setOpenSegs: vi.fn(),
    })
  );
}

describe('useDictionaryLookup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(peekHeadword).mockReset().mockReturnValue(undefined);
    vi.mocked(lookupHeadword).mockReset();
    vi.mocked(prefetchHeadwordShard).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // The flicker this exists to prevent: the dock's "Loading…" body is one line and its definitions
  // are several, so any render that passes through a loading state resizes the dock twice.
  describe('never shows a loading state for a lookup that resolves promptly', () => {
    it('answers a resident shard in a single commit, with no loading state at all', () => {
      vi.mocked(peekHeadword).mockReturnValue(['thus', 'so']);
      const { result } = setup();

      act(() => {
        result.current.onWordClick('evaṁ', 0, 0);
      });

      expect(result.current.dict).toMatchObject({ word: 'evaṁ', gloss: '2', defs: ['thus', 'so'] });
      expect(result.current.dict?.loading).toBeFalsy();
      expect(lookupHeadword).not.toHaveBeenCalled();
    });

    it('leaves the dock closed while a non-resident shard resolves, rather than opening it empty', async () => {
      let resolve!: (v: string[] | null) => void;
      vi.mocked(lookupHeadword).mockReturnValue(new Promise((r) => { resolve = r; }));
      const { result } = setup();

      act(() => {
        result.current.onWordClick('evaṁ', 0, 0);
      });
      // Part-way to the delay, so the assertion depends on the delay actually being honoured
      // rather than merely on fake timers not having run.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 50);
      });
      expect(result.current.dict).toBeNull();

      await act(async () => {
        resolve(['thus']);
      });
      expect(result.current.dict).toMatchObject({ word: 'evaṁ', defs: ['thus'] });
      expect(result.current.dict?.loading).toBeFalsy();
    });

    it('keeps the open dock’s definitions, and so its height, while stepping to a non-resident word', async () => {
      vi.mocked(peekHeadword).mockReturnValueOnce(['first']);
      const { result } = setup();
      act(() => {
        result.current.onWordClick('evaṁ', 0, 0);
      });

      let resolve!: (v: string[] | null) => void;
      vi.mocked(lookupHeadword).mockReturnValue(new Promise((r) => { resolve = r; }));
      act(() => {
        result.current.goToAdjacentWord(1);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 50);
      });

      // Caret has moved to the new word, but the body is untouched — no loading, same defs.
      expect(result.current.dict).toMatchObject({ word: 'me', wordIndex: 1, defs: ['first'] });
      expect(result.current.dict?.loading).toBeFalsy();

      await act(async () => {
        resolve(['second']);
      });
      expect(result.current.dict).toMatchObject({ word: 'me', defs: ['second'] });
    });
  });

  describe('admits to waiting only once the lookup is genuinely slow', () => {
    it('shows the loading state after the delay elapses', async () => {
      vi.mocked(lookupHeadword).mockReturnValue(new Promise(() => {}));
      const { result } = setup();

      act(() => {
        result.current.onWordClick('evaṁ', 0, 0);
      });
      expect(result.current.dict).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS);
      });
      expect(result.current.dict).toMatchObject({ word: 'evaṁ', loading: true, defs: null });
    });

    it('does not show it when the lookup beats the delay', async () => {
      vi.mocked(lookupHeadword).mockResolvedValue(['thus']);
      const states: Array<boolean | undefined> = [];
      const { result } = setup();

      await act(async () => {
        result.current.onWordClick('evaṁ', 0, 0);
      });
      states.push(result.current.dict?.loading);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS * 2);
      });

      expect(states).toEqual([undefined]);
      expect(result.current.dict).toMatchObject({ defs: ['thus'] });
      expect(result.current.dict?.loading).toBeFalsy();
    });

    // A timer left armed past a close would pop the dock back open on a word the reader dismissed.
    it('cancels a pending loading state when the dock is closed', async () => {
      vi.mocked(lookupHeadword).mockReturnValue(new Promise(() => {}));
      const { result } = setup();

      act(() => {
        result.current.onWordClick('evaṁ', 0, 0);
      });
      act(() => {
        result.current.closeDict();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS * 2);
      });

      expect(result.current.dict).toBeNull();
    });
  });

  it('settles a word the dictionary has no entry for, rather than leaving it loading', async () => {
    vi.mocked(peekHeadword).mockReturnValue(null);
    const { result } = setup();

    act(() => {
      result.current.onWordClick('notaword', 0, 0);
    });

    expect(result.current.dict).toMatchObject({ defs: null, gloss: 'Pali' });
    expect(result.current.dict?.loading).toBeFalsy();
  });

  // The dock renders its retry branch on `loading && failed`, so a failed fetch has to set both —
  // dropping `loading` here would show the word with an empty definition list as though the
  // dictionary genuinely had nothing for it.
  it('marks a failed shard fetch as failed, keeping the dock on its retry branch', async () => {
    vi.mocked(lookupHeadword).mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await act(async () => {
      result.current.onWordClick('evaṁ', 0, 0);
    });

    expect(result.current.dict).toMatchObject({ loading: true, failed: true });
  });

  it('retryLookup re-runs the word the dock is showing', async () => {
    vi.mocked(lookupHeadword).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(['thus']);
    const { result } = setup();

    await act(async () => {
      result.current.onWordClick('evaṁ', 0, 0);
    });
    expect(result.current.dict).toMatchObject({ failed: true });

    await act(async () => {
      result.current.retryLookup();
    });

    expect(lookupHeadword).toHaveBeenLastCalledWith('evaṁ');
    expect(result.current.dict).toMatchObject({ defs: ['thus'] });
    expect(result.current.dict?.failed).toBeFalsy();
  });

  // Holding an Arrow key walks words faster than a cold shard resolves, so replies land out of
  // order. Without the token guard the stale one wins and the dock shows the wrong definition.
  it('ignores a slow reply for a word the dock has already moved on from', async () => {
    let resolveFirst!: (v: string[] | null) => void;
    vi.mocked(lookupHeadword)
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue(['second']);
    const { result } = setup();

    act(() => {
      result.current.onWordClick('evaṁ', 0, 0);
    });
    await act(async () => {
      result.current.onWordClick('sutaṁ', 0, 2);
    });
    expect(result.current.dict).toMatchObject({ word: 'sutaṁ', defs: ['second'] });

    await act(async () => {
      resolveFirst(['first']);
    });
    expect(result.current.dict).toMatchObject({ word: 'sutaṁ', defs: ['second'] });
  });

  // Consecutive words in a sutta rarely share a shard, so without warming the neighbours every
  // prev/next would take the async path and the dock could never step without waiting.
  it('warms both neighbours’ shards around the open word', () => {
    vi.mocked(peekHeadword).mockReturnValue(['x']);
    const { result } = setup();

    act(() => {
      result.current.onWordClick('me', 0, 1);
    });

    const warmed = vi.mocked(prefetchHeadwordShard).mock.calls.map(([w]) => w);
    expect(warmed).toEqual(expect.arrayContaining(['sutaṁ', 'evaṁ']));
  });

  it('clears the dock when the sutta changes, since segment indices no longer mean anything', async () => {
    vi.mocked(peekHeadword).mockReturnValue(['x']);
    const { result, rerender } = renderHook(
      ({ suttaId }) =>
        useDictionaryLookup({
          suttaId,
          segments,
          scrollRef: createRef<HTMLElement>(),
          scrollToSegment: vi.fn(),
          setOpenSegs: vi.fn(),
        }),
      { initialProps: { suttaId: 'dn1' } }
    );

    act(() => {
      result.current.onWordClick('evaṁ', 0, 0);
    });
    expect(result.current.dict).not.toBeNull();

    rerender({ suttaId: 'dn2' });
    expect(result.current.dict).toBeNull();
  });

  // A segment SuttaCentral left with no English renders no Pali at all (SegmentedText), so walking
  // into one would show the reader Pali they never opened and could not have opened.
  it('steps over a segment with no English rather than opening its Pali', () => {
    vi.mocked(peekHeadword).mockReturnValue(['x']);
    const withUntranslated: SegmentFile[] = [
      { key: 'sn35.33:1.1', pali: 'Sāvatthinidānaṁ.', en: 'At Sāvatthī.' },
      { key: 'sn35.33:1.2', pali: 'Tatra kho …pe…', en: '' },
      { key: 'sn35.33:1.3', pali: 'sabbaṁ bhikkhave', en: '“Bhikkhus, all is liable to be reborn.' },
    ];
    const { result } = renderHook(() =>
      useDictionaryLookup({
        suttaId: 'sn35.33-42',
        segments: withUntranslated,
        scrollRef: createRef<HTMLElement>(),
        scrollToSegment: vi.fn(),
        setOpenSegs: vi.fn(),
      })
    );

    act(() => {
      result.current.onWordClick('Sāvatthinidānaṁ.', 0, 0);
    });
    act(() => {
      result.current.goToAdjacentWord(1);
    });

    expect(result.current.dict).toMatchObject({ word: 'sabbaṁ', segIndex: 2, wordIndex: 0 });
  });
});
