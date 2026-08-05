import { useEffect, useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
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
  const suttaId = rawSuttaId || undefined;
  const { mobile, desktop, previewHidden, showPreview, hidePreview, dragTree, resetTree, dragList, resetList } = useLayout();
  const { corpus } = useCorpus();
  // `/read/:suttaId` is a genuinely separate route (full-screen reader, not one of this page's
  // panes), so closing it back to `/browse/:nodeId/:suttaId` fully remounts LibraryPage — `view`
  // can't just default to 'tree' here, or mobile would show the browse tree instead of the sutta
  // list the user was just reading from, which reads as "my scroll position (and place) got
  // reset". If a suttaId is already present on mount, we came from exactly that round trip (or a
  // deep link to a preview), so start on 'list' instead.
  const [view, setView] = useState<'tree' | 'list'>(suttaId ? 'list' : 'tree');
  const [query, setQuery] = useState('');

  // @reach/router defers the actual route-param update by a microtask + rAF after navigate()
  // (see LocationProvider.componentDidMount in @reach/router/lib/history.js), so reading
  // `routeNodeId` straight from route props here would render one frame with the *new* `view`
  // ('list', flipped synchronously below) paired with the *stale* nodeId — on mobile that's a
  // visible flash of the previous/empty list before the correct one appears, which is the
  // "flickers, needs a second tap" bug. Mirroring the target id into local state synchronously
  // alongside `view` keeps that render consistent; the effect just keeps it truthful for
  // back/forward/deep-link navigation that doesn't go through onSelectNode.
  const [nodeId, setNodeId] = useState(routeNodeId);
  useEffect(() => {
    setNodeId(routeNodeId);
  }, [routeNodeId]);

  function onSelectNode(id: string) {
    setQuery('');
    setView('list');
    setNodeId(id);
    navigate(`/browse/${encodeURIComponent(id)}`);
  }

  function onOpen(id: string) {
    if (desktop && !previewHidden) {
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

  // Space toggles the preview pane, and Left/Right/Enter only act once one is actually open (see
  // `desktop && !previewHidden` throughout) — there's no more keyboard row-highlighting to drive
  // them otherwise (see the removed useListNav), so the previewed sutta (`suttaId`, the route's
  // own selection) is the only well-defined "current" item left to step from or open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!desktop) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (previewHidden) showPreview();
        else hidePreview();
        return;
      }
      if (previewHidden || !suttaId || !corpus) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onOpenReader(suttaId);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = suttaOrder.indexOf(suttaId);
      if (i === -1) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const next = suttaOrder[Math.min(suttaOrder.length - 1, Math.max(0, i + dir))];
      if (!next || next === suttaId) return;
      e.preventDefault();
      // Stepping through the canonical order (not the current pane's own item order) can land on
      // a sutta outside whatever's currently browsed (a different category, or not in the list
      // being viewed at all) — always re-deriving `nodeId` from the landed-on sutta's own corpus
      // node, the same way clicking it in the tree would, is what makes the tree pane (and the
      // list pane's contents) follow along and expand/scroll to the right place on a category
      // jump, instead of leaving them pointed at wherever browsing started.
      const newNodeId = corpus.suttas[next].node;
      setQuery('');
      setNodeId(newNodeId);
      navigate(`/browse/${encodeURIComponent(newNodeId)}/${encodeURIComponent(next)}`);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, previewHidden, suttaId, suttaOrder, corpus]);

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
