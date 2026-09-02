import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { splitPaliWords, stripPunct, findAdjacentWord } from '../lib/dictionary';
import { lookupHeadword, peekHeadword, prefetchHeadwordShard } from '../lib/dictionaryShards';
import { animateScrollBy, computeSegmentScrollOffset } from '../lib/segmentScroll';
import { getUiScale } from '../lib/uiPrefs';
import { isUntranslated, type SegmentFile } from '../lib/corpus';

interface DictState {
  word: string;
  gloss: string;
  defs: string[] | null;
  // Where this word sits in the sutta's Pali, which the dock's prev/next arrows step from.
  segIndex: number;
  wordIndex: number;
  // The shard is still being fetched, and has been for LOADING_DELAY_MS. Never set for a lookup
  // that resolves promptly, so the dock's height doesn't move for a cached tap.
  loading?: boolean;
  // That fetch failed, so the dock offers a retry rather than claiming to still be downloading.
  failed?: boolean;
}

// How long a lookup may take before the dock admits to waiting.
const LOADING_DELAY_MS = 150;

// How long after a lookup starts the dock may still scroll its word into view. Past it, the reader
// has moved on and pulling the pane back would be the more surprising thing.
const SCROLL_WINDOW_MS = 2000;

interface UseDictionaryLookupOptions {
  suttaId: string | undefined;
  segments: SegmentFile[] | null;
  scrollRef: RefObject<HTMLElement | null>;
  scrollToSegment: (segIndex: number, block?: ScrollLogicalPosition, highlightId?: string) => void;
  setOpenSegs: (updater: (s: Record<number, boolean>) => Record<number, boolean>) => void;
}

// The reader's word-tap dictionary: the open dock's state, opening and closing it, and stepping to
// the adjacent Pali word.
//
// A tapped word is looked up in its range shard (lib/dictionaryShards.ts). A shard already in
// memory answers in the same commit, so the dock opens straight to its definitions; otherwise the
// dock waits LOADING_DELAY_MS before it says so, and both of the word's neighbours are prefetched,
// since consecutive words in a sutta almost never share a shard. Because the dock is a flex
// sibling of the reading pane, every change in its height can hide the word it is about, so the
// word is scrolled back into view whenever the dock's content settles, within SCROLL_WINDOW_MS.
export function useDictionaryLookup({ suttaId, segments, scrollRef, scrollToSegment, setOpenSegs }: UseDictionaryLookupOptions) {
  const [dict, setDict] = useState<DictState | null>(null);

  // Which lookup the dock is showing; a reply writes state only while it is still the current one.
  // Shard fetches settle out of order, and bumping this also cancels everything in flight.
  const currentLookup = useRef(0);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // When the lookup on screen began — see SCROLL_WINDOW_MS.
  const lookupStartedAt = useRef(0);

  const cancelPending = useCallback(() => {
    currentLookup.current += 1;
    clearTimeout(loadingTimer.current);
  }, []);

  // Closes the dock on a sutta change: its segment indices belong to the previous one.
  useEffect(() => {
    cancelPending();
    setDict(null);
  }, [suttaId, cancelPending]);

  useEffect(() => () => clearTimeout(loadingTimer.current), []);

  const runLookup = useCallback(
    (raw: string, segIndex: number, wordIndex: number) => {
      const token = (currentLookup.current += 1);
      const word = stripPunct(raw);
      lookupStartedAt.current = Date.now();
      clearTimeout(loadingTimer.current);
      const settle = (defs: string[] | null) =>
        setDict({ word, gloss: defs ? `${defs.length}` : 'Pali', defs, segIndex, wordIndex });

      // The shard is already in memory: answer in this commit, with no intermediate render.
      const known = peekHeadword(raw);
      if (known !== undefined) {
        settle(known);
        return;
      }

      // Not resident. An open dock moves to the new word, keeping its body and so its height; a
      // closed one stays shut. Nothing resizes until the timer below fires.
      setDict((d) => (d ? { ...d, word, segIndex, wordIndex } : d));
      loadingTimer.current = setTimeout(() => {
        if (token !== currentLookup.current) return;
        setDict({ word, gloss: '', defs: null, segIndex, wordIndex, loading: true });
      }, LOADING_DELAY_MS);

      lookupHeadword(raw).then(
        (defs) => {
          if (token !== currentLookup.current) return;
          clearTimeout(loadingTimer.current);
          settle(defs);
        },
        () => {
          if (token !== currentLookup.current) return;
          clearTimeout(loadingTimer.current);
          setDict({ word, gloss: '', defs: null, segIndex, wordIndex, loading: true, failed: true });
        }
      );
    },
    []
  );

  const retryLookup = useCallback(() => {
    if (dict) runLookup(dict.word, dict.segIndex, dict.wordIndex);
  }, [dict, runLookup]);

  // Every segment's Pali words, in the order SegmentedText renders them. An untranslated segment
  // renders no Pali, so it contributes none and the prev/next walk steps over it.
  const segWords = useMemo(
    () => (segments ? segments.map((s) => (isUntranslated(s) ? [] : splitPaliWords(s.pali))) : []),
    [segments]
  );

  // Warms the shards either neighbour of the open word would need.
  const prefetchNeighbours = useCallback(
    (segIndex: number, wordIndex: number) => {
      for (const dir of [1, -1] as const) {
        const neighbour = findAdjacentWord(segWords, segIndex, wordIndex, dir);
        if (neighbour) prefetchHeadwordShard(neighbour.word);
      }
    },
    [segWords]
  );

  // The word SegmentedText marks as active. Memoized on the two indices rather than on `dict`,
  // which setDict reallocates, so it stays referentially stable while the position holds.
  const activeWord = useMemo(
    () => (dict ? { segIndex: dict.segIndex, wordIndex: dict.wordIndex } : null),
    [dict?.segIndex, dict?.wordIndex]
  );

  // Centres a word in the reading pane, but only when its rect falls outside the pane's visible
  // bounds. The pane's measured height already accounts for the dock, which is a flex sibling.
  const scrollToWordIfCovered = useCallback(
    (segIndex: number, wordIndex: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const word = container.querySelector(`[data-word-seg="${segIndex}"][data-word="${wordIndex}"]`);
      if (!word) {
        // The word isn't in the DOM; fall back to the coarser segment-level scroll.
        scrollToSegment(segIndex, 'center');
        return;
      }
      const wordRect = word.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (wordRect.top >= containerRect.top && wordRect.bottom <= containerRect.bottom) return;
      // Centres the word rather than its segment, which a long paragraph can leave covered. The
      // offset is divided by the UI scale, CSS `zoom` that rects report through and scrolls don't.
      animateScrollBy(container, computeSegmentScrollOffset(containerRect, wordRect, 'center', getUiScale()));
    },
    [scrollRef, scrollToSegment]
  );

  // Keeps the open word visible as the dock's height moves — it opens, it admits to loading, it
  // fills with definitions — by running off the dock's rendered content rather than off the tap.
  useEffect(() => {
    if (!dict) return;
    if (Date.now() - lookupStartedAt.current > SCROLL_WINDOW_MS) return;
    scrollToWordIfCovered(dict.segIndex, dict.wordIndex);
    // `defs` by reference: a settled lookup yields one array, so this fires once per resize.
  }, [dict?.segIndex, dict?.wordIndex, dict?.loading, dict?.defs, scrollToWordIfCovered]);

  // Looks up the next Pali word in either direction, crossing into the adjacent segment — skipping
  // any with no Pali — once the current one runs out.
  const goToAdjacentWord = useCallback(
    (dir: 1 | -1) => {
      if (!dict || segWords.length === 0) return;
      const next = findAdjacentWord(segWords, dict.segIndex, dict.wordIndex, dir);
      if (!next) return;
      const { segIndex: si, wordIndex: wi, word: raw } = next;
      runLookup(raw, si, wi);
      prefetchNeighbours(si, wi);
      // Reveals the Pali on a segment change; scrolling is left to the effect above.
      if (si !== dict.segIndex) setOpenSegs((s) => (s[si] ? s : { ...s, [si]: true }));
    },
    [dict, runLookup, prefetchNeighbours, segWords, setOpenSegs]
  );

  // Closes the dock, clearing any selection iOS Safari started on the same touch — which would
  // otherwise take the next drag as a handle drag rather than a scroll.
  const closeDict = useCallback(() => {
    cancelPending();
    setDict(null);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }, [cancelPending]);

  const onWordClick = useCallback(
    (raw: string, segIndex: number, wordIndex: number) => {
      runLookup(raw, segIndex, wordIndex);
      prefetchNeighbours(segIndex, wordIndex);
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    },
    [runLookup, prefetchNeighbours]
  );

  return { dict, activeWord, closeDict, onWordClick, goToAdjacentWord, retryLookup };
}
