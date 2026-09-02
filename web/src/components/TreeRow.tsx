import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLayout } from '../context/LayoutContext';
import { isExpandable } from '../lib/corpus';
import type { ChapterRow } from '../lib/types';

// One row of the tree under a nikaya, recursing as deep as the collection nests. Memoized, so a
// TreePane render unrelated to the corpus tree costs nothing here — which requires `onToggle` and
// `onSelect` to be stable. Expanding still re-renders every row, `expanded` being one map.
export const TreeRow = memo(function TreeRow({
  node,
  depth,
  nodeId,
  flashNodeId,
  expanded,
  onToggle,
  onSelect,
}: {
  node: ChapterRow;
  depth: number;
  nodeId?: string;
  // The row a reader breadcrumb click named, briefly highlighted; it may be an ancestor of
  // `nodeId`.
  flashNodeId?: string;
  expanded: Record<string, boolean>;
  // `deep` is ⌥-click, which collapses everything under this row too.
  onToggle: (id: string, deep?: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const expandable = isExpandable(node);
  const open = !!expanded[node.id];
  return (
    <div data-component="TreeRow">
      <button
        data-node-id={node.id}
        className={`row flex items-center gap-[11px] w-full text-left pr-[22px] py-[13px] border-b border-ink/[.07] transition-colors duration-500 ${
          nodeId === node.id || flashNodeId === node.id ? 'bg-ink/[.06]' : ''
        }`}
        style={{ paddingLeft: 24 + depth * 14 }}
        onClick={(e) => (expandable ? onToggle(node.id, e.altKey) : onSelect(node.id))}
      >
        <span className="w-[15px] flex-none flex items-center justify-center text-ink-4">
          {expandable && (open ? <ChevronDown size={15} strokeWidth={2} /> : <ChevronRight size={15} strokeWidth={2} />)}
        </span>
        <span className="flex-1 min-w-0">
          {/* A step below the nikaya label this row sits under, which the same size would
              flatten. */}
          <span className="text-ui-md font-medium leading-[1.3]">{node.label}</span>
          {node.sub && <span className="block font-serif text-ui-sm italic text-accent-text mt-[1px]">{node.sub}</span>}
          <span className="block font-sans text-ui-sm text-ink-4 mt-[2px]">
            {node.ref} · {node.count} sutta{node.count === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      {expandable &&
        open &&
        node.chapters!.map((c) => (
          <TreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            nodeId={nodeId}
            flashNodeId={flashNodeId}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
});
