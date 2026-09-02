import type { CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import type { SuttaRowChip } from '../lib/lists';
import type { ThemeColors } from '../lib/types';
import { HighlightCountBadge } from './HighlightCountBadge';

interface SuttaRowChipsProps {
  chips: SuttaRowChip[];
  hlCount: number;
  // The distinct colours those highlights use — the badge's swatches (see highlightColors).
  hlColors: string[];
  // The reader's own theme, which styles the chips inline. The library omits it and takes the
  // shell-tied Tailwind classes.
  theme?: ThemeColors;
  // The reader's body font size, so the chips track its typography control. The library has none
  // and keeps the fixed size below, which is what `fs` at its default produces anyway.
  fs?: number;
  // Passed where a chip or the badge is interactive — only the reader's sutta header. Without one
  // each renders as a span, the Library's rows being the click target themselves.
  onChipClick?: (chipId: string) => void;
  onHighlightClick?: (e: React.MouseEvent) => void;
  // Adds the "add to list" control after the chips. Passing it also renders the row for a sutta
  // with neither chips nor highlights, the control having to be reachable before there are any.
  onAddToList?: (e: React.MouseEvent) => void;
}

// One sutta's list-membership chips and highlight badge, shared by the Library's rows, both search
// surfaces and the reader's sutta header, so all four stay identical.
export function SuttaRowChips({ chips, hlCount, hlColors, theme, fs, onChipClick, onHighlightClick, onAddToList }: SuttaRowChipsProps) {
  if (chips.length === 0 && hlCount === 0 && !onAddToList) return null;
  const ChipTag = onChipClick ? 'button' : 'span';
  const fontSize = fs ? fs - 7 : 14;
  const height = fontSize + 11;
  // The add control runs a point above the chips, having no fill or outline to be found by.
  const addFontSize = fontSize + 1;
  // The gap before the highlight badge, which as a count rather than a list separates itself from
  // whatever precedes it — by more after the outline-less add control than after a chip's own
  // edge, and by nothing at all when it is alone on the line.
  function badgeGapFor(): number | undefined {
    if (onAddToList) return 12;
    if (chips.length > 0) return 8;
    return undefined;
  }
  const badgeGap = badgeGapFor();
  return (
    <span data-component="SuttaRowChips" className="flex flex-wrap items-center gap-1.5 mt-3">
      {/* A chip for a list inside a group is segmented: a tinted leading segment naming the
          immediate parent, then the list's own name. The parent identifies the list — several
          groups can hold a "#anicca" — and a segment carries it on touch, where a hover title says
          nothing. Every chip stays a self-contained unit, so the row wraps chip by chip, at the
          cost of repeating a parent across its group's chips. `items-stretch` and
          `overflow-hidden` are what let the segment's fill reach the rounded end. */}
      {chips.map((c) => (
        <ChipTag
          key={c.id}
          className={`inline-flex items-stretch overflow-hidden whitespace-nowrap rounded-full font-sans ${
            theme ? '' : 'border border-ink/25'
          } ${onChipClick ? 'hover:opacity-70' : ''}`}
          style={
            theme
              ? { border: `1px solid ${theme.rule}`, color: theme.fg, fontSize, height }
              : { fontSize, height }
          }
          onClick={
            onChipClick
              ? (e) => {
                  e.stopPropagation();
                  onChipClick(c.id);
                }
              : undefined
          }
          title={c.breadcrumb}
        >
          {/* The parent segment, set apart by its fill and weight rather than a quieter colour —
              each palette's quiet rungs are tuned for the page's own ground and lose about a stop
              on this tint. */}
          {c.parent && (
            <span
              className={`flex items-center pl-[8px] pr-[9px] font-medium rounded-r-full ${
                theme ? '' : 'bg-ink/10 text-ink-2'
              }`}
              style={theme ? { background: theme.tint } : undefined}
            >
              {c.parent}
            </span>
          )}
          {/* The parent segment's own cap is the only fill on the seam — the label segment has
              none — so rounding it carves a socket straight out of its own fill rather than
              needing to overlap the label segment to fake a bulge into it.
              A top-level list has no parent segment, so it would otherwise be the one chip on the
              line with no weight and no fill anywhere — reading as the lesser of two chips when if
              anything it is the higher. It takes the parent segment's own weight and rung, plus a
              fill of its own at half that segment's strength and a little more room around the
              word: the two things a nested chip has more of are mass reaching all four edges and
              sheer area, and the border can't supply either. Half strength because this fill spans
              the whole pill rather than a leading segment of it, and at the parent's own alpha a
              row of top-level chips read as a strip of solid buttons. In the reader the chip
              already carries `theme.fg`, which is what the parent segment shows too, so only the
              weight is left to match there. */}
          <span
            className={`flex items-center ${
              c.parent ? 'pl-[3px] pr-[9px]' : `px-[13px] font-medium ${theme ? '' : 'text-ink-2 bg-ink/[.05]'}`
            }`}
            style={
              !c.parent && theme ? { background: `color-mix(in srgb, ${theme.tint} 50%, transparent)` } : undefined
            }
          >
            {c.label}
          </span>
        </ChipTag>
      ))}
      {/* No fill of any kind — unlike the highlight badge beside it and unlike the chips' own
          parent segments. This is the only thing on the line that *acts*, and a third filled pill
          beside them made the row read as a strip of buttons. It carries its weight by being
          larger than the chips instead, and by changing colour under a pointer: the hover pair
          travels as custom properties because both colours come from the active reading theme,
          which a Tailwind `hover:` class can't read out of an inline style. Hover states compile
          inside `@media (hover: hover)` (see tailwind.config.js), so an iOS tap can't leave this
          stuck lit.
          The label is carried only when there are no chips: that is the one case where nothing
          else on screen explains the icon. Beside existing chips the row already reads as
          memberships, so a bare "+" is unambiguous and keeps the chips the thing being read. */}
      {onAddToList && (
        <button
          aria-label="Add to list"
          className="relative inline-flex items-center gap-1 whitespace-nowrap font-sans font-semibold text-[color:var(--add-fg)] hover:text-[color:var(--add-fg-hover)] after:content-[''] after:absolute after:-inset-[11px]"
          style={
            {
              '--add-fg': theme ? theme.dim : 'rgb(var(--ink-4))',
              '--add-fg-hover': theme ? theme.fg : 'rgb(var(--ink))',
              fontSize: addFontSize,
            } as CSSProperties
          }
          onClick={onAddToList}
        >
          {/* Drawn at the control's own type size and a heavier stroke than the app's usual 2:
              on its own beside the chips (the no-label case) the glyph *is* the control, and a
              thin one at icon-button scale reads as a hairline rather than a mark. */}
          <Plus size={Math.round(addFontSize)} strokeWidth={2.75} />
          {chips.length === 0 && 'Add to list'}
        </button>
      )}
      {hlCount > 0 && (
        <HighlightCountBadge
          count={hlCount}
          colors={hlColors}
          theme={theme}
          fs={fs}
          onClick={onHighlightClick}
          style={{ marginLeft: badgeGap }}
        />
      )}
    </span>
  );
}
