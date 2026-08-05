import { useEffect, useState } from 'react';
import { navigate } from '@reach/router';
import { BookOpen, Eye, PanelRightClose, ChevronRight } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useSuttaReading } from '../hooks/useSuttaReading';
import { breadcrumbFor } from '../lib/corpus';
import { SegmentedText } from './SegmentedText';
import { HighlightPopup } from './HighlightPopup';
import { HighlightGutter } from './HighlightGutter';
import { NoteEditor } from './NoteEditor';
import { ListMembershipPicker } from './ListMembershipPicker';
import { flattenListTree, resolveListById } from '../lib/lists';
import { AUTO_LIST_IDS } from '../lib/autoLists';
import { READER_FACES, READER_THEMES } from '../lib/theme';

interface PreviewPaneProps {
  selectedId?: string;
}

export function PreviewPane({ selectedId }: PreviewPaneProps) {
  const { corpus } = useCorpus();
  const { desktop, previewHidden, hidePreview } = useLayout();
  const { notes, submitNote, membership, lists, visited } = useUserData();
  const { fs, lh, face, allPali } = useReaderPrefs();
  const [showListPicker, setShowListPicker] = useState(false);
  useEffect(() => setShowListPicker(false), [selectedId]);
  const sutta = corpus && selectedId ? corpus.suttas[selectedId] : undefined;
  const {
    segments,
    hlForSutta,
    highlightGroups,
    hlCounts,
    scrollRef,
    scrollToSegment: jumpToHighlight,
    pop,
    onTextUp,
    pick,
    popStop,
    openPop,
  } = useSuttaReading(selectedId, 'preview');

  if (!desktop || previewHidden) return null;

  const style = { flex: 1, minWidth: 300 };
  const theme = READER_THEMES.light;

  if (!sutta || !selectedId) {
    return (
      <aside data-component="PreviewPane" className="flex flex-col h-full" style={style}>
        <div className="font-sans flex-1 flex items-center justify-center text-[13.5px] text-ink/45">Select a sutta</div>
      </aside>
    );
  }

  const flatLists = flattenListTree(lists);
  const breadcrumbForId = (id: string) => resolveListById(id, flatLists).breadcrumb;
  // Where this sutta lives in the browse tree, shown above the title — see the matching
  // comment in ReaderPage.tsx.
  const corpusBreadcrumb = corpus ? breadcrumbFor(corpus, sutta.node) : [];
  // "Highlights"/"Notes" membership is redundant here — the highlight-count circles and note
  // text above already say as much — so, like ListPane and the reader, the auto lists are
  // excluded from the chip row entirely.
  const chips = (membership[selectedId] || []).filter((id) => !AUTO_LIST_IDS.has(id));

  return (
    <aside className="flex flex-col h-full" style={style}>
      <header className="font-sans flex-none flex items-center gap-4 pl-[34px] pr-[22px] py-[13px] border-b border-ink/10">
        <button className="flex items-center text-ink/65" aria-label="Collapse preview" title="Collapse preview" onClick={hidePreview}>
          <PanelRightClose size={15} strokeWidth={1.75} />
        </button>
        <span className="text-xs font-semibold tracking-[.02em] text-ink/60">
          {sutta.ref} · {sutta.min} min{visited[selectedId] ? ' · read' : ''}
        </span>
        <button
          className="ml-auto font-sans flex items-center gap-2 px-[18px] py-[11px] rounded-full bg-accent text-[#FBFAF7] text-[14px] font-semibold shadow-[0_1px_2px_rgba(27,25,23,.15)] hover:brightness-110 active:brightness-95"
          onClick={() => {
            // The current URL already *is* this pane/nodeId/selection (that's what makes the
            // preview pane show at all) — reusing it as `from` sends the reader's close button
            // back to exactly this spot instead of the sutta's bare corpus location.
            navigate(`/read/${encodeURIComponent(selectedId)}`, { state: { from: window.location.pathname } });
          }}
        >
          <BookOpen size={16} strokeWidth={2} />
          Open
        </button>
      </header>
      <div ref={scrollRef} className="sc flex-1 px-[34px] pt-[30px] pb-[60px]">
        {corpusBreadcrumb.length > 0 && (
          <nav className="font-sans flex flex-wrap items-center gap-1 text-[11.5px] text-ink/45 mb-2">
            {corpusBreadcrumb.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={10} strokeWidth={2} />}
                <button className="hover:underline hover:text-ink/70" onClick={() => navigate(`/browse/${encodeURIComponent(b.id)}`)}>
                  {b.label}
                </button>
              </span>
            ))}
          </nav>
        )}
        <div className="text-[27px] font-semibold leading-[1.15] tracking-[-.015em] font-serif">{sutta.en}</div>
        <div className="text-[16px] mt-1 italic font-serif" style={{ color: '#8A6A3B' }}>
          {sutta.pali}
        </div>
        {sutta.blurb && <div className="italic text-[15.5px] leading-[1.6] text-ink/[.72] mt-3">{sutta.blurb}</div>}
        {notes[selectedId] && (
          <div className="text-[15.5px] leading-[1.6] text-ink/[.72] mt-2 pl-[10px] border-l-2 border-ink/30">{notes[selectedId]}</div>
        )}
        {(hlCounts.length > 0 || chips.length > 0) && (
          <div className="flex flex-wrap items-center gap-[6px] mt-3">
            {hlCounts.map(({ c, count }) => (
              <span
                key={c}
                className="inline-flex items-center justify-center h-5 rounded-full font-sans text-[11px] font-extrabold"
                style={{ background: c, color: '#000', minWidth: 20, padding: '0 5px' }}
              >
                {count}
              </span>
            ))}
            {chips.map((id) => (
              <span
                key={id}
                className="inline-flex items-center h-5 whitespace-nowrap rounded-full px-[10px] font-sans text-[11px] border border-ink/[.25] text-ink/70"
              >
                {breadcrumbForId(id)}
              </span>
            ))}
          </div>
        )}
        <div className="h-px bg-ink/[.14] mt-[28px] mb-[24px]" />
        {segments ? (
          <SegmentedText
            segments={segments}
            highlights={hlForSutta}
            theme={theme}
            fontSize={fs - 1}
            lineHeight={lh}
            face={READER_FACES[face]}
            openSegs={{}}
            allPali={allPali}
            onToggleSeg={() => {}}
            onWordClick={() => {}}
            onTextUp={onTextUp}
            onSpanClick={(i, s, e, rect, color) => openPop(i, s, e, rect, color)}
          />
        ) : (
          <div className="font-sans text-[13px] text-ink/40">Loading…</div>
        )}
        <div className="font-sans text-center text-[12.5px] text-ink/40 my-[26px]">— end of excerpt —</div>
        <div className="h-px bg-ink/[.14] mb-[22px]" />
        <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mb-[7px]">Note</div>
        <NoteEditor
          value={notes[selectedId] || ''}
          onSubmit={(text) => submitNote(selectedId, text)}
          placeholder="Add a note — return to save, shift+return for a new line"
          textareaClassName="w-full border border-ink/[.22] rounded-field px-3 py-2.5 bg-field text-[15.5px] resize-y outline-none font-serif"
          saveButtonClassName="mt-1.5 font-sans text-[11.5px] font-semibold px-2 py-[3px] rounded border border-ink/[.22] text-ink/70"
        />
        <div className="flex items-center justify-between mt-[22px] mb-2">
          <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">In lists</div>
          <button
            className="font-sans text-[11.5px] text-ink/50 hover:text-ink/70"
            onClick={() => setShowListPicker((v) => !v)}
          >
            {showListPicker ? 'Done' : '+ add'}
          </button>
        </div>
        {showListPicker ? (
          <ListMembershipPicker suttaId={selectedId} theme={theme} autoFocus onRequestClose={() => setShowListPicker(false)} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((id) => (
              <span
                key={id}
                className="inline-flex items-center h-5 whitespace-nowrap rounded-[11px] px-[10px] font-sans text-[11.5px] border border-ink/[.25] text-ink/70"
              >
                {breadcrumbForId(id)}
              </span>
            ))}
            {chips.length === 0 && <div className="font-sans text-[13px] text-ink/40">Not in any lists yet.</div>}
          </div>
        )}
      </div>
      {pop && <HighlightPopup pop={pop} theme={theme} onPick={pick} onRemove={() => pick(null)} onStop={popStop} />}
      <HighlightGutter
        scrollRef={scrollRef}
        highlightGroups={highlightGroups}
        onJump={jumpToHighlight}
        layoutKey={`${fs}-${lh}-${face}-${allPali}`}
      />
    </aside>
  );
}
