import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useCorpusSearch } from '../hooks/useCorpusSearch';
import { flatSuttaOrder, nodeLabel, sortByIdAsc, suttasFor } from '../lib/corpus';
import { SHORTCUTS, shortcutsForScope, isShortcut, isTypingTarget } from '../lib/shortcuts';
import { LIBRARY_VIEW_KEY, READER_ORIGIN_KEY, ROUTE_INTENT_KEY } from '../lib/storageKeys';
import { consumeIntent, type RouteIntent } from '../lib/routeIntent';
import { TreePane } from '../components/TreePane';
import { ListPane } from '../components/ListPane';
import { ShortcutsModal } from '../components/ShortcutsModal';

// Tree/list divider hit area. Asymmetric around the boundary because the two edges differ:
// backwards it must stay inside TreePane's 10px right padding, where the "List options" button
// sits flush; forwards it can reach further, since ListPane's rows are `px-5`. Nothing is drawn
// here — the strip carries only the resize cursor and the drag.
const TREE_LIST_HIT_BEFORE = 8;
const TREE_LIST_HIT_AFTER = 14;

export function LibraryPage({
  nodeId: routeNodeId,
  suttaId: rawSuttaId,
  location,
}: RouteComponentProps<{ nodeId: string; suttaId?: string }>) {
  // `suttaId` is a splat segment (see App.tsx), so /browse/:nodeId and /browse/:nodeId/:suttaId
  // are one route element and this page stays mounted — with every pane's scroll position —
  // across selecting and deselecting a row.
  const { mobile, dragTree, resetTree, paneW } = useLayout();
  const { corpus } = useCorpus();
  const { lists, notes } = useUserData();
  // @reach/router defers the route-param update by a microtask + rAF after navigate(), so
  // reading the ids straight off props would render a frame pairing new local state with a stale
  // id — a flash of the wrong list on mobile, a highlighted row that jumps back for a frame.
  // Mirroring them into state, set synchronously with everything else a handler changes, keeps
  // each render consistent; the effects below cover navigation this page didn't initiate.
  const [suttaId, setSuttaId] = useState(rawSuttaId || undefined);
  useEffect(() => {
    setSuttaId(rawSuttaId || undefined);
  }, [rawSuttaId]);
  // Only ever *suppresses* TreePane's corrective pane sync, so a stale value resurrected by a
  // refresh is harmless (worst case it skips a no-op sync) — hence read straight off
  // location.state, unlike the one-shot values below.
  const restoreOrigin = !!(location?.state as { restoreOrigin?: boolean } | undefined)?.restoreOrigin;
  // `fromView`/`flashNodeId` are meant for exactly one arrival, but location.state survives a
  // same-tab refresh (the browser keeps history.state for the current entry), so trusting them
  // unconditionally would let a reload override a pane switch made by hand since. Consumed once
  // via a lazy initializer, so a stale resurrection reads as "no intent" instead.
  const [consumedIntent] = useState(() =>
    consumeIntent(
      location?.state as ({ fromView?: 'tree' | 'list'; flashNodeId?: string } & RouteIntent) | null | undefined,
      ROUTE_INTENT_KEY
    )
  );
  // A reader breadcrumb click always lands on the sutta's own leaf group, but names the ancestor
  // segment actually clicked so the tree pane can briefly scroll to and highlight that row.
  // Timed out rather than left standing — it points at where something is, it isn't a selection.
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
    // A suttaId with no router state at all is a fresh arrival that never went through one of
    // this app's navigate() calls — a bookmark or a typed URL — where 'list' is the only way to
    // reveal the highlighted row. A mount that carried state came from in-app navigation, so the
    // persisted preference below is the better signal there.
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

  // Scanned once here and handed to both panes, so they show one result set from one scan per
  // keystroke. useCorpusSearch defers the scan off `query`, keeping the input responsive on a
  // slow device.
  const hits = useCorpusSearch(corpus, query, notes, lists);
  // TreePane owns the arrow-key nav; mirrored here so ListPane, which renders the rows on
  // desktop, can show the same highlight.
  const [activeSearchId, setActiveSearchId] = useState<string | undefined>(undefined);

  const [nodeId, setNodeId] = useState(routeNodeId);
  useEffect(() => {
    setNodeId(routeNodeId);
  }, [routeNodeId]);

  // Tab title mirrors what the right pane shows, via the same `nodeLabel` lookup ListPane's own
  // header uses, so it's right on a fresh reload and not only after an in-app navigation.
  useEffect(() => {
    if (query.trim().length > 0) {
      document.title = 'Search';
    } else {
      const { ref, label } = nodeLabel(corpus, nodeId || '', lists);
      document.title = label ? (ref ? `${ref} · ${label}` : label) : 'Sutamaya';
    }
    return () => {
      document.title = 'Sutamaya';
    };
  }, [corpus, nodeId, lists, query]);

  // useCallback'd, not inline arrows: TreePane's keydown effect depends on `onOpenSutta`, and
  // typing in the search box re-renders this page per keystroke — a fresh identity each time
  // would tear down and re-add that window listener on every one.
  const onSelectNode = useCallback((id: string) => {
    setQuery('');
    setView('list');
    setNodeId(id);
    setSuttaId(undefined);
    navigate(`/browse/${encodeURIComponent(id)}`);
  }, []);

  const onOpen = useCallback(
    (id: string) => {
      // `from`/`fromView` ride along through the reader's own navigate() calls, so closing it —
      // however many Prev/Next steps later — returns to this exact pane, node and scroll offset
      // rather than the sutta's bare corpus location.
      //
      // A search hit is the one case where the opened id isn't a member of the current `nodeId`:
      // search spans the whole corpus, so a hit found while browsing DN can live in MN. Returning
      // there would leave the pane on a category the sutta doesn't belong to, so its own node is
      // used instead — where a bare deep link would have landed.
      const returnNodeId = query.trim() && corpus?.suttas[id] ? corpus.suttas[id].node : nodeId;
      const from = `/browse/${encodeURIComponent(returnNodeId || '')}/${encodeURIComponent(id)}`;
      // Persisted as well as carried in router state, since a hard refresh drops location.state
      // entirely — see ReaderPage's closeReader for the fallback that reads this back.
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

  // Canonical browse order for the whole corpus — the same list ReaderPage's Prev/Next walks —
  // so Up/Down can cross a category boundary instead of stopping at its edge.
  const suttaOrder = useMemo(() => (corpus ? flatSuttaOrder(corpus) : []), [corpus]);

  // Up/Down move the highlighted row, Enter opens it. Both key off `suttaId` rather than any
  // pane's visibility: the URL's sutta is the only well-defined "current" item, and a sutta can
  // be selected this way on mobile too.
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
      // In a user list, Up/Down stays inside it, in its stored order, stopping dead at either
      // end. Spilling into corpus order would defeat the point of a curated list.
      const currentList = lists.find((l) => l.id === nodeId);
      if (currentList) {
        const items = currentList.items;
        // Nothing selected yet — start at the first item whichever direction was pressed.
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
      // Browsing the corpus tree instead: step canonical order, which can leave the current
      // category. Re-deriving `nodeId` from the landed-on sutta each time — as clicking it in
      // the tree would — is what makes both panes follow along and scroll to the right place.
      if (!suttaId) {
        // Start from the browsed category's first row, not corpus order's very first sutta,
        // which would read as teleporting away from wherever the tree already points.
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
      {/* Both panes stay mounted on mobile and hide, so a tree<->list toggle keeps each one's
          scroll offset and expansion state. `display:contents` leaves this wrapper transparent
          to the flex layout. The `visible` prop covers the other half: a `display:none` box has
          no scroll extent, so a pane that mounts while hidden can only restore its scroll once
          `visible` flips true — see useScrollMemory. */}
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
          shortcutsOpen={shortcutsOpen}
        />
      </div>

      {/* Absolute, so the hit area can overhang both panes without changing either one's width
          or depending on paint order; z-10 keeps it grabbable above their content. */}
      {!mobile && (
        <div
          className="absolute top-0 bottom-0 z-10 cursor-col-resize touch-none"
          style={{ left: paneW.tree - TREE_LIST_HIT_BEFORE, width: TREE_LIST_HIT_BEFORE + TREE_LIST_HIT_AFTER }}
          onPointerDown={dragTree}
          // `touchend` is the only event WebKit reliably lets us cancel here (`touch-none` above
          // makes `touchstart` arrive uncancelable), and cancelling it asks iOS not to synthesize
          // the trailing click that would open whichever row the finger drifted over. See
          // LayoutContext's `swallowNextClick` for why this alone isn't trusted.
          onTouchEnd={(e) => e.preventDefault()}
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
