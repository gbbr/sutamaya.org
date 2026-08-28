import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { X, Menu as MenuIcon, ChevronLeft, ChevronRight, List as ListIcon, Search } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useLayout } from '../context/LayoutContext';
import { useSuttaReading } from '../hooks/useSuttaReading';
import { type ScrollRestore } from '../hooks/useScrollMemory';
import { useReaderOrigin } from '../hooks/useReaderOrigin';
import { useReaderKeyboard } from '../hooks/useReaderKeyboard';
import { useDictionaryLookup } from '../hooks/useDictionaryLookup';
import { animateScrollBy, animateScrollTop } from '../lib/segmentScroll';
import { flatSuttaOrder, breadcrumbFor, resolveCanonicalSuttaId, loadSuttaText } from '../lib/corpus';
import { flattenListTree, resolveListById, suttaRowMeta } from '../lib/lists';
import { READER_FACES, READER_THEMES } from '../lib/theme';
import { setReaderThemeColor } from '../lib/themeColor';
import { SHORTCUTS, SHOWS_KEY_HINTS, shortcutsForScope } from '../lib/shortcuts';
import { tagIntent } from '../lib/routeIntent';
import { enteredByReturn } from '../lib/entryKind';
import { getUiScale } from '../lib/uiPrefs';
import type { Highlight } from '../lib/types';
import { animateStep, cancelStepAnimations } from '../lib/motion';
import { markSuttaOpened } from '../lib/pwaNudge';
import { getReaderPanelTab, setReaderPanelTab, type ReaderPanelTab } from '../lib/readerPanelTab';
import { SegmentedText } from '../components/SegmentedText';
import { HighlightPopup } from '../components/HighlightPopup';
import { HighlightGutter } from '../components/HighlightGutter';
import { DictionaryDock } from '../components/DictionaryDock';
import { ReaderMenuPanel } from '../components/ReaderMenuPanel';
import { ReaderSearchOverlay } from '../components/ReaderSearchOverlay';
import { KeyCap, ShortcutsModal } from '../components/ShortcutsModal';
import { SuttaRowChips } from '../components/SuttaRowChips';

// How long a sutta has to stay open before it counts as visited. Long enough that stepping
// through with Prev/Next doesn't fill the Recent list with everything it passed, short enough
// that genuinely opening something always records it.
const VISIT_DEBOUNCE_MS = 5000;

// The PREVIOUS/NEXT caption over each half of the end-of-sutta nav — a label for the control
// rather than part of the text, so it sits at the reader's "Contents" caption size instead of
// riding the type scale. Capped rather than fixed at 11px: the titles beneath it are `fs - 4`,
// which reaches 11 at FS_MIN, and a caption the same size as what it captions stops reading as one.
const FOOT_NAV_LABEL: CSSProperties = { fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' };
const footNavLabelSize = (fs: number) => Math.min(11, fs - 6);
// The key caps in those captions, held under the caption's own weight — see where it's applied.
const FOOT_NAV_KEY_OPACITY = 0.72;

// What SegmentedText gets while highlights are hidden. A stable identity, so hiding them doesn't
// re-render every segment on each pass. Passing none rather than suppressing the paint inside
// SegmentedText also drops the highlight spans themselves, so hidden text can't be tapped to open
// a popup for a highlight that isn't on screen.
const NO_HIGHLIGHTS: Highlight[] = [];

export function ReaderPage({ suttaId: routeSuttaId, location }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus } = useCorpus();
  // A batched document — several inner suttas in one file, "dhp320-333" — has no corpus entry for
  // any individual inner sutta, so resolving here lets every other use of `suttaId` below (text
  // fetch, annotations, Prev/Next, breadcrumb) operate on the batch's id as if that had been
  // requested directly. `requestedSubUid` is set only when the resolution changed something, and is
  // used purely to scroll to and softly mark that inner sutta's segments once the batch loads.
  const suttaId = corpus && routeSuttaId ? resolveCanonicalSuttaId(corpus, routeSuttaId) : routeSuttaId;
  const requestedSubUid = routeSuttaId && routeSuttaId !== suttaId ? routeSuttaId : undefined;
  const { notes, membership, lists, markVisited } = useUserData();
  const {
    resolvedTheme,
    fs,
    lh,
    face,
    allPali,
    showNotes,
    toggleShowNotes,
    showHighlights,
    toggleShowHighlights,
    revealHighlights,
    cycleTheme,
  } = useReaderPrefs();

  // Where to return to on close: the exact pane, nodeId and scroll position the reader was opened
  // from (LibraryPage's onOpen), not the sutta's bare corpus location — which is the fallback for a
  // direct link to /read/:suttaId, having no such origin. `fromView` rides alongside it on mobile,
  // where LibraryPage shows one pane at a time, so closing lands on the right pane rather than
  // whichever LibraryPage's suttaId-present-on-mount default would guess.
  const readerLocationState = location?.state as { from?: string; fromView?: 'tree' | 'list' } | undefined;
  const { from, fromView, navigateToSutta, closeToOrigin } = useReaderOrigin(readerLocationState);
  const [openSegs, setOpenSegs] = useState<Record<number, boolean>>({});
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({});
  const [panel, setPanel] = useState(false);
  // The panel remembers its tab across suttas and sessions (lib/readerPanelTab.ts), so every path
  // that lands on a tab — the header's Menu button, the chips, the keyboard shortcuts, switching
  // tab from inside the open panel — records it.
  const [tab, setTabState] = useState<ReaderPanelTab>(getReaderPanelTab);
  const setTab = useCallback((t: ReaderPanelTab) => {
    setTabState(t);
    setReaderPanelTab(t);
  }, []);
  const [noteFocusSignal, setNoteFocusSignal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { mobile } = useLayout();
  const tapRef = useRef<{ x: number; y: number } | null>(null);

  const sutta = corpus && suttaId ? corpus.suttas[suttaId] : undefined;
  // Where this sutta opens. A return — back or forward, a refresh, an app relaunch — resumes the
  // remembered position; anything the reader chose now starts at the top (lib/entryKind.ts). A
  // route already naming a segment to jump to takes neither, and scrolls itself instead (see the
  // requestedSubUid effect below). Sampled per sutta id rather than per mount, since ReaderPage
  // stays mounted across Prev/Next and only its route param changes, and held in a ref so it stays
  // fixed while that id is on screen, however often this re-renders before the async restore runs.
  const restoreRef = useRef<{ id?: string; restore: ScrollRestore; skipRestore: boolean }>({
    restore: 'stored',
    skipRestore: false,
  });
  if (restoreRef.current.id !== suttaId) {
    restoreRef.current = {
      id: suttaId,
      restore: enteredByReturn() ? 'stored' : 'top',
      skipRestore: !!requestedSubUid,
    };
  }
  const {
    segments,
    error: textError,
    retry: retryText,
    hlForSutta,
    highlightGroups,
    hlCount,
    hlColors,
    scrollRef,
    scrollToSegment,
    pop,
    onTextUp,
    pick,
    close: closePop,
    popStop,
    openPop,
  } = useSuttaReading(suttaId, 'reader', restoreRef.current);
  // Auto-list membership is redundant here, since the highlight gutter and the note preview above
  // already say as much, so suttaRowMeta's AUTO_LIST_IDS filter drops it from the chip row — as it
  // does for ListPane, TreePane and ReaderSearchOverlay.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const suttaChips = useMemo(
    () => (suttaId ? suttaRowMeta([suttaId], membership, {}, flatLists).get(suttaId)?.chips ?? [] : []),
    [suttaId, membership, flatLists]
  );
  // Where this sutta lives in the browse tree (nikaya, any intermediate groups, down to its own
  // leaf group) — shown above the title, each segment navigating via /browse/{id}, which already
  // expands every ancestor and scrolls to it (see TreePane's useScrollToNode).
  const breadcrumb = useMemo(() => (corpus && sutta ? breadcrumbFor(corpus, sutta.node) : []), [corpus, sutta]);
  // Only DN9-style suttas with internal `<h2>`–`<h5>` structure (see build-corpus.mjs's
  // `roleFor()`) have any of these — empty for most suttas, which is why the block that renders
  // this is conditional on it below. The Contents list steps indentation/size/weight down one
  // notch per level (h2 top-level, h5 deepest — e.g. DN2's numbered sub-sections), so the jump
  // menu reads as the same 4-deep hierarchy the headings themselves render as in the body.
  const headings = useMemo(
    () =>
      (segments || []).reduce<Array<{ i: number; text: string; level: 2 | 3 | 4 | 5 }>>((acc, s, i) => {
        if (s.role === 'heading') acc.push({ i, text: s.en, level: s.headingLevel ?? 2 });
        return acc;
      }, []),
    [segments]
  );

  const theme = READER_THEMES[resolvedTheme];

  // Drives the OS/browser chrome (mobile status bar, desktop PWA title bar) with the reader's own
  // background while it's open — otherwise that chrome stays stuck on the shell's theme (see
  // lib/themeColor.ts). Cleared on unmount so it falls back to whatever the shell was showing.
  useEffect(() => {
    setReaderThemeColor(theme.bg);
    return () => setReaderThemeColor(null);
  }, [theme.bg]);

  // Tab title tracks whatever sutta is actually open, so switching suttas or reopening the tab
  // after a refresh both show the right title without a round trip through the tree.
  useEffect(() => {
    document.title = sutta ? `${sutta.ref} · ${sutta.en}` : 'Sutamaya';
    return () => {
      document.title = 'Sutamaya';
    };
  }, [sutta]);

  // Drives the offline-download nudge banner in TreePane, which only makes sense to show once
  // someone has actually opened a sutta — not the very first thing a fresh PWA install sees.
  useEffect(() => {
    markSuttaOpened();
  }, []);

  useEffect(() => {
    setOpenSegs({});
    setOpenNotes({});
    // A stray native selection can outlive the tap that opened this sutta (e.g. the list-row tap
    // that navigated here) — clearing it on every fresh mount stops it from carrying over and
    // blocking the first touch-scroll in the newly-opened reader.
    window.getSelection()?.removeAllRanges();
  }, [suttaId]);

  const { dict, activeWord, closeDict, onWordClick, goToAdjacentWord, retryLookup } = useDictionaryLookup({
    suttaId,
    segments,
    scrollRef,
    scrollToSegment,
    setOpenSegs,
  });

  // "Visited" means opened, and feeds the Recent auto-list; it makes no claim about having read
  // anything. The delay is a debounce, so a Prev/Next flick-through doesn't fill Recent with
  // everything it passed, and is cancelled if the sutta changes before it elapses.
  useEffect(() => {
    if (!suttaId || !sutta) return;
    const timer = window.setTimeout(() => markVisited(suttaId), VISIT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [suttaId, sutta, markVisited]);

  // Landed here through a deep link or search hit for one inner sutta of a batched document (see
  // requestedSubUid above) — scroll to its first segment once the batch's text has loaded, a frame
  // after load, as jumpToHighlight below does. Such a route opens with `skipRestore` (see
  // restoreRef), so useScrollMemory writes no scroll position for this mount and there is nothing
  // to override: on iOS Safari two scroll writes to one container milliseconds apart can stack
  // rather than the second superseding the first, landing well past the intended target.
  useEffect(() => {
    if (!requestedSubUid || !segments) return;
    const idx = segments.findIndex((s) => s.key.startsWith(`${requestedSubUid}:`));
    if (idx === -1) return;
    requestAnimationFrame(() => scrollToSegment(idx, 'start'));
  }, [requestedSubUid, segments, scrollToSegment]);

  // The whole corpus in canonical browse order, not just the current category's siblings — so
  // Prev/Next carries on into the next/previous category once the current one runs out, rather
  // than stopping at its edge. Depends only on `corpus` (not `sutta`), so it's correct whether
  // the reader was entered from browsing, a search result, or a deep link.
  const siblingIds = useMemo(() => (corpus ? flatSuttaOrder(corpus) : []), [corpus]);

  // Opened from a user list rather than the corpus browse tree, where Prev/Next stays inside that
  // list's items and stops at either end: jumping away to wherever a sutta happens to live in the
  // corpus would defeat the point of viewing a curated list. It also drives the "viewing from list
  // X" indicator above the breadcrumb, so that narrowed scope is visible rather than silent.
  // `from` is `/browse/{nodeId}/{suttaId}` (LibraryPage's onOpen) and stays constant across a
  // Prev/Next run, since navigateToSutta carries it forward.
  //
  // Conditional on the sutta on screen actually being in that list, because `from` is a return
  // address rather than a description of what is being read: opening a search hit from inside the
  // reader keeps the same origin, and an unrelated sutta would otherwise claim membership in the
  // header and get a Prev/Next scope with no position in it, dead in both directions. Falling back
  // to the corpus order there is what the breadcrumb already shows.
  const listOrigin = useMemo(() => {
    const nodeId = from?.match(/^\/browse\/([^/]+)\//)?.[1];
    const list = nodeId ? lists.find((l) => l.id === decodeURIComponent(nodeId)) : undefined;
    return suttaId && list?.items.includes(suttaId) ? list : undefined;
  }, [from, lists, suttaId]);

  // The sutta one Prev/Next step from `base`, or undefined at either end of the run. A list
  // origin stops dead at its own ends; the corpus order clamps instead, which is the same thing
  // said differently (the clamped id equals the one stepped from).
  const neighbourOf = useCallback(
    (base: string | undefined, dir: 1 | -1) => {
      if (!base) return undefined;
      if (listOrigin) {
        const i = listOrigin.items.indexOf(base);
        const next = i === -1 ? undefined : listOrigin.items[i + dir];
        return next === base ? undefined : next;
      }
      const i = siblingIds.indexOf(base);
      const next = siblingIds[Math.min(siblingIds.length - 1, Math.max(0, i + dir))];
      return next === base ? undefined : next;
    },
    [listOrigin, siblingIds]
  );

  // Fetch both neighbours once this sutta's text has arrived, so stepping to either has it in hand
  // — through loadSuttaText's module-level cache, which useSuttaText reads synchronously — rather
  // than spending the step animation on a request. Waiting on `segments` keeps these off the wire
  // while the sutta being read is still fetching, which on a slow connection is what matters.
  useEffect(() => {
    if (!segments) return;
    for (const dir of [1, -1] as const) {
      const id = neighbourOf(suttaId, dir);
      if (id) loadSuttaText(id).catch(() => {});
    }
  }, [neighbourOf, suttaId, segments]);

  // The two neighbours, resolved to corpus entries so the foot of the sutta can name where
  // Prev/Next actually goes. Either is undefined at the end of the run — a list origin's own ends,
  // or the ends of the canon.
  const footNeighbours = useMemo(() => {
    const at = (dir: 1 | -1) => {
      const id = neighbourOf(suttaId, dir);
      return corpus && id ? corpus.suttas[id] : undefined;
    };
    return { prev: at(-1), next: at(1) };
  }, [corpus, neighbourOf, suttaId]);

  // The article element the step animation runs on — the measure column inside the scrolling
  // pane, so the header and the highlight gutter stay put while the text itself travels.
  const articleRef = useRef<HTMLDivElement>(null);
  // The direction to animate in on arrival, read by the layout effect below. A ref rather than
  // state, because it is consumed exactly once by the render that lands on `id`: as state it would
  // linger, and returning to that sutta by another route would replay an entrance for a step nobody
  // took.
  const enterOnArrival = useRef<{ id: string; dir: 1 | -1 } | null>(null);

  function step(dir: 1 | -1) {
    const next = neighbourOf(suttaId, dir);
    if (!next) return;
    enterOnArrival.current = { id: next, dir };
    // navigateToSutta carries `from`/`fromView` forward so closing after stepping through several
    // suttas still returns to wherever the reader was originally opened from, not the last-stepped
    // sutta's own location.
    navigateToSutta(next);
  }

  // Animate the arriving sutta in, on the render that lands on it. The navigation itself is never
  // delayed for this — the step has already happened by the time anything moves.
  useLayoutEffect(() => {
    const to = enterOnArrival.current;
    enterOnArrival.current = null;
    const el = articleRef.current;
    if (!el) return;
    cancelStepAnimations(el);
    if (to && to.id === suttaId) animateStep(el, to.dir);
  }, [suttaId]);

  // Going to a highlight is a deliberate act about highlights, so it turns them back on for good
  // rather than revealing one transiently — landing on a state you have to leave again is worse.
  // The reveal has rendered by the time the deferred scroll runs, so scrollToSegment can still find
  // the `data-hl-id` span it centres on.
  function jumpToHighlight(segIndex: number, highlightId?: string) {
    setPanel(false);
    revealHighlights();
    requestAnimationFrame(() => scrollToSegment(segIndex, 'center', highlightId));
  }

  function closeReader() {
    closeToOrigin(suttaId, sutta ? `/browse/${sutta.node}/${suttaId}` : '/');
  }

  function onSearchOpenSutta(id: string) {
    setSearchOpen(false);
    navigateToSutta(id);
  }

  // Opening the Pali — or a footnote — under the last line on screen puts it below the fold, where
  // the reader has to scroll for what they just asked to see. This brings it up by the least it
  // can, and only when something is actually clipped, so a tap in the middle of the page moves
  // nothing and the English line the reveal belongs to stays where the eye left it.
  //
  // This is `scrollIntoView({ block: 'nearest' })` on the reveal, done by hand for the reason
  // scrollToSegment (useSuttaReading) gives: Settings > UI scale is CSS `zoom`, which
  // getBoundingClientRect reports through while scroll writes don't, so the offset has to be
  // divided by the scale — and scrollIntoView isn't zoom-aware at all. The cap is what makes a
  // reveal taller than the pane settle at its own first line rather than chase its bottom.
  const revealIntoView = useCallback(
    (i: number, kind: 'pali' | 'note') => {
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        const reveal = container?.querySelector<HTMLElement>(`[data-reveal-seg="${i}"][data-reveal="${kind}"]`);
        if (!container || !reveal) return;
        const containerRect = container.getBoundingClientRect();
        const rect = reveal.getBoundingClientRect();
        const MARGIN = 14;
        const clipped = rect.bottom + MARGIN - containerRect.bottom;
        if (clipped <= 0) return;
        const cap = Math.max(0, rect.top - containerRect.top - MARGIN);
        animateScrollBy(container, Math.min(clipped, cap) / getUiScale());
      });
    },
    [scrollRef]
  );

  // Wrapped in useCallback, as onToggleNote below is, so a freshly-allocated function on every
  // ReaderPage render doesn't defeat SegmentedText's per-segment memoization. Collapsing the Pali
  // on the segment holding the dictionary dock's active word also closes the dock, which would
  // otherwise keep pointing at a word no longer visible.
  const onToggleSeg = useCallback(
    (i: number) => {
      setOpenSegs((s) => {
        const willOpen = !s[i];
        if (!willOpen && dict?.segIndex === i) closeDict();
        if (willOpen && !allPali) revealIntoView(i, 'pali');
        return { ...s, [i]: willOpen };
      });
    },
    [dict, closeDict, allPali, revealIntoView]
  );
  const onToggleNote = useCallback(
    (i: number) => {
      setOpenNotes((s) => {
        const willOpen = !s[i];
        if (willOpen) revealIntoView(i, 'note');
        return { ...s, [i]: willOpen };
      });
    },
    [revealIntoView]
  );

  function onReaderPointerDown(e: React.PointerEvent) {
    tapRef.current = { x: e.clientX, y: e.clientY };
  }
  function onReaderPointerUp(e: React.PointerEvent) {
    const start = tapRef.current;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved < 10 && !String(window.getSelection()) && pop) closePop();
  }

  useReaderKeyboard({
    shortcutsOpen,
    setShortcutsOpen,
    searchOpen,
    setSearchOpen,
    pop,
    closePop,
    dict,
    closeDict,
    panel,
    setPanel,
    closeReader,
    step,
    goToAdjacentWord,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    toggleShowHighlights,
    cycleTheme,
  });

  if (!corpus || !sutta || !suttaId) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: theme.bg, color: theme.fg }}>
        <span className="font-sans text-sm opacity-60">Loading…</span>
      </div>
    );
  }

  const faceFamily = READER_FACES[face];
  const measureWidth = fs * 34;

  return (
    <div
      data-component="ReaderPage"
      className="fixed inset-0 z-40 flex flex-col animate-fadeIn"
      style={
        {
          background: theme.bg,
          color: theme.fg,
          // Turns off pinch- and double-tap-zoom over the text, leaving vertical scrolling. Without
          // it Safari delays every `click` to see whether a second tap follows, which is felt as a
          // lag before the dictionary opens on a word tap.
          touchAction: 'pan-y',
          '--reader-selection': theme.selection,
        } as CSSProperties
      }
      onPointerDown={onReaderPointerDown}
      onPointerUp={onReaderPointerUp}
      // The selection is read from the whole reader, not just the text: a drag that runs off the
      // top or bottom of the viewport lifts over the scroll container or the header, and a handler
      // bound to the segments themselves would never see it — leaving a live selection with no
      // popup. Releases elsewhere are harmless, since a selection with either end outside the
      // rendered segments yields no popup.
      onMouseUp={onTextUp}
      onTouchEnd={onTextUp}
    >
      {/* The title is positioned against the header rather than laid out between the buttons: the
          right side carries two controls to the left's one, so a flex-centred title would sit off
          to the left by half that difference. Absolute centring keeps it on the page's own centre
          line however many buttons flank it. `max-w` keeps a long one clear of both groups, and
          the flanking groups keep their own layout via `justify-between`. */}
      <header className="font-sans flex-none relative flex items-center justify-between px-5 py-3.5 text-ui-base" style={{ borderBottom: `1px solid ${theme.rule}` }}>
        {/* `p-3.5 -m-3.5`: a 47px touch area around the 19px icon, clearing the 44px minimum both
            platforms ask for, while the negative margin keeps the icon spaced as it looks rather
            than as it's hit. The right-hand pair trades some of that padding away to sit closer
            together — see below. */}
        <button className="flex items-center p-3.5 -m-3.5" title="Close" onClick={closeReader}>
          <X size={19} strokeWidth={1.75} />
        </button>
        {/* Tapping the title bar scrolls back to the top of the sutta — the same "tap the top of
            the screen" convention most native iOS apps use. That convention is normally free
            (UIScrollView's own scrollsToTop, wired to a tap on the physical status bar), but it
            only ever applies to a page's own document-level scroll; this reader's actual
            scrolling happens in `scrollRef`'s nested div (`.fixed inset-0` root, `html`/`body`
            themselves never scroll — see index.css), which that native behavior never reaches,
            so it has to be done by hand here instead. */}
        <button
          className="absolute left-1/2 -translate-x-1/2 max-w-[calc(100%-14rem)] truncate opacity-75 font-serif cursor-pointer"
          aria-label="Scroll to top"
          title="Scroll to top"
          onClick={() => scrollRef.current && animateScrollTop(scrollRef.current, 0)}
        >
          {/* The English title is what identifies a sutta to a reader who has scrolled past the
              h1, so it takes the header wherever it fits. Below `mobile` it can't: the flanking
              buttons leave ~166px, which truncates most titles mid-word, so a narrow screen keeps
              the bare ref and relies on the h1 below. */}
          {mobile ? sutta.ref : `${sutta.ref} · ${sutta.en}`}
        </button>
        {/* These two sit closer than the header's 47px touch areas allow, so they take a smaller
            one: `p-3 -m-3` is 43px around each 19px icon. The negative margins collapse each
            button's layout box back to the icon, so the gap has to cover the 24px of padding they
            hide before it separates anything — gap-6 sits the two hit areas exactly edge to edge,
            the closest the icons can be drawn without one button catching taps meant for the
            other. */}
        <div className="flex items-center gap-6">
          <button
            className="flex items-center p-3 -m-3"
            aria-label="Search"
            title="Search (/)"
            onClick={(e) => {
              e.stopPropagation();
              setSearchOpen(true);
            }}
          >
            <Search size={19} strokeWidth={1.75} />
          </button>
          <button
            className="flex items-center p-3 -m-3"
            aria-label="Menu"
            title="Menu"
            onClick={(e) => {
              e.stopPropagation();
              // Opening straight onto the Theme tab's mobile bottom sheet shouldn't leave an open
              // DictionaryDock sitting underneath it wasting space — desktop's drawer never
              // overlaps the dock, so this is mobile-only (see ReaderMenuPanel's `onTabChange` for
              // the other path into the same state).
              if (mobile && tab === 'text') closeDict();
              setPanel(true);
            }}
          >
            <MenuIcon size={19} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* `overflowX: hidden` so the step animation's translateX can't briefly make the pane
          horizontally scrollable (or flash a scrollbar) as the incoming sutta slides in from
          off to the right — `.sc` only sets overflow-y, and CSS resolves the other axis to
          `auto` rather than leaving it visible. */}
      <div ref={scrollRef} className="sc flex-1" style={{ padding: '44px 22px 120px', overflowX: 'hidden' }}>
        {/* Stepping to another sutta carries this column off the way the reader is travelling and
            brings the next one in behind it, so Prev/Next reads as movement through the canon
            rather than the screen silently becoming a different sutta. Driven imperatively from
            `step` above rather than by a class, since each step has to restart an animation on an
            element that never unmounts, and the navigation between the two halves waits on the
            exit's own completion. */}
        <div ref={articleRef} style={{ maxWidth: measureWidth, margin: '0 auto' }}>
          {listOrigin && (
            <nav className="font-sans flex items-center gap-1" style={{ fontSize: fs - 6, marginBottom: 7, color: theme.dim }}>
              <button
                className="flex items-center gap-1 hover:underline"
                onClick={() =>
                  navigate(`/browse/${encodeURIComponent(listOrigin.id)}/${encodeURIComponent(suttaId)}`, {
                    state: tagIntent({ fromView: 'list' }),
                  })
                }
              >
                <ListIcon size={fs - 7} strokeWidth={2} />
                {listOrigin.label}
              </button>
            </nav>
          )}
          {breadcrumb.length > 0 && (
            <nav className="font-sans flex flex-wrap items-center gap-1" style={{ fontSize: fs - 6, marginBottom: 7, color: theme.dim }}>
              {breadcrumb.map((b, i) => (
                <span key={b.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={fs - 7} strokeWidth={2} />}
                  <button
                    className="hover:underline"
                    onClick={() =>
                      // Every segment lands the same place — the sutta's own enclosing leaf
                      // group, with the sutta itself highlighted/scrolled-to there — regardless of
                      // which ancestor in the chain was actually clicked. `flashNodeId` carries
                      // which segment was actually clicked through to the tree pane, which briefly
                      // scrolls to and highlights that exact row (it may be an ancestor above the
                      // sutta's own leaf group) — see LibraryPage/TreePane. On mobile (single pane
                      // at a time), the flash only lives in the tree pane, so clicking the sutta's
                      // own leaf category (already the list pane's contents) opens the list as
                      // before, but clicking any ancestor above that opens the tree pane instead —
                      // otherwise the flash would land on a pane that isn't shown.
                      navigate(`/browse/${encodeURIComponent(sutta.node)}/${encodeURIComponent(suttaId)}`, {
                        state: tagIntent({ fromView: b.id === sutta.node ? 'list' : 'tree', flashNodeId: b.id }),
                      })
                    }
                  >
                    {b.label}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {/* Display leading, but not below the face's own glyph extent: Georgia's ascender plus
              descender is ~1.136em, and the serif faces with longer extenders (Palatino,
              Newsreader) want more still, so anything tighter overlaps a descender with the next
              line's ascender on the long titles — the only ones that wrap. */}
          <h1 className="font-serif" style={{ margin: 0, fontSize: Math.round(fs * 1.72), fontWeight: 600, lineHeight: 1.2, letterSpacing: '-.015em' }}>
            {sutta.en}
          </h1>
          <div className="font-serif italic" style={{ fontSize: fs - 2, marginTop: 5, color: theme.dim }}>
            {sutta.pali}
          </div>
          {/* Light's `theme.dim` is tuned for menu-row labels, which sit at a larger size; on this
              small metadata line it reads louder than the title it sits under. Paled to the lightest
              warm gray that still clears 4.5:1 on light's paper. Sepia and dark's own `dim` are
              already alpha-composited well below their `fg`, so they need no equivalent. */}
          <div className="font-sans" style={{ fontSize: fs - 6, marginTop: 9, color: resolvedTheme === 'light' ? '#7A7168' : theme.dim }}>
            {sutta.min} min read ·{' '}
            Source:{' '}
            <a
              href={`https://github.com/gbbr/sutamaya.org/blob/main/docs/translation-changes.md`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              SuttaCentral, modified
            </a>
          </div>
          {sutta.blurb && (
            <div className="italic" style={{ fontSize: fs - 4, lineHeight: 1.6, marginTop: 11, color: theme.fg, opacity: 0.72 }}>
              {sutta.blurb}
            </div>
          )}
          {notes[suttaId] && (
            <button
              type="button"
              className="flex w-full gap-[7px] text-left hover:opacity-100"
              aria-label="Edit note"
              style={{ fontSize: fs - 4, lineHeight: 1.6, marginTop: 9, color: theme.fg, opacity: 0.72 }}
              onClick={() => {
                setTab('highlights');
                setPanel(true);
                setNoteFocusSignal((s) => s + 1);
              }}
            >
              {/* The em dash, not a quote rule, marks this as the reader's own note — a left rule
                  reads as a passage quoted from the sutta. Matches the note on a Library list row. */}
              <span aria-hidden className="flex-none">
                —
              </span>
              <span>{notes[suttaId]}</span>
            </button>
          )}
          <div className="mt-4">
            <SuttaRowChips
              chips={suttaChips}
              hlCount={hlCount}
              hlColors={hlColors}
              theme={theme}
              fs={fs}
              onChipClick={(chipId) => {
                const { list } = resolveListById(chipId, flatLists);
                // Must explicitly tag `fromView: 'list'` rather than relying on LibraryPage's own
                // "no router state at all -> fresh arrival" fallback (see its `view` init) —
                // @reach/router's navigate() always stamps a `{key}` onto location.state even when
                // no state is passed, so that fallback never actually fires for this (or any other)
                // in-app navigate() call; without this, the pane shown depended on whatever view
                // happened to be persisted from last time (works by accident when that was already
                // 'list', shows the tree instead when it wasn't).
                if (list) navigate(`/browse/${list.id}/${suttaId}`, { state: tagIntent({ fromView: 'list' }) });
              }}
              onHighlightClick={(e) => {
                e.stopPropagation();
                setTab('highlights');
                setPanel(true);
              }}
              onAddToList={(e) => {
                e.stopPropagation();
                setTab('lists');
                setPanel(true);
              }}
            />
          </div>
          <div style={{ height: 1, background: theme.rule, margin: '20px 0 22px' }} />

          {headings.length > 0 && (
            <div>
              <nav className="font-sans" style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: theme.dim, marginBottom: 8 }}>
                  Contents
                </div>
                {headings.map((h) => {
                  // Step size for each level below the top (h2): one indent/size/opacity notch
                  // per level, so h2→h5 read as a real 4-deep hierarchy rather than 2 flat tiers.
                  // Anchored to the reader's own Size preference (`fs`, same value driving
                  // SegmentedText's fontSize below) rather than a fixed pixel value, so the
                  // Contents list scales along with the body text instead of staying fixed while
                  // everything else in the reader grows/shrinks.
                  const step = h.level - 2;
                  return (
                    <button
                      key={h.i}
                      className="block text-left hover:underline"
                      style={{
                        paddingLeft: step * 12,
                        marginTop: 6,
                        fontSize: fs - 1 - step,
                        fontWeight: h.level === 2 ? 600 : 400,
                        color: theme.fg,
                        opacity: 0.9 - step * 0.06,
                      }}
                      onClick={() => scrollToSegment(h.i)}
                    >
                      {h.text}
                    </button>
                  );
                })}
              </nav>
              <div style={{ height: 1, background: theme.rule, margin: '20px 0 22px' }} />
            </div>
          )}

          {segments ? (
            <SegmentedText
              segments={segments}
              highlights={showHighlights ? hlForSutta : NO_HIGHLIGHTS}
              theme={theme}
              fontSize={fs}
              lineHeight={lh}
              face={faceFamily}
              openSegs={openSegs}
              allPali={allPali}
              onToggleSeg={onToggleSeg}
              onWordClick={onWordClick}
              onSpanClick={openPop}
              showNotes={showNotes}
              openNotes={openNotes}
              onToggleNote={onToggleNote}
              activeWord={activeWord}
              focusUid={requestedSubUid}
            />
          ) : textError ? (
            <div className="flex flex-col items-center gap-3 font-sans text-sm text-center" style={{ padding: '24px 0' }}>
              <div style={{ color: theme.fg, opacity: 0.7 }}>Couldn't load this sutta. Check your connection and try again.</div>
              <button
                className="text-ui-base px-3 py-1.5 rounded-md hover:opacity-70"
                style={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
                onClick={retryText}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="font-sans text-sm opacity-50">Loading…</div>
          )}

          {/* Prev/Next where the reader actually finishes, rather than as two more icons in the
              header — the step to a neighbouring sutta is wanted at the end of the text, not at
              every moment the header's own controls are. Only shown once the text is on screen, so
              it can't sit under a spinner. */}
          {segments && (footNeighbours.prev || footNeighbours.next) && (
            <nav className="font-sans" style={{ marginTop: 30 }}>
              <div style={{ height: 1, background: theme.rule, marginBottom: 14 }} />
              {/* One row, previous anchored left and next right, each captioned with the direction
                  it goes. Each half takes an equal share and truncates within it; the empty spacer
                  keeps `next` on the right when there is no `prev` to push it there. The flex row
                  is each button's inner span, never the button itself: WebKit sizes a button's own
                  content box to max-content, so a flex item inside one never shrinks and
                  `truncate` has nothing narrower to clip to. */}
              <div className="flex items-center gap-5" style={{ fontSize: fs - 4 }}>
                {footNeighbours.prev ? (
                  <button className="block flex-1 min-w-0 text-left hover:opacity-70" onClick={() => step(-1)}>
                    {/* The label is inset by the chevron's own width plus the row gap, so it starts
                        on the same vertical as the title beneath it rather than hanging left of it. */}
                    {/* The caption doubles as where the keyboard step is named, since this is the
                        one place in the reader that step is already on screen. */}
                    <span
                      className="flex items-center gap-1.5"
                      style={{ marginLeft: fs, fontSize: footNavLabelSize(fs), ...FOOT_NAV_LABEL, color: theme.dim }}
                    >
                      Previous
                      {/* Paler than the caption it sits beside: the word names the destination,
                          the cap only says how else to get there. */}
                      {SHOWS_KEY_HINTS && (
                        <span className="inline-flex" style={{ opacity: FOOT_NAV_KEY_OPACITY }}>
                          <KeyCap keyName={SHORTCUTS.readerNav.keys[0]} theme={theme} small />
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5" style={{ marginTop: 3 }}>
                      <ChevronLeft size={fs - 6} strokeWidth={2} className="flex-none" style={{ color: theme.dim }} />
                      {/* Below `mobile` the two halves are ~150px each, which truncates every title
                          to a few words — the bare ref identifies the destination better there. */}
                      <span className="min-w-0 truncate" style={{ color: theme.fg }}>
                        {mobile ? footNeighbours.prev.ref : `${footNeighbours.prev.ref} · ${footNeighbours.prev.en}`}
                      </span>
                    </span>
                  </button>
                ) : (
                  <span className="flex-1" />
                )}
                {footNeighbours.next ? (
                  <button className="block flex-1 min-w-0 text-right hover:opacity-70" onClick={() => step(1)}>
                    <span
                      className="flex items-center justify-end gap-1.5"
                      style={{ marginRight: fs, fontSize: footNavLabelSize(fs), ...FOOT_NAV_LABEL, color: theme.dim }}
                    >
                      {SHOWS_KEY_HINTS && (
                        <span className="inline-flex" style={{ opacity: FOOT_NAV_KEY_OPACITY }}>
                          <KeyCap keyName={SHORTCUTS.readerNav.keys[1]} theme={theme} small />
                        </span>
                      )}
                      Next
                    </span>
                    <span className="flex items-center justify-end gap-1.5" style={{ marginTop: 3 }}>
                      <span className="min-w-0 truncate" style={{ color: theme.fg }}>
                        {mobile ? footNeighbours.next.ref : `${footNeighbours.next.ref} · ${footNeighbours.next.en}`}
                      </span>
                      <ChevronRight size={fs - 6} strokeWidth={2} className="flex-none" style={{ color: theme.dim }} />
                    </span>
                  </button>
                ) : (
                  <span className="flex-1" />
                )}
              </div>
            </nav>
          )}
        </div>
      </div>

      {dict && (
        <DictionaryDock
          word={dict.word}
          gloss={dict.gloss}
          defs={dict.defs}
          loading={dict.loading}
          dictionaryFailed={dict.failed}
          theme={theme}
          fontSize={fs}
          onClose={closeDict}
          onPrev={() => goToAdjacentWord(-1)}
          onNext={() => goToAdjacentWord(1)}
          onRetryDictionary={retryLookup}
        />
      )}

      {panel && (
        <ReaderMenuPanel
          suttaId={suttaId}
          mobile={mobile}
          theme={theme}
          initialTab={tab}
          segments={segments}
          highlightGroups={highlightGroups}
          onClose={() => setPanel(false)}
          onJumpToHighlight={jumpToHighlight}
          noteFocusSignal={noteFocusSignal}
          onTabChange={(t) => {
            setTab(t);
            if (mobile && t === 'text') closeDict();
          }}
        />
      )}

      {pop && (
        <HighlightPopup
          pop={pop}
          theme={theme}
          mobile={mobile}
          // Making a highlight while they're hidden turns them back on — otherwise the act
          // produces nothing visible and reads as a failed save. Erasing one doesn't.
          onPick={(color) => {
            revealHighlights();
            pick(color);
          }}
          onRemove={() => pick(null)}
          onClose={closePop}
          onStop={popStop}
        />
      )}

      {!panel && (
        <HighlightGutter
          scrollRef={scrollRef}
          highlightGroups={highlightGroups}
          theme={theme}
          onJump={jumpToHighlight}
          layoutKey={`${fs}-${lh}-${face}-${allPali}-${segments ? segments.length : 'loading'}`}
        />
      )}

      {searchOpen && <ReaderSearchOverlay theme={theme} onOpenSutta={onSearchOpenSutta} onClose={() => setSearchOpen(false)} />}

      {shortcutsOpen && (
        <ShortcutsModal shortcuts={shortcutsForScope('reader')} theme={theme} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
