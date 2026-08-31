import type { CSSProperties } from 'react';
import { highlightPaint, SHELL_THEME } from '../lib/theme';
import type { ThemeColors } from '../lib/types';

interface HighlightCountBadgeProps {
  count: number;
  // The distinct colours those highlights use, palette-ordered (see highlightColors) — one swatch
  // each, so the indicator says what kind of marking as well as how much.
  colors: string[];
  onClick?: (e: React.MouseEvent) => void;
  theme?: ThemeColors;
  // The reader's body font size, so the badge scales alongside the chips it sits with — see
  // SuttaRowChips' own `fs` for why only the reader passes it.
  fs?: number;
  style?: CSSProperties;
}

// A sutta's highlights as swatches plus a total across every colour, shared by ListPane and
// ReaderPage's header.
//
// It carries no fill or outline of its own, so the swatches are the only colour on the line and stay
// findable among the outlined membership chips beside them. They are painted through `highlightPaint`
// in the actual highlight colours, so dark's deeper palette shows here too; the number stays muted
// neutral ink, since it is an indicator rather than something to read.
//
// Renders as a <button> when `onClick` is passed — ReaderPage opens the Highlights panel tab — and
// otherwise as a plain <span>, for ListPane, where the row itself isn't interactive. `theme` lets
// ReaderPage colour it from the active reading theme; ListPane passes none and gets the app shell's
// own variables.
export function HighlightCountBadge({ count, colors, onClick, theme, fs, style }: HighlightCountBadgeProps) {
  const Tag = onClick ? 'button' : 'span';
  // Hover lifts the number to full-strength ink, the same dim -> fg move as the neighbouring "+"
  // control in SuttaRowChips. Both ends are theme tokens, so it darkens on a light ground and
  // lightens on a dark one; they travel as custom properties rather than a resolved inline `color`,
  // which is what leaves the hover rule something to restate.
  const vars = {
    '--hl-ink': theme ? theme.dim : 'rgb(var(--ink-3))',
    '--hl-ink-hover': theme ? theme.fg : 'rgb(var(--ink))',
  } as CSSProperties;
  // The same type size as the chips beside it (SuttaRowChips' `fontSize`), and a fixed height so it
  // shares their baseline on a line that wraps.
  const fontSize = fs ? fs - 7 : 14;
  const height = fs ? fs + 2 : 20;
  // A little over half the type size: readable as a colour at a glance, but small enough that three
  // don't outweigh the count they belong to.
  const dot = Math.round(fontSize * 0.6);
  return (
    <Tag
      data-component="HighlightCountBadge"
      // The swatches carry no text, so the count alone is what a screen reader would otherwise
      // announce for the control.
      aria-label={onClick ? `${count} highlights` : undefined}
      // The hover response and the enlarged touch target only when this is clickable — as a plain
      // <span> they would suggest an affordance that isn't there. Hover states compile inside
      // `@media (hover: hover)` (tailwind.config.js), so an iOS tap can't leave this stuck lit.
      className={`relative inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-semibold text-[color:var(--hl-ink)] transition-colors ${
        onClick ? "hover:text-[color:var(--hl-ink-hover)] after:content-[''] after:absolute after:-inset-[11px]" : ''
      }`}
      style={{ ...vars, fontSize, height, ...style }}
      onClick={onClick}
    >
      {/* A hairline ring in the theme's own rule colour, exactly as the colour swatches in
          HighlightPopup carry one: these pastels sit a shade off the page on a light ground, and
          dark's deeper fills sit a shade off it on a dark one, so at this size neither has an edge
          of its own to be found by. */}
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
