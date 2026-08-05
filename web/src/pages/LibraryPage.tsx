import { useEffect, useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { flatSuttaOrder } from '../lib/corpus';
import { TreePane } from '../components/TreePane';
import { ListPane } from '../components/ListPane';
import { PreviewPane } from '../components/PreviewPane';

export function LibraryPage({ nodeId: routeNodeId, suttaId: rawSuttaId }: RouteComponentProps<{ nodeId: string; suttaId?: string }>) {
  // `suttaId` is a splat segment (see App.tsx) so both /browse/:nodeId and
  // /browse/:nodeId/:suttaId are the *same* route element — giving it '' rather than undefined
  // when absent, and keeping LibraryPage mounted (with all its local state, including every
  // pane's scroll position) across selecting/deselecting a preview sutta, instead of the
  // full remount+state-loss that two separate <LibraryPage> route elements caused (reach-router
  // auto-keys route children by position, so switching which one matched was a key change).
  const { mobile, desktop, previewHidden, showPreview, hidePreview, dragTree, resetTree, dragList, resetList } = useLayout();
  const { corpus } = useCorpus();
  const { lists } = useUserData();
  // @reach/router defers the actual route-param update by a microtask + rAF after navigate()
  // (see LocationProvider.componentDidMount in @reach/router/lib/history.js), so reading
  // `rawSuttaId`/`routeNodeId` straight from route props here would render one frame with
  // whatever *new* local UI state a navigation handler flips synchronously (`view`, or
  // Left/Right's `nodeId` below) paired with the *stale* id from props — on mobile that's a
  // visible flash of the previous/empty list before the correct one appears (the "flickers,
  // needs a second tap" bug); for Left/Right specifically it read as the step not "continuing"
  // from wherever you already were, since the highlighted row would revert to the old sutta for
  // a frame before catching up. Mirroring both ids into local state, set synchronously alongside
  // whatever else a given navigation changes, keeps every render consistent; the effects below
  // just keep them truthful for back/forward/deep-link navigation that doesn't go through one of
  // this page's own handlers.
  const [suttaId, setSuttaId] = useState(rawSuttaId || undefined);
  useEffect(() => {
    setSuttaId(rawSuttaId || undefined);
  }, [rawSuttaId]);
  // `/read/:suttaId` is a genuinely separate route (full-screen reader, not one of this page's
  // panes), so closing it back to `/browse/:nodeId/:suttaId` fully remounts LibraryPage — `view`
  // can't just default to 'tree' here, or mobile would show the browse tree instead of the sutta
  // list the user was just reading from, which reads as "my scroll position (and place) got
  // reset". If a suttaId is already present on mount, we came from exactly that round trip (or a
  // deep link to a preview), so start on 'list' instead.
  const [view, setView] = useState<'tree' | 'list'>(suttaId ? 'list' : 'tree');
  const [query, setQuery] = useState('');

  const [nodeId, setNodeId] = useState(routeNodeId);
  useEffect(() => {
    setNodeId(routeNodeId);
  }, [routeNodeId]);

  function onSelectNode(id: string) {
    setQuery('');
    setView('list');
    setNodeId(id);
    setSuttaId(undefined);
    navigate(`/browse/${encodeURIComponent(id)}`);
  }

  function onOpen(id: string) {
    if (desktop && !previewHidden) {
      setSuttaId(id);
      navigate(`/browse/${encodeURIComponent(nodeId || '')}/${encodeURIComponent(id)}`);
    } else {
      // `from` round-trips through the reader's own navigate() calls (Prev/Next, its search
      // overlay) so that whenever it's closed — however many suttas later — it lands back on
      // exactly this pane/nodeId/scroll position instead of falling back to the sutta's bare
      // corpus location (see ReaderPage's closeReader).
      navigate(`/read/${encodeURIComponent(id)}`, { state: { from: `/browse/${encodeURIComponent(nodeId || '')}/${encodeURIComponent(id)}` } });
    }
  }

  function onOpenReader(id: string) {
    navigate(`/read/${encodeURIComponent(id)}`, { state: { from: `/browse/${encodeURIComponent(nodeId || '')}/${encodeURIComponent(id)}` } });
  }

  const showTreePane = !mobile || view === 'tree';
  const showListPane = !mobile || view === 'list';

  // The whole corpus in canonical browse order — same list ReaderPage's own Prev/Next walks —
  // so Left/Right below can step across a category boundary once the current one runs out,
  // rather than stopping at its edge.
  const suttaOrder = useMemo(() => (corpus ? flatSuttaOrder(corpus) : []), [corpus]);

  // Space toggles the preview pane (still desktop-only — it's the only thing that ever mounts
  // one). Left/Right/Enter key off `suttaId` itself (whether the URL ends in a sutta, i.e.
  // `/browse/:nodeId/:suttaId`) rather than the preview pane's visibility — a sutta can be
  // "selected" this way with the preview hidden too (e.g. it was hidden after selecting one, or
  // the reader closed back to a mobile/two-pane view via its `from` state — see ReaderPage), and
  // that URL sutta is the only well-defined "current" item to step from or open regardless of
  // whether a preview widget happens to be showing it (see ListPane's matching `on` highlight).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === ' ') {
        if (!desktop) return;
        e.preventDefault();
        if (previewHidden) showPreview();
        else hidePreview();
        return;
      }
      if (!suttaId || !corpus) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onOpenReader(suttaId);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      // Browsing a user list, Left/Right stays inside it — stepping through *that* list's own
      // items in its own stored order, never touching `nodeId`, and stopping dead at either end
      // rather than spilling into the canonical corpus order. Jumping away to wherever a sutta
      // happens to live in the tree would defeat the point of viewing a curated list at all (its
      // whole reason to exist is a different order/subset than the corpus's own).
      const currentList = lists.find((l) => l.id === nodeId);
      if (currentList) {
        const items = currentList.items;
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
  }, [desktop, previewHidden, suttaId, suttaOrder, corpus, lists, nodeId]);

  return (
    <div data-component="LibraryPage" className="flex overflow-hidden bg-paper h-full">
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
          visible={showTreePane}
        />
      </div>

      {!mobile && (
        <div className="flex-none w-[7px] -ml-[7px] cursor-col-resize touch-none" onPointerDown={dragTree} onDoubleClick={resetTree} />
      )}

      <div style={{ display: showListPane ? 'contents' : 'none' }}>
        <ListPane
          nodeId={nodeId}
          selectedId={suttaId}
          query={query}
          onBack={() => setView('tree')}
          onOpen={onOpen}
          onOpenReader={onOpenReader}
          visible={showListPane}
        />
      </div>

      {desktop && !previewHidden && (
        <div className="flex-none w-[7px] -ml-[7px] cursor-col-resize touch-none" onPointerDown={dragList} onDoubleClick={resetList} />
      )}

      {desktop && <PreviewPane selectedId={suttaId} />}
    </div>
  );
}
