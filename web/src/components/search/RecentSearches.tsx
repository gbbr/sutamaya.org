import { History, X } from 'lucide-react';
import { useLayout } from '../../context/LayoutContext';
import type { ThemeColors } from '../../lib/types';

interface RecentSearchesProps {
  // Newest first.
  searches: string[];
  // The row the arrow keys are on, or -1.
  activeIndex: number;
  // The row of the search whose results are on screen beside this list, or -1.
  currentIndex?: number;
  onPick: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
  // useActiveHitIndex's row registration, for the cursor's scroll into view.
  setRowRef: (i: number) => (el: HTMLButtonElement | null) => void;
  // Places the cursor on the row under the pointer.
  onHover?: (i: number, e: React.MouseEvent) => void;
  // The surrounding pane's row inset in px, so these line up with its other rows.
  inset: number;
  // The reader's palette, where this is drawn over the reader's own background rather than the
  // library's.
  theme?: ThemeColors;
}

// RecentSearches lists the reader's recent searches under a heading with a Clear button, each row
// running its search again and carrying its own remove button.
export function RecentSearches({
  searches,
  activeIndex,
  currentIndex = -1,
  onPick,
  onRemove,
  onClear,
  setRowRef,
  onHover,
  inset,
  theme,
}: RecentSearchesProps) {
  const { mobile } = useLayout();
  const dim = theme ? { color: theme.dim } : undefined;
  return (
    <div data-component="RecentSearches">
      <div className="flex items-center justify-between pt-3 pb-1.5" style={{ paddingLeft: inset, paddingRight: inset }}>
        <span className={`font-sans text-ui-2xs font-bold tracking-[.12em] uppercase${theme ? '' : ' text-ink-3'}`} style={dim}>
          Recent searches
        </span>
        <button
          className={`-my-1 -mr-2 py-1 px-2 font-sans text-ui-xs font-semibold${theme ? '' : ' text-ink-4 hover:text-ink'}`}
          style={dim}
          // Keeps focus in the search box, and a phone's keyboard up.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      {searches.map((q, i) => {
        const marked = i === activeIndex || i === currentIndex;
        return (
          <div
            key={q}
            className={`flex items-center border-b${theme ? '' : ` border-ink/[.07]${marked ? ' bg-ink/[.06]' : ''}`}`}
            style={
              theme
                ? {
                    borderColor: theme.rule,
                    background: marked ? `color-mix(in srgb, ${theme.tint} 50%, transparent)` : 'transparent',
                  }
                : undefined
            }
            onMouseMove={onHover && ((e) => onHover(i, e))}
          >
            <button
              ref={setRowRef(i)}
              className="row flex-1 min-w-0 flex items-center gap-[11px] py-[11px] text-left"
              style={{ paddingLeft: inset }}
              aria-current={i === currentIndex ? 'true' : undefined}
              onClick={() => onPick(q)}
            >
              <History size={16} strokeWidth={2} className={`flex-none${theme ? '' : ' text-ink-4'}`} style={dim} />
              <span className="truncate text-ui-md" style={theme ? { color: theme.fg } : undefined}>
                {q}
              </span>
            </button>
            <button
              className={`flex-none ${mobile ? 'w-11 h-11' : 'w-10 h-10'} flex items-center justify-center rounded-full${theme ? '' : ' text-ink-4 hover:bg-ink/[.08] hover:text-ink'}`}
              // Puts the glyph's edge on the inset, the button's air overhanging it.
              style={{ marginRight: inset - (mobile ? 14 : 12), ...dim }}
              aria-label={`Remove “${q}” from recent searches`}
              title="Remove"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRemove(q)}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
