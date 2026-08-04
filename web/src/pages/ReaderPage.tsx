import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { X, Menu as MenuIcon } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useSuttaText } from '../hooks/useSuttaText';
import { useHighlightPopup } from '../hooks/useHighlightPopup';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { flatSuttaOrder } from '../lib/corpus';
import { groupHighlights } from '../lib/highlights';
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
  const { highlights, notes, markVisited } = useUserData();
  const { theme: themeId, fs, lh, face, allPali } = useReaderPrefs();

  const initialPanelTab = new URLSearchParams(location?.search).get('panel') as 'highlights' | 'lists' | 'text' | null;
  const [openSegs, setOpenSegs] = useState<Record<number, boolean>>({});
  const [dict, setDict] = useState<DictState | null>(null);
  const [panel, setPanel] = useState(!!initialPanelTab);
  const [tab, setTab] = useState<'highlights' | 'lists' | 'text'>(initialPanelTab || 'highlights');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 860);
  const tapRef = useRef<{ x: number; y: number } | null>(null);

  const segments = useSuttaText(suttaId);
  const sutta = corpus && suttaId ? corpus.suttas[suttaId] : undefined;
  const hlForSutta = (suttaId && highlights[suttaId]) || [];
  const { pop, onTextUp, pick, close: closePop, popStop, openPop } = useHighlightPopup(suttaId, hlForSutta);
  const scrollRef = useScrollMemory<HTMLDivElement>(suttaId ? `reader:${suttaId}` : null);
  const highlightGroups = useMemo(() => groupHighlights(hlForSutta, segments), [hlForSutta, segments]);

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
        setTab('highlights');
        setPanel(true);
      } else if (e.key.toLowerCase() === 'l') {
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
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-seg="${segIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
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
          <h1 className="font-serif" style={{ margin: 0, fontSize: Math.round(fs * 1.72), fontWeight: 600, lineHeight: 1.12, letterSpacing: '-.015em' }}>
            {sutta.en}
          </h1>
          <div className="font-serif italic" style={{ fontSize: fs - 2, marginTop: 5, color: theme.dim }}>
            {sutta.pali}
          </div>
          {(notes[suttaId] || sutta.blurb) && (
            <div
              className={notes[suttaId] ? 'pl-[10px]' : 'italic'}
              style={{
                fontSize: fs - 4,
                lineHeight: 1.6,
                marginTop: 11,
                color: theme.fg,
                opacity: 0.72,
                borderLeft: notes[suttaId] ? `2px solid ${theme.rule}` : undefined,
              }}
            >
              {notes[suttaId] || sutta.blurb}
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
