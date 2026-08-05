import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SegmentedText } from '../components/SegmentedText';
import { HighlightPopup } from '../components/HighlightPopup';
import { HighlightGutter } from '../components/HighlightGutter';
import { DictionaryDock } from '../components/DictionaryDock';
import { ReaderMenuPanel } from '../components/ReaderMenuPanel';
import { ReaderSearchOverlay } from '../components/ReaderSearchOverlay';

interface DictState {
  word: string;
  gloss: string;
  body: string;
}

export function ReaderPage({ suttaId, location }: RouteComponentProps<{ suttaId: string }>) {
  const { corpus, dictionary } = useCorpus();
  const { notes, membership, lists, markVisited } = useUserData();
  const { theme: themeId, fs, lh, face, allPali } = useReaderPrefs();

  const initialPanelTab = new URLSearchParams(location?.search).get('panel') as 'highlights' | 'lists' | 'text' | null;
  const [openSegs, setOpenSegs] = useState<Record<number, boolean>>({});
  const [dict, setDict] = useState<DictState | null>(null);
  const [panel, setPanel] = useState(!!initialPanelTab);
  const [tab, setTab] = useState<'highlights' | 'lists' | 'text'>(initialPanelTab || 'highlights');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 860);
  const tapRef = useRef<{ x: number; y: number } | null>(null);

  const sutta = corpus && suttaId ? corpus.suttas[suttaId] : undefined;
  const {
    segments,
    hlForSutta,
    highlightGroups,
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

  const theme = READER_THEMES[themeId];

  useEffect(() => {
    if (suttaId) markVisited(suttaId);
    setOpenSegs({});
    setDict(null);
  }, [suttaId, markVisited]);

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
    if (next && next !== suttaId) navigate(`/read/${encodeURIComponent(next)}`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While the search overlay is open, it owns every key itself (see its own onKeyDown) —
      // bail out before even the input/textarea tag check below, since a click on a result row
      // (not the input) would otherwise let these fall through to the reader's own shortcuts.
      if (searchOpen) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        if (dict) setDict(null);
        else if (panel) setPanel(false);
        else closeReader();
      } else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setTab('highlights');
        setPanel(true);
      } else if (e.key.toLowerCase() === 'l') {
        // Without this, the same keypress that opens the panel also lands in the Lists tab's
        // now-focused filter input (it autoFocuses — see ListMembershipPicker) since nothing
        // stopped the browser's own default text-insertion behavior for this key.
        e.preventDefault();
        setTab('lists');
        setPanel(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dict, panel, searchOpen, siblingIds, suttaId]);

  function jumpToHighlight(segIndex: number) {
    setPanel(false);
    requestAnimationFrame(() => scrollToSegment(segIndex));
  }

  function closeReader() {
    if (sutta) navigate(`/browse/${sutta.node}/${suttaId}`);
    else navigate('/');
  }

  function onSearchOpenSutta(id: string) {
    setSearchOpen(false);
    navigate(`/read/${encodeURIComponent(id)}`);
  }

  function onWordClick(raw: string) {
    if (!dictionary) return;
    const word = raw.replace(/[.,;:""''"'?!—]/g, '');
    const def = lookupWord(dictionary, raw);
    setDict({
      word,
      gloss: def ? `${def.length} sense${def.length > 1 ? 's' : ''} · DPD` : 'Pali',
      body: def ? def.join('<br/>') : 'No entry in the offline dictionary for this form. Try the stem, or search the full lexicon.',
    });
  }

  function onReaderPointerDown(e: React.PointerEvent) {
    tapRef.current = { x: e.clientX, y: e.clientY };
  }
  function onReaderPointerUp(e: React.PointerEvent) {
    const start = tapRef.current;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (e.pointerType === 'touch' && moved > 70 && Math.abs(e.clientY - start.y) < 60) {
      step(e.clientX < start.x ? 1 : -1);
      return;
    }
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
      data-component="ReaderPage"
      className="fixed inset-0 z-40 flex flex-col animate-fadeIn"
      style={{ background: theme.bg, color: theme.fg }}
      onPointerDown={onReaderPointerDown}
      onPointerUp={onReaderPointerUp}
    >
      <header className="font-sans flex-none flex items-center gap-4 px-5 py-3 text-[13px]" style={{ borderBottom: `1px solid ${theme.rule}` }}>
        <button className="flex items-center" title="Close" onClick={closeReader}>
          <X size={15} strokeWidth={1.75} />
        </button>
        <span className="flex-1 text-center opacity-75 font-serif">{mobile ? sutta.ref : `${sutta.ref} · ${sutta.pali}`}</span>
        <button
          className="flex items-center gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            setTab('highlights');
            setPanel(true);
          }}
        >
          <MenuIcon size={15} strokeWidth={1.75} />
          Menu
        </button>
      </header>

      <div ref={scrollRef} className="sc flex-1" style={{ padding: '44px 22px 120px' }}>
        <div style={{ maxWidth: measureWidth, margin: '0 auto' }}>
          {breadcrumb.length > 0 && (
            <nav className="font-sans flex flex-wrap items-center gap-1" style={{ fontSize: 12, marginBottom: 7, color: theme.dim }}>
              {breadcrumb.map((b, i) => (
                <span key={b.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={11} strokeWidth={2} />}
                  <button className="hover:underline" onClick={() => navigate(`/browse/${encodeURIComponent(b.id)}`)}>
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
          {(suttaLists.length > 0) && (
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
            </div>
          )}
          <div className="font-sans" style={{ fontSize: 12, marginTop: 9, color: theme.dim }}>
            {sutta.ref} · {sutta.min} min
          </div>
          <div style={{ height: 1, background: theme.rule, margin: '20px 0 22px' }} />

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
              onToggleSeg={(i) => setOpenSegs((s) => ({ ...s, [i]: !s[i] }))}
              onWordClick={onWordClick}
              onTextUp={onTextUp}
              onSpanClick={(i, s, e, rect, color) => openPop(i, s, e, rect, color)}
            />
          ) : (
            <div className="font-sans text-sm opacity-50">Loading…</div>
          )}

          <div className="font-sans text-center" style={{ marginTop: 34, fontSize: 12.5, color: theme.dim }}>
            — end of excerpt —
          </div>
        </div>
      </div>

      {dict && <DictionaryDock word={dict.word} gloss={dict.gloss} body={dict.body} theme={theme} onClose={() => setDict(null)} />}

      {panel && (
        <ReaderMenuPanel
          suttaId={suttaId}
          mobile={mobile}
          theme={theme}
          initialTab={tab}
          segments={segments}
          onClose={() => setPanel(false)}
          onJumpToHighlight={jumpToHighlight}
        />
      )}

      {pop && <HighlightPopup pop={pop} theme={theme} onPick={pick} onRemove={() => pick(null)} onStop={popStop} />}

      {!panel && (
        <HighlightGutter
          scrollRef={scrollRef}
          highlightGroups={highlightGroups}
          onJump={jumpToHighlight}
          layoutKey={`${fs}-${lh}-${face}-${allPali}`}
        />
      )}

      {searchOpen && <ReaderSearchOverlay theme={theme} onOpenSutta={onSearchOpenSutta} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
