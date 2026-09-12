import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams } from 'react-router';
import { X, Menu as MenuIcon, ChevronLeft, ChevronRight, Library, List as ListIcon, Search, Share, Share2, ArrowDownToLine } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useLayout } from '../context/LayoutContext';
import { useSuttaReading } from '../hooks/useSuttaReading';
import { type ScrollRestore } from '../hooks/useScrollMemory';
import { useReaderOrigin } from '../hooks/useReaderOrigin';
import { useReaderKeyboard } from '../hooks/useReaderKeyboard';
import { useBackHandler } from '../hooks/useBackHandler';
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
import { platformName } from '../lib/platform';
import { canShareLink, shareLink, shareUrl } from '../lib/share';
import { READING_TOP, readingPositionOf } from '../lib/readingPosition';
import { tuckIntoBar } from '../lib/putAsideTuck';
import { segmentIndex } from '../lib/segmentKeys';
import { PUT_ASIDE_CAP, type PutAsideEntry } from '../lib/putAside';
import { PutAsideBar, type PutAsideSheetMode } from '../components/PutAsideBar';
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

// Whether the header carries a Share button: only without browser chrome, whose address bar shares.
const SHAREABLE = canShareLink();

// The share glyph each platform's own apps use: Android's connected nodes, the boxed arrow elsewhere.
const ShareIcon = platformName() === 'android' ? Share2 : Share;

// A header icon's footprint: the 19px glyph plus the 24px gap to its neighbour.
const TOOL_W = 43;

// The width the centred title gives up to `count` right-hand icons, mirrored on both sides: the
// header's 20px padding, the icons, and 8px between them and the title.
const titleClearance = (count: number) => 2 * (TOOL_W * count + 4);

// How a library search is named where the reader shows the run it was opened from — above the
// breadcrumb and at the foot of the sutta.
const searchRunLabel = (query: string) => `Results for: “${query}”`;

// The highlights SegmentedText gets while they are hidden: none, and a stable identity so the
// segments don't re-render.
const NO_HIGHLIGHTS: Highlight[] = [];

// How long the text may take before the reader says it is loading. A shorter wait than this reads
// as a stutter rather than as progress, and a sutta prefetched on the press that opened it
// (lib/suttaPrefetch.ts) is on screen well inside it.
const TEXT_LOADING_DELAY_MS = 150;

export function ReaderPage() {
  const { suttaId: routeSuttaId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
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
  }, [routeSuttaId, requestedId, navigate]);
  const { notes, membership, lists, markVisited, putAside, putSuttaAside, trackPutAside, ready: userDataReady } = useUserData();
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
  // The segments a search hit's snippet was drawn from, sampled once per navigation rather than
  // once per mount: this page never unmounts between suttas, so a value held for its lifetime
  // would fire again on every later one and leave a new jump no way in. consumeIntent hands a
  // navId back a single time, which is what keeps a same-tab refresh from jumping twice; a
  // Prev/Next step carries no intent at all and so clears this.
  const arrivalState = location?.state as ({ segments?: [number, number] } & RouteIntent) | null | undefined;
  const arrivalRef = useRef<{ navId?: string; segments?: [number, number] }>({});
  if (arrivalRef.current.navId !== arrivalState?.navId) {
    const consumed = consumeIntent(arrivalState, READER_INTENT_KEY);
    arrivalRef.current = { navId: arrivalState?.navId, segments: consumed?.segments };
  }
  const searchSegments = arrivalRef.current.segments;
  const { from, searchIds, navigateToSutta, closeToOrigin, leaveReader } =
    useReaderOrigin(readerLocationState);
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
  // The line this sutta's tab remembers, where the set holds one for it.
  const tabLine = putAside.find((e) => e.suttaId === suttaId)?.key;
  // Where this sutta opens, sampled once per sutta id: 'stored' on a return — back or forward, a
  // refresh, a relaunch (lib/entryKind.ts) — 'top' otherwise, and no restore at all when the route
  // names an inner sutta to scroll to.
  const restoreRef = useRef<{ id?: string; restore: ScrollRestore; skipRestore: boolean; resumes: boolean }>({
    restore: 'stored',
    skipRestore: false,
    resumes: false,
  });
  if (restoreRef.current.id !== suttaId) {
    const restore = enteredByReturn(navigationType, location.state) ? 'stored' : 'top';
    // Whether this sutta opens at its tab's line. A set-aside sutta is a reading the reader means
    // to carry on, so every way into one resumes it — the bar, a Library row, a link, a Prev/Next
    // step. What outranks the tab is a route naming a line of its own, and a return, which is the
    // reader asking for the place this device left them rather than for the tab's line: that one
    // moves only as they leave a reading, so a refresh would hand back an older place than the one
    // on screen. The cost is a cold-opened link to a set-aside sutta this device has never held a
    // place for, which opens at the top.
    const resumes = restore === 'top' && !requestedSubUid && searchSegments === undefined;
    restoreRef.current = {
      id: suttaId,
      restore,
      // An arrival with a line of its own to land on leaves the pane's restore out of it.
      skipRestore: !!requestedSubUid || searchSegments !== undefined || (resumes && tabLine !== undefined),
      resumes,
    };
  }
  const resumeKey = restoreRef.current.resumes ? tabLine : undefined;
  // The resume target as the arrival left it, read by the effect below rather than depended on: a
  // set that moves under an open reading — the reader's own minimise, or a sync pulling in another
  // device's — leaves what is on screen where it is.
  const resumeKeyRef = useRef(resumeKey);
  resumeKeyRef.current = resumeKey;
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
    setReaderThemeColor(theme.bg, resolvedTheme === 'dark');
    return () => setReaderThemeColor(null);
  }, [theme.bg, resolvedTheme]);

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

  // The reading takes focus as each sutta arrives, so Space, Page Down and the arrow keys scroll it
  // without a click first, as they do on any page a browser loads.
  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, [suttaId, scrollRef]);

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

  // Whether the passage the reader arrived on is still washed.
  const [flashing, setFlashing] = useState(false);

  // The segments the wash covers, clamped to the text that has loaded. Derived rather than held, so
  // it leaves with the arrival it belongs to in that same render: a Prev/Next step lands on text
  // that is often already fetched, and a range held a commit longer paints over it.
  const flashRange = useMemo<[number, number] | undefined>(() => {
    if (!flashing || !searchSegments || requestedSubUid || !segments) return undefined;
    const [first, last] = searchSegments;
    return first >= segments.length ? undefined : [first, Math.min(last, segments.length - 1)];
  }, [flashing, searchSegments, requestedSubUid, segments]);

  // Scrolls to the passage a search hit's snippet was drawn from, so the line the reader picked out
  // of the results is what they land on, and washes the whole of it for SEARCH_FLASH_MS so the eye
  // finds it. Centred rather than at the top: a snippet is a fragment, and the passage around it is
  // what makes it read as an answer.
  useEffect(() => {
    if (searchSegments === undefined || requestedSubUid || !segments) return;
    const [first] = searchSegments;
    if (first >= segments.length) return;
    requestAnimationFrame(() => scrollToSegment(first, 'center'));
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), SEARCH_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [searchSegments, requestedSubUid, segments, scrollToSegment]);

  // Resumes a set-aside sutta at the line it was left on. At the top of the pane rather than
  // centred, and without the ease: this is the reader picking up where they were, not being shown a
  // passage, and one that opens by scrolling down to itself plays a journey they never took. A key
  // this copy of the text doesn't carry — an older cached copy, or one the corpus has since dropped
  // the line from — scrolls nowhere and opens at the top.
  //
  // `READING_TOP` is the head of the document, above the first segment, so it is the pane itself
  // that is put back to nothing rather than a segment that is scrolled to. Written out rather than
  // left to the pane's own zero: this page's reading column survives the change of sutta, so it
  // arrives holding whatever the last one was scrolled to.
  //
  // Held until the user data is in as well as the text, which is the same wait the pane's own
  // scroll memory makes: the breadcrumb above the reading grows a row once the lists land, and a
  // line measured to the top edge before that ends up a row's worth off.
  useEffect(() => {
    const key = resumeKeyRef.current;
    if (key === undefined || !segments || !userDataReady) return;
    if (key === READING_TOP) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
      return;
    }
    const at = segmentIndex(segments).get(key);
    if (at === undefined) return;
    requestAnimationFrame(() => scrollToSegment(at, 'start', { animate: false }));
  }, [suttaId, segments, userDataReady, scrollToSegment, scrollRef]);

  // The reading as the set would remember it, sampled at the moment it is asked for rather than
  // tracked — the scroll position is only ever wanted at the instant of a minimise or a swap.
  const currentEntry = useCallback((): PutAsideEntry | null => {
    if (!suttaId) return null;
    const position = readingPositionOf(scrollRef.current, segments);
    return position ? { suttaId, ...position } : null;
  }, [suttaId, segments, scrollRef]);

  // Whether the sutta on screen already has a tab, which is what the header's left side answers to:
  // a reading with a tab is left by going back down into it, and Close stands down.
  const held = !!suttaId && putAside.some((e) => e.suttaId === suttaId);
  // A full set has no slot for this sutta, and nothing in it is dropped to mint one: the minimise
  // control opens the sheet instead, where closing a tab hands its place straight to this reading.
  const full = !held && putAside.length >= PUT_ASIDE_CAP;
  const [putAsideSheet, setPutAsideSheet] = useState<PutAsideSheetMode>('closed');

  // Hands the set the line this sutta is being left on, where it holds a tab for it — a tab tracks
  // its sutta the way a browser tab holds its scroll. Every way out of a reading calls it; a sutta
  // the set doesn't hold gains nothing, reading alone earning no tab.
  const keepPlace = useCallback(() => {
    const entry = currentEntry();
    if (entry) trackPutAside(entry);
  }, [currentEntry, trackPutAside]);

  // Opens one of the set in place. It lands on the tab's own line, as every way into a set-aside
  // sutta does (restoreRef above). The origin travels with it, so closing still returns wherever
  // this run of reading began.
  function resumePutAside(entry: PutAsideEntry) {
    keepPlace();
    navigateToSutta(entry.suttaId);
  }

  // Sets the sutta aside and leaves, playing the reading down into the bar on the way out — what
  // tells this apart from closing, which leaves for the same place and takes nothing with it. The
  // card is raised before the navigation and comes down over the Library, so the shrink happens
  // against the page the reader has arrived on rather than against nothing (lib/putAsideTuck.ts).
  //
  // A sutta that already has a tab keeps its slot and has only its line refreshed, the card coming
  // down onto that tab: this is the whole of how such a reading is left.
  function minimiseReader() {
    const entry = currentEntry();
    if (entry) putSuttaAside(entry);
    if (entry && sutta) {
      tuckIntoBar({
        suttaId: entry.suttaId,
        label: `${sutta.ref} · ${sutta.en}`,
        theme,
        face: READER_FACES[face],
      });
    }
    leaveToOrigin();
  }

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

  // Whether the wait for the text has run long enough to be worth showing.
  const [textSlow, setTextSlow] = useState(false);
  useEffect(() => {
    if (segments || textError) {
      setTextSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setTextSlow(true), TEXT_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [segments, textError, suttaId]);

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
    keepPlace();
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
    leaveReader(`/browse/${encodeURIComponent(node)}/${encodeURIComponent(suttaId)}`, {
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
    requestAnimationFrame(() => scrollToSegment(segIndex, 'center', { highlightId }));
  }

  // Leaves the reader for wherever this run of reading began, without touching the put-aside set.
  function leaveToOrigin() {
    closeToOrigin(suttaId, sutta ? `/browse/${sutta.node}/${suttaId}` : '/');
  }

  // Closing leaves the reading, and leaves the set as it stands: a tab is closed by its own ✕ on
  // the bar, never from up here. All this owes the set is the line it is walking away from. Escape
  // and Android's Back come here too, including from a reading whose header offers only ⤓.
  function closeReader() {
    keepPlace();
    leaveToOrigin();
  }

  function onSearchOpenSutta(id: string, segments?: [number, number]) {
    setSearchOpen(false);
    keepPlace();
    // Leaves the library search's run behind: this jump is the reader's own search, not that one.
    navigateToSutta(id, segments, true);
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

  // The icon count each side of the header actually draws, so the centred title gives up clearance
  // for whichever side is denser.
  const leftIconCount = held ? 1 : 2; // Set aside, + Close where the sutta has no tab
  const rightIconCount = SHAREABLE ? 3 : 2; // Search + Menu, + Share
  const headerIconCount = Math.max(leftIconCount, rightIconCount);

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
    putAsideOpen: putAsideSheet !== 'closed',
    closePutAside: () => setPutAsideSheet('closed'),
    // The same two things the header's control and the bar's slots do, and refusing on the same
    // terms: the sheet rather than a silent drop at the cap. A sutta that already has a tab is put
    // back in it, as the header's ⤓ does.
    setAside: () => (full ? setPutAsideSheet('full') : minimiseReader()),
    openPutAsideSlot: (slot: number) => {
      const entry = putAside[slot - 1];
      if (entry) resumePutAside(entry);
    },
    closeReader,
    step,
    goToAdjacentWord,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
    toggleShowHighlights,
    cycleTheme,
  });

  // Android's back button, one step at a time, in the same order Escape backs out (useReaderKeyboard):
  // the help and search overlays, then the selection popup, the dictionary and the panel, then the
  // reader itself. A no-op on web and iOS.
  useBackHandler(true, () => {
    if (shortcutsOpen) setShortcutsOpen(false);
    else if (searchOpen) setSearchOpen(false);
    else if (pop) closePop();
    else if (dict) closeDict();
    else if (panel) setPanel(false);
    else closeReader();
  });

  // A uid this corpus doesn't have — never a pending load, since App.tsx renders no route until
  // the corpus is in.
  if (!corpus || !sutta || !suttaId) return <NotFoundPage />;

  const faceFamily = READER_FACES[face];
  const measureWidth = fs * 34;

  return (
    <div
      data-component="ReaderPage"
      className="fixed inset-0 z-40 flex flex-col"
      style={
        {
          background: theme.bg,
          color: theme.fg,
          // A fixed, viewport-filling layer, so it insets its own content past a landscape display
          // cutout rather than inheriting body's padding. The background still fills edge to edge.
          paddingLeft: 'var(--safe-left)',
          paddingRight: 'var(--safe-right)',
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
      {/* The header: close and set-aside on the left, the other tools on the right, and the title
          absolutely centred on the page rather than between them, since the two sides carry
          different numbers of buttons. A 44px bar starting on the safe-area line, the platform's
          own top-bar geometry, with its controls centred in it. */}
      <header
        className="font-sans flex-none relative flex items-center justify-between box-content h-11 px-5 text-ui-base"
        style={{ borderBottom: `1px solid ${theme.rule}`, paddingTop: 'var(--safe-top)' }}
      >
        {/* `gap-6` puts the hit areas edge to edge. Setting aside belongs beside Close: the left of
            the header is how to leave a reading, and setting aside is the other thing to do with
            one. A sutta that already has a tab shows only ⤓, which puts the reading back in it:
            Close is the same walk away from the same reading under an icon that promises the tab
            goes with it, and the only ✕ that closes a tab is the tab's own. */}
        <div className="flex items-center gap-6">
          {/* `p-3.5 -m-3.5`: a 47px touch area around the 19px icon, with the negative margin
              collapsing the button's layout box back to the icon. */}
          {!held && (
            <button className="flex items-center p-3.5 -m-3.5" title="Close" onClick={closeReader}>
              <X size={19} strokeWidth={1.75} />
            </button>
          )}
          <button
            className="flex items-center p-3.5 -m-3.5"
            aria-label={held ? 'Back to the bar' : 'Set aside'}
            title={
              held
                ? 'Back to the bar'
                : full
                  ? `You can set aside ${PUT_ASIDE_CAP} suttas at a time — make room first`
                  : 'Set aside for later'
            }
            onClick={(e) => {
              e.stopPropagation();
              if (full) setPutAsideSheet('full');
              else minimiseReader();
            }}
          >
            <ArrowDownToLine size={19} strokeWidth={1.75} />
          </button>
        </div>
        {/* Tapping the title scrolls back to the top of the sutta, the iOS status-bar convention.
            Done by hand, since the reader scrolls in a nested div rather than the document. */}
        <button
          className="absolute left-1/2 -translate-x-1/2 truncate opacity-75 font-serif cursor-pointer"
          style={{ maxWidth: `calc(100% - ${titleClearance(headerIconCount)}px)` }}
          aria-label="Scroll to top"
          title="Scroll to top"
          onClick={() => scrollRef.current && animateScrollTop(scrollRef.current, 0)}
        >
          {/* The bare ref on mobile, where the flanking buttons leave too little room for the
              English title. */}
          {mobile ? sutta.ref : `${sutta.ref} · ${sutta.en}`}
        </button>
        {/* `p-3 -m-3` gives these a smaller 43px touch area so they can sit closer. */}
        <div className="flex items-center gap-6">
          {SHAREABLE && (
            <button
              className="flex items-center p-3 -m-3"
              aria-label="Share"
              title="Share"
              onClick={(e) => {
                e.stopPropagation();
                void shareLink(shareUrl(`/read/${requestedSubUid ?? suttaId}`)).catch(() => {});
              }}
            >
              <ShareIcon size={19} strokeWidth={1.75} />
            </button>
          )}
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

      {/* The scrolling pane, focusable so the keyboard scrolls it. `overflowX: hidden` keeps the
          step animation's translateX from making it horizontally scrollable, which `.sc` alone
          doesn't cover. */}
      <div
        ref={scrollRef}
        tabIndex={-1}
        className="sc flex-1"
        style={{ padding: '32px 22px 120px', overflowX: 'hidden', outline: 'none' }}
      >
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
                    leaveReader(`/browse/${encodeURIComponent(listOrigin.id)}/${encodeURIComponent(suttaId)}`, {
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
                      leaveReader(`/browse/${encodeURIComponent(sutta.node)}/${encodeURIComponent(suttaId)}`, {
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
                // `fromView` is tagged explicitly: an arrival from inside the app otherwise opens
                // LibraryPage on whichever pane it was last left on, and this chip names a list.
                if (list) leaveReader(`/browse/${list.id}/${suttaId}`, { state: tagIntent({ fromView: 'list' }) });
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
              flashRange={flashRange}
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
          ) : textSlow ? (
            <div className="font-sans text-sm opacity-50">Loading…</div>
          ) : null}

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

      {/* The put-aside bar, below the reading and above everything overlaid on it. It takes its
          height from this column rather than floating, so the text is never behind it.

          The dictionary takes the foot of the screen for itself: one word up is one piece of
          furniture down there, not two rows of it, and the reading keeps the bar's height while
          the dock has the rest. The bar returns as it stood the moment the word closes — it slides
          up only when the set first appears, never on a mount like this one. */}
      {!dict && (
        <PutAsideBar
          theme={theme}
          currentSuttaId={suttaId}
          onOpen={resumePutAside}
          sheet={putAsideSheet}
          onSheet={setPutAsideSheet}
          onMakeRoom={minimiseReader}
        />
      )}

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

      {!panel && segments && (
        <HighlightGutter
          scrollRef={scrollRef}
          highlights={hlForSutta}
          segments={segments}
          theme={theme}
          onJump={jumpToHighlight}
          layoutKey={`${fs}-${lh}-${face}-${allPali}-${paliAbove}-${segments ? segments.length : 'loading'}`}
        />
      )}

      {searchOpen && (
        <ReaderSearchOverlay
          theme={theme}
          currentId={suttaId}
          onOpenSutta={onSearchOpenSutta}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {shortcutsOpen && (
        <ShortcutsModal shortcuts={shortcutsForScope('reader')} theme={theme} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
