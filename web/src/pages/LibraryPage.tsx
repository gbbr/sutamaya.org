import { useState } from 'react';
import { navigate, type RouteComponentProps } from '@reach/router';
import { useLayout } from '../context/LayoutContext';
import { TreePane } from '../components/TreePane';
import { ListPane } from '../components/ListPane';
import { PreviewPane } from '../components/PreviewPane';

export function LibraryPage({ nodeId, suttaId }: RouteComponentProps<{ nodeId: string; suttaId?: string }>) {
  const { mobile, desktop, treeHidden, previewHidden, showTree, dragTree, resetTree, dragList, resetList } = useLayout();
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

  const showTreePane = !mobile || view === 'tree';
  const showListPane = !mobile || view === 'list';

  return (
    <div className="flex overflow-hidden bg-paper" style={{ height: '100dvh' }}>
      {showTreePane && <TreePane nodeId={nodeId} onSelect={onSelectNode} onSearch={setQuery} query={query} />}

      {!mobile && treeHidden && (
        <div className="flex-none w-3 cursor-[e-resize] border-r border-ink/10" style={{ background: '#F0ECE4' }} onClick={showTree} />
      )}
      {!mobile && !treeHidden && (
        <div className="flex-none w-[7px] -ml-[7px] cursor-col-resize touch-none" onPointerDown={dragTree} onDoubleClick={resetTree} />
      )}

      {showListPane && <ListPane nodeId={nodeId} selectedId={suttaId} query={query} onBack={() => setView('tree')} onOpen={onOpen} />}

      {desktop && !previewHidden && (
        <div className="flex-none w-[7px] -ml-[7px] cursor-col-resize touch-none" onPointerDown={dragList} onDoubleClick={resetList} />
      )}

      {desktop && <PreviewPane selectedId={suttaId} />}
    </div>
  );
}
