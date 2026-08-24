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
// so it reads as a distinct kind of indicator rather than one more chip, and filled in the
// *accent* hue rather than neutral ink: a chip for a list inside a group carries a neutral tinted
// segment naming that group (see SuttaRowChips), so a neutral fill here would put a count and a
// group name in the same material right beside each other. Renders as a <button>
// (clickable, e.g. ReaderPage opening the Highlights side-panel tab) when `onClick` is passed,
// otherwise a plain <span> (ListPane, where the row itself isn't interactive). `theme` lets
// Only the *fill* is accent-hued, though: the number and icon stay muted neutral ink, because the
// accent colour already belongs to the Pali subtitle sitting a line above every row that shows one
// (`--accent-text`/`theme.pali`), and a count in that same colour reads as more of that. Muted
// rather than full-strength because it is an indicator, not something to read — the fill is what
// makes it findable. `theme` lets ReaderPage fill it from the active reading theme's own accent
// wash (`paliTint`) and colour it with that theme's `dim`; ListPane passes no theme, so the app
// shell's own variables (its light/dark mode is a deliberately separate system — see index.css)
// stand in. Either way the four colours arrive as CSS custom properties rather than as a resolved
// inline `background`/`color`, so the hover rule below can restate them.
export function HighlightCountBadge({ count, onClick, theme, fs, style }: HighlightCountBadgeProps) {
  const Tag = onClick ? 'button' : 'span';
  // Hover moves *toward* the theme rather than fading the whole pill out: a stronger pour of the
  // same accent behind full-strength ink. An opacity fade would have washed the badge into
  // whatever it sits on, which on a dark ground means dimming — the opposite of the "this is live"
  // signal a hover owes. Both ends are built from tokens that already follow the theme (`pali`,
  // `fg`), so the badge darkens on a light ground and lightens on a dark one without either
  // branch knowing which it's on. Same dim -> fg move as the neighbouring "+" control in
  // SuttaRowChips, so the two respond alike.
  const accent = theme ? theme.pali : 'rgb(var(--accent-text))';
  const vars = {
    '--hl-fill': theme ? theme.paliTint : 'rgb(var(--accent-text) / .15)',
    '--hl-fill-hover': `color-mix(in srgb, ${accent} 28%, transparent)`,
    '--hl-ink': theme ? theme.dim : 'rgb(var(--ink-3))',
    '--hl-ink-hover': theme ? theme.fg : 'rgb(var(--ink))',
  } as CSSProperties;
  // Same type size as the chips this sits beside (SuttaRowChips' own `fontSize`), so the icon and
  // the number read at their weight rather than shrinking away next to them. The pill itself is
  // deliberately a little shorter than those chips outside the reader, so its height is its own
  // number rather than derived from the type size.
  const fontSize = fs ? fs - 7 : 14;
  const height = fs ? fs + 2 : 20;
  return (
    <Tag
      data-component="HighlightCountBadge"
      // The hover response only when this is actually clickable — as a plain <span> (ListPane,
      // where the row itself is the target) it would suggest an affordance that isn't there.
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-[9px] font-sans font-semibold bg-[var(--hl-fill)] text-[color:var(--hl-ink)] transition-colors ${
        onClick ? 'hover:bg-[var(--hl-fill-hover)] hover:text-[color:var(--hl-ink-hover)]' : ''
      }`}
      style={{ ...vars, fontSize, height, ...style }}
      onClick={onClick}
    >
      <Highlighter size={Math.round(fontSize)} strokeWidth={2.25} />
      {count}
    </Tag>
  );
}
