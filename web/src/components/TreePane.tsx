import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@reach/router';
import { LifeBuoy, Highlighter, StickyNote, History, Library, List, Search, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { useScrollToNode } from '../hooks/useScrollToNode';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useListCrud } from '../hooks/useListCrud';
import { useListTreeDrag } from '../hooks/useListTreeDrag';
import { useActiveHitIndex } from '../hooks/useActiveHitIndex';
import { ancestorsOf, findNode, flatSuttaOrder, SEARCH_PLACEHOLDER, SEARCH_RESULTS_CAP, type SearchHit } from '../lib/corpus';
import { ancestorsOfList, flattenListTree, suttaRowMeta } from '../lib/lists';
import { derivePaneViewSync } from '../lib/paneView';
import { TREE_VIEW_KEY, TREE_EXPANDED_KEY } from '../lib/storageKeys';
import { RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from '../lib/autoLists';
import { SHORTCUTS, isShortcut } from '../lib/shortcuts';
import type { ListDef } from '../lib/types';
import { SignedInBadge } from './SignedInBadge';
import { DataStatus } from './DataStatus';
import { HeaderBanner } from './HeaderBanner';
import { SuttaRowChips } from './SuttaRowChips';
import { type ListRowMenuProps, type ListRowEditProps, type ListRowDeleteProps, type ListRowDraftProps } from './ListRow';
import { CorpusTreeView } from './CorpusTreeView';
import { ListsTreeView } from './ListsTreeView';
import { SlidingPillToggle } from './SlidingPillToggle';

interface PersistedExpansion {
  corpus: string[];
  lists: string[];
}

// What the user expanded by hand, one id list per tree. Unioned at mount with the selected
// node's ancestor chain, so a deep link opens its own ancestors whatever this device had open.
function loadPersistedExpansion(): PersistedExpansion {
  try {
    const raw = localStorage.getItem(TREE_EXPANDED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedExpansion>;
      return { corpus: Array.isArray(parsed.corpus) ? parsed.corpus : [], lists: Array.isArray(parsed.lists) ? parsed.lists : [] };
    }
  } catch {
    // storage unavailable/corrupt — ignore
  }
  return { corpus: [], lists: [] };
}

function toRecord(ids: string[]): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const id of ids) record[id] = true;
  return record;
}

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  onOpenSutta: (suttaId: string) => void;
  onSearch: (query: string) => void;
  query: string;
  // Scanned once by LibraryPage and shared with ListPane, so both panes show one result set.
  // On desktop ListPane renders the rows; this pane keeps the input and the keyboard nav.
  hits: SearchHit[];
  // The hit this pane's arrow-key nav has highlighted, so ListPane can mirror it on desktop.
  onActiveHitChange?: (id: string | undefined) => void;
  // False while LibraryPage has this pane `display:none` on mobile rather than unmounted — see
  // useScrollMemory, which can't restore a scroll offset into a box with no scroll extent.
  visible?: boolean;
  // This mount is a reader-close round trip, not a deliberate chip/breadcrumb click or deep
  // link. Suppresses the Library/My-lists sync below once: such a mount's `nodeId` is often a
  // corpus node even though the user had My lists open, and syncing would discard their choice.
  restoreOrigin?: boolean;
  // The breadcrumb segment last clicked in the reader — may sit above `nodeId`. Briefly scrolled
  // to and highlighted; doesn't affect what's browsed.
  flashNodeId?: string;
  // LibraryPage's "?" modal is open, so this pane's own '/' and 'x' shortcuts stand down.
  shortcutsOpen?: boolean;
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
  shortcutsOpen = false,
}: TreePaneProps) {
  const { corpus } = useCorpus();
  const {
    ready,
    lists,
    membership,
    notes,
    highlights,
    createList,
    renameList,
    removeList,
    reorderLists,
    setListParent,
  } = useUserData();
  const { user } = useAuth();
  const { mobile, paneW } = useLayout();

  const scrollRef = useScrollMemory<HTMLDivElement>('tree', visible);
  // Expanded synchronously at mount, never via an effect: useScrollMemory restores in a layout
  // effect, so a tree still collapsed at that point clamps the restored offset back to 0.
  const [persistedExpansion] = useState(loadPersistedExpansion);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    ...toRecord(persistedExpansion.corpus),
    ...ancestorsOf(corpus, nodeId),
  }));
  // Which of the two trees gets the column — they don't share one scroll, where My lists would
  // sit below the long nikaya tree. Never gated on being signed in: a signed-out reader's lists
  // live in the local mirror, so My lists is always a real place to go.
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

  // Points the toggle at whichever tree `nodeId` actually lives in, so a deep link to a list (a
  // membership chip) or to a corpus node (a breadcrumb) doesn't land on the other tree with
  // nothing selected. Keyed on whether nodeId *is* a list id rather than on `lists`: a reorder
  // or re-parent hands back a new `lists` reference with the same ids, and re-running on that
  // would snap the pane to 'library' after every drag. Skipped at mount when `restoreOrigin`.
  const nodeIsListId = lists.some((l) => l.id === nodeId);
  const mountedRef = useRef(false);
  useEffect(() => {
    const isFirstRun = !mountedRef.current;
    mountedRef.current = true;
    const next = derivePaneViewSync({
      isFirstRun,
      restoreOrigin,
      nodeId,
      nodeIsListId,
      nodeIsCorpusNode: !!(corpus && nodeId && findNode(corpus, nodeId)),
    });
    if (next) setPaneView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeIsListId, corpus]);

  // Opens the current node's ancestors when nodeId changes after mount, without collapsing
  // anything the user already had open. Both trees keep their own expanded-state map.
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

  // useCallback'd (only reading the setState function itself, which React guarantees is stable)
  // so TreeRow's own memoization isn't defeated by a freshly-allocated handler on every TreePane
  // render — see TreeRow.tsx's perf note.
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((x) => ({ ...x, [id]: !x[id] }));
  }, []);
  // Synchronous initial state for the same reason `expanded` above is: so the tree is already
  // expanded to nodeId on the very first render if TreePane mounts fresh already pointed at a
  // nested list.
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>(() => ({
    ...toRecord(persistedExpansion.lists),
    ...ancestorsOfList(lists, nodeId),
  }));
  // Persists both trees' expansion together under one key — low-frequency (click-driven, or the
  // ancestor-follow effects above firing on a nodeId change), so an un-debounced write here is
  // negligible, unlike a continuous/animation-driven event (see LayoutContext's drag handler).
  useEffect(() => {
    try {
      localStorage.setItem(
        TREE_EXPANDED_KEY,
        JSON.stringify({
          corpus: Object.keys(expanded).filter((id) => expanded[id]),
          lists: Object.keys(listExpanded).filter((id) => listExpanded[id]),
        })
      );
    } catch {
      // storage unavailable — ignore
    }
  }, [expanded, listExpanded]);
  // Closed by default — see the search icon button in the header. Initialized from whether a
  // query is already present (rather than always `false`) so a pre-populated `query` prop can't
  // leave the pane showing search results with no visible way to see/edit what's being searched.
  const [searchOpen, setSearchOpen] = useState(() => query.trim().length > 0);
  const searchInput = useRef<HTMLInputElement>(null);
  // Starts at 0, not -1, so Enter opens the first result without an arrow press first. The ref
  // mirrors the state so the keydown effect below reads a live index without resubscribing.
  const { activeIndex: searchActiveIndex, activeIndexRef: searchActiveIndexRef, moveBy: moveSearchActiveIndexBy, setRowRef: setHitRowRef } =
    useActiveHitIndex(query);

  const { listChildrenOf, countFor, topLevelLists } = useListTreeIndex(lists);
  const autoLists = useMemo(
    () =>
      [
        { list: lists.find((l) => l.id === RECENT_AUTO_LIST_ID), sub: 'Last 20 suttas visited', Icon: History },
        { list: lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID), sub: 'Last 100 suttas highlighted', Icon: Highlighter },
        { list: lists.find((l) => l.id === NOTES_AUTO_LIST_ID), sub: 'Last 100 suttas noted', Icon: StickyNote },
      ].filter((x): x is { list: ListDef; sub: string; Icon: typeof Highlighter } => !!x.list),
    [lists]
  );

  // useCallback'd for the same reason toggleExpanded above is — passed straight through to
  // ListRow, whose own memoization (mirroring TreeRow's) needs this to stay referentially stable
  // across renders that don't actually change it.
  const toggleListExpanded = useCallback((id: string) => {
    setListExpanded((x) => ({ ...x, [id]: !x[id] }));
  }, []);

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
    draftKind,
    setDraftKind,
    submittingParentId,
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

  const { reorderMode, setReorderMode, dragId, indicator, onRowPointerDown, getRowRef } = useListTreeDrag({
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

  // List-membership chips, highlight count, and note per hit — same lookup ListPane's own rows
  // use (see suttaRowMeta), needed here too since mobile has no ListPane to show them instead
  // (see the mobile search-row rendering below).
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const searchRowMeta = useMemo(
    () => suttaRowMeta(displayHits.map((h) => h.id), membership, highlights, flatLists),
    [displayHits, membership, highlights, flatLists]
  );

  // Mirrors the currently keyboard-highlighted hit up to LibraryPage so it can show the same
  // highlight on ListPane's own row for it (see this pane's own render below, which stops
  // rendering hit rows itself once ListPane is also visible).
  useEffect(() => {
    onActiveHitChange?.(searching ? displayHits[searchActiveIndex]?.id : undefined);
  }, [searching, searchActiveIndex, displayHits, onActiveHitChange]);

  // Hides the search input and clears its query — on Escape, the inline "x", or opening a hit
  // (see openHit below). Always resets `query` even though closing while empty is a no-op there,
  // so every call site can just call this rather than deciding whether a reset is also needed.
  function closeSearch() {
    setSearchOpen(false);
    onSearch('');
  }

  // Deliberately doesn't closeSearch() first: navigate() only lands a microtask+rAF later, so
  // clearing the search UI here would paint a frame of the bare tree before the reader arrives.
  // The route change unmounts this pane anyway, so there's no stale query to clean up.
  function openHit(id: string) {
    onOpenSutta(id);
  }

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      // The shortcuts modal owns every key while it's open (see LibraryPage's own handler) —
      // without this, '/' opens the search row behind it and steals focus into the autofocused
      // input, and 'x' swaps panes out of sight.
      if (shortcutsOpen) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      // Up/down/Enter over the search hits work while the search input itself has focus (the
      // normal state while results are showing) — but not while some *other* input/textarea has
      // focus. '/' and 'x' below are unrelated shortcuts and keep the plain bail: typing either
      // character into the search box (or any input) must never re-trigger them.
      const isSearchInput = e.target === searchInput.current;
      if (searching && displayHits.length > 0 && !(tag === 'textarea' || (tag === 'input' && !isSearchInput))) {
        if (isShortcut(e, SHORTCUTS.librarySelectMove)) {
          e.preventDefault();
          moveSearchActiveIndexBy(e.key === 'ArrowDown' ? 1 : -1, displayHits.length);
          return;
        }
        if (isShortcut(e, SHORTCUTS.librarySelectOpen) && searchActiveIndexRef.current < displayHits.length) {
          e.preventDefault();
          const hit = displayHits[searchActiveIndexRef.current];
          openHit(hit.matchedId ?? hit.id);
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
      } else if (isShortcut(e, SHORTCUTS.libraryToggleLists)) {
        e.preventDefault();
        setPaneView((v) => (v === 'library' ? 'lists' : 'library'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searching, displayHits, searchOpen, onOpenSutta, shortcutsOpen]);

  // The target row usually isn't in the DOM on the render nodeId changed on — the expand
  // effects above have to run first — so these retry on each of those state changes.
  useScrollToNode(scrollRef, nodeId, [paneView, expanded, listExpanded, corpus, lists]);
  // Second, so a breadcrumb's own segment (which may sit above nodeId) wins the final position.
  useScrollToNode(scrollRef, flashNodeId, [paneView, expanded, listExpanded, corpus, lists]);

  // ListRow's props, grouped by concern. Memoized so a fresh object on every TreePane render
  // doesn't defeat ListRow's own memo; built above the `if (!corpus)` bail since hooks can't
  // run conditionally.
  const listRowMenu: ListRowMenuProps = useMemo(
    () => ({
      menuOpenId,
      onToggleMenu: toggleListMenu,
      onMove: moveList,
      onAddChild: addChildList,
      onStartEdit: startEditList,
      onArmDelete: armDeleteList,
    }),
    [menuOpenId, toggleListMenu, moveList, addChildList, startEditList, armDeleteList]
  );
  const listRowEdit: ListRowEditProps = useMemo(
    () => ({
      editingId,
      editDraft,
      onEditDraftChange: setEditDraft,
      onCommitEdit: commitEditList,
      onCancelEdit: cancelEditList,
    }),
    [editingId, editDraft, setEditDraft, commitEditList, cancelEditList]
  );
  const listRowDelete: ListRowDeleteProps = useMemo(
    () => ({
      confirmDeleteId,
      onDelete: deleteList,
      onCancelDelete: cancelDeleteList,
    }),
    [confirmDeleteId, deleteList, cancelDeleteList]
  );
  const draftInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      listInput.current = el;
    },
    [listInput]
  );
  const listRowDraft: ListRowDraftProps = useMemo(
    () => ({
      creatingParentId,
      draft,
      onDraftChange: setDraft,
      onDraftKey,
      draftInputRef,
      submittingParentId,
    }),
    [creatingParentId, draft, setDraft, onDraftKey, draftInputRef, submittingParentId]
  );

  if (!corpus) return null;

  const style = mobile ? { flex: 1 } : { flex: 'none', width: paneW.tree };

  return (
    <aside
      data-component="TreePane"
      className={`flex flex-col h-full min-w-0 overflow-hidden border-r border-ink/10 ${mobile ? '' : 'bg-treepane'}`}
      style={style}
    >
      <header className="flex-none px-[18px] pt-4 pb-3.5 border-b border-ink/10">
        <div className="flex items-center gap-2">
          <div className="text-[22px] font-semibold tracking-[-.01em] flex-1 truncate" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
          <SlidingPillToggle
            active={paneView === 'library' ? 'left' : 'right'}
            onClick={() => setPaneView((v) => (v === 'library' ? 'lists' : 'library'))}
            ariaLabel={paneView === 'library' ? 'Switch to My Lists' : 'Switch to Library'}
            title={paneView === 'library' ? 'Switch to My Lists (x)' : 'Switch to Library (x)'}
            leftIcon={<Library size={mobile ? 14 : 13} strokeWidth={2} />}
            rightIcon={<List size={mobile ? 14 : 13} strokeWidth={2} />}
            leftIconClassName={paneView === 'library' ? 'text-ink' : 'text-ink/45'}
            rightIconClassName={paneView === 'lists' ? 'text-[#FBFAF7]' : 'text-ink/45'}
            slotSize={mobile ? 28 : 24}
            thumbClassName={`border border-ink/[.12] shadow-[0_1px_2px_rgba(27,25,23,.18)] transition-[left,background-color] duration-200 ease-out ${
              paneView === 'lists' ? 'bg-pill-lists' : 'bg-chip'
            }`}
          />
          {/* Sized to match the toggle left of it and the badge right of it, so all three share
              a vertical centre rather than each keying off its own content. */}
          <button
            className="flex-none rounded-full flex items-center justify-center text-ink/[.62] hover:bg-ink/[.06]"
            style={mobile ? { width: 32, height: 32 } : { width: 28, height: 28 }}
            aria-label={searchOpen ? 'Close search' : 'Search'}
            title={searchOpen ? 'Close search (Esc)' : 'Search (/)'}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <Search size={mobile ? 16 : 15} strokeWidth={2} />
          </button>
          {/* Goes to Settings in either sign-in state, so no separate gear is needed here. */}
          <SignedInBadge user={user} size={mobile ? 32 : 28} />
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
              placeholder={SEARCH_PLACEHOLDER}
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

      <HeaderBanner />

      <div ref={scrollRef} className="sc flex-1 py-2.5 pb-6">
        {searching ? (
          <div>
            <div className="px-[18px] pt-2 pb-1 font-sans text-[10.5px] font-bold tracking-[.12em] uppercase text-ink/[.58]">
              {hits.length > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+ results` : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}
            </div>
            {/* Mobile-only: on desktop ListPane renders the same hits beside this pane, with the
                blurb too, and this pane contributes just the count, the input and the key nav.
                No blurb here — the column is narrower and ref/title/Pali already identify a hit. */}
            {mobile && (
              <>
                {displayHits.map(({ id, matchedId, sutta }, i) => {
                  const note = notes[id];
                  const { chips, hlCount } = searchRowMeta.get(id) ?? { chips: [], hlCount: 0 };
                  return (
                    <button
                      key={id}
                      ref={setHitRowRef(i)}
                      className={`row flex flex-col w-full text-left gap-[1px] px-[18px] py-[11px] border-b border-ink/[.07] ${i === searchActiveIndex ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => openHit(matchedId ?? id)}
                    >
                      <span>
                        <span className="font-sans text-[11.5px] font-bold text-ink/60 mr-2.5">{sutta.ref}</span>
                        <span className="text-[16px] font-semibold leading-[1.3]">{sutta.en}</span>
                      </span>
                      <span className="font-serif text-[13.5px] italic text-accent-text">{sutta.pali}</span>
                      {note && (
                        <span className="block font-serif text-[14px] leading-[1.4] mt-[6px] pl-[10px] border-l-2 border-ink/30">
                          {note}
                        </span>
                      )}
                      <SuttaRowChips chips={chips} hlCount={hlCount} />
                    </button>
                  );
                })}
                {hits.length === 0 && (
                  <div className="font-sans text-center text-[13px] text-ink/40 py-[30px] px-5">No matches.</div>
                )}
              </>
            )}
          </div>
        ) : paneView === 'library' ? (
          <CorpusTreeView corpus={corpus} expanded={expanded} onToggle={toggleExpanded} onSelect={onSelect} nodeId={nodeId} flashNodeId={flashNodeId} />
        ) : (
          <ListsTreeView
            ready={ready}
            nodeId={nodeId}
            onSelect={onSelect}
            reorderMode={reorderMode}
            setReorderMode={setReorderMode}
            setMenuOpenId={setMenuOpenId}
            toggleTopLevelDraft={toggleTopLevelDraft}
            creatingParentId={creatingParentId}
            setCreatingParentId={setCreatingParentId}
            listInput={listInput}
            draft={draft}
            setDraft={setDraft}
            onDraftKey={onDraftKey}
            draftKind={draftKind}
            setDraftKind={setDraftKind}
            submittingParentId={submittingParentId}
            topLevelLists={topLevelLists}
            listChildrenOf={listChildrenOf}
            countFor={countFor}
            listExpanded={listExpanded}
            onToggleListExpanded={toggleListExpanded}
            listRowMenu={listRowMenu}
            listRowEdit={listRowEdit}
            listRowDelete={listRowDelete}
            listRowDraft={listRowDraft}
            dragId={dragId}
            indicator={indicator}
            onRowPointerDown={onRowPointerDown}
            getRowRef={getRowRef}
            autoLists={autoLists}
          />
        )}
      </div>

      {/* Pinned below the scroll area, not trailing the rows, where it would sit under fifty
          suttas and never be found. Each end is its own button carrying the bar's full height,
          so both tap targets are bar-height and both fit at the pane's 210px minimum — which is
          why the status end only spells itself out when something is wrong. The inset clears the
          iOS home indicator, where this pane runs to the viewport bottom in an installed PWA. */}
      <div
        className="flex-none flex items-center justify-between border-t border-ink/10"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <button
          className="flex-none flex items-center gap-[9px] min-w-0 pl-[18px] pr-3 py-[11px] text-left font-sans text-[12.5px] text-ink/45 hover:text-ink/70"
          onClick={() => navigate('/help')}
        >
          <LifeBuoy size={15} strokeWidth={2} className="flex-none text-ink/35" />
          Help
        </button>
        <DataStatus />
      </div>
    </aside>
  );
}
