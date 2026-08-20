import type { SuttaRowChip } from '../lib/lists';
import type { ThemeColors } from '../lib/types';
import { HighlightCountBadge } from './HighlightCountBadge';

interface SuttaRowChipsProps {
  chips: SuttaRowChip[];
  hlCount: number;
  // Present only in the Reader (search overlay, sutta header) — the reader has its own
  // light/sepia/dark theme system, independent of the app shell's own dark/light mode (see
  // index.css's --ink), so a reader caller passes its resolved theme to get inline-styled chips
  // matching it instead of the app-shell-tied `border-ink/25` Tailwind classes ListPane/TreePane
  // fall back to when this is omitted. Also forwarded to HighlightCountBadge for the same reason.
  theme?: ThemeColors;
  // The reader's body font size (ReaderPrefs' `fs`), passed only by the reader's sutta header, so
  // the chips track the typography control the way everything else in that header does. The
  // library panes have no such control and pass nothing, keeping the fixed size below — which is
  // what `fs` at its default of 18 also produces, so the reader looks unchanged until the user
  // moves the slider.
  fs?: number;
  // Only the reader's sutta header passes these — its chips navigate to the clicked list, and its
  // badge opens the Highlights side-panel tab. Without a click handler, a chip/badge renders as a
  // plain (non-interactive) span, same as ListPane/TreePane's read-only search rows, where the row
  // itself is already the click target and a nested <button> would be invalid HTML anyway.
  onChipClick?: (chipId: string) => void;
  onHighlightClick?: (e: React.MouseEvent) => void;
}

// List-membership chips + highlight-count badge for one sutta row — shared by ListPane's desktop
// rows, TreePane's mobile search results, the Reader's own search overlay, and the Reader's sutta
// header (see lib/lists.ts's suttaRowMeta for how `chips`/`hlCount` are computed) so all four stay
// visually and behaviourally identical rather than drifting apart.
export function SuttaRowChips({ chips, hlCount, theme, fs, onChipClick, onHighlightClick }: SuttaRowChipsProps) {
  if (chips.length === 0 && hlCount === 0) return null;
  const ChipTag = onChipClick ? 'button' : 'span';
  const fontSize = fs ? fs - 7 : 11;
  const height = fontSize + 9;
  return (
    <span data-component="SuttaRowChips" className="flex flex-wrap items-center gap-1.5 mt-2">
      {chips.map((c) => (
        <ChipTag
          key={c.id}
          className={`inline-flex items-center whitespace-nowrap rounded-full px-[9px] font-sans ${
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
        >
          {c.breadcrumb}
        </ChipTag>
      ))}
      {hlCount > 0 && <HighlightCountBadge count={hlCount} theme={theme} fs={fs} onClick={onHighlightClick} />}
    </span>
  );
}
