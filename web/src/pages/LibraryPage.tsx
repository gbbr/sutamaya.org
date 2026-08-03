import { useMemo, useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { PanelLeftOpen } from 'lucide-react';
import { useLayout } from '../context/LayoutContext';
import { useCorpus } from '../context/CorpusContext';
import { useUserData } from '../context/UserDataContext';
import { useListNav } from '../hooks/useListNav';
import { listItemsFor } from '../lib/corpus';
import { TreePane } from '../components/TreePane';
import { ListPane } from '../components/ListPane';
import { PreviewPane } from '../components/PreviewPane';

export function LibraryPage({ nodeId, suttaId }: RouteComponentProps<{ nodeId: string; suttaId?: string }>) {
  const { mobile, desktop, treeHidden, previewHidden, showTree, dragTree, resetTree, dragList, resetList } = useLayout();
  const { corpus } = useCorpus();
  const { lists, membership, notes } = useUserData();
  const [view, setView] = useState<'tree' | 'list'>('tree');
  const [query, setQuery] = useState('');

  function onSelectNode(id: string) {
    setQuery('');
    setView('list');
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
    <div className="flex overflow-hidden bg-paper" style={{ height: '100dvh' }}>
      {showTreePane && (
        <TreePane nodeId={nodeId} onSelect={onSelectNode} onOpenSutta={onOpen} onSearch={setQuery} query={query} activeIndex={activeIndex} />
      )}

      {!mobile && treeHidden && (
        <button
          className="flex-none w-3 flex items-center justify-center cursor-[e-resize] border-r border-ink/10 text-ink/35 hover:text-ink/60 hover:bg-ink/[.04]"
          style={{ background: '#F0ECE4' }}
          title="Show browse pane"
          onClick={showTree}
        >
          <PanelLeftOpen size={13} strokeWidth={1.75} />
        </button>
      )}
      {!mobile && !treeHidden && (
        <div className="flex-none w-[7px] -ml-[7px] cursor-col-resize touch-none" onPointerDown={dragTree} onDoubleClick={resetTree} />
      )}

      {showListPane && (
        <ListPane
          nodeId={nodeId}
          selectedId={suttaId}
          query={query}
          onBack={() => setView('tree')}
          onOpen={onOpen}
          onOpenReader={onOpenReader}
          activeIndex={activeIndex}
        />
      )}

      {desktop && !previewHidden && (
        <div className="flex-none w-[7px] -ml-[7px] cursor-col-resize touch-none" onPointerDown={dragList} onDoubleClick={resetList} />
      )}

      {desktop && <PreviewPane selectedId={suttaId} />}
    </div>
  );
}
