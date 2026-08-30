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
  // Where this lookup's word sits in the sutta's Pali, so DictionaryDock's prev/next arrows can
  // step to the adjacent word without re-deriving the position from the word text, which isn't
  // unique within a segment.
  segIndex: number;
  wordIndex: number;
  // This word's shard is still being fetched, and has been for long enough to be worth saying so
  // — see LOADING_DELAY_MS. Never set for a lookup that resolves promptly, so the dock's height
  // doesn't move for the ordinary cached tap.
  loading?: boolean;
  // That fetch failed — offline with this shard uncached, or a bad response. Distinguished from
  // `loading` so the dock can offer a retry instead of claiming a download is still going.
  failed?: boolean;
}

// How long a lookup may take before the dock admits to waiting. A shard read that beats this never
// renders a loading state, which keeps the dock from resizing twice for every tapped word.
const LOADING_DELAY_MS = 150;

// How long after a lookup starts the dock may still scroll the word it opened on into view. The
// dock's height settles asynchronously — a cold shard resolves well after the tap — so the
// visibility check has to run again when it does, and this bounds how late that can happen: past
// the window (a fetch that hangs, then fails) the reader has moved on and yanking the pane back
// would be the more surprising behaviour.
const SCROLL_WINDOW_MS = 2000;

interface UseDictionaryLookupOptions {
  suttaId: string | undefined;
  segments: SegmentFile[] | null;
  scrollRef: RefObject<HTMLElement | null>;
  scrollToSegment: (segIndex: number, block?: ScrollLogicalPosition, highlightId?: string) => void;
  setOpenSegs: (updater: (s: Record<number, boolean>) => Record<number, boolean>) => void;
}

// ReaderPage's word-tap dictionary lookup cluster: the currently-open dock's state, opening and
// closing it, and stepping to the adjacent Pali word (DictionaryDock's own prev/next arrows, and
// the reader's plain Left/Right shortcut, which only does this while the dock is open — Shift
// belongs to sutta-to-sutta navigation; see useReaderKeyboard).
export function useDictionaryLookup({ suttaId, segments, scrollRef, scrollToSegment, setOpenSegs }: UseDictionaryLookupOptions) {
  const [dict, setDict] = useState<DictState | null>(null);

  // Which lookup the dock is showing. Shard fetches settle out of order — holding an Arrow key
  // walks words faster than a cold shard resolves — so a reply may write state only while it is
  // still the one being waited on. Bumping it also cancels: closing the dock or changing sutta
  // invalidates every reply and timer in flight.
  const currentLookup = useRef(0);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // When the lookup the dock is currently showing began — see SCROLL_WINDOW_MS.
  const lookupStartedAt = useRef(0);

  const cancelPending = useCallback(() => {
    currentLookup.current += 1;
    clearTimeout(loadingTimer.current);
  }, []);

  // Sutta changed (Prev/Next, a deep link, closing and reopening elsewhere) — any dock left open
  // for the previous sutta's own segment indices is meaningless for the new one.
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

      // The shard is already parsed and in memory: answer in this same commit, so the dock opens
      // (or steps) straight to its definitions with no intermediate render.
      const known = peekHeadword(raw);
      if (known !== undefined) {
        settle(known);
        return;
      }

      // Not resident. Move the caret to the new word if the dock is open, leaving its body — and so
      // its height — as it was; a dock that isn't open stays shut rather than opening empty.
      // Nothing changes size until the timer below fires.
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

  // Every segment's Pali word list, in the order SegmentedText renders them — used by onWordClick
  // to record where a lookup came from, and by goToAdjacentWord to walk across segment boundaries.
  // An untranslated segment (lib/corpus.ts) renders no Pali at all, so it contributes no words and
  // the walk steps straight over it: prev/next only ever opens Pali the reader could have opened
  // themselves by tapping an English line.
  const segWords = useMemo(
    () => (segments ? segments.map((s) => (isUntranslated(s) ? [] : splitPaliWords(s.pali))) : []),
    [segments]
  );

  // Warm the shards either neighbour of the open word would need. Consecutive words in a sutta
  // share almost no alphabetical locality — stepping through dn4 crosses a shard boundary on 37 of
  // every 39 steps — so without this, prev/next always takes the async path.
  const prefetchNeighbours = useCallback(
    (segIndex: number, wordIndex: number) => {
      for (const dir of [1, -1] as const) {
        const neighbour = findAdjacentWord(segWords, segIndex, wordIndex, dir);
        if (neighbour) prefetchHeadwordShard(neighbour.word);
      }
    },
    [segWords]
  );

  // The word SegmentedText renders as persistently active (its activeWordIndex prop). Kept
  // referentially stable across renders where the position hasn't changed by depending on the
  // primitives rather than on `dict`, which setDict always reallocates.
  const activeWord = useMemo(
    () => (dict ? { segIndex: dict.segIndex, wordIndex: dict.wordIndex } : null),
    [dict?.segIndex, dict?.wordIndex]
  );

  // Only scrolls if the word's DOM rect falls outside the reading pane's visible bounds. The
  // DictionaryDock is a flex sibling of the scroll pane rather than an overlay, so as it mounts,
  // grows or shrinks the pane's measured height already accounts for it and no dock-height lookup
  // is needed. The check is strict, with no padding: padding the trigger zone would fire extra
  // scrolls for words already fully visible, and the breathing room belongs on the destination.
  const scrollToWordIfCovered = useCallback(
    (segIndex: number, wordIndex: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const word = container.querySelector(`[data-word-seg="${segIndex}"][data-word="${wordIndex}"]`);
      if (!word) {
        // The word isn't in the DOM, which shouldn't happen once its segment's reveal is open —
        // fall back to the coarser segment-level scroll rather than doing nothing.
        scrollToSegment(segIndex, 'center');
        return;
      }
      const wordRect = word.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (wordRect.top >= containerRect.top && wordRect.bottom <= containerRect.bottom) return;
      // Centre the word itself rather than its segment (scrollToSegment's target): a long
      // paragraph or verse block can leave the word covered even after its segment is centred.
      // Centring the word also leaves generous clearance above and below it.
      //
      // The same measure-convert-scroll as scrollToSegment (useSuttaReading), inlined for an
      // arbitrary element: Settings > UI scale is CSS `zoom` on <html>, which getBoundingClientRect
      // reports through and scroll writes don't, so computeSegmentScrollOffset divides the offset
      // by the scale.
      animateScrollBy(container, computeSegmentScrollOffset(containerRect, wordRect, 'center', getUiScale()));
    },
    [scrollRef, scrollToSegment]
  );

  // The dock is a flex sibling of the reading pane, so anything that changes its height shortens
  // the pane and can hide the word the dock is about. Its height moves at three separate moments
  // — it opens, it admits to loading, it fills with definitions — and only the first of those is
  // synchronous with the tap, so the check runs off the dock's rendered content rather than off
  // the tap. This is also what handles the tap itself: an effect runs after the commit, by which
  // point the dock has mounted and any newly revealed segment is in the DOM.
  useEffect(() => {
    if (!dict) return;
    if (Date.now() - lookupStartedAt.current > SCROLL_WINDOW_MS) return;
    scrollToWordIfCovered(dict.segIndex, dict.wordIndex);
    // `defs` by reference: a settled lookup yields one array, so this fires once per resize and
    // not on the re-renders in between.
  }, [dict?.segIndex, dict?.wordIndex, dict?.loading, dict?.defs, scrollToWordIfCovered]);

  // Walks from the open dict word to the next Pali token, crossing into the adjacent segment —
  // skipping any with no Pali tokens — once the current one runs out. Driven by DictionaryDock's
  // prev/next arrows and the reader's Left/Right shortcut (useReaderKeyboard).
  const goToAdjacentWord = useCallback(
    (dir: 1 | -1) => {
      if (!dict || segWords.length === 0) return;
      const next = findAdjacentWord(segWords, dict.segIndex, dict.wordIndex, dir);
      if (!next) return;
      const { segIndex: si, wordIndex: wi, word: raw } = next;
      runLookup(raw, si, wi);
      prefetchNeighbours(si, wi);
      // Reveal on an actual segment change; an already-open segment's words are all rendered.
      // Whether to scroll is left to the effect above, which checks the word's own visibility — a
      // short next segment can land fully in view, and a taller definition list can push the
      // current word under the dock without the segment changing at all.
      if (si !== dict.segIndex) setOpenSegs((s) => (s[si] ? s : { ...s, [si]: true }));
    },
    [dict, runLookup, prefetchNeighbours, segWords, setOpenSegs]
  );

  // A word, note or highlight tap is a single-shot click rather than a selection, and those tap
  // targets carry `user-select: none` — but iOS Safari can still win the race and start a native
  // text-selection gesture on the same touch, leaving a stray selection and its handles over the
  // text. That selection then takes the next touch-drag as a handle drag instead of a scroll,
  // which reads as scrolling being blocked. Clearing on every open and close, as `pick()` and
  // `close()` in useHighlightPopup.ts do, releases it whichever side won.
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
