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
import {
  ancestorsOf,
  descendantIdsOf,
  findNode,
  flatSuttaOrder,
  SEARCH_PLACEHOLDER,
  SEARCH_RESULTS_CAP,
  type SearchHit,
} from '../lib/corpus';
import { ancestorsOfList, flattenListTree, suttaRowMeta } from '../lib/lists';
import { hasLocalWorkWorthKeeping } from '../lib/keepSafe';
import { derivePaneViewSync } from '../lib/paneView';
import { TREE_VIEW_KEY, TREE_EXPANDED_KEY } from '../lib/storageKeys';
import { RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from '../lib/autoLists';
import { SHORTCUTS, isShortcut } from '../lib/shortcuts';
import type { ListDef } from '../lib/types';
import { SignedInBadge } from './SignedInBadge';
import { HeaderBanner } from './HeaderBanner';
import { SuttaRowChips } from './SuttaRowChips';
import { type ListRowMenuProps, type ListRowEditProps, type ListRowDeleteProps, type ListRowDraftProps } from './ListRow';
import { CorpusTreeView } from './CorpusTreeView';
import { ListsTreeView } from './ListsTreeView';

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
  // `deep` (⌥-click, see TreeRow) closes the row's whole subtree instead of just hiding it with
  // its descendants still flagged open — the escape hatch for a tree left sprawling after a lot
  // of browsing. Only ever collapses: ⌥-clicking a closed row opens just that row, since
  // expanding a nikaya's entire subtree at once would bury the pane in rows.
  const toggleExpanded = useCallback(
    (id: string, deep = false) => {
      setExpanded((x) => {
        if (!deep || !x[id]) return { ...x, [id]: !x[id] };
        const next = { ...x, [id]: false };
        for (const d of descendantIdsOf(corpus, id)) next[d] = false;
        return next;
      });
    },
    [corpus]
  );
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
        { list: lists.find((l) => l.id === RECENT_AUTO_LIST_ID), sub: "Suttas you've opened", Icon: History },
        { list: lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID), sub: "Suttas you've highlighted", Icon: Highlighter },
        { list: lists.find((l) => l.id === NOTES_AUTO_LIST_ID), sub: "Suttas you've written notes in", Icon: StickyNote },
      ].filter((x): x is { list: ListDef; sub: string; Icon: typeof Highlighter } => !!x.list),
    [lists]
  );

  // useCallback'd for the same reason toggleExpanded above is — passed straight through to
  // ListRow, whose own memoization (mirroring TreeRow's) needs this to stay referentially stable
  // across renders that don't actually change it.
  const toggleListExpanded = useCallback(
    (id: string, deep = false) => {
      setListExpanded((x) => {
        if (!deep || !x[id]) return { ...x, [id]: !x[id] };
        const next = { ...x, [id]: false };
        const queue = listChildrenOf(id).map((l) => l.id);
        while (queue.length) {
          const childId = queue.pop()!;
          next[childId] = false;
          for (const grandchild of listChildrenOf(childId)) queue.push(grandchild.id);
        }
        return next;
      });
    },
    [listChildrenOf]
  );

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
      {/* No bottom padding while the tabs are up: their underline has to land on this border,
          which is what makes the two read as one edge rather than a control floating above a
          rule. With the tabs gone the padding comes back, or the search box sits on the rule. */}
      <header className={`flex-none px-[22px] pt-5 border-b border-ink/10 ${searching ? 'pb-4' : ''}`}>
        {/* Everything in this row is a destination away from the two trees — help, search, the
            account. The pane's own Library/My-lists switch is deliberately *not* among them: as
            one more small control in a row of small controls it read as chrome, when it's the
            navigation half the app lives behind. It gets its own row below instead. */}
        <div className="flex items-center gap-2">
          <div className="text-ui-3xl font-semibold tracking-[-.01em] flex-1 truncate" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
          {/* All three are sized alike so they share a vertical centre rather than each keying
              off its own content. Their *horizontal* spacing can't come from the row's own gap,
              though: these two are transparent boxes around a glyph that leaves 8–10px of air on
              each side, while the badge is a bordered circle filling its box edge to edge. An even
              gap therefore looks uneven — the badge crowds the search icon by about the width of
              that air. So the row's gap is tightened between the two icon buttons and widened
              before the badge, by roughly that difference. Swapping either glyph for one with a
              different ink width means re-checking these two numbers. */}
          <button
            className="flex-none rounded-full flex items-center justify-center text-ink-3 hover:bg-ink/[.06]"
            style={mobile ? { width: 44, height: 44 } : { width: 38, height: 38 }}
            aria-label="Help"
            title="Help"
            onClick={() => navigate('/help')}
          >
            <LifeBuoy size={mobile ? 21 : 19} strokeWidth={2} />
          </button>
          <button
            className="flex-none -ml-1 rounded-full flex items-center justify-center text-ink-3 hover:bg-ink/[.06]"
            style={mobile ? { width: 44, height: 44 } : { width: 38, height: 38 }}
            aria-label={searchOpen ? 'Close search' : 'Search'}
            title={searchOpen ? 'Close search (Esc)' : 'Search (/)'}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <Search size={mobile ? 20 : 18} strokeWidth={2} />
          </button>
          {/* Goes to Settings in either sign-in state, so no separate gear is needed here. */}
          <div className="flex-none ml-[6px]">
            <SignedInBadge user={user} size={mobile ? 40 : 34} atRisk={!user && hasLocalWorkWorthKeeping(lists, notes, highlights)} />
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
              placeholder={SEARCH_PLACEHOLDER}
              className="w-full h-[38px] border border-ink/[.22] rounded-field pl-3 pr-8 bg-field text-ui-md outline-none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full text-ink-4 hover:bg-ink/[.08] hover:text-ink"
              aria-label="Clear search"
              title="Clear search"
              onClick={closeSearch}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        )}
        {/* Named tabs rather than the icon toggle this used to be: two unlabelled glyphs in the
            row above gave a reader nothing to guess from, and this is the only way to reach My
            lists. Kept last in the header so the active tab's underline always meets the header's
            own border, even with the search box open above it.

            Two buttons, not one control that flips: an underlined tab bar reads as "click the one
            you want", and clicking the tab you're already on should do nothing. The `x` shortcut
            still flips between them.

            Gone entirely once a query has results below: hits are drawn from the whole corpus
            regardless of which tab is active, so leaving a highlighted tab sitting above them
            would claim they were filtered by it.

            The -mx-2 cancels 8px of the header's own 22px side padding. On the right the rows
            below are inset 10px, but what sits at that edge is a round hover target with air
            around its glyph, so ending the underline at 10px overshoots what the eye reads as
            the edge and 22px falls short of it; 14px splits the two. The left gets the same 8px
            so the bar stays centred under the header above it — both tabs are flex-1 in this one
            row, so the margin moves the two outer ends together and the shared inner edge stays
            put. */}
        {!searching && (
          <div className="flex mt-4 -mx-2 font-sans text-ui-sm font-semibold">
            {(['library', 'lists'] as const).map((view) => (
              <button
                key={view}
                className={`flex-1 min-w-0 flex items-center justify-center gap-[9px] h-[42px] border-b-2 transition-colors ${
                  paneView === view ? 'border-accent-text text-ink' : 'border-transparent text-ink-4 hover:text-ink-2'
                }`}
                aria-pressed={paneView === view}
                title={view === 'library' ? 'Library (x)' : 'My Lists (x)'}
                onClick={() => setPaneView(view)}
              >
                {view === 'library' ? (
                  <Library size={mobile ? 17 : 16} strokeWidth={2} />
                ) : (
                  <List size={mobile ? 17 : 16} strokeWidth={2} />
                )}
                {view === 'library' ? 'Library' : 'Lists'}
              </button>
            ))}
          </div>
        )}
      </header>

      <HeaderBanner />

      {/* The inset clears the iOS home indicator, which this pane runs underneath in an installed
          PWA — added to the bottom padding rather than replacing it, since the last row wants
          breathing room on every other device too. */}
      <div
        ref={scrollRef}
        className="sc flex-1 pt-3"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {searching ? (
          <div>
            <div className="px-[22px] pt-3 pb-1.5 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3">
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
                      className={`row flex flex-col w-full text-left gap-[2px] px-[22px] py-[14px] border-b border-ink/[.07] ${i === searchActiveIndex ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => openHit(matchedId ?? id)}
                    >
                      <span>
                        <span className="font-sans text-ui-xs font-bold text-ink-3 mr-2.5">{sutta.ref}</span>
                        <span className="text-ui-lg font-semibold leading-[1.3]">{sutta.en}</span>
                      </span>
                      <span className="font-serif text-ui-base italic text-accent-text">{sutta.pali}</span>
                      {note && (
                        <span className="block font-serif text-ui-md leading-[1.4] mt-[6px] pl-[10px] border-l-2 border-ink/30">
                          {note}
                        </span>
                      )}
                      <SuttaRowChips chips={chips} hlCount={hlCount} />
                    </button>
                  );
                })}
                {hits.length === 0 && (
                  <div className="font-sans text-center text-ui-base text-ink-4 py-[30px] px-5">No matches.</div>
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

    </aside>
  );
}
