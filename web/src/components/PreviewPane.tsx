import { useRef } from 'react';
import { navigate } from '@reach/router';
import { BookOpen, PanelRightClose } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { useSuttaText } from '../hooks/useSuttaText';
import { useHighlightPopup } from '../hooks/useHighlightPopup';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { SegmentedText } from './SegmentedText';
import { HighlightPopup } from './HighlightPopup';
import { READER_FACES, READER_THEMES } from '../lib/theme';

interface PreviewPaneProps {
  selectedId?: string;
}

export function PreviewPane({ selectedId }: PreviewPaneProps) {
  const { corpus } = useCorpus();
  const { desktop, previewHidden, hidePreview } = useLayout();
  const { notes, setNote, highlights, membership, toggleMembership, visited } = useUserData();
  const { fs, lh, face, allPali } = useReaderPrefs();
  const segments = useSuttaText(selectedId);
  const sutta = corpus && selectedId ? corpus.suttas[selectedId] : undefined;
  const hlForSutta = (selectedId && highlights[selectedId]) || [];
  const { pop, onTextUp, pick, popStop, openPop } = useHighlightPopup(selectedId, hlForSutta);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useScrollMemory<HTMLDivElement>(selectedId ? `preview:${selectedId}` : null);

  if (!desktop || previewHidden) return null;

  const style = { flex: 1, minWidth: 300 };
  const theme = READER_THEMES.light;

  if (!sutta || !selectedId) {
    return (
      <aside className="flex flex-col h-full" style={style}>
        <div className="font-sans flex-1 flex items-center justify-center text-[13.5px] text-ink/45">Select a sutta</div>
      </aside>
    );
  }

  const chips = membership[selectedId] || [];

  return (
    <aside className="flex flex-col h-full" style={style}>
      <header className="font-sans flex-none flex items-center gap-4 pl-[34px] pr-[22px] py-[13px] border-b border-ink/10">
        <span className="flex-1 text-xs font-semibold tracking-[.02em] text-ink/60">
          {sutta.ref} · {sutta.min} min{visited[selectedId] ? ' · read' : ''}
        </span>
        <button
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink/65"
          onClick={() => {
            navigate(`/read/${encodeURIComponent(selectedId)}`);
          }}
        >
          <BookOpen size={14} strokeWidth={1.75} />
          Read
        </button>
        <button className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink/65" title="Close preview" onClick={hidePreview}>
          <PanelRightClose size={15} strokeWidth={1.75} />
          Close
        </button>
      </header>
      <div ref={scrollRef} className="sc flex-1 px-[34px] pt-[30px] pb-[60px]">
        <div className="text-[27px] font-semibold leading-[1.15] tracking-[-.015em] font-serif">{sutta.en}</div>
        <div className="text-[16px] mt-1 italic font-serif" style={{ color: '#8A6A3B' }}>
          {sutta.pali}
        </div>
        <div className="text-[15.5px] leading-[1.6] text-ink/[.72] mt-3">{sutta.blurb}</div>
        <div className="h-px bg-ink/[.14] my-[24px]" />
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
        <textarea
          ref={noteRef}
          value={notes[selectedId] || ''}
          onChange={(e) => setNote(selectedId, e.target.value)}
          placeholder="Add a note"
          rows={2}
          className="w-full border border-ink/[.22] rounded-field px-3 py-2.5 bg-field text-[15.5px] italic resize-y outline-none font-serif"
        />
        <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58] mt-[22px] mb-2">In lists</div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((label) => (
            <button
              key={label}
              className="inline-flex items-center whitespace-nowrap rounded-[11px] px-[10px] py-[3px] font-sans text-[11.5px] border border-accent bg-accent text-[#FBFAF7]"
              onClick={() => toggleMembership(selectedId, label)}
            >
              {label} ×
            </button>
          ))}
          <button
            className="inline-flex items-center whitespace-nowrap border border-dashed border-ink/[.35] rounded-[11px] px-[10px] py-[3px] font-sans text-[11.5px] text-ink/50"
            onClick={() => navigate(`/read/${encodeURIComponent(selectedId)}?panel=lists`)}
          >
            + add
          </button>
        </div>
      </div>
      {pop && <HighlightPopup pop={pop} theme={theme} onPick={pick} onRemove={() => pick(null)} onStop={popStop} />}
    </aside>
  );
}
