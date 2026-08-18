import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { splitPaliWords, stripPunct, findAdjacentWord } from '../lib/dictionary';
import { lookupHeadword, peekHeadword, prefetchHeadwordShard } from '../lib/dictionaryShards';
import type { SegmentFile } from '../lib/corpus';

interface DictState {
  word: string;
  gloss: string;
  defs: string[] | null;
  // Where this lookup's word sits in the sutta's own Pali — lets the DictionaryDock's prev/next
  // arrows step to the adjacent word (see goToAdjacentWord below) without re-deriving position
  // from the (not-unique-within-a-segment) word text itself.
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
// renders a loading state at all, which is what stops the dock resizing twice — once to its
// one-line "Loading…" body and again to the definitions — for every tapped word.
const LOADING_DELAY_MS = 150;

interface UseDictionaryLookupOptions {
  suttaId: string | undefined;
  segments: SegmentFile[] | null;
  scrollRef: RefObject<HTMLElement | null>;
  scrollToSegment: (segIndex: number, block?: ScrollLogicalPosition, highlightId?: string) => void;
  setOpenSegs: (updater: (s: Record<number, boolean>) => Record<number, boolean>) => void;
}

// ReaderPage's word-tap dictionary lookup cluster: the currently-open dock's state, opening/
// closing it, and stepping to the adjacent Pali word (DictionaryDock's own prev/next arrows, and
// the reader's Shift+Arrow shortcut). Pulled out as its own hook — a faithful move (same
// conditions, same dependency tracking) mirroring how useReaderKeyboard was already pulled out of
// this same component.
export function useDictionaryLookup({ suttaId, segments, scrollRef, scrollToSegment, setOpenSegs }: UseDictionaryLookupOptions) {
  const [dict, setDict] = useState<DictState | null>(null);

  // Which lookup the dock is currently showing. Shard fetches settle out of order (holding
  // Shift+Arrow walks words faster than a cold shard resolves), so a reply is only allowed to
  // write state if it is still the one being waited on. Bumping it also cancels: closing the dock
  // or changing sutta invalidates every reply and timer still in flight.
  const currentLookup = useRef(0);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

      // Not resident. Move the caret to the new word if the dock is already open, but leave its
      // body — and so its height — exactly as it was; a dock that isn't open stays shut rather
      // than opening empty. Either way nothing visibly changes size until the timer below fires.
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

  // Every segment's Pali word list, in the same order SegmentedText renders (and taps) them —
  // shared by onWordClick (to record where a lookup came from) and goToAdjacentWord (to walk
  // forward/backward across segment boundaries) below.
  const segWords = useMemo(() => (segments ? segments.map((s) => splitPaliWords(s.pali)) : []), [segments]);

  // Warm the shards either neighbour of the open word would need. Consecutive words in a sutta
  // share almost no alphabetical locality — stepping through dn4 crosses a shard boundary on 37
  // of every 39 steps — so without this, prev/next would take the async path every single time
  // and the dock could never step without waiting.
  const prefetchNeighbours = useCallback(
    (segIndex: number, wordIndex: number) => {
      for (const dir of [1, -1] as const) {
        const neighbour = findAdjacentWord(segWords, segIndex, wordIndex, dir);
        if (neighbour) prefetchHeadwordShard(neighbour.word);
      }
    },
    [segWords]
  );

  // The word SegmentedText should render as persistently "active" (see its activeWordIndex prop)
  // — kept referentially stable across renders where the position hasn't actually changed by
  // depending on the primitives, not on `dict` itself (setDict always allocates a new object,
  // including from goToAdjacentWord even when only the word text should visually update).
  const activeWord = useMemo(
    () => (dict ? { segIndex: dict.segIndex, wordIndex: dict.wordIndex } : null),
    [dict?.segIndex, dict?.wordIndex]
  );

  // Only scrolls if the given word's DOM rect actually falls outside the reading pane's own
  // visible bounds — above its top (stepped/jumped to a spot scrolled past already) or below its
  // bottom (the DictionaryDock is a flex sibling of the scroll pane, not an overlay — see its
  // render in ReaderPage — so when it mounts, grows, or shrinks with a new word's definition list,
  // the scroll pane's own measured height already reflects however much room it's taking up, with
  // no separate dock-height lookup needed). The check itself is strict (no padding) — padding a
  // *trigger* zone around the edges just fires extra scrolls for words that are already fully
  // visible; the "leave some breathing room" ask instead belongs on the destination below.
  const scrollToWordIfCovered = useCallback(
    (segIndex: number, wordIndex: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const word = container.querySelector(`[data-word-seg="${segIndex}"][data-word="${wordIndex}"]`);
      if (!word) {
        // Segment not rendered yet for some reason (shouldn't normally happen once its reveal is
        // open) — fall back to the old segment-level scroll rather than silently doing nothing.
        scrollToSegment(segIndex, 'center');
        return;
      }
      const wordRect = word.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (wordRect.top < containerRect.top || wordRect.bottom > containerRect.bottom) {
        // Center the *word itself*, not the segment's heading (scrollToSegment's target) — a long
        // paragraph or verse block can otherwise leave the actual word still covered (or still
        // off-screen) even after "centering" its segment. Centering the word's own element also
        // naturally leaves generous clearance above and below it, well past the "at least a line"
        // ask, without needing a separate padded destination.
        word.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [scrollRef, scrollToSegment]
  );

  // Walks forward/backward from the currently-open dict word to the next Pali token, crossing
  // into the next/previous segment (skipping any with no Pali tokens at all) once the current one
  // runs out — used by DictionaryDock's own prev/next arrows and the reader's Shift+Arrow
  // shortcut (see useReaderKeyboard, which depends on this).
  const goToAdjacentWord = useCallback(
    (dir: 1 | -1) => {
      if (!dict || segWords.length === 0) return;
      const next = findAdjacentWord(segWords, dict.segIndex, dict.wordIndex, dir);
      if (!next) return;
      const { segIndex: si, wordIndex: wi, word: raw } = next;
      runLookup(raw, si, wi);
      prefetchNeighbours(si, wi);
      // Reveal on an actual segment change — an already-open segment's words are all already
      // rendered. Whether to scroll is then left entirely to scrollToWordIfCovered, which
      // checks the *word's* own visibility rather than assuming a segment change always needs
      // one (a short next segment can easily land fully in view on its own) or that staying
      // within one never does (a taller definition list can still push the current word under
      // the dock without the segment changing at all).
      if (si !== dict.segIndex) setOpenSegs((s) => (s[si] ? s : { ...s, [si]: true }));
      requestAnimationFrame(() => scrollToWordIfCovered(si, wi));
    },
    [dict, runLookup, prefetchNeighbours, segWords, scrollToWordIfCovered, setOpenSegs]
  );

  // A word/note/highlight tap is a single-shot click, not a selection (see the matching
  // `user-select: none` on those tap targets in SegmentedText/index.css) — but iOS Safari can
  // still occasionally win the race and start its own native text-selection gesture on the same
  // touch that fired this click, leaving a stray selection (and its handles/callout) sitting
  // over the text after the dock closes. That stray selection is what then intercepts the next
  // touch-drag as a selection-handle drag instead of a scroll, reading as "scroll is blocked".
  // Clearing on every open/close, mirroring `pick()`/`close()` in useHighlightPopup.ts, forces
  // that state to release regardless of which side won.
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
      // The dock opening can cover the just-tapped word if it's near the bottom of the reading
      // pane — scrollToWordIfCovered re-centers only when that's actually true, not on every tap.
      requestAnimationFrame(() => scrollToWordIfCovered(segIndex, wordIndex));
    },
    [runLookup, prefetchNeighbours, scrollToWordIfCovered]
  );

  return { dict, activeWord, closeDict, onWordClick, goToAdjacentWord, retryLookup };
}
