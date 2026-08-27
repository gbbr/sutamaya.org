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
  // Present only in the Reader (search overlay, sutta header), which has its own light/sepia/dark
  // theme independent of the app shell's. A reader caller passes its resolved theme to get
  // inline-styled chips; omitting it falls back to the shell-tied `border-ink/25` Tailwind classes
  // ListPane and TreePane use. Forwarded to HighlightCountBadge as well.
  theme?: ThemeColors;
  // The reader's body font size (ReaderPrefs' `fs`), passed only by the reader's sutta header, so
  // the chips track its typography control. The library panes have no such control and pass
  // nothing, keeping the fixed size below — which is also what `fs` at its default of 18 produces.
  fs?: number;
  // Only the reader's sutta header passes these: its chips navigate to the clicked list, its badge
  // opens the Highlights side-panel tab. Without a handler a chip or badge renders as a plain span,
  // as in ListPane and TreePane's rows, where the row itself is the click target and a nested
  // <button> would be invalid HTML.
  onChipClick?: (chipId: string) => void;
  onHighlightClick?: (e: React.MouseEvent) => void;
  // Adds an "add to list" control after the chips and before the highlight badge, opening the Lists
  // side-panel tab. Only the reader's sutta header passes it, so the control that edits the
  // memberships sits beside them, matching every row in the Library's list pane. Passing it also
  // makes the row render for a sutta with no chips and no highlights, which would otherwise draw
  // nothing — the control has to be reachable before there is any membership to show.
  onAddToList?: (e: React.MouseEvent) => void;
}

// List-membership chips and highlight-count badge for one sutta row, shared by ListPane's desktop
// rows, TreePane's mobile search results, the Reader's search overlay and the Reader's sutta header
// so all four stay identical. See lib/lists.ts's suttaRowMeta for how `chips`/`hlCount` are built.
export function SuttaRowChips({ chips, hlCount, hlColors, theme, fs, onChipClick, onHighlightClick, onAddToList }: SuttaRowChipsProps) {
  if (chips.length === 0 && hlCount === 0 && !onAddToList) return null;
  const ChipTag = onChipClick ? 'button' : 'span';
  const fontSize = fs ? fs - 7 : 14;
  const height = fontSize + 11;
  // The add-to-list control runs a point above the chips: it has no fill or outline of its own, so
  // a little extra size keeps it from disappearing into the run of pills — but only a little, since
  // it sits at the end of that run rather than heading it.
  const addFontSize = fontSize + 1;
  // The gap before the highlight badge. The badge is a count rather than a list, so it separates
  // itself from whatever precedes it, by an amount that depends on what that is. The add control
  // keeps the plain chip-to-chip gap, since it edits the memberships it sits at the end of.
  function badgeGapFor(): number | undefined {
    // After the add control, which carries no fill or outline of its own: it takes a clear step to
    // read as a break rather than as more of the same run.
    if (onAddToList) return 12;
    // Straight after a chip's edge, in the Library, where the line has no add control. Less than
    // after the add control, since a pill edge is already a boundary, but not nothing: the badge
    // has no outline, so without a little air its swatches read as hanging off the chip.
    if (chips.length > 0) return 8;
    // The badge is alone on the line, so there's nothing to separate from: flush with the row.
    return undefined;
  }
  const badgeGap = badgeGapFor();
  return (
    <span data-component="SuttaRowChips" className="flex flex-wrap items-center gap-1.5 mt-3">
      {/* A chip for a list inside a group is segmented: a tinted leading segment naming the
          immediate parent, then the list's own name. The parent is part of what identifies the
          list — several groups can hold a "#anicca" — and a segment carries it on touch, where a
          hover title says nothing. Repeating the parent on each of that group's chips is the cost
          of every chip staying a self-contained unit: nothing has to line up, and the row wraps
          chip-by-chip exactly as it did when they were plain pills, rather than needing a group
          to survive being split across two lines.
          `items-stretch` + `overflow-hidden` on the pill is what makes the parent segment's fill
          reach both rounded ends; the horizontal padding moves onto the segments themselves. */}
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
          {/* The fill and the medium weight are what set the parent apart, not a quieter text
              colour: the quiet rungs of each palette (`--ink-3`, a theme's `dim`) are tuned for
              text on the page's own ground, and this text sits on a tint that costs it about a
              stop — sepia's `dim` landed near 3:1 there. Same colour as the list's own name, one
              step down in the shell where the ramp has a rung to spare. */}
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
