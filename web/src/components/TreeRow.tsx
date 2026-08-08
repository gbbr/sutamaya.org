import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLayout } from '../context/LayoutContext';
import { isExpandable } from '../lib/corpus';
import type { ChapterRow } from '../lib/types';

// One row of the nested chapter/group/category tree under a nikaya — recurses arbitrarily
// deep (SN: group > chapter > category; AN: chapter > category; MN: category directly).
export function TreeRow({
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
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const expandable = isExpandable(node);
  const open = !!expanded[node.id];
  const { mobile } = useLayout();
  return (
    <div>
      <button
        data-node-id={node.id}
        className={`row flex items-start gap-[9px] w-full text-left pr-[18px] py-[9px] border-b border-ink/[.07] transition-colors duration-500 ${
          nodeId === node.id || flashNodeId === node.id ? 'bg-ink/[.06]' : ''
        }`}
        // On mobile, the first level isn't indented — the nikaya headings above are already
        // visually distinct (bolder, their own row style, plus a chevron), so the extra 14px
        // here bought nothing but cramped text width on a narrow single-pane screen. Once both
        // panes fit side by side there's room to spare, so it steps in from depth 0 as before.
        style={{ paddingLeft: 18 + Math.max(0, depth - (mobile ? 1 : 0)) * 14 }}
        onClick={() => (expandable ? onToggle(node.id) : onSelect(node.id))}
      >
        <span className="w-[11px] flex-none flex items-center justify-center text-ink/40 mt-[7px]">
          {expandable && (open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />)}
        </span>
        <span className="flex-1 min-w-0">
          <span>
            <span className="font-sans text-[13px] font-bold text-ink/45 mr-2">{node.ref}</span>
            <span className="text-[15px] font-semibold leading-[1.3]">{node.label}</span>
          </span>
          {node.sub && <span className="block font-serif text-[13px] italic text-accent-text mt-[1px]">{node.sub}</span>}
          <span className="block font-sans text-[13px] text-ink/45 mt-[2px]">
            {node.count} sutta{node.count === 1 ? '' : 's'}
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
}
