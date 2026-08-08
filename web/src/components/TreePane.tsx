import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@reach/router';
import { Settings, ChevronRight, ChevronDown, Highlighter, StickyNote, History, ArrowUpDown, Library, List, Folder, Search, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { useScrollToNode } from '../hooks/useScrollToNode';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useListCrud } from '../hooks/useListCrud';
import { useListTreeDrag } from '../hooks/useListTreeDrag';
import { ancestorsOf, findNode, isExpandable, SEARCH_RESULTS_CAP, type SearchHit } from '../lib/corpus';
import { ancestorsOfList } from '../lib/lists';
import { derivePaneViewSync } from '../lib/paneView';
import { TREE_VIEW_KEY } from '../lib/storageKeys';
import { RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from '../lib/autoLists';
import { SHORTCUTS, isShortcut } from '../lib/shortcuts';
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
  // Computed once by LibraryPage (not independently here) and shared with ListPane, so the two
  // panes show one consistent result set instead of each running its own searchCorpus scan — see
  // ListPane, which does the actual row rendering on desktop while this pane just keeps its input
  // and keyboard nav.
  hits: SearchHit[];
  // Reports the row this pane's own arrow-key nav currently has highlighted (or undefined when
  // not searching / nothing highlighted yet), so ListPane can mirror that highlight onto its own
  // rows on desktop, where this pane no longer renders them itself.
  onActiveHitChange?: (id: string | undefined) => void;
  // Whether this pane is currently the visible one (LibraryPage keeps both TreePane and
  // ListPane mounted on mobile and toggles `display:none` instead of unmounting — see
  // useScrollMemory for why scroll restoration needs to know this).
  visible?: boolean;
  // True when this mount is a reader-close round trip landing back on wherever the reader was
  // opened from (see LibraryPage's `view` init and ReaderPage's closeReader), as opposed to an
  // explicit chip/breadcrumb click or a fresh deep link. The Library/My-lists toggle below
  // (`paneView`) needs to tell these apart: a chip/breadcrumb click is a deliberate "go to this
  // list/category" that should flip the toggle to match; a reader-close round trip is not — its
  // `nodeId` can easily be a corpus node (a sutta's own `node`, unrelated to what was actually
  // browsed) even though the user had "My lists" open the whole time, and forcing the toggle
  // back to 'library' in that case would discard their pane choice for no reason.
  restoreOrigin?: boolean;
  // The specific breadcrumb segment last clicked in the reader (see LibraryPage/ReaderPage) —
  // may be an ancestor above `nodeId` itself. Briefly scrolled to and highlighted, then cleared
  // by LibraryPage's own timer; doesn't otherwise affect what's browsed.
  flashNodeId?: string;
}

export function TreePane({
  nodeId,
  onSelect,
  onOpenSutta,
  onSearch,
  query,
  hits,
  onActiveHitChange,
  visible = true,
  restoreOrigin = false,
  flashNodeId,
}: TreePaneProps) {
  const { corpus } = useCorpus();
  const { lists, createList, renameList, removeList, reorderLists, setListParent } = useUserData();
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
      return localStorage.getItem(TREE_VIEW_KEY) === 'lists' ? 'lists' : 'library';
    } catch {
      return 'library';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TREE_VIEW_KEY, paneView);
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
  //
  // Skipped on the very first run (mount) whenever `restoreOrigin` says so — see its own prop
  // comment for why a reader-close round trip needs this sync suppressed exactly once, while a
  // breadcrumb/chip click or a fresh deep link (no `restoreOrigin`) still wants it to run on
  // mount as before, since those *are* what this effect exists for in the first place.
  const nodeIsListId = lists.some((l) => l.id === nodeId);
  const mountedRef = useRef(false);
  useEffect(() => {
    const isFirstRun = !mountedRef.current;
    mountedRef.current = true;
    const next = derivePaneViewSync({
      isFirstRun,
      restoreOrigin,
      signedIn: !!user,
      nodeId,
      nodeIsListId,
      nodeIsCorpusNode: !!(corpus && nodeId && findNode(corpus, nodeId)),
    });
    if (next) setPaneView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, nodeId, nodeIsListId, corpus]);

  // Expands every ancestor level of the current node whenever nodeId *changes* after mount —
  // covers deep links and search-driven navigation within an already-mounted TreePane, without
  // collapsing anything the user already had open. Shared by both the corpus tree and the "My
  // lists" tree, which each keep their own independent expanded-state map.
  function expandIds(setter: (updater: (x: Record<string, boolean>) => Record<string, boolean>) => void, toOpen: Record<string, boolean>) {
    if (!Object.keys(toOpen).length) return;
    setter((x) => {
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
  }

  useEffect(() => {
    expandIds(setExpanded, ancestorsOf(corpus, nodeId));
  }, [corpus, nodeId]);

  useEffect(() => {
    expandIds(setListExpanded, ancestorsOfList(lists, nodeId));
  }, [lists, nodeId]);

  function toggleExpanded(id: string) {
    setExpanded((x) => ({ ...x, [id]: !x[id] }));
  }
  // Synchronous initial state for the same reason `expanded` above is: so the tree is already
  // expanded to nodeId on the very first render if TreePane mounts fresh already pointed at a
  // nested list.
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>(() => ancestorsOfList(lists, nodeId));
  // Closed by default — see the search icon button in the header. Initialized from whether a
  // query is already present (rather than always `false`) so a pre-populated `query` prop can't
  // leave the pane showing search results with no visible way to see/edit what's being searched.
  const [searchOpen, setSearchOpen] = useState(() => query.trim().length > 0);
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
        { list: lists.find((l) => l.id === RECENT_AUTO_LIST_ID), sub: 'Last 20 suttas read', Icon: History },
        { list: lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID), sub: 'Last 100 suttas highlighted', Icon: Highlighter },
        { list: lists.find((l) => l.id === NOTES_AUTO_LIST_ID), sub: 'Last 100 suttas noted', Icon: StickyNote },
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
    blockedDelete,
    editingId,
    editDraft,
    setEditDraft,
    creatingParentId,
    setCreatingParentId,
    draft,
    setDraft,
    draftKind,
    setDraftKind,
    listInput,
    toggleListMenu,
    startEditList,
    commitEditList,
    cancelEditList,
    armDeleteList,
    cancelDeleteList,
    deleteList,
    addChildList,
    toggleTopLevelDraft,
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
  // A short/common query can match hundreds of suttas — only render/keyboard-navigate the first
  // SEARCH_RESULTS_CAP (see its own comment); `hits.length` (uncapped) still drives the "N
  // results" label below so that count stays honest.
  const displayHits = useMemo(() => hits.slice(0, SEARCH_RESULTS_CAP), [hits]);

  useEffect(() => {
    setSearchActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (searchActiveIndex >= 0) hitRefs.current[searchActiveIndex]?.scrollIntoView({ block: 'nearest' });
  }, [searchActiveIndex]);

  // Mirrors the currently keyboard-highlighted hit up to LibraryPage so it can show the same
  // highlight on ListPane's own row for it (see this pane's own render below, which stops
  // rendering hit rows itself once ListPane is also visible).
  useEffect(() => {
    onActiveHitChange?.(searching && searchActiveIndex >= 0 ? displayHits[searchActiveIndex]?.id : undefined);
  }, [searching, searchActiveIndex, displayHits, onActiveHitChange]);

  // Hides the search input and clears its query — on Escape, the inline "x", or opening a hit
  // (see openHit below). Always resets `query` even though closing while empty is a no-op there,
  // so every call site can just call this rather than deciding whether a reset is also needed.
  function closeSearch() {
    setSearchOpen(false);
    onSearch('');
  }

  // Opening a search hit navigates to `/read/:id` — a different route than this one, so
  // LibraryPage (and this pane's search UI with it) unmounts once the reader takes over; a
  // return trip remounts it fresh, with no stale query/result list to clean up. Deliberately
  // *not* calling closeSearch() first: `navigate()` only takes effect a microtask+rAF later (see
  // LibraryPage's own comment on this), so clearing the search UI synchronously here would paint
  // a frame of the bare tree underneath before the reader actually replaces it — the "search
  // hides, tree flashes, then the reader shows" bug. Leaving the search UI exactly as the user
  // left it until the swap happens keeps the transition looking like search result → reader,
  // with nothing in between.
  function openHit(id: string) {
    onOpenSutta(id);
  }

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      // Up/down/Enter over the search hits work while the search input itself has focus (the
      // normal state while results are showing) — but not while some *other* input/textarea has
      // focus. '/' and 'x' below are unrelated shortcuts and keep the plain bail: typing either
      // character into the search box (or any input) must never re-trigger them.
      const isSearchInput = e.target === searchInput.current;
      if (searching && displayHits.length > 0 && !(tag === 'textarea' || (tag === 'input' && !isSearchInput))) {
        if (isShortcut(e, SHORTCUTS.librarySelectMove)) {
          e.preventDefault();
          if (e.key === 'ArrowDown') setSearchActiveIndex((i) => Math.min(displayHits.length - 1, i + 1));
          else setSearchActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (isShortcut(e, SHORTCUTS.librarySelectOpen) && searchActiveIndexRef.current >= 0 && searchActiveIndexRef.current < displayHits.length) {
          e.preventDefault();
          openHit(displayHits[searchActiveIndexRef.current].id);
          return;
        }
      }
      if (tag === 'input' || tag === 'textarea') return;
      if (isShortcut(e, SHORTCUTS.librarySearch)) {
        e.preventDefault();
        if (searchOpen) {
          searchInput.current?.focus();
          searchInput.current?.select();
        } else {
          setSearchOpen(true);
        }
      } else if (isShortcut(e, SHORTCUTS.libraryToggleLists) && user) {
        e.preventDefault();
        setPaneView((v) => (v === 'library' ? 'lists' : 'library'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, searching, displayHits, searchOpen, onOpenSutta]);

  // The target row (corpus chapter or list) often isn't in the DOM yet on the same render
  // nodeId changed on — the ancestor-expand effects above (and, for a list, the paneView switch
  // above) still need to run and re-render first — so this retries on each of their state
  // changes until the row is actually findable, not just once.
  useScrollToNode(scrollRef, nodeId, [effectiveView, expanded, listExpanded, corpus, lists]);
  // A breadcrumb click's specific segment (see LibraryPage) — may be an ancestor above `nodeId`
  // itself, so it gets its own scroll rather than assuming `nodeId`'s scroll above already
  // reached it; called second, so it wins the final scroll position when both are set.
  useScrollToNode(scrollRef, flashNodeId, [effectiveView, expanded, listExpanded, corpus, lists]);

  if (!corpus) return null;

  const style = mobile ? { flex: 1 } : { flex: 'none', width: paneW.tree };

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
    blockedDelete,
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
    <aside
      data-component="TreePane"
      className={`flex flex-col h-full min-w-0 overflow-hidden border-r border-ink/10 ${mobile ? '' : 'bg-treepane'}`}
      style={style}
    >
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-center gap-2">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1 truncate">sutamaya</div>
          {user && (
            <button
              className="relative flex flex-none items-center rounded-full p-[2px] bg-ink/[.09]"
              aria-label={paneView === 'library' ? 'Switch to My Lists' : 'Switch to Library'}
              title={paneView === 'library' ? 'Switch to My Lists (x)' : 'Switch to Library (x)'}
              onClick={() => setPaneView((v) => (v === 'library' ? 'lists' : 'library'))}
            >
              <div
                className="absolute top-[2px] bottom-[2px] rounded-full bg-chip border border-ink/[.12] shadow-[0_1px_2px_rgba(27,25,23,.18)] transition-[left] duration-200 ease-out"
                style={{ left: paneView === 'library' ? 2 : '50%', width: 'calc(50% - 2px)' }}
              />
              {/* Mobile-sized to roughly match the "sutamaya" title's own height — this and the
                  account badge next to it are the two touch targets in this row people actually
                  reach for repeatedly. */}
              <span
                className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${paneView === 'library' ? 'text-ink' : 'text-ink/45'}`}
                style={mobile ? { width: 28, height: 28 } : { width: 24, height: 24 }}
              >
                <Library size={mobile ? 14 : 13} strokeWidth={2} />
              </span>
              <span
                className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${paneView === 'lists' ? 'text-ink' : 'text-ink/45'}`}
                style={mobile ? { width: 28, height: 28 } : { width: 24, height: 24 }}
              >
                <List size={mobile ? 14 : 13} strokeWidth={2} />
              </span>
            </button>
          )}
          {/* Same outer height as the pane toggle to its left (24px icon + 2px padding on each
              side = 28/32) and the account badge to its right, so all three sit flush along the
              same vertical center instead of each keying off its own inner content size —
              clicking toggles the search row below open/closed (see closeSearch/searchOpen);
              '/' from anywhere does the same (see the keydown effect above). */}
          <button
            className="flex-none rounded-full flex items-center justify-center text-ink/[.62] hover:bg-ink/[.06]"
            style={mobile ? { width: 32, height: 32 } : { width: 28, height: 28 }}
            aria-label={searchOpen ? 'Close search' : 'Search'}
            title={searchOpen ? 'Close search (Esc)' : 'Search (/)'}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <Search size={mobile ? 16 : 15} strokeWidth={2} />
          </button>
          {/* Account entry point, right of the toggle on every viewport (this used to be a
              separate desktop-only footer at the bottom of the pane, with nothing else on it —
              not worth a whole row of its own when it fits right here). */}
          <div className={`flex items-center flex-none ${mobile ? 'gap-3.5' : 'gap-2.5'}`}>
            {!user && (
              <button className="flex items-center text-ink/[.62]" aria-label="Settings" title="Settings" onClick={() => navigate('/settings')}>
                <Settings size={mobile ? 20 : 16} strokeWidth={1.75} />
              </button>
            )}
            <SignedInBadge user={user} size={mobile ? 32 : 28} promptGoogleSignIn={promptGoogleSignIn} />
            {/* The badge above already goes to Settings regardless of sign-in state (see
                SignedInBadge) — once signed in it's the one obvious account affordance, so the
                separate gear (redundant with it) drops out; signed out, the badge alone reads
                as "sign in", not "settings", so the gear stays as the explicit way in. */}
          </div>
        </div>
        {searchOpen && (
          <div className="mt-4 relative">
            <input
              ref={searchInput}
              autoFocus
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                // Stops here rather than bubbling to any other Escape handler — closing the
                // search box is a complete, self-contained action for this key while it has
                // focus, not one step of some other component's own Escape handling.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSearch();
                } else if (e.key === 'Enter' && !query.trim()) {
                  // "Submitting" an empty query — there's nothing to search for, so treat it the
                  // same as Escape rather than leaving an empty, focused box sitting open.
                  e.preventDefault();
                  closeSearch();
                }
              }}
              placeholder="Search ID, title, blurb, note, text"
              className="w-full h-[38px] border border-ink/[.22] rounded-field pl-3 pr-8 bg-field text-[14.5px] outline-none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full text-ink/40 hover:bg-ink/[.08] hover:text-ink"
              aria-label="Clear search"
              title="Clear search"
              onClick={closeSearch}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        )}
      </header>

      <div ref={scrollRef} className="sc flex-1 py-2.5 pb-6">
        {searching ? (
          <div>
            <div className="px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">
              {hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ results` : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}
            </div>
            {/* On desktop, ListPane is visible right next to this pane and renders the same hits
                with more detail (blurb/note, list chips, highlight count) — showing them again
                here too was pure duplication. This pane still owns the input and keyboard nav
                (see the keydown effect above, and onActiveHitChange mirroring the highlight into
                ListPane); on mobile, where ListPane isn't shown at all, it's still the only place
                results can appear, so it keeps rendering them itself. */}
            {mobile && (
              <>
                {displayHits.map(({ id, sutta }, i) => (
                  <button
                    key={id}
                    ref={(el) => {
                      hitRefs.current[i] = el;
                    }}
                    className={`row flex flex-col w-full text-left gap-[1px] px-[18px] py-[11px] border-b border-ink/[.07] ${i === searchActiveIndex ? 'bg-ink/[.06]' : ''}`}
                    onClick={() => openHit(id)}
                  >
                    <span>
                      <span className="font-sans text-[11.5px] font-bold text-ink/60 mr-2.5">{sutta.ref}</span>
                      <span className="text-[16px] font-semibold leading-[1.3]">{sutta.en}</span>
                    </span>
                    <span className="font-serif text-[13.5px] italic text-accent-text">{sutta.pali}</span>
                  </button>
                ))}
                {hits.length === 0 && (
                  <div className="font-sans text-center text-[13px] text-ink/40 py-[30px] px-5">No matches.</div>
                )}
              </>
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
                      className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] transition-colors duration-500 ${
                        nodeId === n.id || flashNodeId === n.id ? 'bg-ink/[.06]' : ''
                      }`}
                      onClick={() => (expandableNode ? toggleExpanded(n.id) : onSelect(n.id))}
                    >
                      <span className="w-[11px] flex-none flex items-center justify-center text-ink/55">
                        {expandableNode ? open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} /> : ''}
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
                        <TreeRow
                          key={c.id}
                          node={c}
                          depth={1}
                          nodeId={nodeId}
                          flashNodeId={flashNodeId}
                          expanded={expanded}
                          onToggle={toggleExpanded}
                          onSelect={onSelect}
                        />
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
                  className={`w-[22px] h-[22px] border rounded-md flex items-center justify-center ${
                    reorderMode ? 'border-accent2 bg-accent2 text-[#FBFAF7]' : 'border-ink/[.20] bg-transparent text-ink/50 hover:bg-ink/[.06]'
                  }`}
                  onClick={() => {
                    setReorderMode((m) => !m);
                    setMenuOpenId(null);
                  }}
                >
                  <ArrowUpDown size={12} strokeWidth={2} />
                </button>
                <button
                  aria-label="New list or group"
                  title="New list or group"
                  className="plus w-[22px] h-[22px] border border-ink/[.20] rounded-md flex items-center justify-center text-[15px] leading-none text-ink/50 hover:bg-ink/[.06]"
                  onClick={toggleTopLevelDraft}
                >
                  +
                </button>
              </div>
            </div>
            {reorderMode && (
              <div className="px-[18px] pb-1.5 font-sans text-[11.5px] text-ink/45">Drag a list onto a group to nest it, or to the top/bottom edge of a row to reorder.</div>
            )}
            {creatingParentId === null && (
              <div className="flex items-center gap-[6px] pl-[18px] pr-[10px] pt-1.5 pb-2">
                <input
                  ref={listInput}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onDraftKey}
                  onBlur={() => setCreatingParentId(undefined)}
                  placeholder={draftKind === 'group' ? 'Group name — return to create' : 'List name — return to create'}
                  className="font-serif flex-1 min-w-0 h-[34px] border border-accent rounded-lg px-2.5 bg-field text-[14.5px] outline-none"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {/* Icon-only List/Group toggle (no text labels — the input's own placeholder
                    already says which one is picked) — a single button spanning both icons, so
                    a click anywhere on it flips draftKind, not just on whichever side happens to
                    be inactive. onMouseDown preventDefault keeps focus on the input instead of
                    shifting it here, so flipping kind mid-type doesn't trigger the input's own
                    onBlur (which cancels the whole draft). */}
                <button
                  type="button"
                  aria-label={draftKind === 'list' ? 'Switch to Group' : 'Switch to List'}
                  title={draftKind === 'list' ? 'Switch to Group' : 'Switch to List'}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDraftKind((k) => (k === 'list' ? 'group' : 'list'))}
                  className="relative flex-none flex items-center p-[2px] rounded-full bg-ink/[.09]"
                >
                  <div
                    className="absolute top-[2px] bottom-[2px] rounded-full bg-chip border border-ink/[.12] shadow-[0_1px_2px_rgba(27,25,23,.15)] transition-[left] duration-150 ease-out"
                    style={{ left: draftKind === 'list' ? 2 : '50%', width: 'calc(50% - 2px)' }}
                  />
                  <span className={`relative z-10 w-[26px] h-[26px] flex items-center justify-center transition-colors ${draftKind === 'list' ? 'text-ink' : 'text-ink/50'}`}>
                    <List size={13} strokeWidth={2} />
                  </span>
                  <span className={`relative z-10 w-[26px] h-[26px] flex items-center justify-center transition-colors ${draftKind === 'group' ? 'text-ink' : 'text-ink/50'}`}>
                    <Folder size={13} strokeWidth={2} />
                  </span>
                </button>
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
