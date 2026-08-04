import { useEffect, useMemo, useRef } from 'react';
import { Eye } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { listItemsFor, nodeLabel } from '../lib/corpus';

interface ListPaneProps {
  nodeId?: string;
  selectedId?: string;
  query: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onOpenReader: (id: string) => void;
  activeIndex: number;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

export function ListPane({ nodeId, selectedId, query, onBack, onOpen, onOpenReader, activeIndex, visible = true }: ListPaneProps) {
  const { corpus } = useCorpus();
  const { lists, membership, notes, visited } = useUserData();
  const { mobile, desktop, twoPane, previewHidden, showPreview, paneW } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>(`list:${query.trim() ? 'search' : nodeId || 'none'}`, visible);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const searching = query.trim().length > 0;

  const items = useMemo(
    () => (corpus ? listItemsFor(corpus, nodeId, query, notes, lists, membership) : []),
    [corpus, nodeId, query, notes, lists, membership]
  );

  useEffect(() => {
    if (activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!corpus) return null;

  const title = searching ? 'Search' : nodeLabel(corpus, nodeId || '', lists);
  const readCount = items.filter(([id]) => visited[id]).length;
  const meta = searching ? `${items.length} results` : `${items.length} suttas · ${readCount} read`;

  const style = mobile
    ? { flex: 1 }
    : desktop && !previewHidden
      ? { flex: 'none' as const, width: paneW.list, background: '#F8F6F2' }
      : { flex: 1, background: '#F8F6F2' };

  return (
    <section className={`flex flex-col h-full min-w-0 ${!mobile && desktop && !previewHidden ? 'border-r border-ink/10' : ''}`} style={style}>
      <header className="flex-none flex items-baseline gap-3 px-5 pt-4 pb-3.5 border-b border-ink/10">
        {mobile && (
          <button className="font-sans text-[13px] text-ink/50" onClick={onBack}>
            Back
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-sans text-[19px] font-semibold tracking-[-.01em] truncate">{title}</div>
          <div className="font-sans text-xs text-ink/[.42] mt-[2px]">{meta}</div>
        </div>
        {desktop && previewHidden && (
          <button
            className="flex items-center justify-center text-ink/[.55] border border-ink/[.22] rounded-lg w-7 h-7"
            title="Preview"
            onClick={showPreview}
          >
            <Eye size={14} strokeWidth={1.75} />
          </button>
        )}
      </header>
      <div ref={scrollRef} className="sc flex-1">
        {items.map(([id, s], i) => {
          const on = desktop && !previewHidden && !twoPane && id === selectedId;
          const focused = i === activeIndex;
          const note = notes[id];
          const chips = membership[id] || [];
          return (
            <button
              key={id}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className={`block w-full text-left px-5 py-[13px] border-b border-ink/[.08] ${on ? 'bg-accent text-[#FBFAF7]' : ''} ${focused && !on ? 'bg-ink/[.05]' : ''}`}
              style={focused ? { boxShadow: `inset 2px 0 0 ${on ? 'rgba(251,250,247,.6)' : '#8A6A3B'}` } : undefined}
              onClick={() => onOpen(id)}
              onDoubleClick={() => onOpenReader(id)}
            >
              <span className="flex items-baseline gap-2.5">
                <span className={`font-sans text-[14.5px] font-bold tracking-[.02em] ${on ? 'opacity-65' : 'text-ink/60'}`}>{s.ref}</span>
                <span className="flex-1 text-[16.5px] leading-[1.3] font-serif">{s.en}</span>
                {visited[id] && <span className={`font-sans text-[11px] ${on ? 'opacity-45' : 'text-ink/[.28]'}`}>read</span>}
              </span>
              <span className={`block font-serif text-[13.5px] italic mt-[1px] ${on ? 'opacity-75' : 'text-accent'}`}>{s.pali}</span>
              {note ? (
                <span
                  className="block font-serif text-[14.5px] italic leading-[1.45] mt-[7px] pl-[10px] border-l-2"
                  style={{ borderColor: on ? 'rgba(251,250,247,.5)' : 'rgba(27,25,23,.3)' }}
                >
                  {note}
                </span>
              ) : (
                <span className={`block text-[14px] leading-[1.5] mt-1.5 ${on ? 'opacity-80' : 'text-ink/[.72]'}`}>{s.blurb}</span>
              )}
              {chips.length > 0 && (
                <span className="flex flex-wrap gap-1.5 mt-2">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center whitespace-nowrap leading-[1.4] rounded-[10px] px-[9px] py-[2px] font-sans text-[11px] border"
                      style={{ borderColor: on ? 'rgba(251,250,247,.45)' : 'rgba(27,25,23,.25)' }}
                    >
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="font-sans text-center text-[13.5px] text-ink/40 py-10 px-5">
            {searching ? `Nothing matches "${query}".` : 'Nothing here yet.'}
          </div>
        )}
      </div>
    </section>
  );
}
