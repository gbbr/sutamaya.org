import { createRef } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDictionaryLookup } from './useDictionaryLookup';
import { lookupHeadword } from '../lib/dictionaryShards';
import type { SegmentFile } from '../lib/corpus';

vi.mock('../lib/dictionaryShards', () => ({ lookupHeadword: vi.fn() }));

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
    vi.mocked(lookupHeadword).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the dock immediately, then fills in the definitions when the shard arrives', async () => {
    let resolve!: (v: string[] | null) => void;
    vi.mocked(lookupHeadword).mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = setup();

    act(() => {
      result.current.onWordClick('evaṁ', 0, 0);
    });
    // A tap must never look like it did nothing, even while its shard is still in flight.
    expect(result.current.dict).toMatchObject({ word: 'evaṁ', loading: true, defs: null, segIndex: 0, wordIndex: 0 });

    await act(async () => {
      resolve(['thus', 'so']);
    });
    expect(result.current.dict).toMatchObject({ word: 'evaṁ', loading: false, failed: false, gloss: '2', defs: ['thus', 'so'] });
  });

  it('settles a word the dictionary has no entry for, rather than leaving it loading', async () => {
    vi.mocked(lookupHeadword).mockResolvedValue(null);
    const { result } = setup();

    await act(async () => {
      result.current.onWordClick('notaword', 0, 0);
    });

    expect(result.current.dict).toMatchObject({ loading: false, defs: null, gloss: 'Pali' });
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
    expect(result.current.dict).toMatchObject({ loading: false, failed: false, defs: ['thus'] });
  });

  // Holding Shift+Arrow walks words faster than a cold shard resolves, so replies land out of
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

    // The first lookup only now comes back.
    await act(async () => {
      resolveFirst(['first']);
    });
    expect(result.current.dict).toMatchObject({ word: 'sutaṁ', defs: ['second'] });
  });

  it('steps to the adjacent word and looks that one up', async () => {
    vi.mocked(lookupHeadword).mockResolvedValue(['x']);
    const { result } = setup();

    await act(async () => {
      result.current.onWordClick('evaṁ', 0, 0);
    });
    await act(async () => {
      result.current.goToAdjacentWord(1);
    });

    await waitFor(() => expect(result.current.dict).toMatchObject({ word: 'me', segIndex: 0, wordIndex: 1 }));
  });

  it('clears the dock when the sutta changes, since segment indices no longer mean anything', async () => {
    vi.mocked(lookupHeadword).mockResolvedValue(['x']);
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

    await act(async () => {
      result.current.onWordClick('evaṁ', 0, 0);
    });
    expect(result.current.dict).not.toBeNull();

    rerender({ suttaId: 'dn2' });
    expect(result.current.dict).toBeNull();
  });
});
