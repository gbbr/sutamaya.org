import { useEffect, useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useListNav } from '../hooks/useListNav';
import { listItemsFor } from '../lib/corpus';
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
  const { mobile, desktop, previewHidden, dragTree, resetTree, dragList, resetList } = useLayout();
  const { corpus } = useCorpus();
  const { lists, membership, notes } = useUserData();
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
      navigate(`/read/${encodeURIComponent(id)}`);
    }
  }

  function onOpenReader(id: string) {
    navigate(`/read/${encodeURIComponent(id)}`);
  }

  const items = useMemo(
    () => (corpus ? listItemsFor(corpus, nodeId, query, notes, lists, membership) : []),
    [corpus, nodeId, query, notes, lists, membership]
  );
  const { activeIndex } = useListNav(items.length, (i) => onOpen(items[i][0]), `${nodeId || ''}:${query}`);

  const showTreePane = !mobile || view === 'tree';
  const showListPane = !mobile || view === 'list';

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
          activeIndex={activeIndex}
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
          activeIndex={activeIndex}
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
