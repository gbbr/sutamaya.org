import { ChevronDown, ChevronRight } from 'lucide-react';
import { isExpandable } from '../lib/corpus';
import type { Corpus } from '../lib/types';
import { TreeRow } from './TreeRow';

interface CorpusTreeViewProps {
  corpus: Corpus;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (nodeId: string) => void;
  nodeId?: string;
  flashNodeId?: string;
}

// The corpus browse tree (TreePane's "Library" view) — one row per nikaya, each expandable into
// TreeRow's own recursive chapter/category rendering. Its own component rather than part of
// TreePane because it shares almost no JSX with the "My lists" tree it alternates with (see
// ListsTreeView); TreePane still owns all the state this needs (expanded/onToggle) and the
// header/search chrome around both trees.
export function CorpusTreeView({ corpus, expanded, onToggle, onSelect, nodeId, flashNodeId }: CorpusTreeViewProps) {
  return (
    <div data-component="CorpusTreeView">
      {corpus.nikayas.map((n) => {
        const open = !!expanded[n.id];
        const expandableNode = isExpandable(n);
        return (
          <div key={n.id}>
            <button
              data-node-id={n.id}
              className={`row flex items-center gap-[11px] w-full text-left px-[18px] py-[9px] border-b border-ink/[.07] transition-colors duration-500 ${
                nodeId === n.id || flashNodeId === n.id ? 'bg-ink/[.06]' : ''
              }`}
              onClick={() => (expandableNode ? onToggle(n.id) : onSelect(n.id))}
            >
              <span className="w-[11px] flex-none flex items-center justify-center text-ink/55">
                {expandableNode ? open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} /> : ''}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[16px] font-medium leading-[1.3]">{n.label}</span>
                <span className="block font-sans text-[12.5px] font-medium text-ink/60 mt-[1px]">{n.sub}</span>
              </span>
              <span className="font-sans text-[11.5px] font-medium text-ink/50">{n.count}</span>
            </button>
            {expandableNode &&
              open &&
              n.chapters!.map((c) => (
                <TreeRow
                  key={c.id}
                  node={c}
                  depth={1}
                  nodeId={nodeId}
                  flashNodeId={flashNodeId}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
