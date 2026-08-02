import { useMemo, useState } from 'react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { nodeLabel, searchCorpus, suttasFor } from '../lib/corpus';
import type { Sutta } from '../lib/types';

interface ListPaneProps {
  nodeId?: string;
  selectedId?: string;
  query: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}

export function ListPane({ nodeId, selectedId, query, onBack, onOpen }: ListPaneProps) {
  const { corpus } = useCorpus();
  const { lists, membership, notes, visited } = useUserData();
  const { mobile, desktop, twoPane, previewHidden, showPreview, paneW } = useLayout();
  const [sortAlpha, setSortAlpha] = useState(false);

  const searching = query.trim().length > 0;

  const items = useMemo<Array<[string, Sutta]>>(() => {
    if (!corpus) return [];
    if (searching) return searchCorpus(corpus, query, notes).map((h) => [h.id, h.sutta] as [string, Sutta]);
    if (!nodeId) return [];
    const list = lists.find((l) => String(l.id) === nodeId);
    let base: Array<[string, Sutta]>;
    if (list) {
      const memberIds = new Set(Object.entries(membership).filter(([, ls]) => ls.includes(list.label)).map(([id]) => id));
      base = Object.entries(corpus.suttas).filter(([id]) => memberIds.has(id));
    } else {
      base = suttasFor(corpus, nodeId);
    }
    if (sortAlpha) base = [...base].sort((a, b) => a[1].en.localeCompare(b[1].en));
    return base;
  }, [corpus, searching, query, notes, nodeId, lists, membership, sortAlpha]);

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
          <div className="text-[19px] font-semibold tracking-[-.01em] truncate">{title}</div>
          <div className="font-sans text-xs text-ink/[.42] mt-[2px]">{meta}</div>
        </div>
        {!searching && (
          <button className="font-sans text-[12.5px] font-medium text-ink/[.55]" onClick={() => setSortAlpha((s) => !s)}>
            {sortAlpha ? 'A–Z' : 'Order'}
          </button>
        )}
        {desktop && previewHidden && (
          <button
            className="font-sans text-[12.5px] font-medium text-ink/[.55] border border-ink/[.22] rounded-lg px-[9px] py-[3px]"
            onClick={showPreview}
          >
            Preview
          </button>
        )}
      </header>
      <div className="sc flex-1">
        {items.map(([id, s]) => {
          const on = desktop && !previewHidden && !twoPane && id === selectedId;
          const note = notes[id];
          const chips = membership[id] || [];
          return (
            <button
              key={id}
              className={`block w-full text-left px-5 py-[15px] border-b border-ink/[.08] ${on ? 'bg-ink text-[#FBFAF7]' : ''}`}
              onClick={() => onOpen(id)}
            >
              <span className="flex items-baseline gap-2.5">
                <span className={`font-sans text-[11.5px] font-bold tracking-[.02em] ${on ? 'opacity-65' : 'text-ink/60'}`}>{s.ref}</span>
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
