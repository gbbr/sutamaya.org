import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLayout } from '../context/LayoutContext';
import { isExpandable } from '../lib/corpus';
import type { ChapterRow } from '../lib/types';

// One row of the nested chapter/group/category tree under a nikaya, recursing arbitrarily deep
// (SN: group > chapter > category; AN: chapter > category; MN: category directly).
//
// Wrapped in `memo`, so a TreePane re-render unrelated to the corpus tree doesn't force every
// expanded row to re-render. That requires `onToggle`/`onSelect` to stay referentially stable
// across those renders — see TreePane's useCallback around toggleExpanded. Expanding or collapsing
// still re-renders every row, since `expanded` is passed as one map rather than a per-row boolean.
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
  // A breadcrumb segment last clicked in the reader (see TreePane) — may be an ancestor above
  // `nodeId` itself, briefly highlighted the same way `nodeId`'s own row is.
  flashNodeId?: string;
  expanded: Record<string, boolean>;
  // `deep` is ⌥-click: collapse this row and everything under it, rather than leaving the
  // descendants flagged open to reappear on the next expand. See TreePane's toggleExpanded.
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
          {/* A step below CorpusTreeView's own `text-ui-lg` label, which is the nikaya this row
              sits under: these are its chapters, and reading as the same size flattens that. */}
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
