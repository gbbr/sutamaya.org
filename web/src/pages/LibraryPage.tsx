import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { flatSuttaOrder, sortByIdAsc, suttasFor } from '../lib/corpus';
import { SHORTCUTS, shortcutsForScope, isShortcut, isTypingTarget } from '../lib/shortcuts';
import { LIBRARY_VIEW_KEY, READER_ORIGIN_KEY, ROUTE_INTENT_KEY } from '../lib/storageKeys';
import { consumeIntent, type RouteIntent } from '../lib/routeIntent';
import { TreePane } from '../components/TreePane';
import { ListPane } from '../components/ListPane';
import { ShortcutsModal } from '../components/ShortcutsModal';

// Tree/list divider hit area — split asymmetrically around the boundary rather than centered on
// it, since a naive symmetric widening runs into two different edges' content:
//  - TreePane's "List options" row button sits flush against the pane's right edge (pr-[10px],
//    20px button — see TreePane.tsx's ListRow), so the reach backward (into the tree pane) stays
//    inside that 10px padding buffer.
//  - ListPane's own rows are `px-5` (20px) with the row itself being the full-width tap target
//    (TreePane.tsx's counterpart, ListPane.tsx ~L264), so the reach forward (into the list pane)
//    is kept well short of where the row's visible text actually starts, rather than visually
//    bleeding into it.
// Nothing is drawn here — only the cursor and drag behavior live in this strip.
const TREE_LIST_HIT_BEFORE = 8;
const TREE_LIST_HIT_AFTER = 14;

export function LibraryPage({
  nodeId: routeNodeId,
  suttaId: rawSuttaId,
  location,
}: RouteComponentProps<{ nodeId: string; suttaId?: string }>) {
  // `suttaId` is a splat segment (see App.tsx) so both /browse/:nodeId and
  // /browse/:nodeId/:suttaId are the *same* route element — giving it '' rather than undefined
  // when absent, and keeping LibraryPage mounted (with all its local state, including every
  // pane's scroll position) across selecting/deselecting a highlighted row, instead of the
  // full remount+state-loss that two separate <LibraryPage> route elements caused (reach-router
  // auto-keys route children by position, so switching which one matched was a key change).
  const { mobile, dragTree, resetTree, paneW } = useLayout();
  const { corpus } = useCorpus();
  const { lists, notes } = useUserData();
  // @reach/router defers the actual route-param update by a microtask + rAF after navigate()
  // (see LocationProvider.componentDidMount in @reach/router/lib/history.js), so reading
  // `rawSuttaId`/`routeNodeId` straight from route props here would render one frame with
  // whatever *new* local UI state a navigation handler flips synchronously (`view`, or
  // Up/Down's `nodeId` below) paired with the *stale* id from props — on mobile that's a
  // visible flash of the previous/empty list before the correct one appears (the "flickers,
  // needs a second tap" bug); for Up/Down specifically it read as the step not "continuing"
  // from wherever you already were, since the highlighted row would revert to the old sutta for
  // a frame before catching up. Mirroring both ids into local state, set synchronously alongside
  // whatever else a given navigation changes, keeps every render consistent; the effects below
  // just keep them truthful for back/forward/deep-link navigation that doesn't go through one of
  // this page's own handlers.
  const [suttaId, setSuttaId] = useState(rawSuttaId || undefined);
  useEffect(() => {
    setSuttaId(rawSuttaId || undefined);
  }, [rawSuttaId]);
  // `/read/:suttaId` and `/settings` are both genuinely separate routes (full-screen, not one of
  // this page's panes), so navigating to either fully unmounts LibraryPage — `view` can't just
  // default to 'tree' here, or mobile would show the browse tree instead of the sutta list the
  // user was just looking at, which reads as "my place got reset". A reader round trip carries
  // the pane it was opened from back in `location.state.fromView` (see onOpen below and
  // ReaderPage's own `from`/`fromView`), so that takes priority when present — it's the only way
  // to know the user was actually on 'tree' (e.g. searched and opened a hit straight from there)
  // rather than 'list'. Absent that (a fresh deep link to a specific sutta, e.g. tapping a
  // list-membership chip in the Reader), a suttaId in the URL still means start on 'list' so the
  // highlighted row is actually visible; otherwise fall back to whichever pane was last shown,
  // persisted the same way as TreePane's own Library/My Lists toggle (`sutamaya.treeView`), since
  // a plain in-memory default can't survive the remount either.
  // Whether this mount is a reader-close round trip (as opposed to an explicit chip/breadcrumb
  // click or a fresh deep link) — see TreePane's own `restoreOrigin` prop for why its Library/My
  // lists toggle needs to know this on top of `fromView` above.
  // `restoreOrigin` only ever *suppresses* TreePane's own corrective sync (see its own prop
  // comment) — trusting a stale, refresh-resurrected `true` here is harmless (worst case: skips a
  // sync that would've been a no-op), so it's read straight off location.state on every render,
  // unlike the one-shot values below.
  const restoreOrigin = !!(location?.state as { restoreOrigin?: boolean } | undefined)?.restoreOrigin;
  // `fromView`/`flashNodeId`, by contrast, are values meant to apply to exactly one arrival (a
  // reader-close round trip, a breadcrumb click) — location.state set by navigate() survives a
  // same-tab refresh (the browser keeps history.state for the current entry across a reload), so
  // trusting them unconditionally let a refresh resurrect a stale value and silently override a
  // pane switch made by hand since (the single most-patched bug in this component's history — see
  // lib/routeIntent.ts). Consumed exactly once via a lazy initializer, the same one-shot guarantee
  // `view`'s own initializer below relies on, so a stale resurrection reads as "no intent" and
  // falls through to persisted preference instead.
  const [consumedIntent] = useState(() =>
    consumeIntent(
      location?.state as ({ fromView?: 'tree' | 'list'; flashNodeId?: string } & RouteIntent) | null | undefined,
      ROUTE_INTENT_KEY
    )
  );
  // A breadcrumb click in the reader (see ReaderPage) always lands here on the sutta's own leaf
  // group — that part doesn't change — but also names which specific ancestor segment was
  // actually clicked, so the tree pane can briefly scroll to and highlight that exact row (which
  // may be higher up the chain than the leaf group itself) without disturbing anything else this
  // page already does. Cleared on a timer rather than left to linger, since it's a "here's where
  // that was" pointer, not a real selection.
  const locationFlashNodeId = consumedIntent?.flashNodeId as string | undefined;
  const [flashNodeId, setFlashNodeId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!locationFlashNodeId) return;
    setFlashNodeId(locationFlashNodeId);
    const t = window.setTimeout(() => setFlashNodeId(undefined), 1600);
    return () => window.clearTimeout(t);
  }, [locationFlashNodeId]);
  const [view, setView] = useState<'tree' | 'list'>(() => {
    const fromView = consumedIntent?.fromView;
    if (fromView === 'tree' || fromView === 'list') return fromView;
    // A bare suttaId in the URL with *no* router state at all means a genuinely fresh arrival
    // that never went through one of this app's own navigate() calls — a bookmark, a typed URL,
    // or a list-membership chip tap in the Reader (which sets no state) — where 'list' is the
    // only way to actually reveal the highlighted row. A mount that *did* carry state (even once
    // the one-shot intent above is stale/already-consumed — e.g. refreshing after a manual pane
    // switch made without navigating, like ListPane's Back button) came from an in-app
    // navigation, so persisted preference is the more trustworthy signal there instead of this
    // generic fallback.
    if (suttaId && !location?.state) return 'list';
    try {
      const stored = localStorage.getItem(LIBRARY_VIEW_KEY);
      if (stored === 'list' || stored === 'tree') return stored;
    } catch {
      // storage unavailable — ignore
    }
    return 'tree';
  });
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_VIEW_KEY, view);
    } catch {
      // storage unavailable — ignore
    }
  }, [view]);
  const [query, setQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Computed once here (not independently by TreePane and ListPane, which used to each run their
  // own searchCorpus scan on every keystroke) and handed down to both, so they render one
  // consistent result set instead of two — TreePane keeps its own input/keyboard nav, ListPane
  // does the actual row rendering; see both components for how they split it. useCorpusSearch
  // itself defers the scan off `query` so the input stays instantly responsive even while a
  // slower device is still catching up (same hook ReaderSearchOverlay uses for its own scan).
  const hits = useCorpusSearch(corpus, query, notes, lists);
  // The hit TreePane's own arrow-key nav currently has highlighted, mirrored here so ListPane
  // (which renders the actual rows on desktop) can show that same highlight — see TreePane's
  // onActiveHitChange and ListPane's activeId.
  const [activeSearchId, setActiveSearchId] = useState<string | undefined>(undefined);

  const [nodeId, setNodeId] = useState(routeNodeId);
  useEffect(() => {
    setNodeId(routeNodeId);
  }, [routeNodeId]);

  // useCallback-wrapped (not inline arrows at the JSX call sites below) so these stay
  // referentially stable across renders that don't actually change what they'd do — e.g.
  // TreePane's keydown effect depends on `onOpenSutta`, so a fresh function identity on every
  // LibraryPage render (typing in the search box re-renders this page on every keystroke) would
  // otherwise tear down and re-add that window-level listener once per keystroke.
  const onSelectNode = useCallback((id: string) => {
    setQuery('');
    setView('list');
    setNodeId(id);
    setSuttaId(undefined);
    navigate(`/browse/${encodeURIComponent(id)}`);
  }, []);

  const onOpen = useCallback(
    (id: string) => {
      // `from`/`fromView` round-trip through the reader's own navigate() calls (Prev/Next, its
      // search overlay) so that whenever it's closed — however many suttas later — it lands back
      // on exactly this pane/nodeId/scroll position instead of falling back to the sutta's bare
      // corpus location (see ReaderPage's closeReader, and this page's own `view` init above for
      // why `fromView` specifically is needed on top of the URL alone).
      //
      // A *search* hit is the one case where the opened id isn't actually a member of whatever
      // `nodeId` currently is — search spans the whole corpus regardless of what's browsed, so a
      // hit found while browsing category A can easily live in category B. Browsing straight
      // (tapping a row in the tree/a list) never has this mismatch: the clicked row is always
      // already a member of `nodeId`'s own contents. Returning to A afterward would show the
      // tree/list pane on a category the reopened sutta doesn't even belong to (on mobile, the
      // "wrong tree pane" bug) — using the sutta's own node instead lands back on where it
      // actually lives, the same place a bare deep link to it would.
      const returnNodeId = query.trim() && corpus?.suttas[id] ? corpus.suttas[id].node : nodeId;
      const from = `/browse/${encodeURIComponent(returnNodeId || '')}/${encodeURIComponent(id)}`;
      // Also persisted (not just carried in router state) so ReaderPage's own close can still
      // return to this pane/location after a hard refresh, which drops location.state entirely
      // (browser-native — a fresh navigation's history entry has none) — see ReaderPage's
      // closeReader for the fallback that reads this back.
      try {
        localStorage.setItem(READER_ORIGIN_KEY, JSON.stringify({ suttaId: id, from, fromView: view }));
      } catch {
        // storage unavailable — ignore
      }
      navigate(`/read/${encodeURIComponent(id)}`, { state: { from, fromView: view } });
    },
    [nodeId, view, query, corpus]
  );

  const showTreePane = !mobile || view === 'tree';
  const showListPane = !mobile || view === 'list';

  // The whole corpus in canonical browse order — same list ReaderPage's own Prev/Next walks —
  // so Up/Down below can step across a category boundary once the current one runs out, rather
  // than stopping at its edge.
  const suttaOrder = useMemo(() => (corpus ? flatSuttaOrder(corpus) : []), [corpus]);

  // Up/Down move the highlighted row through the list (tree pane follows along); Enter opens it
  // into the full reader. Both key off `suttaId` itself (whether the URL ends in a sutta, i.e.
  // `/browse/:nodeId/:suttaId`), not any pane's visibility — a sutta can be "selected" this way
  // on mobile too (e.g. the reader closed back to this view via its `from` state — see
  // ReaderPage), and that URL sutta is the only well-defined "current" item to step from or open
  // (see ListPane's matching `on` highlight).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While open, the help modal owns every key itself — Esc or '?' again both close it,
      // mirroring how every other overlay in this app closes.
      if (shortcutsOpen) {
        if (e.key === 'Escape' || isShortcut(e, SHORTCUTS.libraryHelp)) {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      if (isTypingTarget(e)) return;
      if (isShortcut(e, SHORTCUTS.libraryHelp)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (!corpus) return;
      if (isShortcut(e, SHORTCUTS.librarySelectOpen)) {
        if (!suttaId) return;
        e.preventDefault();
        onOpen(suttaId);
        return;
      }
      if (!isShortcut(e, SHORTCUTS.librarySelectMove)) return;
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      // Browsing a user list, Up/Down stays inside it — stepping through *that* list's own
      // items in its own stored order, never touching `nodeId`, and stopping dead at either end
      // rather than spilling into the canonical corpus order. Jumping away to wherever a sutta
      // happens to live in the tree would defeat the point of viewing a curated list at all (its
      // whole reason to exist is a different order/subset than the corpus's own).
      const currentList = lists.find((l) => l.id === nodeId);
      if (currentList) {
        const items = currentList.items;
        // Nothing selected yet (Up/Down pressed with the list pane not "active") — start from
        // its first item rather than doing nothing, regardless of which direction was pressed.
        if (!suttaId) {
          const first = items[0];
          if (!first) return;
          e.preventDefault();
          setSuttaId(first);
          navigate(`/browse/${encodeURIComponent(nodeId || '')}/${encodeURIComponent(first)}`);
          return;
        }
        const i = items.indexOf(suttaId);
        if (i === -1) return;
        const next = items[i + dir];
        if (!next) return;
        e.preventDefault();
        setSuttaId(next);
        navigate(`/browse/${encodeURIComponent(nodeId || '')}/${encodeURIComponent(next)}`);
        return;
      }
      // Otherwise (browsing the corpus tree itself), step through the whole corpus's canonical
      // order instead, which can land on a sutta outside whatever's currently browsed (a
      // different category) — always re-deriving `nodeId` from the landed-on sutta's own corpus
      // node, the same way clicking it in the tree would, is what makes the tree pane (and the
      // list pane's contents) follow along and expand/scroll to the right place on that jump.
      if (!suttaId) {
        // Start from whatever category is already browsed (ListPane's own first row), not the
        // canonical corpus order's first sutta overall — that'd jump away from wherever the tree
        // pane already has nodeId pointed, which reads as teleporting rather than "starting".
        const first = (nodeId && sortByIdAsc(suttasFor(corpus, nodeId))[0]?.[0]) || suttaOrder[0];
        if (!first) return;
        e.preventDefault();
        const newNodeId = corpus.suttas[first].node;
        setQuery('');
        setNodeId(newNodeId);
        setSuttaId(first);
        navigate(`/browse/${encodeURIComponent(newNodeId)}/${encodeURIComponent(first)}`);
        return;
      }
      const i = suttaOrder.indexOf(suttaId);
      if (i === -1) return;
      const next = suttaOrder[Math.min(suttaOrder.length - 1, Math.max(0, i + dir))];
      if (!next || next === suttaId) return;
      e.preventDefault();
      const newNodeId = corpus.suttas[next].node;
      setQuery('');
      setNodeId(newNodeId);
      setSuttaId(next);
      navigate(`/browse/${encodeURIComponent(newNodeId)}/${encodeURIComponent(next)}`);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen, suttaId, suttaOrder, corpus, lists, nodeId]);

  return (
    <div data-component="LibraryPage" className="relative flex overflow-hidden bg-paper h-full">
      {/* Always mounted (never conditionally rendered) on mobile — a mounted-but-hidden pane
          keeps its scroll position and `expanded` tree state across a tree<->list toggle
          instead of losing them to a remount. `display:contents` when shown keeps this wrapper
          transparent to the flex layout, matching the unwrapped behavior exactly. The `visible`
          prop (-> useScrollMemory) handles the other half: a pane that mounts *while* hidden
          (e.g. LibraryPage remounting after the reader closes) can't restore its scroll then —
          a `display:none` box has no scroll extent, so `scrollTop = saved` just clamps to 0 —
          it restores instead the moment `visible` actually flips true. */}
      <div style={{ display: showTreePane ? 'contents' : 'none' }}>
        <TreePane
          nodeId={nodeId}
          onSelect={onSelectNode}
          onOpenSutta={onOpen}
          onSearch={setQuery}
          query={query}
          hits={hits}
          onActiveHitChange={setActiveSearchId}
          visible={showTreePane}
          restoreOrigin={restoreOrigin}
          flashNodeId={flashNodeId}
        />
      </div>

      {/* Positioned absolutely (rather than the zero-footprint negative-margin overlay this
          replaced) so the touch-friendly hit area can extend past the pane boundary on both
          sides without shifting either pane's width or fighting DOM paint order for which pane
          "wins" the overlap — z-10 keeps it grabbable above both panes' own content regardless. */}
      {!mobile && (
        <div
          className="absolute top-0 bottom-0 z-10 cursor-col-resize touch-none"
          style={{ left: paneW.tree - TREE_LIST_HIT_BEFORE, width: TREE_LIST_HIT_BEFORE + TREE_LIST_HIT_AFTER }}
          onPointerDown={dragTree}
          onDoubleClick={resetTree}
        />
      )}

      <div style={{ display: showListPane ? 'contents' : 'none' }}>
        <ListPane
          nodeId={nodeId}
          selectedId={suttaId}
          query={query}
          hits={hits}
          activeId={activeSearchId}
          onBack={() => setView('tree')}
          onOpen={onOpen}
          visible={showListPane}
        />
      </div>

      {shortcutsOpen && <ShortcutsModal shortcuts={shortcutsForScope('library')} onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
