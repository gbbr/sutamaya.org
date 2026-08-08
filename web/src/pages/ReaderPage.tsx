import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { X, Menu as MenuIcon, ChevronRight } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useSuttaReading } from '../hooks/useSuttaReading';
import { flatSuttaOrder, breadcrumbFor } from '../lib/corpus';
import { flattenListTree, resolveListById } from '../lib/lists';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import { READER_FACES, READER_THEMES } from '../lib/theme';
import { lookupWord } from '../lib/dictionary';
import { SHORTCUTS, shortcutsForScope, isShortcut } from '../lib/shortcuts';
import { tagIntent } from '../lib/routeIntent';
import { READER_ORIGIN_KEY } from '../lib/storageKeys';
import { SegmentedText } from '../components/SegmentedText';
import { HighlightPopup } from '../components/HighlightPopup';
import { HighlightGutter } from '../components/HighlightGutter';
import { DictionaryDock } from '../components/DictionaryDock';
import { ReaderMenuPanel } from '../components/ReaderMenuPanel';
import { ReaderSearchOverlay } from '../components/ReaderSearchOverlay';
import { ReaderShortcutsModal } from '../components/ReaderShortcutsModal';
import { HighlightCountBadge } from '../components/HighlightCountBadge';

interface DictState {
  word: string;
  gloss: string;
  defs: string[] | null;
}

interface PersistedReaderOrigin {
  suttaId: string;
  from: string;
  fromView?: 'tree' | 'list';
}

// A hard refresh drops location.state entirely (browser-native — a fresh navigation's history
// entry starts with none), losing `from`/`fromView` even for a reader opened moments earlier via
// LibraryPage.onOpen (which persists this alongside the router-state it also sets — see there).
// Scoped by `suttaId` so a direct/bookmarked link to a *different* /read/:id can't resurrect a
// stale origin left over from an unrelated earlier reading session.
function readPersistedReaderOrigin(suttaId: string | undefined): PersistedReaderOrigin | null {
  if (!suttaId) return null;
  try {
    const raw = localStorage.getItem(READER_ORIGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedReaderOrigin;
    return parsed.suttaId === suttaId ? parsed : null;
  } catch {
    return null;
  }
}

// Re-keys the persisted origin to whichever sutta is now being read, carrying the same
// `from`/`fromView` forward the same way router state already does (see step()/
// onSearchOpenSutta below) — otherwise a refresh partway through a Prev/Next run would find the
// persisted entry still scoped to the *original* sutta and fall back to the bare corpus location
// instead of the actual origin pane.
function persistReaderOrigin(suttaId: string, from: string | undefined, fromView: 'tree' | 'list' | undefined) {
  if (!from) return;
  try {
    localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId, from, fromView }));
  } catch {
    // storage unavailable — ignore
  }
}

export function ReaderPage({ suttaId, location }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus, dictionary } = useCorpus();
  const { notes, membership, lists, markVisited } = useUserData();
  const { theme: themeId, fs, lh, face, allPali, showNotes, toggleShowNotes } = useReaderPrefs();

  const initialPanelTab = new URLSearchParams(location?.search).get('panel') as 'highlights' | 'lists' | 'text' | null;
  // Where to return to on close — the exact pane/nodeId/scroll position the reader was opened
  // from (see LibraryPage's onOpen), not just the sutta's bare corpus location. Falls back to
  // that bare location for a direct/bookmarked link to /read/:suttaId, which has no such origin.
  // `fromView` rides alongside it (mobile only — LibraryPage shows one pane at a time there) so
  // closing lands back on the actual tree/list pane the reader was opened from, not whichever one
  // LibraryPage's own suttaId-present-on-mount default would otherwise guess.
  const readerLocationState = location?.state as { from?: string; fromView?: 'tree' | 'list' } | undefined;
  const from = readerLocationState?.from;
  const fromView = readerLocationState?.fromView;
  const [openSegs, setOpenSegs] = useState<Record<number, boolean>>({});
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({});
  const [dict, setDict] = useState<DictState | null>(null);
  const [panel, setPanel] = useState(!!initialPanelTab);
  const [tab, setTab] = useState<'highlights' | 'lists' | 'text'>(initialPanelTab || 'highlights');
  const [noteFocusSignal, setNoteFocusSignal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 860);
  const tapRef = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const sutta = corpus && suttaId ? corpus.suttas[suttaId] : undefined;
  const {
    segments,
    hlForSutta,
    highlightGroups,
    hlCount,
    scrollRef,
    scrollToSegment,
    pop,
    onTextUp,
    pick,
    close: closePop,
    popStop,
    openPop,
  } = useSuttaReading(suttaId, 'reader');
  // "Highlights"/"Notes" membership (see server/src/routes/data.js's buildUserData) is redundant
  // here — the highlight gutter and the note preview above already say as much — so they're
  // filtered out of the chip row entirely.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const suttaLists = useMemo(() => {
    const raw = (suttaId && membership[suttaId]) || [];
    return raw
      .filter((id) => !AUTO_LIST_IDS.has(id))
      .map((id) => {
        const { list, breadcrumb } = resolveListById(id, flatLists);
        return { id, list, breadcrumb };
      });
  }, [suttaId, membership, flatLists]);
  // Where this sutta lives in the browse tree (nikaya, any intermediate groups, down to its own
  // leaf group) — shown above the title, each segment navigating via /browse/{id}, which already
  // expands every ancestor and scrolls to it (see TreePane's useScrollToNode).
  const breadcrumb = useMemo(() => (corpus && sutta ? breadcrumbFor(corpus, sutta.node) : []), [corpus, sutta]);
  // Only DN9-style suttas with internal `<h2>`/`<h3>` structure (see build-corpus.mjs's
  // `roleFor()`) have any of these — empty for most suttas, which is why the block that renders
  // this is conditional on it below.
  const headings = useMemo(
    () =>
      (segments || []).reduce<Array<{ i: number; text: string; level: 2 | 3 }>>((acc, s, i) => {
        if (s.role === 'heading') acc.push({ i, text: s.en, level: s.headingLevel ?? 2 });
        return acc;
      }, []),
    [segments]
  );

  const theme = READER_THEMES[themeId];

  useEffect(() => {
    setOpenSegs({});
    setOpenNotes({});
    setDict(null);
    // A stray native selection can outlive the tap that opened this sutta (e.g. the list-row tap
    // that navigated here) — clearing it on every fresh mount stops it from carrying over and
    // blocking the first touch-scroll in the newly-opened reader.
    window.getSelection()?.removeAllRanges();
  }, [suttaId]);

  // A sutta only counts as "visited" once the reader has actually stayed open on it for a
  // meaningful fraction of its estimated reading time — marking it the instant it opens (the old
  // behavior) meant a single Prev/Next flick-through marked everything it passed as read, making
  // the "read" checkmark (ListPane) not mean much. Cancelled (never marked) if the
  // sutta changes — Prev/Next, closing, a deep link elsewhere — before the dwell time elapses.
  useEffect(() => {
    if (!suttaId || !sutta) return;
    const dwellMs = Math.max(1000, sutta.min * 60 * 1000 * 0.3);
    const timer = window.setTimeout(() => markVisited(suttaId), dwellMs);
    return () => window.clearTimeout(timer);
  }, [suttaId, sutta, markVisited]);

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 860);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The whole corpus in canonical browse order, not just the current category's siblings — so
  // Prev/Next carries on into the next/previous category once the current one runs out, rather
  // than stopping at its edge. Depends only on `corpus` (not `sutta`), so it's correct whether
  // the reader was entered from browsing, a search result, or a deep link.
  const siblingIds = useMemo(() => (corpus ? flatSuttaOrder(corpus) : []), [corpus]);

  function step(dir: 1 | -1) {
    if (!suttaId) return;
    const i = siblingIds.indexOf(suttaId);
    const next = siblingIds[Math.min(siblingIds.length - 1, Math.max(0, i + dir))];
    // Carries `from`/`fromView` forward so closing after stepping through several suttas still
    // returns to wherever the reader was originally opened from, not the last-stepped sutta's own
    // location.
    if (next && next !== suttaId) {
      persistReaderOrigin(next, from, fromView);
      navigate(`/read/${encodeURIComponent(next)}`, { state: { from, fromView } });
    }
  }

  // Swipe-left/right to go to the next/prev sutta on mobile. This has to bypass React's own
  // Pointer Events (what the tap-to-dismiss-popup handlers below use) because the reading pane
  // (`scrollRef`, below) is vertically scrollable, and browsers commit to a native vertical-scroll
  // gesture as soon as a touch shows *any* vertical drift — once that happens they stop
  // delivering pointermove/pointerup for that touch (a pointercancel fires instead), so a
  // pointerup-only swipe check silently never fires for anything but a perfectly horizontal
  // drag.
  //
  // The root's own `touch-action: pan-y` (JSX below) is what actually keeps this from
  // conflicting with normal vertical scrolling: it tells the browser upfront, from CSS alone,
  // that only vertical panning is ever handled natively here, so it can start compositor-thread
  // scrolling immediately on any vertical-ish touch without waiting on this effect's own
  // `touchmove` listener at all. Without it (an earlier version of this effect registered
  // `touchmove` as `{ passive: false }` specifically so it could call `preventDefault()` once a
  // gesture revealed itself as horizontal-dominant), *every* touch-driven scroll in the reader —
  // not just actual swipes — had to synchronously wait for this handler to run before the browser
  // would commit to scrolling at all, since a non-passive listener means the browser can't know
  // in advance whether a given gesture will end up preventDefault()-ed. That's harmless when the
  // main thread is free, but on a slow device/first load — heavy initial `SegmentedText`
  // rendering, corpus/text JSON parsing — it reads as "can't scroll for a few seconds": the
  // browser is just waiting on a main thread that's busy with something else entirely. With
  // `touch-action: pan-y` declared, the listener below only ever needs to *read* touch deltas for
  // the horizontal-swipe threshold — it no longer blocks or has to preventDefault anything itself
  // (the browser already won't hand horizontal motion to native scroll/pull-to-refresh), so it can
  // stay fully passive.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let lock: 'h' | 'v' | null = null;

    function onTouchStart(e: TouchEvent) {
      // The side panel (including its own font-size/line-height range inputs) is a full-height
      // overlay rendered inside this same root, so without this guard a touch drag started over
      // it — including a horizontal one on a slider thumb — would still bubble up here and get
      // read as a swipe once released.
      if (panel || e.touches.length !== 1) {
        start = null;
        lock = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lock = null;
    }
    function onTouchMove(e: TouchEvent) {
      if (panel || !start || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!lock) {
        if (Math.hypot(dx, dy) < 10) return;
        lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (!panel && start && lock === 'h') {
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 60) step(dx < 0 ? 1 : -1);
      }
      start = null;
      lock = null;
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingIds, suttaId, panel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While open, the help modal owns every key itself — Esc or '?' again both close it,
      // mirroring how every other overlay in this app closes.
      if (shortcutsOpen) {
        if (e.key === 'Escape' || isShortcut(e, SHORTCUTS.readerHelp)) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      // While the search overlay is open, it owns every key itself (see its own onKeyDown) —
      // bail out before even the input/textarea tag check below, since a click on a result row
      // (not the input) would otherwise let these fall through to the reader's own shortcuts.
      if (searchOpen) return;
      // Escape is handled before the input/textarea bail below (unlike every other shortcut
      // here) — it's the "leave this" key even mid-edit (e.g. the highlights panel's own note
      // textarea, which has no Escape handling of its own), not a text-insertion key like '/' or
      // 'h'/'l'/'n' that would otherwise land in whatever's focused. A field with its own
      // graduated Escape behavior (see ListMembershipPicker) calls stopPropagation() so this
      // doesn't also fire on the same keypress and skip past its first step.
      if (isShortcut(e, SHORTCUTS.readerClose)) {
        // A live selection/highlight-color popup is the innermost thing to back out of — it
        // takes priority even over the dictionary dock, since a word tap can't happen without
        // first releasing whatever text was selected.
        if (pop) closePop();
        else if (dict) closeDict();
        else if (panel) setPanel(false);
        else closeReader();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (isShortcut(e, SHORTCUTS.readerHelp)) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (isShortcut(e, SHORTCUTS.readerSearch)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (isShortcut(e, SHORTCUTS.readerNav)) step(e.key === 'ArrowLeft' ? -1 : 1);
      else if (isShortcut(e, SHORTCUTS.readerHighlights)) {
        e.preventDefault();
        setTab('highlights');
        setPanel(true);
      } else if (isShortcut(e, SHORTCUTS.readerLists)) {
        // Without this, the same keypress that opens the panel also lands in the Lists tab's
        // now-focused filter input (it autoFocuses — see ListMembershipPicker) since nothing
        // stopped the browser's own default text-insertion behavior for this key.
        e.preventDefault();
        setTab('lists');
        setPanel(true);
      } else if (isShortcut(e, SHORTCUTS.readerNote)) {
        e.preventDefault();
        setTab('highlights');
        setPanel(true);
        setNoteFocusSignal((s) => s + 1);
      } else if (isShortcut(e, SHORTCUTS.readerNotesToggle)) {
        e.preventDefault();
        toggleShowNotes();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen, dict, panel, pop, closePop, searchOpen, siblingIds, suttaId]);

  function jumpToHighlight(segIndex: number) {
    setPanel(false);
    requestAnimationFrame(() => scrollToSegment(segIndex, 'center'));
  }

  function closeReader() {
    // `restoreOrigin: true` marks this as a return-to-origin round trip (as opposed to a fresh
    // deep link) — see TreePane's own `restoreOrigin` prop for why its Library/My-lists toggle
    // needs to tell the two apart. Only meaningful alongside `from` itself: the no-`from`
    // fallback below is a bare corpus location, not a return to anywhere the user actually was.
    // Tagged (see lib/routeIntent.ts) so LibraryPage consumes `fromView` exactly once, rather
    // than a later refresh of the same URL resurrecting it over a manual pane switch made since.
    if (from) {
      navigate(from, { state: tagIntent({ fromView, restoreOrigin: true }) });
      return;
    }
    const persistedOrigin = readPersistedReaderOrigin(suttaId);
    if (persistedOrigin) {
      navigate(persistedOrigin.from, { state: tagIntent({ fromView: persistedOrigin.fromView, restoreOrigin: true }) });
      return;
    }
    if (sutta) navigate(`/browse/${sutta.node}/${suttaId}`);
    else navigate('/');
  }

  function onSearchOpenSutta(id: string) {
    setSearchOpen(false);
    persistReaderOrigin(id, from, fromView);
    navigate(`/read/${encodeURIComponent(id)}`, { state: { from, fromView } });
  }

  // Wrapped in useCallback (as are onToggleSeg/onToggleNote below) so SegmentedText's own
  // per-segment memoization isn't defeated by a freshly-allocated function on every ReaderPage
  // render — see SegmentedText.tsx's perf note.
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
    (raw: string) => {
      if (!dictionary) return;
      const word = raw.replace(/[.,;:""''"'?!—]/g, '');
      const def = lookupWord(dictionary, raw);
      setDict({
        word,
        gloss: def ? `${def.length}` : 'Pali',
        defs: def,
      });
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    },
    [dictionary]
  );
  const onToggleSeg = useCallback((i: number) => setOpenSegs((s) => ({ ...s, [i]: !s[i] })), []);
  const onToggleNote = useCallback((i: number) => setOpenNotes((s) => ({ ...s, [i]: !s[i] })), []);

  function onReaderPointerDown(e: React.PointerEvent) {
    tapRef.current = { x: e.clientX, y: e.clientY };
  }
  function onReaderPointerUp(e: React.PointerEvent) {
    const start = tapRef.current;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved < 10 && !String(window.getSelection()) && pop) closePop();
  }

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
      ref={rootRef}
      data-component="ReaderPage"
      className="fixed inset-0 z-40 flex flex-col animate-fadeIn"
      style={{ background: theme.bg, color: theme.fg, touchAction: 'pan-y' }}
      onPointerDown={onReaderPointerDown}
      onPointerUp={onReaderPointerUp}
    >
      <header className="font-sans flex-none flex items-center gap-4 px-5 py-3 text-[13px]" style={{ borderBottom: `1px solid ${theme.rule}` }}>
        <button className="flex items-center" title="Close" onClick={closeReader}>
          <X size={15} strokeWidth={1.75} />
        </button>
        {/* Tapping the title bar scrolls back to the top of the sutta — the same "tap the top of
            the screen" convention most native iOS apps use. That convention is normally free
            (UIScrollView's own scrollsToTop, wired to a tap on the physical status bar), but it
            only ever applies to a page's own document-level scroll; this reader's actual
            scrolling happens in `scrollRef`'s nested div (`.fixed inset-0` root, `html`/`body`
            themselves never scroll — see index.css), which that native behavior never reaches,
            so it has to be done by hand here instead. */}
        <button
          className="flex-1 text-center opacity-75 font-serif cursor-pointer"
          aria-label="Scroll to top"
          title="Scroll to top"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          {mobile ? sutta.ref : `${sutta.ref} · ${sutta.pali}`}
        </button>
        <button
          className="flex items-center"
          aria-label="Menu"
          title="Menu"
          onClick={(e) => {
            e.stopPropagation();
            // Opening straight onto the Theme tab's mobile bottom sheet shouldn't leave an open
            // DictionaryDock sitting underneath it wasting space — desktop's drawer never
            // overlaps the dock, so this is mobile-only (see ReaderMenuPanel's `onTabChange` for
            // the other path into the same state).
            if (mobile) closeDict();
            setTab('text');
            setPanel(true);
          }}
        >
          <MenuIcon size={15} strokeWidth={1.75} />
        </button>
      </header>

      <div ref={scrollRef} className="sc flex-1" style={{ padding: '44px 22px 120px' }}>
        <div style={{ maxWidth: measureWidth, margin: '0 auto' }}>
          {breadcrumb.length > 0 && (
            <nav className="font-sans flex flex-wrap items-center gap-1" style={{ fontSize: 12, marginBottom: 7, color: theme.dim }}>
              {breadcrumb.map((b, i) => (
                <span key={b.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={11} strokeWidth={2} />}
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
          <h1 className="font-serif" style={{ margin: 0, fontSize: Math.round(fs * 1.72), fontWeight: 600, lineHeight: 1.12, letterSpacing: '-.015em' }}>
            {sutta.en}
          </h1>
          <div className="font-serif italic" style={{ fontSize: fs - 2, marginTop: 5, color: theme.dim }}>
            {sutta.pali}
          </div>
          <div className="font-sans" style={{ fontSize: 12, marginTop: 9, color: theme.dim }}>
            {sutta.min} min read
          </div>
          {sutta.blurb && (
            <div className="italic" style={{ fontSize: fs - 4, lineHeight: 1.6, marginTop: 11, color: theme.fg, opacity: 0.72 }}>
              {sutta.blurb}
            </div>
          )}
          {notes[suttaId] && (
            <div
              className="pl-[10px]"
              style={{ fontSize: fs - 4, lineHeight: 1.6, marginTop: 9, color: theme.fg, opacity: 0.72, borderLeft: `2px solid ${theme.rule}` }}
            >
              {notes[suttaId]}
            </div>
          )}
          {(suttaLists.length > 0 || hlCount > 0) && (
            <div className="flex flex-wrap items-center gap-[6px]" style={{ marginTop: 11 }}>
              {suttaLists.map(({ id, list, breadcrumb }) => {
                return (
                  <button
                    key={id}
                    className="inline-flex items-center h-5 whitespace-nowrap rounded-full px-[10px] font-sans text-[11px] hover:opacity-70"
                    style={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
                    onClick={() => list && navigate(`/browse/${list.id}/${suttaId}`)}
                  >
                    {breadcrumb}
                  </button>
                );
              })}
              {hlCount > 0 && (
                <HighlightCountBadge
                  count={hlCount}
                  theme={theme}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTab('highlights');
                    setPanel(true);
                  }}
                />
              )}
            </div>
          )}
          <div style={{ height: 1, background: theme.rule, margin: '20px 0 22px' }} />

          {headings.length > 0 && (
            <div>
              <nav className="font-sans" style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: theme.dim, marginBottom: 8 }}>
                  Contents
                </div>
                {headings.map((h) => (
                  <button
                    key={h.i}
                    className="block text-left hover:underline"
                    style={{
                      paddingLeft: h.level === 3 ? 16 : 0,
                      marginTop: 6,
                      fontSize: h.level === 3 ? 16 : 17,
                      fontWeight: h.level === 3 ? 400 : 600,
                      color: theme.fg,
                      opacity: h.level === 3 ? 0.72 : 0.9,
                    }}
                    onClick={() => scrollToSegment(h.i)}
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
              <div style={{ height: 1, background: theme.rule, margin: '20px 0 22px' }} />
            </div>
          )}

          {segments ? (
            <SegmentedText
              segments={segments}
              highlights={hlForSutta}
              theme={theme}
              fontSize={fs}
              lineHeight={lh}
              face={faceFamily}
              openSegs={openSegs}
              allPali={allPali}
              onToggleSeg={onToggleSeg}
              onWordClick={onWordClick}
              onTextUp={onTextUp}
              onSpanClick={openPop}
              showNotes={showNotes}
              openNotes={openNotes}
              onToggleNote={onToggleNote}
            />
          ) : (
            <div className="font-sans text-sm opacity-50">Loading…</div>
          )}

          <div className="font-sans text-center" style={{ marginTop: 34, fontSize: 12.5, color: theme.dim }}>
            — end of excerpt —
          </div>
        </div>
      </div>

      {dict && (
        <DictionaryDock word={dict.word} gloss={dict.gloss} defs={dict.defs} theme={theme} fontSize={fs} onClose={closeDict} />
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
            if (mobile && t === 'text') closeDict();
          }}
        />
      )}

      {pop && <HighlightPopup pop={pop} theme={theme} onPick={pick} onRemove={() => pick(null)} onStop={popStop} />}

      {!panel && (
        <HighlightGutter
          scrollRef={scrollRef}
          highlightGroups={highlightGroups}
          onJump={jumpToHighlight}
          layoutKey={`${fs}-${lh}-${face}-${allPali}-${segments ? segments.length : 'loading'}`}
        />
      )}

      {searchOpen && <ReaderSearchOverlay theme={theme} onOpenSutta={onSearchOpenSutta} onClose={() => setSearchOpen(false)} />}

      {shortcutsOpen && (
        <ReaderShortcutsModal shortcuts={shortcutsForScope('reader')} theme={theme} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
