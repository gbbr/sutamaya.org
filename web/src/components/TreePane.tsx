import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@reach/router';
import { Highlighter, StickyNote, History, Library, List, Search, X } from 'lucide-react';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useLayout } from '../context/LayoutContext';
import { forgetScrollPosition, useScrollMemory } from '../hooks/useScrollMemory';
import { useScrollToNode } from '../hooks/useScrollToNode';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useListCrud } from '../hooks/useListCrud';
import { useListTreeDrag } from '../hooks/useListTreeDrag';
import { useActiveHitIndex } from '../hooks/useActiveHitIndex';
import { ancestorsOf, descendantIdsOf, findNode, flatSuttaOrder } from '../lib/corpus';
import {
  SEARCH_PLACEHOLDER,
  SEARCH_RESULTS_CAP,
  type ListHit,
  type SearchHit,
} from '../lib/search/metadata';
import { searchNoMatches, type TextSearchStatus } from '../lib/search/text';
import { beginTextSearchLoad } from '../lib/search/textClient';
import { ancestorsOfList, flattenListTree, suttaRowMeta } from '../lib/lists';
import { hasLocalWorkWorthKeeping } from '../lib/keepSafe';
import { derivePaneViewSync } from '../lib/paneView';
import { TREE_VIEW_KEY, TREE_EXPANDED_KEY } from '../lib/storageKeys';
import { RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from '../lib/autoLists';
import { SHORTCUTS, isShortcut } from '../lib/shortcuts';
import type { ListDef } from '../lib/types';
import { SignedInBadge } from './SignedInBadge';
import { HeaderBanner } from './HeaderBanner';
import { MatchedText } from './MatchedText';
import { TextSearchProgress } from './TextSearchProgress';
import { SearchListHits } from './SearchListHits';
import { SuttaRowChips } from './SuttaRowChips';
import { StagingCommit } from './StagingCommit';
import { type ListRowMenuProps, type ListRowEditProps, type ListRowDeleteProps, type ListRowDraftProps } from './ListRow';
import { CorpusTreeView } from './CorpusTreeView';
import { ListsTreeView } from './ListsTreeView';

interface PersistedExpansion {
  corpus: string[];
  lists: string[];
  // The node being browsed when this was written, so the next mount can tell a deep link from a
  // plain return to the pane, which is restored verbatim.
  node?: string;
}

// The expansion as it was last left, one id list per tree.
function loadPersistedExpansion(): PersistedExpansion {
  try {
    const raw = localStorage.getItem(TREE_EXPANDED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedExpansion>;
      return {
        corpus: Array.isArray(parsed.corpus) ? parsed.corpus : [],
        lists: Array.isArray(parsed.lists) ? parsed.lists : [],
        node: typeof parsed.node === 'string' ? parsed.node : undefined,
      };
    }
  } catch {
    // Unavailable or corrupt storage is simply nothing expanded.
  }
  return { corpus: [], lists: [] };
}

function toRecord(ids: string[]): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const id of ids) record[id] = true;
  return record;
}

// Which row the search cursor is on. The arrows walk the lists block and the sutta hits as one
// column, so it isn't necessarily a sutta.
export interface ActiveSearchRow {
  kind: 'list' | 'sutta';
  id: string;
}

interface TreePaneProps {
  nodeId?: string;
  onSelect: (nodeId: string) => void;
  // `segment` is where a text hit was found, and where the reader opens; absent for every other row.
  onOpenSutta: (suttaId: string, segment?: number) => void;
  onSearch: (query: string) => void;
  query: string;
  // The sutta hits, scanned once by LibraryPage and shared with ListPane, which draws the rows on
  // desktop; this pane keeps the input and the keyboard nav.
  hits: SearchHit[];
  // The list hits, already trimmed to what renders, so both panes agree on which rows exist.
  listHits: ListHit[];
  listHitTotal: number;
  // Whether the sutta text is searchable yet, which is all the empty state says about it.
  textStatus: TextSearchStatus;
  // Whether the results are waiting on that text, said in place of the rows.
  textPending: boolean;
  // Whether `hits` is the complete answer to the query, which the scroll restore waits for.
  hitsSettled?: boolean;
  listsExpanded: boolean;
  onToggleListsExpanded: () => void;
  // Reports the arrow-key cursor's row, so ListPane can mirror it on desktop.
  onActiveHitChange?: (row: ActiveSearchRow | undefined) => void;
  // The hit to start the search cursor on, rather than the first: the result this mount is a
  // return from.
  restoreHitId?: string;
  // False while this pane is mounted but hidden on mobile, which useScrollMemory needs to know:
  // a box with no scroll extent can't be restored into.
  visible?: boolean;
  // True when this mount is a reader-close round trip, which suppresses the Library/My lists sync
  // below once — such a `nodeId` is often a corpus node even though My lists was open.
  restoreOrigin?: boolean;
  // The breadcrumb segment last clicked in the reader, briefly scrolled to and highlighted; it may
  // sit above `nodeId`, and doesn't affect what is browsed.
  flashNodeId?: string;
  // True when this mount came from a breadcrumb click. Set at mount, unlike `flashNodeId`, which
  // arrives a tick later so it can be timed out.
  breadcrumbArrival?: boolean;
  // True while the library's "?" modal is open, which stands this pane's own shortcuts down.
  shortcutsOpen?: boolean;
}

export function TreePane({
  nodeId,
  onSelect,
  onOpenSutta,
  onSearch,
  query,
  hits,
  listHits,
  listHitTotal,
  textStatus,
  textPending,
  hitsSettled = true,
  listsExpanded,
  onToggleListsExpanded,
  onActiveHitChange,
  restoreHitId,
  visible = true,
  restoreOrigin = false,
  flashNodeId,
  breadcrumbArrival = false,
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
  } = useUserData();
  const { user } = useAuth();
  const { mobile, paneW } = useLayout();

  // The pane's scroll, held until the mirror lands and the results are complete: the My lists block
  // sits above the tree, and the sutta text's hits arrive under the metadata ones, either of them
  // moving the rows under a restored position. Results are remembered apart from the tree, the two
  // sharing this one column but not each other's places in it.
  const scrollKey = query.trim() ? 'tree:search' : 'tree';
  const scrollRef = useScrollMemory<HTMLDivElement>(scrollKey, visible, { readyToRestore: ready && hitsSettled });
  // A new query opens at the top, and forgets where the query before it was left. Not the query
  // this mount arrived on, whose offset is what the restore above is putting back, and not a
  // cleared one, which hands the column back to the tree and its own offset.
  const lastQueryRef = useRef(query.trim());
  useEffect(() => {
    const q = query.trim();
    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;
    if (!q) return;
    forgetScrollPosition(scrollKey);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query, scrollKey, scrollRef]);
  // Read synchronously at mount rather than in an effect: useScrollMemory restores in a layout
  // effect, and a tree still collapsed then clamps the restored offset to 0.
  const [persistedExpansion] = useState(loadPersistedExpansion);
  // Whether this mount should reveal `nodeId` — open its ancestors and point the toggle at its
  // tree. True for a navigation: a deep link, a membership chip, a breadcrumb click. A mount on
  // the node last persisted is a return to the pane instead, restored exactly as it was left.
  const revealNow = nodeId !== persistedExpansion.node || breadcrumbArrival;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    ...toRecord(persistedExpansion.corpus),
    ...(revealNow ? ancestorsOf(corpus, nodeId) : {}),
  }));
  // Which of the two trees has the column. Never gated on being signed in, a signed-out reader's
  // lists living in the local mirror.
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

  // Points the toggle at whichever tree `nodeId` lives in. Keyed on whether it is a list id rather
  // than on `lists`, which a reorder hands back anew with the same ids — re-running on that would
  // snap the pane to the library after every drag.
  const nodeIsListId = lists.some((l) => l.id === nodeId);
  const mountedRef = useRef(false);
  useEffect(() => {
    const isFirstRun = !mountedRef.current;
    mountedRef.current = true;
    const next = derivePaneViewSync({
      isFirstRun,
      restoreOrigin,
      returningToSameNode: !revealNow,
      nodeId,
      nodeIsListId,
      nodeIsCorpusNode: !!(corpus && nodeId && findNode(corpus, nodeId)),
    });
    if (next) setPaneView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeIsListId, corpus]);

  // Opens `toOpen` in one of the two trees' expansion maps, collapsing nothing already open.
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

  // The node already revealed, seeded with `nodeId` on a return to the pane so the effects below
  // don't undo the mount-time suppression a moment later. Advanced only once there was something
  // to open, the corpus and the lists both being able to arrive after this first renders.
  const revealedNodeRef = useRef<string | undefined>(revealNow ? undefined : nodeId);
  const revealedListNodeRef = useRef<string | undefined>(revealNow ? undefined : nodeId);

  useEffect(() => {
    if (revealedNodeRef.current === nodeId) return;
    const toOpen = ancestorsOf(corpus, nodeId);
    if (!Object.keys(toOpen).length) return;
    revealedNodeRef.current = nodeId;
    expandIds(setExpanded, toOpen);
  }, [corpus, nodeId]);

  useEffect(() => {
    if (revealedListNodeRef.current === nodeId) return;
    const toOpen = ancestorsOfList(lists, nodeId);
    if (!Object.keys(toOpen).length) return;
    revealedListNodeRef.current = nodeId;
    expandIds(setListExpanded, toOpen);
  }, [lists, nodeId]);

  // Expands or collapses a corpus row. `deep` — ⌥-click — closes its whole subtree rather than
  // hiding it with the descendants still flagged open, and only ever collapses: ⌥-clicking a
  // closed row opens just that row, a nikaya's whole subtree being enough to bury the pane.
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
  // Seeded synchronously as `expanded` is, so a mount pointed at a nested list is expanded to it
  // on the first render.
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>(() => ({
    ...toRecord(persistedExpansion.lists),
    ...(revealNow ? ancestorsOfList(lists, nodeId) : {}),
  }));
  // Persists both trees' expansion under one key. Undebounced, this being click-driven rather than
  // continuous.
  useEffect(() => {
    try {
      localStorage.setItem(
        TREE_EXPANDED_KEY,
        JSON.stringify({
          corpus: Object.keys(expanded).filter((id) => expanded[id]),
          lists: Object.keys(listExpanded).filter((id) => listExpanded[id]),
          node: nodeId,
        })
      );
    } catch {
      // storage unavailable — ignore
    }
  }, [expanded, listExpanded, nodeId]);
  // Whether the search input is showing. Seeded from whether a query is already present, so a
  // pre-populated one can't leave results on screen with no way to see what is being searched.
  const [searchOpen, setSearchOpen] = useState(() => query.trim().length > 0);
  // Closes the input once a list from the results is opened, a destination rather than a
  // refinement. Keyed on the browsed node, since the row can be clicked in either pane and only
  // the node reaches this one.
  useEffect(() => {
    if (!query.trim()) setSearchOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);
  const searchInput = useRef<HTMLInputElement>(null);
  // The search cursor. It starts at 0, so Enter opens the first result with no arrow press first.
  const {
    activeIndex: searchActiveIndex,
    activeIndexRef: searchActiveIndexRef,
    setActiveIndex: setSearchActiveIndex,
    moveBy: moveSearchActiveIndexBy,
    setRowRef: setHitRowRef,
  } = useActiveHitIndex(query);

  const { listChildrenOf, countFor, deleteScopeFor, topLevelLists } = useListTreeIndex(lists);

  const autoLists = useMemo(
    () =>
      [
        // "Recently", where the other two say "Suttas you've …": this is the one that holds a
        // window rather than the whole of what the reader has done.
        { list: lists.find((l) => l.id === RECENT_AUTO_LIST_ID), sub: 'Recently opened suttas', Icon: History },
        { list: lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID), sub: "Suttas you've highlighted", Icon: Highlighter },
        { list: lists.find((l) => l.id === NOTES_AUTO_LIST_ID), sub: "Suttas you've written notes in", Icon: StickyNote },
      ].filter((x): x is { list: ListDef; sub: string; Icon: typeof Highlighter } => !!x.list),
    [lists]
  );

  // Expands or collapses a list row, `deep` closing everything under it too.
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
    // A new list is a place to go; a new group isn't, its row expanding in place rather than
    // opening a page.
    onCreated: (list) => {
      if (list.kind !== 'group') navigate(`/browse/${list.id}`);
    },
  });

  const { reorderMode, setReorderMode, dragId, indicator, onRowPointerDown, getRowRef } = useListTreeDrag({
    lists,
    listChildrenOf,
    topLevelLists,
    scrollRef,
    setListExpanded,
    reorderLists,
  });

  // Whether reorder mode has anything to do, both reordering and nesting needing a second row to
  // move against. The toggle is hidden rather than disabled, and the mode forced off below, which
  // would otherwise strand it on with no control to leave it by.
  const canReorderLists = useMemo(() => lists.filter((l) => !l.auto).length >= 2, [lists]);
  useEffect(() => {
    if (!canReorderLists) setReorderMode(false);
  }, [canReorderLists, setReorderMode]);

  const searching = query.trim().length > 0;
  // The heading over the results, naming suttas rather than results wherever lists matched too,
  // and counting those lists beside them — the block that draws them is capped, so nothing else
  // says how many there are. A result set past the cap reads "80+".
  function resultsHeading(): string {
    const noun = listHitTotal > 0 ? 'sutta' : 'result';
    const suttas =
      hits.length > SEARCH_RESULTS_CAP
        ? `${SEARCH_RESULTS_CAP}+ ${noun}s`
        : `${hits.length} ${noun}${hits.length === 1 ? '' : 's'}`;
    if (listHitTotal === 0) return suttas;
    return `${suttas} · ${listHitTotal} list${listHitTotal === 1 ? '' : 's'}`;
  }
  // The hits actually rendered and keyboard-navigable; `hits` stays uncapped, so the count in the
  // heading is honest.
  const displayHits = useMemo(() => hits.slice(0, SEARCH_RESULTS_CAP), [hits]);

  // The chips and highlight count for each hit, needed here because mobile has no ListPane.
  const flatLists = useMemo(() => flattenListTree(lists), [lists]);
  const searchRowMeta = useMemo(
    () => suttaRowMeta(displayHits.map((h) => h.id), membership, highlights, flatLists),
    [displayHits, membership, highlights, flatLists]
  );

  // The one column the arrows walk: the lists block, then the sutta hits, in the order both panes
  // draw them. Built here, this pane owning the nav even where ListPane renders the rows.
  const navRows: ActiveSearchRow[] = useMemo(
    () => [
      ...listHits.map((h) => ({ kind: 'list' as const, id: h.list.id })),
      ...displayHits.map((h) => ({ kind: 'sutta' as const, id: h.id })),
    ],
    [listHits, displayHits]
  );

  // Puts the cursor on the result the reader opened, so a closed reader lands back on the row it
  // was opened from. Set once, when that row appears: a hit the sutta text alone found arrives
  // after the metadata ones.
  const [cursorSeeded, setCursorSeeded] = useState(!restoreHitId);
  useEffect(() => {
    if (cursorSeeded) return;
    const i = navRows.findIndex((row) => row.kind === 'sutta' && row.id === restoreHitId);
    if (i < 0) return;
    setSearchActiveIndex(i);
    setCursorSeeded(true);
  }, [cursorSeeded, navRows, restoreHitId, setSearchActiveIndex]);

  // Opens row `i`: a list selects it in the pane beside this one, a sutta opens the reader.
  function openRow(i: number) {
    const listHit = listHits[i];
    if (listHit) {
      onSelect(String(listHit.list.id));
      return;
    }
    const hit = displayHits[i - listHits.length];
    if (hit) openHit(hit.matchedId ?? hit.id, hit.snippet?.segment);
  }

  // Reports the cursor's row up to LibraryPage, so ListPane can draw the same highlight.
  useEffect(() => {
    onActiveHitChange?.(searching ? navRows[searchActiveIndex] : undefined);
  }, [searching, searchActiveIndex, navRows, onActiveHitChange]);

  // Hides the search input and clears the query — always both, so no call site has to decide.
  function closeSearch() {
    setSearchOpen(false);
    onSearch('');
  }

  // Opens a hit in the reader, leaving the search as it is: navigate() lands a frame later, so
  // clearing it here would paint a frame of the bare tree, and the route change unmounts this pane.
  function openHit(id: string, segment?: number) {
    onOpenSutta(id, segment);
  }

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      // The shortcuts modal owns every key while it is open.
      if (shortcutsOpen) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      // The arrows and Enter work while the search input has focus, the normal state while results
      // are showing, but not while any other field does. '/' and 'x' below stand down for all of
      // them, being characters that can be typed.
      const isSearchInput = e.target === searchInput.current;
      if (searching && navRows.length > 0 && !(tag === 'textarea' || (tag === 'input' && !isSearchInput))) {
        if (isShortcut(e, SHORTCUTS.librarySelectMove)) {
          e.preventDefault();
          moveSearchActiveIndexBy(e.key === 'ArrowDown' ? 1 : -1, navRows.length);
          return;
        }
        if (isShortcut(e, SHORTCUTS.librarySelectOpen) && searchActiveIndexRef.current < navRows.length) {
          e.preventDefault();
          openRow(searchActiveIndexRef.current);
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
  }, [searching, navRows, displayHits, listHits, searchOpen, onOpenSutta, onSelect, shortcutsOpen]);

  // Scrolls to the browsed node, retrying on each state change the expand effects above make: its
  // row usually isn't in the DOM yet on the render `nodeId` changed on.
  useScrollToNode(scrollRef, nodeId, [paneView, expanded, listExpanded, corpus, lists]);
  // Second, so a breadcrumb's own segment — which may sit above `nodeId` — wins the final position.
  useScrollToNode(scrollRef, flashNodeId, [paneView, expanded, listExpanded, corpus, lists]);

  // ListRow's props, bundled by concern and memoized, so ListRow's own memoization holds. Built
  // above the `if (!corpus)` bail, hooks not being able to run conditionally.
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
      deleteScopeFor,
    }),
    [confirmDeleteId, deleteList, cancelDeleteList, deleteScopeFor]
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
      {/* No bottom padding while the tabs are up, their underline having to land on this border
          for the two to read as one edge; without them the padding comes back, or the search box
          sits on the rule. */}
      <header className={`flex-none px-[22px] pt-5 border-b border-ink/10 ${searching ? 'pb-4' : ''}`}>
        {/* The wordmark and the destinations away from the two trees: help, search, the account.
            The Library/My lists switch gets its own row below rather than joining them, being the
            navigation the app lives behind rather than more chrome. */}
        <div className="flex items-center gap-2">
          <div className="text-ui-3xl font-semibold tracking-[-.01em] flex-1 truncate" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
          {/* The three controls, sized alike so they share a vertical centre. Their spacing is set
              per gap rather than by the row: the two icons are transparent boxes around a glyph
              with air either side, and the badge a circle filling its box, so an even gap reads as
              uneven. A glyph of a different ink width means re-checking those two numbers. */}
          <button
            className="flex-none rounded-full flex items-center justify-center text-ink-3 hover:bg-ink/[.06]"
            style={mobile ? { width: 44, height: 44 } : { width: 38, height: 38 }}
            aria-label="Help"
            title="Help"
            onClick={() => navigate('/help')}
          >
            {/* A typeset question mark in a drawn ring, in the wordmark's own face — an icon `?`
                closes its hook into a blob at this size. The ring is lighter than the neighbouring
                glyphs' stroke, being the affordance rather than the thing read, and `currentColor`
                puts it on the button's own hover.

                The nudge down corrects a line box centred where the glyph is not: Newsreader's
                baseline sits 0.735em down and this `?` inks from −0.007em to 0.680em, leaving its
                centre 0.1015em high. In em, so it survives a size change.

                The size matches what the search icon actually paints rather than its nominal size:
                lucide fills 18 of its 24 units, and a ring fills its own width, so 20 at a lighter
                stroke is where the two settle to the same weight. */}
            <span
              className="flex items-center justify-center rounded-full border-[1.25px] border-current"
              style={{ width: mobile ? 22 : 20, height: mobile ? 22 : 20 }}
            >
              <span
                className="block"
                style={{
                  fontFamily: 'Newsreader, Georgia, serif',
                  fontWeight: 500,
                  fontSize: mobile ? 14 : 13,
                  lineHeight: 1,
                  transform: 'translateY(.1015em)',
                }}
              >
                ?
              </span>
            </span>
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
          {/* The account badge, which opens Settings either way, so no gear is needed. */}
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
                // Stopped here: closing the box is a complete action for this key while the input
                // has focus.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSearch();
                } else if (e.key === 'Enter' && !query.trim()) {
                  // An empty query has nothing to submit, so Enter closes as Escape does.
                  e.preventDefault();
                  closeSearch();
                }
              }}
              // The search text is fetched on the first focus of a search field, so it is usually
              // there by the time anything has been typed.
              onFocus={() => beginTextSearchLoad(corpus)}
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
        {/* Named tabs, since this is the only way to reach My lists and an unlabelled glyph gives a
            reader nothing to guess from. Last in the header, so the active tab's underline meets
            the header's own border even with the search box open above it. Two buttons rather than
            one flipping control, so clicking the tab you are on does nothing; the `x` shortcut
            still flips.

            Gone while a query has results, which are drawn from the whole corpus whichever tab is
            active, and a highlighted tab above them would claim otherwise.

            The negative margin cancels 8px of the header's padding at both ends, splitting the
            difference between the header's own edge and the inset of the rows below, whose own
            edge is a round hover target with air around its glyph. */}
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

      {/* The scrolling column. The safe-area inset is added to the bottom padding rather than
          replacing it, the last row wanting room on every device. */}
      <div
        ref={scrollRef}
        className="sc flex-1 pt-3"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {searching ? (
          <div>
            {/* Mobile only, as the hit rows below are: ListPane draws this block on desktop. */}
            {mobile && (
              <SearchListHits
                hits={listHits}
                total={listHitTotal}
                expanded={listsExpanded}
                onToggleExpanded={onToggleListsExpanded}
                query={query}
                activeId={navRows[searchActiveIndex]?.kind === 'list' ? navRows[searchActiveIndex].id : undefined}
                onSelect={onSelect}
                padX="px-[22px]"
              />
            )}
            {/* Skipped where the lists block is the whole answer, a "0 suttas" heading under it
                reading as a failed search. */}
            {(hits.length > 0 || listHitTotal === 0) && (
              <div className="px-[22px] pt-3 pb-1.5 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3">
                {resultsHeading()}
              </div>
            )}
            {/* The hit rows, mobile only — on desktop ListPane draws them beside this pane, with
                the blurb this narrower column leaves out. */}
            {mobile && (
              <>
                {displayHits.map(({ id, sutta, snippet }, i) => {
                  const note = notes[id];
                  const { chips, hlCount, hlColors } = searchRowMeta.get(id) ?? { chips: [], hlCount: 0, hlColors: [] };
                  // This row's place in the shared column, past the lists block above it.
                  const navIndex = i + listHits.length;
                  return (
                    <button
                      key={id}
                      ref={setHitRowRef(navIndex)}
                      className={`row flex flex-col w-full text-left gap-[2px] px-[22px] py-[14px] border-b border-ink/[.07] ${navIndex === searchActiveIndex ? 'bg-ink/[.06]' : ''}`}
                      onClick={() => openRow(navIndex)}
                    >
                      <span>
                        <span className="font-sans text-ui-xs font-bold text-ink-3 mr-2.5">
                          <MatchedText text={sutta.ref} query={query} />
                        </span>
                        <span className="text-ui-lg font-semibold leading-[1.3]">
                          <MatchedText text={sutta.en} query={query} />
                        </span>
                      </span>
                      <span className="font-serif text-ui-base italic text-accent-text">
                        <MatchedText text={sutta.pali} query={query} />
                      </span>
                      {snippet ? (
                        // Quoted from the sutta: a left rule, which is what marks the sutta's own
                        // words apart from anything written about it.
                        <span className="block font-serif text-ui-md leading-[1.45] mt-[6px] pl-[10px] border-l-2 border-ink/25 text-ink-2">
                          {/* No `block` alongside a clamp: the clamp sets `display:-webkit-box` and
                              Tailwind emits it before `.block`, so `block` would silently win. */}
                          <span className={`line-clamp-3 ${snippet.under ? 'italic text-accent-text' : ''}`}>
                            <MatchedText text={snippet.text} query={snippet.query} />
                          </span>
                          {snippet.under && (
                            <span className="line-clamp-2 mt-[3px]">
                              <MatchedText text={snippet.under} query={snippet.query} />
                            </span>
                          )}
                        </span>
                      ) : (
                        note && (
                          // An em dash rather than a quote rule marks this as the reader's own note.
                          <span className="flex gap-[7px] font-serif text-ui-md leading-[1.4] mt-[6px] text-ink-2">
                            <span aria-hidden className="flex-none text-ink-3">
                              —
                            </span>
                            <span className="whitespace-pre-wrap">
                              <MatchedText text={note} query={query} notation />
                            </span>
                          </span>
                        )
                      )}
                      <SuttaRowChips chips={chips} hlCount={hlCount} hlColors={hlColors} />
                    </button>
                  );
                })}
                {/* Where the results are, until the sutta text lands and the ranking they wait on
                    with it. */}
                {textPending && <TextSearchProgress />}
                {hits.length === 0 && listHitTotal === 0 && !textPending && (
                  <div className="font-sans text-center text-ui-base text-ink-4 py-[30px] px-5 text-balance">
                    {searchNoMatches(textStatus)}
                  </div>
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
            canReorder={canReorderLists}
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

      <StagingCommit />
    </aside>
  );
}
