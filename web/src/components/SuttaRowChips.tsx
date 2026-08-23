import { Plus } from 'lucide-react';
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
  // Adds an "add to list" control after the chips and before the highlight badge, opening the
  // Lists side-panel tab. Only the reader's sutta header passes it — its chips are a live account
  // of this sutta's memberships, so the control that edits them belongs beside them, matching the
  // one on every row in the Library's list pane. Passing it also makes the row render for a sutta
  // with no chips and no highlights, which would otherwise draw nothing at all: the point of the
  // control is to be reachable before there is any membership to show.
  onAddToList?: (e: React.MouseEvent) => void;
}

// List-membership chips + highlight-count badge for one sutta row — shared by ListPane's desktop
// rows, TreePane's mobile search results, the Reader's own search overlay, and the Reader's sutta
// header (see lib/lists.ts's suttaRowMeta for how `chips`/`hlCount` are computed) so all four stay
// visually and behaviourally identical rather than drifting apart.
export function SuttaRowChips({ chips, hlCount, theme, fs, onChipClick, onHighlightClick, onAddToList }: SuttaRowChipsProps) {
  if (chips.length === 0 && hlCount === 0 && !onAddToList) return null;
  const ChipTag = onChipClick ? 'button' : 'span';
  const fontSize = fs ? fs - 7 : 14;
  const height = fontSize + 9;
  // The filled controls sit a little further from the chips than the chips do from each other, so
  // the row reads as memberships first and controls after, rather than one undifferentiated run of
  // pills. Nothing to separate from when there are no chips, so it stays flush with the row's edge.
  const controlGap = chips.length > 0 ? 4 : undefined;
  return (
    <span data-component="SuttaRowChips" className="flex flex-wrap items-center gap-1.5 mt-3">
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
          title={c.breadcrumb}
        >
          {c.label}
        </ChipTag>
      ))}
      {/* Filled, like the highlight badge beside it and unlike the outlined chips — in this row
          filled means "control that opens a panel" and outlined means "a list this sutta is in".
          An outlined pill here, label and all, just reads as one more membership, named "Add to
          list". The label is carried only when there are no chips: that is the one case where
          nothing else on screen explains the icon. Beside existing chips the row already reads as
          memberships, so a bare "+" is unambiguous and keeps the chips the thing being read. */}
      {onAddToList && (
        <button
          aria-label="Add to list"
          className={`relative inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full font-sans font-semibold bg-ink/10 text-ink/60 hover:opacity-70 after:content-[''] after:absolute after:-inset-[11px] ${
            chips.length > 0 ? '' : 'px-[9px]'
          }`}
          style={
            theme
              ? { background: theme.tint, color: theme.fg, fontSize, height, width: chips.length > 0 ? height : undefined, marginLeft: controlGap }
              : { fontSize, height, width: chips.length > 0 ? height : undefined, marginLeft: controlGap }
          }
          onClick={onAddToList}
        >
          <Plus size={Math.round(fontSize)} strokeWidth={2.5} />
          {chips.length === 0 && 'Add to list'}
        </button>
      )}
      {hlCount > 0 && (
        <HighlightCountBadge
          count={hlCount}
          theme={theme}
          fs={fs}
          onClick={onHighlightClick}
          style={{ marginLeft: chips.length > 0 || onAddToList ? 4 : undefined }}
        />
      )}
    </span>
  );
}
