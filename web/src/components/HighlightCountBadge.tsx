import type { CSSProperties } from 'react';
import { Highlighter } from 'lucide-react';

interface HighlightCountBadgeProps {
  count: number;
  onClick?: (e: React.MouseEvent) => void;
  style?: CSSProperties;
}

// A sutta's total highlight count (all colours combined, see highlightCount) behind a single
// highlighter icon — shared by ListPane and ReaderPage's header so a style tweak in one place
// stays consistent everywhere. Filled (not outlined like the neighbouring list-membership chips)
// so it reads as a distinct kind of indicator rather than one more chip. Renders as a <button>
// (clickable, e.g. ReaderPage opening the Highlights side-panel tab) when `onClick` is passed,
// otherwise a plain <span> (ListPane, where the row itself isn't interactive). `style` lets
// ReaderPage override the fill/text colour to match the active reading theme.
export function HighlightCountBadge({ count, onClick, style }: HighlightCountBadgeProps) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className="inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-[9px] font-sans text-[11px] font-bold bg-ink/10 text-ink/60"
      style={style}
      onClick={onClick}
    >
      <Highlighter size={11} strokeWidth={2.25} />
      {count}
    </Tag>
  );
}
