import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { X, Menu as MenuIcon, ChevronLeft, ChevronRight, Library, List as ListIcon, Search } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useLayout } from '../context/LayoutContext';
import { useSuttaReading } from '../hooks/useSuttaReading';
import { type ScrollRestore } from '../hooks/useScrollMemory';
import { useReaderOrigin } from '../hooks/useReaderOrigin';
import { useReaderKeyboard } from '../hooks/useReaderKeyboard';
import { useDictionaryLookup } from '../hooks/useDictionaryLookup';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { animateScrollBy, animateScrollTop } from '../lib/segmentScroll';
import { flatSuttaOrder, breadcrumbFor, normalizeRouteId, resolveCanonicalSuttaId, loadSuttaText } from '../lib/corpus';
import { flattenListTree, resolveListById, suttaRowMeta } from '../lib/lists';
import { READER_FACES, READER_THEMES } from '../lib/theme';
import { setReaderThemeColor } from '../lib/themeColor';
import { shortcutsForScope } from '../lib/shortcuts';
import { consumeIntent, tagIntent, type RouteIntent } from '../lib/routeIntent';
import { READER_INTENT_KEY } from '../lib/storageKeys';
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
import { ShortcutsModal } from '../components/ShortcutsModal';
import { SuttaRowChips } from '../components/SuttaRowChips';
import { MatchedText } from '../components/MatchedText';
import { NotFoundPage } from './NotFoundPage';

// How long a sutta has to stay open before it counts as visited.
const VISIT_DEBOUNCE_MS = 5000;

// How long the segment a search hit was found in stays washed on arrival.
const SEARCH_FLASH_MS = 1600;

// Type treatment of the PREVIOUS/NEXT captions in the end-of-sutta nav.
const FOOT_NAV_LABEL: CSSProperties = { fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' };
// Returns the size of those captions, capped so they stay under the titles they caption.
const footNavLabelSize = (fs: number) => Math.min(11, fs - 6);

// How a library search is named where the reader shows the run it was opened from — above the
// breadcrumb and at the foot of the sutta.
const searchRunLabel = (query: string) => `Results for: “${query}”`;

// The highlights SegmentedText gets while they are hidden: none, and a stable identity so the
// segments don't re-render.
const NO_HIGHLIGHTS: Highlight[] = [];

export function ReaderPage({ suttaId: routeSuttaId, location }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus } = useCorpus();
  // The uid the URL asked for, case-folded (normalizeRouteId).
  const requestedId = routeSuttaId ? normalizeRouteId(routeSuttaId) : routeSuttaId;
  // The document actually read: a batched document ("dhp320-333") has no corpus entry per inner
  // sutta, so everything below — text fetch, annotations, Prev/Next, breadcrumb — works on the
  // batch.
  const suttaId = corpus && requestedId ? resolveCanonicalSuttaId(corpus, requestedId) : requestedId;
  // The inner sutta asked for, when the resolution above changed the id; its segments are scrolled
  // to and washed once the batch loads.
  const requestedSubUid = requestedId && requestedId !== suttaId ? requestedId : undefined;
  // Rewrite the address bar to the case-folded uid, replacing the history entry.
  useEffect(() => {
    if (requestedId && requestedId !== routeSuttaId) {
      navigate(`/read/${encodeURIComponent(requestedId)}`, { replace: true });
    }
  }, [routeSuttaId, requestedId]);
  const { notes, membership, lists, markVisited } = useUserData();
  const {
    resolvedTheme,
    fs,
    lh,
    face,
    allPali,
    paliAbove,
    showNotes,
    toggleShowNotes,
    showHighlights,
    toggleShowHighlights,
    revealHighlights,
    cycleTheme,
  } = useReaderPrefs();

  // Where the reader was opened from (LibraryPage's onOpen): `from` is the pane and node to close
  // back to, `fromView` which pane to show there. Absent for a direct link to /read/:suttaId.
  const readerLocationState = location?.state as
    | { from?: string; fromView?: 'tree' | 'list'; searchIds?: string[] }
    | undefined;
  // The segment a search hit was found in, taken once: location.state survives a same-tab refresh,
  // and a jump the reader has since scrolled away from must not fire again.
  const [searchSegment] = useState(
    () =>
      consumeIntent(
        location?.state as ({ segment?: number } & RouteIntent) | null | undefined,
        READER_INTENT_KEY
      )?.segment
  );
  const { from, fromView, searchIds, navigateToSutta, closeToOrigin } = useReaderOrigin(readerLocationState);
  const [openSegs, setOpenSegs] = useState<Record<number, boolean>>({});
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({});
  const [panel, setPanel] = useState(false);
  // The menu panel's tab, persisted across suttas and sessions (lib/readerPanelTab.ts) by every
  // path that lands on one.
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
  // Where this sutta opens, sampled once per sutta id: 'stored' on a return — back or forward, a
  // refresh, a relaunch (lib/entryKind.ts) — 'top' otherwise, and no restore at all when the route
  // names an inner sutta to scroll to.
  const restoreRef = useRef<{ id?: string; restore: ScrollRestore; skipRestore: boolean }>({
    restore: 'stored',
    skipRestore: false,
  });
  if (restoreRef.current.id !== suttaId) {
    restoreRef.current = {
      id: suttaId,
      restore: enteredByReturn() ? 'stored' : 'top',
      skipRestore: !!requestedSubUid || searchSegment !== undefined,
    };
  }
  const {
    segments,
    error: textError,
    retry: retryText,
    hlForSutta,
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
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  // The user lists this sutta belongs to, as chips. Auto-lists are filtered out by suttaRowMeta.
  const suttaChips = useMemo(
    () => (suttaId ? suttaRowMeta([suttaId], membership, {}, flatLists).get(suttaId)?.chips ?? [] : []),
    [suttaId, membership, flatLists]
  );
  // This sutta's place in the browse tree, from nikaya down to its own leaf group.
  const breadcrumb = useMemo(() => (corpus && sutta ? breadcrumbFor(corpus, sutta.node) : []), [corpus, sutta]);
  // The sutta's internal headings, for the Contents list. Empty for most suttas — only those with
  // `<h2>`–`<h5>` structure of their own (build-corpus.mjs's `roleFor()`) have any.
  const headings = useMemo(
    () =>
      (segments || []).reduce<Array<{ i: number; text: string; level: 2 | 3 | 4 | 5 }>>((acc, s, i) => {
        if (s.role === 'heading') acc.push({ i, text: s.en, level: s.headingLevel ?? 2 });
        return acc;
      }, []),
    [segments]
  );

  const theme = READER_THEMES[resolvedTheme];

  // Paints the OS chrome — mobile status bar, desktop PWA title bar — with the reader's own
  // background while it is open (lib/themeColor.ts), and hands it back to the shell on unmount.
  useEffect(() => {
    setReaderThemeColor(theme.bg);
    return () => setReaderThemeColor(null);
  }, [theme.bg]);

  // The document title and meta description, tracking whichever sutta is open.
  useDocumentMeta(sutta ? `${sutta.ref} · ${sutta.en}` : '', sutta?.blurb);

  // Records that a sutta has been opened, which is what TreePane's offline-download nudge waits on.
  useEffect(() => {
    markSuttaOpened();
  }, []);

  useEffect(() => {
    setOpenSegs({});
    setOpenNotes({});
    // Clears a selection outliving the tap that opened this sutta, which would otherwise block the
    // first touch-scroll.
    window.getSelection()?.removeAllRanges();
  }, [suttaId]);

  const { dict, activeWord, closeDict, onWordClick, goToAdjacentWord, retryLookup } = useDictionaryLookup({
    suttaId,
    segments,
    scrollRef,
    scrollToSegment,
    setOpenSegs,
  });

  // Records the sutta as visited, feeding the Recent auto-list, once it has been open for
  // VISIT_DEBOUNCE_MS.
  useEffect(() => {
    if (!suttaId || !sutta) return;
    const timer = window.setTimeout(() => markVisited(suttaId), VISIT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [suttaId, sutta, markVisited]);

  // Scrolls to the requested inner sutta's first segment, a frame after the batch's text loads.
  useEffect(() => {
    if (!requestedSubUid || !segments) return;
    const idx = segments.findIndex((s) => s.key.startsWith(`${requestedSubUid}:`));
    if (idx === -1) return;
    requestAnimationFrame(() => scrollToSegment(idx, 'start'));
  }, [requestedSubUid, segments, scrollToSegment]);

  // The segment washed on arrival, cleared when the flash ends.
  const [flashSeg, setFlashSeg] = useState<number | undefined>(undefined);

  // Scrolls to the segment a search hit's snippet was drawn from, so the words the reader searched
  // for are what they land on, and washes it for SEARCH_FLASH_MS so the eye finds it in the
  // passage. Centred rather than at the top: a segment is a clause, and the passage around it is
  // what makes it read as an answer.
  useEffect(() => {
    if (searchSegment === undefined || requestedSubUid || !segments) return;
    if (searchSegment >= segments.length) return;
    requestAnimationFrame(() => scrollToSegment(searchSegment, 'center'));
    setFlashSeg(searchSegment);
    const timer = window.setTimeout(() => setFlashSeg(undefined), SEARCH_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [searchSegment, requestedSubUid, segments, scrollToSegment]);

  // The whole corpus in canonical browse order, which Prev/Next steps through across category
  // boundaries.
  const siblingIds = useMemo(() => (corpus ? flatSuttaOrder(corpus) : []), [corpus]);

  // The user list the reader was opened from, when the sutta on screen is one of its items: it
  // scopes Prev/Next to that list and shows above the breadcrumb. Undefined otherwise, including
  // for a sutta reached from inside the reader that the list doesn't hold.
  const listOrigin = useMemo(() => {
    const nodeId = from?.match(/^\/browse\/([^/]+)\//)?.[1];
    const list = nodeId ? lists.find((l) => l.id === decodeURIComponent(nodeId)) : undefined;
    return suttaId && list?.items.includes(suttaId) ? list : undefined;
  }, [from, lists, suttaId]);

  // The library search the reader was opened from, when the sutta on screen is one of its hits: it
  // scopes Prev/Next to the results and shows above the breadcrumb. Undefined otherwise, including
  // for a sutta reached from inside the reader, which leaves the run behind.
  const searchOrigin = useMemo(() => {
    const query = new URLSearchParams(from?.split('?')[1] ?? '').get('q') ?? '';
    if (!query || !suttaId || !searchIds?.includes(suttaId)) return undefined;
    return { query, items: searchIds };
  }, [from, searchIds, suttaId]);

  // The suttas Prev/Next steps through: the search results, else the list the reader was opened
  // from, else the whole canon in browse order.
  const run = searchOrigin?.items ?? listOrigin?.items;

  // Returns the sutta one Prev/Next step from `base`, or undefined at either end of the run —
  // the search results' or list's ends, or the ends of the canon.
  const neighbourOf = useCallback(
    (base: string | undefined, dir: 1 | -1) => {
      if (!base) return undefined;
      if (run) {
        const i = run.indexOf(base);
        const next = i === -1 ? undefined : run[i + dir];
        return next === base ? undefined : next;
      }
      const i = siblingIds.indexOf(base);
      const next = siblingIds[Math.min(siblingIds.length - 1, Math.max(0, i + dir))];
      return next === base ? undefined : next;
    },
    [run, siblingIds]
  );

  // Prefetches both neighbours into loadSuttaText's cache, once this sutta's own text has arrived.
  useEffect(() => {
    if (!segments) return;
    for (const dir of [1, -1] as const) {
      const id = neighbourOf(suttaId, dir);
      if (id) loadSuttaText(id).catch(() => {});
    }
  }, [neighbourOf, suttaId, segments]);

  // The two neighbours as corpus entries, so the foot of the sutta can name where Prev/Next goes.
  const footNeighbours = useMemo(() => {
    const at = (dir: 1 | -1) => {
      const id = neighbourOf(suttaId, dir);
      return corpus && id ? corpus.suttas[id] : undefined;
    };
    return { prev: at(-1), next: at(1) };
  }, [corpus, neighbourOf, suttaId]);

  // What the foot of the sutta says Prev/Next is stepping through, and where this sutta sits in it:
  // the search results, the list the reader was opened from, or the sutta's own collection.
  const footContext = useMemo(() => {
    if (!suttaId) return undefined;
    const place = (kind: 'search' | 'list' | 'collection', label: string, items: string[]) => {
      const i = items.indexOf(suttaId);
      return i === -1 ? undefined : { kind, label, position: `${i + 1} of ${items.length}` };
    };
    if (searchOrigin) return place('search', searchOrigin.query, searchOrigin.items);
    if (listOrigin) return place('list', listOrigin.label, listOrigin.items);
    if (!corpus || !sutta) return undefined;
    const group = siblingIds.filter((id) => corpus.suttas[id]?.node === sutta.node);
    return place('collection', breadcrumb[breadcrumb.length - 1]?.label ?? '', group);
  }, [suttaId, searchOrigin, listOrigin, corpus, sutta, siblingIds, breadcrumb]);

  // The measure column the step animation runs on, inside the scrolling pane.
  const articleRef = useRef<HTMLDivElement>(null);
  // The sutta a Prev/Next step is heading to and the direction it travels, consumed once by the
  // render that lands on it.
  const enterOnArrival = useRef<{ id: string; dir: 1 | -1 } | null>(null);

  // Steps one sutta forward or back, carrying the reader's origin along (navigateToSutta).
  function step(dir: 1 | -1) {
    const next = neighbourOf(suttaId, dir);
    if (!next) return;
    enterOnArrival.current = { id: next, dir };
    navigateToSutta(next);
  }

  // Opens the run the foot of the sutta names: the search results, the list the reader was opened
  // from, or the sutta's own collection.
  function goToRun() {
    if (!suttaId) return;
    if (searchOrigin) {
      closeReader();
      return;
    }
    const node = listOrigin?.id ?? sutta?.node;
    if (!node) return;
    navigate(`/browse/${encodeURIComponent(node)}/${encodeURIComponent(suttaId)}`, {
      state: tagIntent({ fromView: 'list' }),
    });
  }

  // Animates the arriving sutta in, on the render that lands on it.
  useLayoutEffect(() => {
    const to = enterOnArrival.current;
    enterOnArrival.current = null;
    const el = articleRef.current;
    if (!el) return;
    cancelStepAnimations(el);
    if (to && to.id === suttaId) animateStep(el, to.dir);
  }, [suttaId]);

  // Scrolls to a highlight, closing the panel and turning highlights back on if they were hidden.
  function jumpToHighlight(segIndex: number, highlightId?: string) {
    setPanel(false);
    revealHighlights();
    requestAnimationFrame(() => scrollToSegment(segIndex, 'center', highlightId));
  }

  function closeReader() {
    closeToOrigin(suttaId, sutta ? `/browse/${sutta.node}/${suttaId}` : '/');
  }

  function onSearchOpenSutta(id: string, segment?: number) {
    setSearchOpen(false);
    // Leaves the library search's run behind: this jump is the reader's own search, not that one.
    navigateToSutta(id, segment, true);
  }

  // Scrolls a just-opened Pali line or footnote into view, by the least it takes and only when it
  // is clipped. `scrollIntoView({ block: 'nearest' })` by hand, since that isn't aware of the CSS
  // `zoom` Settings' UI scale applies — see scrollToSegment (useSuttaReading).
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

  // Shows or hides one segment's Pali, closing the dictionary dock when it collapses the segment
  // the dock's word is in. Stable, as onToggleNote is, so SegmentedText's memoization holds.
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

  // A uid this corpus doesn't have — never a pending load, since App.tsx renders no route until
  // the corpus is in.
  if (!corpus || !sutta || !suttaId) return <NotFoundPage />;

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
          // Vertical scrolling only: no pinch or double-tap zoom, and no Safari click delay.
          touchAction: 'pan-y',
          '--reader-selection': theme.selection,
        } as CSSProperties
      }
      onPointerDown={onReaderPointerDown}
      onPointerUp={onReaderPointerUp}
      // Bound to the whole reader, not the text, so a drag that lifts over the header or the
      // scroll container still opens the highlight popup.
      onMouseUp={onTextUp}
      onTouchEnd={onTextUp}
    >
      {/* The header: close on the left, search and menu on the right, and the title absolutely
          centred on the page rather than between them, since the two sides carry different
          numbers of buttons. */}
      <header className="font-sans flex-none relative flex items-center justify-between px-5 py-3.5 text-ui-base" style={{ borderBottom: `1px solid ${theme.rule}` }}>
        {/* `p-3.5 -m-3.5`: a 47px touch area around the 19px icon, with the negative margin
            collapsing the button's layout box back to the icon. */}
        <button className="flex items-center p-3.5 -m-3.5" title="Close" onClick={closeReader}>
          <X size={19} strokeWidth={1.75} />
        </button>
        {/* Tapping the title scrolls back to the top of the sutta, the iOS status-bar convention.
            Done by hand, since the reader scrolls in a nested div rather than the document. */}
        <button
          className="absolute left-1/2 -translate-x-1/2 max-w-[calc(100%-14rem)] truncate opacity-75 font-serif cursor-pointer"
          aria-label="Scroll to top"
          title="Scroll to top"
          onClick={() => scrollRef.current && animateScrollTop(scrollRef.current, 0)}
        >
          {/* The bare ref on mobile, where the flanking buttons leave too little room for the
              English title. */}
          {mobile ? sutta.ref : `${sutta.ref} · ${sutta.en}`}
        </button>
        {/* Search and Menu, on a smaller 43px touch area (`p-3 -m-3`) so they can sit closer;
            `gap-6` puts the two hit areas edge to edge. */}
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

      {/* The scrolling pane. `overflowX: hidden` keeps the step animation's translateX from making
          it horizontally scrollable, which `.sc` alone doesn't cover. */}
      <div ref={scrollRef} className="sc flex-1" style={{ padding: '32px 22px 120px', overflowX: 'hidden' }}>
        {/* The measure column. A Prev/Next step animates it out and the next sutta in, driven
            imperatively from `step` above, since this element never unmounts. */}
        <div ref={articleRef} style={{ maxWidth: measureWidth, margin: '0 auto' }}>
          {searchOrigin ? (
            <nav className="font-sans flex items-center gap-1" style={{ fontSize: fs - 6, marginBottom: 7, color: theme.dim }}>
              {/* Back to the results, the same place closing the reader lands. */}
              <button className="flex min-w-0 items-center gap-1 hover:underline" onClick={closeReader}>
                <Search size={fs - 7} strokeWidth={2} className="flex-none" />
                <span className="min-w-0 truncate">{searchRunLabel(searchOrigin.query)}</span>
              </button>
            </nav>
          ) : (
            listOrigin && (
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
            )
          )}
          {breadcrumb.length > 0 && (
            <nav
              className="font-sans flex flex-wrap items-center gap-1"
              aria-label="Breadcrumb"
              style={{ fontSize: fs - 6, marginBottom: 7, color: theme.dim }}
            >
              {breadcrumb.map((b, i) => (
                <span key={b.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={fs - 7} strokeWidth={2} />}
                  <button
                    className="hover:underline"
                    onClick={() =>
                      // Every segment navigates to the sutta's own leaf group, and names the
                      // clicked one as `flashNodeId` for the tree pane to scroll to and highlight.
                      // The pane opened is the one that flash will land in.
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
          {/* The sutta's English title. Display leading, held above the serif faces' own glyph
              extent so a wrapped title's descenders clear the next line. */}
          <h1 className="font-serif" style={{ margin: 0, fontSize: Math.round(fs * 1.72), fontWeight: 600, lineHeight: 1.2, letterSpacing: '-.015em' }}>
            {sutta.en}
          </h1>
          <div className="font-serif italic" style={{ fontSize: fs - 2, marginTop: 5, color: theme.dim }}>
            {sutta.pali}
          </div>
          {/* Reading time and source. The light theme takes a paler gray than its own `theme.dim`,
              which is tuned for larger menu labels; it is the lightest that clears 4.5:1 there. */}
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
              {/* The em dash marking this as the reader's own note, as a Library list row does. */}
              <span aria-hidden className="flex-none">
                —
              </span>
              {/* The note itself, clamped to five lines. MatchedText renders its `*bold*`; the
                  empty query marks no words. */}
              <span className="line-clamp-5 whitespace-pre-wrap">
                <MatchedText text={notes[suttaId]} query="" notation />
              </span>
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
                // `fromView` is tagged explicitly: @reach/router stamps a `{key}` onto
                // location.state even when none is passed, so LibraryPage's no-state fallback
                // never fires for an in-app navigate().
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
                  // How many levels below h2 this heading sits; each one steps the indent, size
                  // and opacity down a notch.
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
              paliAbove={paliAbove}
              onToggleSeg={onToggleSeg}
              onWordClick={onWordClick}
              onSpanClick={openPop}
              showNotes={showNotes}
              openNotes={openNotes}
              onToggleNote={onToggleNote}
              activeWord={activeWord}
              focusUid={requestedSubUid}
              flashSeg={flashSeg}
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

          {/* Prev/Next at the foot of the text, shown once the text itself is on screen. */}
          {segments && (footNeighbours.prev || footNeighbours.next) && (
            <nav className="font-sans" aria-label="Continue reading" style={{ marginTop: 30 }}>
              <div style={{ height: 1, background: theme.rule, marginBottom: 14 }} />
              {/* What Prev/Next is stepping through, and where in it this sutta sits. The label is
                  the way back to it — the same destination the breadcrumb's last segment and
                  closing the reader reach. */}
              {footContext && (
                <div
                  className="flex items-center justify-center gap-1.5"
                  style={{ fontSize: fs - 5, color: theme.dim, marginBottom: 14 }}
                >
                  <button
                    className="flex min-w-0 items-center gap-1.5 hover:opacity-70"
                    aria-label={footContext.kind === 'search' ? 'Back to results' : `Back to ${footContext.label}`}
                    title={footContext.kind === 'search' ? 'Back to results' : `Back to ${footContext.label}`}
                    onClick={goToRun}
                  >
                    {footContext.kind === 'search' && <Search size={fs - 6} strokeWidth={2} className="flex-none" />}
                    {footContext.kind === 'list' && <ListIcon size={fs - 6} strokeWidth={2} className="flex-none" />}
                    {footContext.kind === 'collection' && <Library size={fs - 6} strokeWidth={2} className="flex-none" />}
                    <span className="min-w-0 truncate">
                      {footContext.kind === 'search' ? searchRunLabel(footContext.label) : footContext.label}
                    </span>
                  </button>
                  <span className="flex-none">· {footContext.position}</span>
                </div>
              )}
              {/* One row: previous left, next right, each half an equal share that truncates
                  within it, with an empty spacer standing in for a missing neighbour. Each
                  button's inner span carries the flex row, since WebKit sizes a button's own
                  content box to max-content and `truncate` would have nothing to clip to. */}
              <div className="flex items-center gap-5" style={{ fontSize: fs - 4 }}>
                {footNeighbours.prev ? (
                  <button className="block flex-1 min-w-0 text-left hover:opacity-70" onClick={() => step(-1)}>
                    {/* The caption, inset by the chevron's width plus the row gap so it starts
                        above the title. */}
                    <span
                      className="flex items-center gap-1.5"
                      style={{ marginLeft: fs, fontSize: footNavLabelSize(fs), ...FOOT_NAV_LABEL, color: theme.dim }}
                    >
                      Previous
                    </span>
                    <span className="flex items-center gap-1.5" style={{ marginTop: 3 }}>
                      <ChevronLeft size={fs - 6} strokeWidth={2} className="flex-none" style={{ color: theme.dim }} />
                      {/* The bare ref on mobile, where each half is ~150px and every title
                          truncates to a few words. */}
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
          highlights={hlForSutta}
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
          // Making a highlight while they are hidden turns them back on; erasing one doesn't.
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
          highlights={hlForSutta}
          theme={theme}
          onJump={jumpToHighlight}
          layoutKey={`${fs}-${lh}-${face}-${allPali}-${paliAbove}-${segments ? segments.length : 'loading'}`}
        />
      )}

      {searchOpen && <ReaderSearchOverlay theme={theme} onOpenSutta={onSearchOpenSutta} onClose={() => setSearchOpen(false)} />}

      {shortcutsOpen && (
        <ShortcutsModal shortcuts={shortcutsForScope('reader')} theme={theme} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
