import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '@reach/router';
import { PanelLeftClose, Settings, ChevronRight, ChevronDown, LogIn } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { SEARCH_INPUT_ID } from '../hooks/useListNav';
import { findNode, isExpandable, searchCorpus } from '../lib/corpus';

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  onOpenSutta: (suttaId: string) => void;
  onSearch: (query: string) => void;
  query: string;
  activeIndex: number;
}

export function TreePane({ nodeId, onSelect, onOpenSutta, onSearch, query, activeIndex }: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, notes, createList } = useUserData();
  const { user, promptGoogleSignIn } = useAuth();
  const { mobile, desktop, paneW, hideTree } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>('tree');
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
  const [searchFocused, setSearchFocused] = useState(false);
  const listInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (corpus && searching ? searchCorpus(corpus, query, notes) : []), [corpus, query, searching, notes]);

  useEffect(() => {
    if (searching && activeIndex >= 0) hitRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, searching]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!corpus) return null;

  const style = mobile
    ? { flex: 1 }
    : { flex: 'none', width: paneW.tree, background: '#F0ECE4' };

  async function submitDraft() {
    const name = draft.trim();
    setCreating(false);
    setDraft('');
    if (!name) return;
    try {
      const list = await createList(name);
      navigate(`/browse/${list.id}`);
    } catch {
      // Signed out: createList() already triggered the Google sign-in prompt.
    }
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

  const signedInBadge = user ? (
    <button
      className="flex-none w-[22px] h-[22px] rounded-full overflow-hidden border border-ink/[.18] flex items-center justify-center bg-accent/15 font-sans text-[10px] font-semibold text-accent"
      title={`Signed in as ${user.email}`}
      onClick={() => navigate('/settings')}
    >
      {user.picture ? (
        <img src={user.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        user.email[0]?.toUpperCase()
      )}
    </button>
  ) : (
    <button
      className="flex-none w-[22px] h-[22px] rounded-full border border-ink/[.18] flex items-center justify-center text-ink/45 hover:bg-ink/[.06]"
      title="Sign in with Google"
      onClick={promptGoogleSignIn}
    >
      <LogIn size={12} strokeWidth={1.75} />
    </button>
  );

  return (
    <aside className="flex flex-col h-full min-w-0 border-r border-ink/10" style={style}>
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-baseline gap-2.5 mb-3">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1">Sutamaya</div>
          {desktop && (
            <button
              className="flex-none w-7 h-7 flex items-center justify-center rounded-md text-ink/55 hover:bg-ink/[.06]"
              title="Hide browse pane"
              onClick={() => hideTree()}
            >
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </button>
          )}
          {mobile && (
            <div className="flex items-center gap-3.5">
              {signedInBadge}
              <div className="font-sans flex gap-3.5 text-[13px] font-medium text-ink/[.62]">
                <button className="flex items-center gap-1.5" onClick={() => navigate('/settings')}>
                  <Settings size={14} strokeWidth={1.75} />
                  Settings
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="relative">
          <input
            id={SEARCH_INPUT_ID}
            ref={searchInput}
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search ID, title, blurb, note, text"
            className="w-full h-[38px] border border-ink/[.22] rounded-field pl-3 pr-8 bg-field text-[14.5px] outline-none"
          />
          {!searchFocused && !query && (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-[11px] text-ink/35 border border-ink/20 rounded px-[5px] leading-[16px]">
              /
            </kbd>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="sc flex-1 py-2.5 pb-6">
        {searching ? (
          <div>
            <div className="px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">
              {hits.length} {hits.length === 1 ? 'result' : 'results'}
            </div>
            {hits.map(({ id, sutta }, i) => (
              <button
                key={id}
                ref={(el) => {
                  hitRefs.current[i] = el;
                }}
                className={`row flex flex-col w-full text-left gap-[1px] px-[18px] py-[11px] border-b border-ink/[.07] ${i === activeIndex ? 'bg-ink/[.06]' : ''}`}
                onClick={() => onOpenSutta(id)}
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
                    <span className="w-[11px] flex-none flex items-center justify-center text-ink/40">
                      {expandableNode ? open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} /> : ''}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-semibold leading-[1.3]">{n.label}</span>
                      <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{n.sub}</span>
                    </span>
                    <span className="font-sans text-[11.5px] font-medium text-ink/50">{n.count}</span>
                  </button>
                  {expandableNode && open && n.chapters!.map((c) => (
                    <button
                      key={c.id}
                      className={`row flex items-start gap-[9px] w-full text-left pl-8 pr-[18px] py-[11px] border-b border-ink/[.07] ${nodeId === c.id ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => onSelect(c.id)}
                    >
                      <ChevronRight size={12} strokeWidth={2} className="flex-none mt-[4px] text-ink/35" />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className="font-sans text-[11px] font-bold text-ink/45">{c.ref}</span>
                          <span className="flex-1 text-[15px] font-semibold leading-[1.3]">{c.label}</span>
                        </span>
                        {c.sub && <span className="block font-serif text-[13px] italic text-accent mt-[1px]">{c.sub}</span>}
                        <span className="block font-sans text-[11px] text-ink/45 mt-[2px]">
                          {c.count} sutta{c.count === 1 ? '' : 's'}
                        </span>
                      </span>
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
          <button className="flex items-center gap-1.5" onClick={() => navigate('/settings')}>
            <Settings size={14} strokeWidth={1.75} />
            Settings
          </button>
          {signedInBadge}
        </footer>
      )}

    </aside>
  );
}
