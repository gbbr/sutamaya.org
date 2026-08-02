import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '@reach/router';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useLayout } from '../context/LayoutContext';
import { findNode, isExpandable, searchCorpus } from '../lib/corpus';

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  onSearch: (query: string) => void;
  query: string;
}

export function TreePane({ nodeId, onSelect, onSearch, query }: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, notes, createList } = useUserData();
  const { mobile, desktop, paneW, hideTree } = useLayout();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (corpus && nodeId) {
      const found = findNode(corpus, nodeId);
      if (found?.kind === 'chapter') init[found.parent.id] = true;
    }
    return init;
  });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const listInput = useRef<HTMLInputElement>(null);

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (corpus && searching ? searchCorpus(corpus, query, notes) : []), [corpus, query, searching, notes]);

  if (!corpus) return null;

  const style = mobile
    ? { flex: 1 }
    : { flex: 'none', width: paneW.tree, background: '#F0ECE4' };

  async function submitDraft() {
    const name = draft.trim();
    setCreating(false);
    setDraft('');
    if (!name) return;
    const list = await createList(name);
    navigate(`/browse/${list.id}`);
  }

  function onDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDraft();
    } else if (e.key === 'Escape') {
      setCreating(false);
      setDraft('');
    }
  }

  return (
    <aside className="flex flex-col h-full min-w-0 border-r border-ink/10" style={style}>
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-baseline gap-2.5 mb-3">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1">Sutamaya</div>
          {desktop && (
            <button className="font-sans text-xs font-medium text-ink/55" onClick={() => hideTree()}>
              Hide
            </button>
          )}
          {mobile && (
            <div className="font-sans flex gap-3.5 text-[13px] font-medium text-ink/[.62]">
              <button onClick={() => navigate('/settings')}>Settings</button>
            </div>
          )}
        </div>
        <input
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search ID, title, blurb, note, text"
          className="w-full h-[38px] border border-ink/[.22] rounded-field px-3 bg-field text-[14.5px] outline-none"
        />
      </header>

      <div className="sc flex-1 py-2.5 pb-6">
        {searching ? (
          <div>
            <div className="px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">
              {hits.length} {hits.length === 1 ? 'result' : 'results'}
            </div>
            {hits.map(({ id, sutta }) => (
              <button
                key={id}
                className="row flex flex-col w-full text-left gap-[1px] px-[18px] py-[11px] border-b border-ink/[.07]"
                onClick={() => onSelect(id)}
              >
                <span className="flex items-baseline gap-2.5">
                  <span className="font-sans text-[11.5px] font-bold text-ink/60">{sutta.ref}</span>
                  <span className="flex-1 text-[16px] font-semibold leading-[1.3]">{sutta.en}</span>
                </span>
                <span className="font-serif text-[13.5px] italic text-accent">{sutta.pali}</span>
              </button>
            ))}
            {hits.length === 0 && (
              <div className="font-sans text-center text-[13px] text-ink/40 py-[30px] px-5">No matches.</div>
            )}
          </div>
        ) : (
          <div>
            <div className="px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">Browse</div>
            {corpus.nikayas.map((n) => {
              const open = !!expanded[n.id];
              const expandableNode = isExpandable(n);
              return (
                <div key={n.id}>
                  <button
                    className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[11px] border-b border-ink/[.07] ${nodeId === n.id ? 'bg-ink/[.06]' : ''}`}
                    onClick={() => (expandableNode ? setExpanded((x) => ({ ...x, [n.id]: !open })) : onSelect(n.id))}
                  >
                    <span className="w-[11px] flex-none font-sans text-sm text-ink/40">{expandableNode ? (open ? '–' : '+') : ''}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-semibold leading-[1.3]">{n.label}</span>
                      <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{n.sub}</span>
                    </span>
                    <span className="font-sans text-[11.5px] font-medium text-ink/50">{n.count}</span>
                  </button>
                  {expandableNode && open && n.chapters!.map((c) => (
                    <button
                      key={c.id}
                      className={`row flex items-center gap-[11px] w-full text-left pl-10 pr-[18px] py-[11px] text-[15px] border-b border-ink/[.07] ${nodeId === c.id ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => onSelect(c.id)}
                    >
                      <span className="flex-1 min-w-0 font-semibold leading-[1.3]">{c.label}</span>
                      <span className="font-sans text-[11.5px] font-medium text-ink/50">{c.count}</span>
                    </button>
                  ))}
                </div>
              );
            })}

            <div className="flex items-center justify-between px-[18px] pt-[22px] pb-1">
              <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">My lists</span>
              <button
                className="plus w-[22px] h-[22px] border border-ink/[.28] rounded-md flex items-center justify-center text-[15px] leading-none text-ink/50"
                onClick={() => {
                  setCreating((c) => !c);
                  setDraft('');
                  setTimeout(() => listInput.current?.focus(), 30);
                }}
              >
                +
              </button>
            </div>
            {creating && (
              <div className="px-[18px] pt-1.5 pb-2">
                <input
                  ref={listInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onDraftKey}
                  onBlur={() => setCreating(false)}
                  placeholder="List name — return to create"
                  className="w-full h-[34px] border border-accent rounded-lg px-2.5 bg-field text-[14.5px] outline-none"
                />
              </div>
            )}
            {lists.map((l) => (
              <button
                key={l.id}
                className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[11px] border-b border-ink/[.07] ${nodeId === String(l.id) ? 'bg-ink/[.06]' : ''}`}
                onClick={() => onSelect(String(l.id))}
              >
                <span className="w-[11px] flex-none" />
                <span className="flex-1 min-w-0 text-[16px] font-semibold">{l.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {desktop && (
        <footer className="font-sans flex-none flex justify-between px-[18px] py-[13px] border-t border-ink/10 text-[13px] text-ink/50">
          <button onClick={() => navigate('/settings')}>Settings</button>
        </footer>
      )}

    </aside>
  );
}
