import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useCorpus } from '../context/CorpusContext';
import { lookupWord, splitPaliWords, stripPunct, findAdjacentWord } from '../lib/dictionary';
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
  // Set when the dock was opened before the (~20MB, background-loaded) dictionary had finished
  // fetching — see onWordClick below. Resolved by the effect that watches `dictionary` below.
  loading?: boolean;
}

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
  const { dictionary } = useCorpus();
  const [dict, setDict] = useState<DictState | null>(null);

  // Sutta changed (Prev/Next, a deep link, closing and reopening elsewhere) — any dock left open
  // for the previous sutta's own segment indices is meaningless for the new one.
  useEffect(() => {
    setDict(null);
  }, [suttaId]);

  // First-ever visit: the dictionary (~20MB) can still be mid-fetch when the reader is already
  // interactive (only `corpus` gates first paint — see CorpusContext). A tap during that window
  // opens the dock in `loading` state (see onWordClick below); once `dictionary` actually
  // resolves, redo that lookup for real rather than leaving the dock stuck showing "Loading…".
  useEffect(() => {
    if (!dictionary) return;
    setDict((d) => {
      if (!d?.loading) return d;
      const def = lookupWord(dictionary, d.word);
      return { ...d, gloss: def ? `${def.length}` : 'Pali', defs: def, loading: false };
    });
  }, [dictionary]);

  // Every segment's Pali word list, in the same order SegmentedText renders (and taps) them —
  // shared by onWordClick (to record where a lookup came from) and goToAdjacentWord (to walk
  // forward/backward across segment boundaries) below.
  const segWords = useMemo(() => (segments ? segments.map((s) => splitPaliWords(s.pali)) : []), [segments]);

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
      if (!dict || !dictionary || segWords.length === 0) return;
      const next = findAdjacentWord(segWords, dict.segIndex, dict.wordIndex, dir);
      if (!next) return;
      const { segIndex: si, wordIndex: wi, word: raw } = next;
      const def = lookupWord(dictionary, raw);
      setDict({ word: stripPunct(raw), gloss: def ? `${def.length}` : 'Pali', defs: def, segIndex: si, wordIndex: wi });
      // Reveal on an actual segment change — an already-open segment's words are all already
      // rendered. Whether to scroll is then left entirely to scrollToWordIfCovered, which
      // checks the *word's* own visibility rather than assuming a segment change always needs
      // one (a short next segment can easily land fully in view on its own) or that staying
      // within one never does (a taller definition list can still push the current word under
      // the dock without the segment changing at all).
      if (si !== dict.segIndex) setOpenSegs((s) => (s[si] ? s : { ...s, [si]: true }));
      requestAnimationFrame(() => scrollToWordIfCovered(si, wi));
    },
    [dict, dictionary, segWords, scrollToWordIfCovered, setOpenSegs]
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
    setDict(null);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }, []);

  const onWordClick = useCallback(
    (raw: string, segIndex: number, wordIndex: number) => {
      if (!dictionary) {
        // Dictionary still loading in the background (see the effect above) — open the dock in a
        // loading state rather than silently no-oping the tap, which otherwise reads as "broken"
        // on a first-ever visit. No gloss: the dock's body already says what's going on, and it
        // says it accurately once an attempt has actually failed, where a "Loading…" gloss next to
        // the word would still be claiming a download is in progress.
        setDict({ word: stripPunct(raw), gloss: '', defs: null, segIndex, wordIndex, loading: true });
      } else {
        const def = lookupWord(dictionary, raw);
        setDict({
          word: stripPunct(raw),
          gloss: def ? `${def.length}` : 'Pali',
          defs: def,
          segIndex,
          wordIndex,
        });
      }
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      // The dock opening can cover the just-tapped word if it's near the bottom of the reading
      // pane — scrollToWordIfCovered re-centers only when that's actually true, not on every tap.
      requestAnimationFrame(() => scrollToWordIfCovered(segIndex, wordIndex));
    },
    [dictionary, scrollToWordIfCovered]
  );

  return { dict, activeWord, closeDict, onWordClick, goToAdjacentWord };
}
