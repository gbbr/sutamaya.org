import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { X, Menu as MenuIcon, ChevronRight } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useLayout } from '../context/LayoutContext';
import { useSuttaReading } from '../hooks/useSuttaReading';
import { useReaderOrigin } from '../hooks/useReaderOrigin';
import { useReaderKeyboard } from '../hooks/useReaderKeyboard';
import { useReaderSwipeNav } from '../hooks/useReaderSwipeNav';
import { useDictionaryLookup } from '../hooks/useDictionaryLookup';
import { flatSuttaOrder, breadcrumbFor, resolveCanonicalSuttaId } from '../lib/corpus';
import { flattenListTree, resolveListById, suttaRowMeta } from '../lib/lists';
import { READER_FACES, READER_THEMES } from '../lib/theme';
import { setReaderThemeColor } from '../lib/themeColor';
import { shortcutsForScope } from '../lib/shortcuts';
import { tagIntent } from '../lib/routeIntent';
import { SegmentedText } from '../components/SegmentedText';
import { HighlightPopup } from '../components/HighlightPopup';
import { HighlightGutter } from '../components/HighlightGutter';
import { DictionaryDock } from '../components/DictionaryDock';
import { ReaderMenuPanel } from '../components/ReaderMenuPanel';
import { ReaderSearchOverlay } from '../components/ReaderSearchOverlay';
import { ShortcutsModal } from '../components/ShortcutsModal';
import { SuttaRowChips } from '../components/SuttaRowChips';

export function ReaderPage({ suttaId: routeSuttaId, location }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus } = useCorpus();
  // A batched document (several inner suttas in one file, e.g. "dhp320-333") has no corpus entry
  // of its own for any individual inner sutta ("dhp321") — resolving here means every other use
  // of `suttaId` below (text fetch, highlights/notes/visited, Prev/Next, breadcrumb) transparently
  // operates on the batch's own id, same as if the batch id had been requested directly.
  // `requestedSubUid` is only set when that resolution actually changed something — i.e. this was
  // a deep link/search hit for a specific inner sutta — and is used below purely to scroll to and
  // softly mark that inner sutta's own segments once the batch loads.
  const suttaId = corpus && routeSuttaId ? resolveCanonicalSuttaId(corpus, routeSuttaId) : routeSuttaId;
  const requestedSubUid = routeSuttaId && routeSuttaId !== suttaId ? routeSuttaId : undefined;
  const { notes, membership, lists, markVisited } = useUserData();
  const { resolvedTheme, fs, lh, face, allPali, showNotes, toggleShowNotes } = useReaderPrefs();

  const initialPanelTab = new URLSearchParams(location?.search).get('panel') as 'highlights' | 'lists' | 'text' | null;
  // Where to return to on close — the exact pane/nodeId/scroll position the reader was opened
  // from (see LibraryPage's onOpen), not just the sutta's bare corpus location. Falls back to
  // that bare location for a direct/bookmarked link to /read/:suttaId, which has no such origin.
  // `fromView` rides alongside it (mobile only — LibraryPage shows one pane at a time there) so
  // closing lands back on the actual tree/list pane the reader was opened from, not whichever one
  // LibraryPage's own suttaId-present-on-mount default would otherwise guess.
  const readerLocationState = location?.state as { from?: string; fromView?: 'tree' | 'list' } | undefined;
  const { from, fromView, navigateToSutta, closeToOrigin } = useReaderOrigin(readerLocationState);
  const [openSegs, setOpenSegs] = useState<Record<number, boolean>>({});
  const [openNotes, setOpenNotes] = useState<Record<number, boolean>>({});
  const [panel, setPanel] = useState(!!initialPanelTab);
  const [tab, setTab] = useState<'highlights' | 'lists' | 'text'>(initialPanelTab || 'highlights');
  const [noteFocusSignal, setNoteFocusSignal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { mobile } = useLayout();
  const tapRef = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const sutta = corpus && suttaId ? corpus.suttas[suttaId] : undefined;
  const {
    segments,
    error: textError,
    retry: retryText,
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
  } = useSuttaReading(suttaId, 'reader', !!requestedSubUid);
  // "Highlights"/"Notes" membership (see server/src/routes/data.js's buildUserData) is redundant
  // here — the highlight gutter and the note preview above already say as much — so they're
  // filtered out of the chip row entirely (suttaRowMeta's own AUTO_LIST_IDS filter, same as
  // ListPane/TreePane/ReaderSearchOverlay's use of it).
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

  useEffect(() => {
    setOpenSegs({});
    setOpenNotes({});
    // A stray native selection can outlive the tap that opened this sutta (e.g. the list-row tap
    // that navigated here) — clearing it on every fresh mount stops it from carrying over and
    // blocking the first touch-scroll in the newly-opened reader.
    window.getSelection()?.removeAllRanges();
  }, [suttaId]);

  const { dict, activeWord, closeDict, onWordClick, goToAdjacentWord } = useDictionaryLookup({
    suttaId,
    segments,
    scrollRef,
    scrollToSegment,
    setOpenSegs,
  });

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

  // Landed here via a deep link/search hit for one specific inner sutta of a batched document
  // (see requestedSubUid above) — scroll to its first segment once the batch's text has loaded.
  // Runs a frame after mount/load, same as jumpToHighlight below. `useSuttaReading` is told about
  // `requestedSubUid` (see its own `hasDeepLinkTarget` param) so useScrollMemory skips its usual
  // restore-a-remembered-position behavior for this mount entirely, rather than this effect having
  // to fight/override it (iOS Safari can otherwise land a `scrollBy({behavior:'smooth'})` call
  // issued a few ms after that restore's own synchronous `scrollTop =` write well past the
  // intended target — two scroll writes on the same container that close together can *stack*
  // instead of the second one superseding the first).
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

  function step(dir: 1 | -1) {
    if (!suttaId) return;
    const i = siblingIds.indexOf(suttaId);
    const next = siblingIds[Math.min(siblingIds.length - 1, Math.max(0, i + dir))];
    // navigateToSutta carries `from`/`fromView` forward so closing after stepping through
    // several suttas still returns to wherever the reader was originally opened from, not the
    // last-stepped sutta's own location.
    if (next && next !== suttaId) navigateToSutta(next);
  }

  useReaderSwipeNav({ rootRef, panel, step, siblingIds, suttaId });

  function jumpToHighlight(segIndex: number, highlightId?: string) {
    setPanel(false);
    requestAnimationFrame(() => scrollToSegment(segIndex, 'center', highlightId));
  }

  function closeReader() {
    closeToOrigin(suttaId, sutta ? `/browse/${sutta.node}/${suttaId}` : '/');
  }

  function onSearchOpenSutta(id: string) {
    setSearchOpen(false);
    navigateToSutta(id);
  }

  // Wrapped in useCallback (as is onToggleNote below) so SegmentedText's own per-segment
  // memoization isn't defeated by a freshly-allocated function on every ReaderPage render — see
  // SegmentedText.tsx's perf note. (onWordClick itself lives in useDictionaryLookup now.)
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
    siblingIds,
    suttaId,
    goToAdjacentWord,
    setTab,
    setNoteFocusSignal,
    toggleShowNotes,
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
      ref={rootRef}
      data-component="ReaderPage"
      className="fixed inset-0 z-40 flex flex-col animate-fadeIn"
      style={
        {
          background: theme.bg,
          color: theme.fg,
          touchAction: 'pan-y',
          '--reader-selection': theme.selection,
        } as CSSProperties
      }
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
          <div className="mt-4">
            <SuttaRowChips
              chips={suttaChips}
              hlCount={hlCount}
              theme={theme}
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
              activeWord={activeWord}
              focusUid={requestedSubUid}
            />
          ) : textError ? (
            <div className="flex flex-col items-center gap-3 font-sans text-sm text-center" style={{ padding: '24px 0' }}>
              <div style={{ color: theme.fg, opacity: 0.7 }}>Couldn't load this sutta. Check your connection and try again.</div>
              <button
                className="text-[13px] px-3 py-1.5 rounded-md hover:opacity-70"
                style={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
                onClick={retryText}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="font-sans text-sm opacity-50">Loading…</div>
          )}

          <div className="font-sans text-center" style={{ marginTop: 34, fontSize: 12.5, color: theme.dim }}>
            — end of excerpt —
          </div>
        </div>
      </div>

      {dict && (
        <DictionaryDock
          word={dict.word}
          gloss={dict.gloss}
          defs={dict.defs}
          theme={theme}
          fontSize={fs}
          onClose={closeDict}
          onPrev={() => goToAdjacentWord(-1)}
          onNext={() => goToAdjacentWord(1)}
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
            if (mobile && t === 'text') closeDict();
          }}
        />
      )}

      {pop && <HighlightPopup pop={pop} theme={theme} onPick={pick} onRemove={() => pick(null)} onStop={popStop} />}

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
