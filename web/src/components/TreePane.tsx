import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { navigate } from '@reach/router';
import { PanelLeftClose, Settings, ChevronRight, ChevronDown } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { SEARCH_INPUT_ID } from '../hooks/useListNav';
import { findNode, isExpandable, searchCorpus } from '../lib/corpus';
import type { ChapterRow, Corpus } from '../lib/types';

// One row of the nested chapter/group/category tree under a nikaya — recurses arbitrarily
// deep (SN: group > chapter > category; AN: chapter > category; MN: category directly).
function TreeRow({
  node,
  depth,
  nodeId,
  expanded,
  onToggle,
  onSelect,
}: {
  node: ChapterRow;
  depth: number;
  nodeId?: string;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const expandable = isExpandable(node);
  const open = !!expanded[node.id];
  return (
    <div>
      <button
        className={`row flex items-start gap-[9px] w-full text-left pr-[18px] py-[9px] border-b border-ink/[.07] ${nodeId === node.id ? 'bg-ink/[.06]' : ''}`}
        style={{ paddingLeft: 18 + depth * 14 }}
        onClick={() => (expandable ? onToggle(node.id) : onSelect(node.id))}
      >
        <span className="w-[11px] flex-none flex items-center justify-center text-ink/40 mt-[4px]">
          {expandable ? (
            open ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )
          ) : (
            <ChevronRight size={12} strokeWidth={2} className="text-ink/35" />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="font-sans text-[13px] font-bold text-ink/45">{node.ref}</span>
            <span className="flex-1 text-[15px] font-semibold leading-[1.3]">{node.label}</span>
          </span>
          {node.sub && <span className="block font-serif text-[13px] italic text-accent mt-[1px]">{node.sub}</span>}
          <span className="block font-sans text-[13px] text-ink/45 mt-[2px]">
            {node.count} sutta{node.count === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      {expandable &&
        open &&
        node.chapters!.map((c) => (
          <TreeRow key={c.id} node={c} depth={depth + 1} nodeId={nodeId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
        ))}
    </div>
  );
}

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  onOpenSutta: (suttaId: string) => void;
  onSearch: (query: string) => void;
  query: string;
  activeIndex: number;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

// The set of ancestor ids (nikaya > group > chapter > category, as deep as it goes) that need
// to be open for `nodeId` to be visible in the tree.
function ancestorsOf(corpus: Corpus | null, nodeId: string | undefined): Record<string, boolean> {
  if (!corpus || !nodeId) return {};
  const found = findNode(corpus, nodeId);
  if (found?.kind !== 'chapter' || !found.ancestors.length) return {};
  const init: Record<string, boolean> = {};
  for (const a of found.ancestors) init[a.id] = true;
  return init;
}

export function TreePane({ nodeId, onSelect, onOpenSutta, onSearch, query, activeIndex, visible = true }: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, notes, createList } = useUserData();
  const { user, promptGoogleSignIn } = useAuth();
  const { mobile, desktop, paneW, hideTree } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>('tree', visible);
  // Computed synchronously on mount (not via an effect) so the tree is *already* expanded to
  // nodeId by the very first render — otherwise useScrollMemory's restore (a layout effect,
  // which always runs before any passive effect) would fire against a still-collapsed tree
  // whenever TreePane mounts fresh already pointed at a deep node (e.g. LibraryPage remounting
  // after the reader closes, on desktop where it's always "visible" so that restore-on-visible
  // fallback never kicks in either), silently clamping the restored scroll offset back to 0.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ancestorsOf(corpus, nodeId));
  const [libraryOpen, setLibraryOpen] = useState(true);

  // Expands every ancestor level of the current node whenever nodeId *changes* after mount —
  // covers deep links and search-driven navigation within an already-mounted TreePane, without
  // collapsing anything the user already had open.
  useEffect(() => {
    const toOpen = ancestorsOf(corpus, nodeId);
    if (!Object.keys(toOpen).length) return;
    setExpanded((x) => {
      let changed = false;
      const next = { ...x };
      for (const id of Object.keys(toOpen)) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : x;
    });
  }, [corpus, nodeId]);

  function toggleExpanded(id: string) {
    setExpanded((x) => ({ ...x, [id]: !x[id] }));
  }
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
    // Google's own rendered "icon" button (google.accounts.id.renderButton with type: 'icon')
    // has an unpredictable natural size that doesn't fit cleanly into a 22px badge — at small
    // sizes it clips down to what reads as a blank white circle. This is deliberately just a
    // plain button showing Google's "G" mark, wired to `promptGoogleSignIn` (which navigates to
    // Settings — see the comment on it in AuthContext.tsx for why sign-in itself has to happen
    // from a real, full-size rendered button there rather than inline here).
    <button
      className="flex-none w-[22px] h-[22px] rounded-full border border-ink/[.18] flex items-center justify-center hover:bg-ink/[.06]"
      title="Sign in with Google"
      onClick={promptGoogleSignIn}
    >
      <svg width="13" height="13" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
      </svg>
    </button>
  );

  return (
    <aside className="flex flex-col h-full min-w-0 overflow-hidden border-r border-ink/10" style={style}>
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
              <button className="flex items-center text-ink/[.62]" title="Settings" onClick={() => navigate('/settings')}>
                <Settings size={16} strokeWidth={1.75} />
              </button>
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
            <button
              className="flex items-center gap-1 px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]"
              onClick={() => setLibraryOpen((o) => !o)}
            >
              Library {libraryOpen ? '−' : '+'}
            </button>
            {libraryOpen &&
              corpus.nikayas.map((n) => {
                const open = !!expanded[n.id];
                const expandableNode = isExpandable(n);
                return (
                  <div key={n.id}>
                    <button
                      className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] ${nodeId === n.id ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => (expandableNode ? toggleExpanded(n.id) : onSelect(n.id))}
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
                    {expandableNode &&
                      open &&
                      n.chapters!.map((c) => (
                        <TreeRow key={c.id} node={c} depth={1} nodeId={nodeId} expanded={expanded} onToggle={toggleExpanded} onSelect={onSelect} />
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
                className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] ${nodeId === String(l.id) ? 'bg-ink/[.06]' : ''}`}
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
          <button className="flex items-center" title="Settings" onClick={() => navigate('/settings')}>
            <Settings size={16} strokeWidth={1.75} />
          </button>
          {signedInBadge}
        </footer>
      )}

    </aside>
  );
}
