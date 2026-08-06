import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@reach/router';
import { Settings, ChevronRight, ChevronDown, Highlighter, StickyNote, ArrowUpDown, Library, List } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { useScrollToNode } from '../hooks/useScrollToNode';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useListCrud } from '../hooks/useListCrud';
import { useListTreeDrag } from '../hooks/useListTreeDrag';
import { ancestorsOf, findNode, isExpandable, searchCorpus } from '../lib/corpus';
import { ancestorsOfList } from '../lib/lists';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from '../lib/autoLists';
import type { ListDef } from '../lib/types';
import { TreeRow } from './TreeRow';
import { SignedInBadge } from './SignedInBadge';
import { ListRow, type ListRowMenuProps, type ListRowEditProps, type ListRowDeleteProps, type ListRowDraftProps } from './ListRow';

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  onOpenSutta: (suttaId: string) => void;
  onSearch: (query: string) => void;
  query: string;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
}

export function TreePane({ nodeId, onSelect, onOpenSutta, onSearch, query, visible = true }: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, notes, createList, renameList, removeList, reorderLists, setListParent } = useUserData();
  const { user, promptGoogleSignIn } = useAuth();
  const { mobile, paneW } = useLayout();
  const scrollRef = useScrollMemory<HTMLDivElement>('tree', visible);
  // Computed synchronously on mount (not via an effect) so the tree is *already* expanded to
  // nodeId by the very first render — otherwise useScrollMemory's restore (a layout effect,
  // which always runs before any passive effect) would fire against a still-collapsed tree
  // whenever TreePane mounts fresh already pointed at a deep node (e.g. LibraryPage remounting
  // after the reader closes, on desktop where it's always "visible" so that restore-on-visible
  // fallback never kicks in either), silently clamping the restored scroll offset back to 0.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ancestorsOf(corpus, nodeId));
  // Library and My Lists used to share one scrolling column, with My Lists always below the
  // (often long) nikaya tree — effectively inaccessible without a lot of scrolling for anyone
  // who mainly lives in one or the other. This switches the pane between full views of each
  // instead, persisted like the rest of this pane's layout prefs. Signed-out users have no lists
  // to switch to, so they're pinned to 'library' regardless of what's stored.
  const [paneView, setPaneView] = useState<'library' | 'lists'>(() => {
    try {
      return localStorage.getItem('sutamaya.treeView') === 'lists' ? 'lists' : 'library';
    } catch {
      return 'library';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('sutamaya.treeView', paneView);
    } catch {
      // storage unavailable — ignore
    }
  }, [paneView]);
  const effectiveView = user ? paneView : 'library';

  // A membership chip's /browse/{list_id} navigation (or any other deep link to a list) needs
  // the "My lists" tree actually showing for that row to be visible at all — flip the toggle for
  // the user rather than landing them on a Library view with nothing selected. Symmetrically, a
  // breadcrumb segment's /browse/{corpus_node_id} navigation (or any other deep link into the
  // browse tree) needs to flip back to 'library' — otherwise a user who navigates there while
  // "My lists" is showing ends up on a list view with nothing selected instead.
  // Depend on whether nodeId *is* a list id, not on the `lists` array itself — reordering or
  // re-parenting a list (drag-and-drop in ListRow) gives `lists` a new reference without adding
  // or removing any id, and re-running this on that reference change alone snapped the pane back
  // to 'library' immediately after every mobile drag-drop (nodeId, still a corpus node id from
  // whatever the user was last browsing, would hit the `else if` branch below).
  const nodeIsListId = lists.some((l) => l.id === nodeId);
  useEffect(() => {
    if (!user || !nodeId) return;
    if (nodeIsListId) setPaneView('lists');
    else if (corpus && findNode(corpus, nodeId)) setPaneView('library');
  }, [user, nodeId, nodeIsListId, corpus]);

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

  // Same as above, for the "My lists" tree.
  useEffect(() => {
    const toOpen = ancestorsOfList(lists, nodeId);
    if (!Object.keys(toOpen).length) return;
    setListExpanded((x) => {
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
  }, [lists, nodeId]);

  function toggleExpanded(id: string) {
    setExpanded((x) => ({ ...x, [id]: !x[id] }));
  }
  // Synchronous initial state for the same reason `expanded` above is: so the tree is already
  // expanded to nodeId on the very first render if TreePane mounts fresh already pointed at a
  // nested list.
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>(() => ancestorsOfList(lists, nodeId));
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  // Up/down (and Enter to open) over the search results list only — see the keydown effect
  // below. `searchActiveIndexRef` mirrors the state so the effect's Enter branch always reads
  // the live index without needing to resubscribe its listener on every arrow keypress.
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const searchActiveIndexRef = useRef(-1);
  searchActiveIndexRef.current = searchActiveIndex;
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const { listChildrenOf, countFor, topLevelLists } = useListTreeIndex(lists);
  const autoLists = useMemo(
    () =>
      [
        { list: lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID), sub: 'Every sutta with a highlight', Icon: Highlighter },
        { list: lists.find((l) => l.id === NOTES_AUTO_LIST_ID), sub: 'Every sutta with a note', Icon: StickyNote },
      ].filter((x): x is { list: ListDef; sub: string; Icon: typeof Highlighter } => !!x.list),
    [lists]
  );

  function toggleListExpanded(id: string) {
    setListExpanded((x) => ({ ...x, [id]: !x[id] }));
  }

  const {
    menuOpenId,
    setMenuOpenId,
    confirmDeleteId,
    editingId,
    editDraft,
    setEditDraft,
    creatingParentId,
    setCreatingParentId,
    draft,
    setDraft,
    listInput,
    toggleListMenu,
    startEditList,
    commitEditList,
    cancelEditList,
    armDeleteList,
    cancelDeleteList,
    deleteList,
    addChildList,
    moveList,
    onDraftKey,
  } = useListCrud({
    listChildrenOf,
    topLevelLists,
    setListExpanded,
    createList,
    renameList,
    removeList,
    reorderLists,
    onCreated: (list) => navigate(`/browse/${list.id}`),
  });

  const { reorderMode, setReorderMode, dragId, overId, overZone, onRowPointerDown, registerRowEl } = useListTreeDrag({
    lists,
    listChildrenOf,
    topLevelLists,
    scrollRef,
    setListExpanded,
    setListParent,
    reorderLists,
  });

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (corpus && searching ? searchCorpus(corpus, query, notes) : []), [corpus, query, searching, notes]);

  useEffect(() => {
    setSearchActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (searchActiveIndex >= 0) hitRefs.current[searchActiveIndex]?.scrollIntoView({ block: 'nearest' });
  }, [searchActiveIndex]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      // Up/down/Enter over the search hits work while the search input itself has focus (the
      // normal state while results are showing) — but not while some *other* input/textarea has
      // focus. '/' and 'x' below are unrelated shortcuts and keep the plain bail: typing either
      // character into the search box (or any input) must never re-trigger them.
      const isSearchInput = e.target === searchInput.current;
      if (searching && hits.length > 0 && !(tag === 'textarea' || (tag === 'input' && !isSearchInput))) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSearchActiveIndex((i) => Math.min(hits.length - 1, i + 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSearchActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'Enter' && searchActiveIndexRef.current >= 0 && searchActiveIndexRef.current < hits.length) {
          e.preventDefault();
          onOpenSutta(hits[searchActiveIndexRef.current].id);
          return;
        }
      }
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '/') {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      } else if (e.key.toLowerCase() === 'x' && user) {
        e.preventDefault();
        setPaneView((v) => (v === 'library' ? 'lists' : 'library'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, searching, hits, onOpenSutta]);

  // The target row (corpus chapter or list) often isn't in the DOM yet on the same render
  // nodeId changed on — the ancestor-expand effects above (and, for a list, the paneView switch
  // above) still need to run and re-render first — so this retries on each of their state
  // changes until the row is actually findable, not just once.
  useScrollToNode(scrollRef, nodeId, [effectiveView, expanded, listExpanded, corpus, lists]);

  if (!corpus) return null;

  const style = mobile
    ? { flex: 1 }
    : { flex: 'none', width: paneW.tree, background: '#F0ECE4' };

  // ListRow's props are grouped by concern (see ListRow.tsx) — built once here rather than at
  // each of its (potentially deeply nested) call sites.
  const listRowMenu: ListRowMenuProps = {
    menuOpenId,
    onToggleMenu: toggleListMenu,
    onMove: moveList,
    onAddChild: addChildList,
    onStartEdit: startEditList,
    onArmDelete: armDeleteList,
  };
  const listRowEdit: ListRowEditProps = {
    editingId,
    editDraft,
    onEditDraftChange: setEditDraft,
    onCommitEdit: commitEditList,
    onCancelEdit: cancelEditList,
  };
  const listRowDelete: ListRowDeleteProps = {
    confirmDeleteId,
    onDelete: deleteList,
    onCancelDelete: cancelDeleteList,
  };
  const listRowDraft: ListRowDraftProps = {
    creatingParentId,
    draft,
    onDraftChange: setDraft,
    onDraftKey,
    draftInputRef: (el) => {
      listInput.current = el;
    },
  };

  return (
    <aside data-component="TreePane" className="flex flex-col h-full min-w-0 overflow-hidden border-r border-ink/10" style={style}>
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1 truncate">sutamaya</div>
          {user && (
            <button
              className="relative flex flex-none items-center rounded-full p-[2px]"
              style={{ background: 'rgba(27,25,23,.09)' }}
              aria-label={paneView === 'library' ? 'Switch to My Lists' : 'Switch to Library'}
              title={paneView === 'library' ? 'Switch to My Lists (x)' : 'Switch to Library (x)'}
              onClick={() => setPaneView((v) => (v === 'library' ? 'lists' : 'library'))}
            >
              <div
                className="absolute top-[2px] bottom-[2px] rounded-full bg-white shadow-[0_1px_2px_rgba(27,25,23,.18)] transition-[left] duration-200 ease-out"
                style={{ left: paneView === 'library' ? 2 : '50%', width: 'calc(50% - 2px)' }}
              />
              {/* Mobile-sized to roughly match the "sutamaya" title's own height — this and the
                  account badge next to it are the two touch targets in this row people actually
                  reach for repeatedly. */}
              <span
                className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${paneView === 'library' ? 'text-ink' : 'text-ink/45'}`}
                style={mobile ? { width: 38, height: 38 } : { width: 24, height: 24 }}
              >
                <Library size={mobile ? 17 : 13} strokeWidth={2} />
              </span>
              <span
                className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${paneView === 'lists' ? 'text-ink' : 'text-ink/45'}`}
                style={mobile ? { width: 38, height: 38 } : { width: 24, height: 24 }}
              >
                <List size={mobile ? 17 : 13} strokeWidth={2} />
              </span>
            </button>
          )}
          {/* Account entry point, right of the toggle on every viewport (this used to be a
              separate desktop-only footer at the bottom of the pane, with nothing else on it —
              not worth a whole row of its own when it fits right here). */}
          <div className={`flex items-center flex-none ${mobile ? 'gap-3.5' : 'gap-2.5'}`}>
            <SignedInBadge user={user} size={mobile ? 36 : 26} promptGoogleSignIn={promptGoogleSignIn} />
            {/* The badge above already goes to Settings regardless of sign-in state (see
                SignedInBadge) — once signed in it's the one obvious account affordance, so the
                separate gear (redundant with it) drops out; signed out, the badge alone reads
                as "sign in", not "settings", so the gear stays as the explicit way in. */}
            {!user && (
              <button className="flex items-center text-ink/[.62]" aria-label="Settings" title="Settings" onClick={() => navigate('/settings')}>
                <Settings size={mobile ? 20 : 16} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              // Stops here rather than bubbling to any other Escape handler — clearing and
              // defocusing the search box is a complete, self-contained action for this key
              // while it has focus, not one step of some other component's own Escape handling.
              e.stopPropagation();
              onSearch('');
              searchInput.current?.blur();
            }}
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
                className={`row flex flex-col w-full text-left gap-[1px] px-[18px] py-[11px] border-b border-ink/[.07] ${i === searchActiveIndex ? 'bg-ink/[.06]' : ''}`}
                onClick={() => onOpenSutta(id)}
              >
                <span>
                  <span className="font-sans text-[11.5px] font-bold text-ink/60 mr-2.5">{sutta.ref}</span>
                  <span className="text-[16px] font-semibold leading-[1.3]">{sutta.en}</span>
                </span>
                <span className="font-serif text-[13.5px] italic text-accent">{sutta.pali}</span>
              </button>
            ))}
            {hits.length === 0 && (
              <div className="font-sans text-center text-[13px] text-ink/40 py-[30px] px-5">No matches.</div>
            )}
          </div>
        ) : effectiveView === 'library' ? (
          <div>
            {corpus.nikayas.map((n) => {
                const open = !!expanded[n.id];
                const expandableNode = isExpandable(n);
                return (
                  <div key={n.id}>
                    <button
                      data-node-id={n.id}
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
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between pl-[18px] pr-[10px] pt-2 pb-1">
              <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">My lists</span>
              <div className="flex items-center gap-[7px]">
                <button
                  aria-label={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
                  title={reorderMode ? 'Done reordering' : 'Reorder & nest lists'}
                  className="w-[22px] h-[22px] border rounded-md flex items-center justify-center"
                  style={{
                    borderColor: reorderMode ? '#8A6A3B' : 'rgba(27,25,23,.28)',
                    background: reorderMode ? '#8A6A3B' : 'transparent',
                    color: reorderMode ? '#FBFAF7' : 'rgba(27,25,23,.5)',
                  }}
                  onClick={() => {
                    setReorderMode((m) => !m);
                    setMenuOpenId(null);
                  }}
                >
                  <ArrowUpDown size={12} strokeWidth={2} />
                </button>
                <button
                  aria-label="Add group"
                  title="Add group"
                  className="plus w-[22px] h-[22px] border border-ink/[.28] rounded-md flex items-center justify-center text-[15px] leading-none text-ink/50"
                  onClick={() => {
                    setCreatingParentId((c) => (c === undefined ? null : undefined));
                    setDraft('');
                    setTimeout(() => listInput.current?.focus(), 30);
                  }}
                >
                  +
                </button>
              </div>
            </div>
            {reorderMode && (
              <div className="px-[18px] pb-1.5 font-sans text-[11.5px] text-ink/45">Drag a list onto a group to nest it, or to the top/bottom edge of a row to reorder.</div>
            )}
            {creatingParentId === null && (
              <div className="px-[18px] pt-1.5 pb-2">
                <input
                  ref={listInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onDraftKey}
                  onBlur={() => setCreatingParentId(undefined)}
                  placeholder="Group name — return to create"
                  className="w-full h-[34px] border border-accent rounded-lg px-2.5 bg-field text-[14.5px] outline-none"
                />
              </div>
            )}
            {topLevelLists.map((l, idx) => (
              <ListRow
                key={l.id}
                list={l}
                depth={0}
                nodeId={nodeId}
                childrenOf={listChildrenOf}
                countFor={countFor}
                listExpanded={listExpanded}
                onToggle={toggleListExpanded}
                onSelect={onSelect}
                menu={listRowMenu}
                edit={listRowEdit}
                del={listRowDelete}
                draft={listRowDraft}
                siblingIndex={idx}
                siblingCount={topLevelLists.length}
                reorderMode={reorderMode}
                dragId={dragId}
                overId={overId}
                overZone={overZone}
                onRowPointerDown={onRowPointerDown}
                registerRowEl={registerRowEl}
              />
            ))}
            {autoLists.length > 0 && (
              <div>
                <div className="px-[18px] pt-[22px] pb-1">
                  <span className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">Automatic</span>
                </div>
                {autoLists.map(({ list, sub, Icon }) => (
                  <button
                    key={list.id}
                    data-node-id={list.id}
                    className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] ${
                      nodeId === String(list.id) ? 'bg-ink/[.06]' : ''
                    }`}
                    onClick={() => onSelect(String(list.id))}
                  >
                    <span className="w-[11px] flex-none flex items-center justify-center text-ink/40">
                      <Icon size={13} strokeWidth={2} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-semibold leading-[1.3]">{list.label}</span>
                      <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{sub}</span>
                    </span>
                    <span className="font-sans text-[11.5px] font-medium text-ink/50">{list.items.length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </aside>
  );
}
