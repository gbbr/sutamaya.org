import type { CSSProperties } from 'react';
import { highlightPaint, SHELL_THEME } from '../lib/theme';
import type { ThemeColors } from '../lib/types';

interface HighlightCountBadgeProps {
  count: number;
  // The distinct colours those highlights use, one swatch each.
  colors: string[];
  onClick?: (e: React.MouseEvent) => void;
  theme?: ThemeColors;
  // The reader's body font size, so the badge scales with the chips beside it. The reader passes
  // it; the Library takes the fixed defaults.
  fs?: number;
  style?: CSSProperties;
}

// A sutta's highlights, as one swatch per colour plus the total across them. It carries no fill or
// outline of its own, so the swatches are the only colour on a line of outlined chips. A <button>
// where `onClick` is passed — the reader opens the Highlights tab — and a <span> otherwise, for
// the Library, whose rows aren't interactive there.
export function HighlightCountBadge({ count, colors, onClick, theme, fs, style }: HighlightCountBadgeProps) {
  const Tag = onClick ? 'button' : 'span';
  // The number's colour at rest and on hover, as custom properties, which is what leaves the hover
  // rule something to restate. Theme tokens, so it darkens on light and lightens on dark.
  const vars = {
    '--hl-ink': theme ? theme.dim : 'rgb(var(--ink-3))',
    '--hl-ink-hover': theme ? theme.fg : 'rgb(var(--ink))',
  } as CSSProperties;
  // The chips' own type size, and a fixed height so it shares their baseline on a wrapped line.
  const fontSize = fs ? fs - 7 : 14;
  const height = fs ? fs + 2 : 20;
  // Swatch size: a little over half the type size, so three don't outweigh the count.
  const dot = Math.round(fontSize * 0.6);
  return (
    <Tag
      data-component="HighlightCountBadge"
      // The swatches carry no text, so the count alone is all a screen reader would announce.
      aria-label={onClick ? `${count} highlights` : undefined}
      // The hover response and enlarged touch target only where this is clickable, which as a
      // <span> would suggest an affordance that isn't there.
      className={`relative inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-semibold text-[color:var(--hl-ink)] transition-colors ${
        onClick ? "hover:text-[color:var(--hl-ink-hover)] after:content-[''] after:absolute after:-inset-[11px]" : ''
      }`}
      style={{ ...vars, fontSize, height, ...style }}
      onClick={onClick}
    >
      {/* The swatches, each ringed in the theme's rule colour as HighlightPopup's are: at this
          size neither the pastels nor dark's deeper fills have an edge of their own. */}
      <span className="flex items-center gap-[3px]">
        {colors.map((c) => (
          <span
            key={c}
            data-swatch
            style={{
              width: dot,
              height: dot,
              borderRadius: 2,
              background: highlightPaint(c, theme ?? SHELL_THEME),
              boxShadow: `0 0 0 1px ${theme ? theme.rule : 'rgb(var(--ink) / .18)'}`,
            }}
          />
        ))}
      </span>
      {count}
    </Tag>
  );
}
