import type { CSSProperties } from 'react';
import { Highlighter } from 'lucide-react';
import type { ThemeColors } from '../lib/types';

interface HighlightCountBadgeProps {
  count: number;
  onClick?: (e: React.MouseEvent) => void;
  theme?: ThemeColors;
  // The reader's body font size, so the badge scales alongside the chips it sits with — see
  // SuttaRowChips' own `fs` for why only the reader passes it.
  fs?: number;
  style?: CSSProperties;
}

// A sutta's total highlight count (all colours combined, see highlightCount) behind a single
// highlighter icon — shared by ListPane and ReaderPage's header so a style tweak in one place
// stays consistent everywhere. Filled (not outlined like the neighbouring list-membership chips)
// so it reads as a distinct kind of indicator rather than one more chip. Renders as a <button>
// (clickable, e.g. ReaderPage opening the Highlights side-panel tab) when `onClick` is passed,
// otherwise a plain <span> (ListPane, where the row itself isn't interactive). `theme` lets
// ReaderPage fill/text-colour it to match the active reading theme (via its own `tint` token,
// lighter than `rule`); ListPane passes no theme, so the plain `bg-ink/10` Tailwind classes (the
// app shell's own light/dark mode, a deliberately separate system — see index.css) apply instead.
export function HighlightCountBadge({ count, onClick, theme, fs, style }: HighlightCountBadgeProps) {
  const Tag = onClick ? 'button' : 'span';
  const fontSize = fs ? fs - 7 : 11;
  const height = fontSize + 9;
  return (
    <Tag
      data-component="HighlightCountBadge"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-[9px] font-sans font-bold bg-ink/10 text-ink/60"
      style={theme ? { background: theme.tint, color: theme.fg, fontSize, height, ...style } : { fontSize, height, ...style }}
      onClick={onClick}
    >
      <Highlighter size={Math.round(fontSize)} strokeWidth={2.25} />
      {count}
    </Tag>
  );
}
