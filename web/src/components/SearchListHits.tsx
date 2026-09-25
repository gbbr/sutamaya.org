import { useEffect, useRef } from 'react';
import { ChevronDown, Library, List } from 'lucide-react';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useUserData } from '../context/UserDataContext';
import { LIST_RESULTS_CAP, listBlockHitId, type ListBlockHit } from '../lib/search/metadata';
import { MatchedText } from './MatchedText';

interface SearchListHitsProps {
  // The rows to draw, already trimmed; LibraryPage owns the expansion, so TreePane's arrow-key nav
  // walks exactly what is drawn.
  hits: ListBlockHit[];
  // How many matched in all, so the toggle can name what is hidden.
  total: number;
  // Names and counts every match, the hidden ones included: "Collections (4)".
  heading: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  query: string;
  // The row the arrow-key cursor is on, while it is in this block rather than among the sutta hits.
  activeId?: string;
  // Whether that cursor is on the toggle beneath the rows.
  toggleActive?: boolean;
  onSelect: (nodeId: string) => void;
  // The surrounding pane's own row padding, so these line up with the results beneath them.
  padX: string;
}

// The reader's lists and the browse groups matching the query, as a labelled block above the sutta
// hits — a reader who types a list's or a collection's name is looking for it, not the suttas
// inside. A line or two each, so a row never outweighs a sutta hit. Drawn by whichever pane is
// showing results: ListPane on desktop, TreePane on mobile.
export function SearchListHits({
  hits,
  total,
  heading,
  expanded,
  onToggleExpanded,
  query,
  activeId,
  toggleActive = false,
  onSelect,
  padX,
}: SearchListHitsProps) {
  const { lists } = useUserData();
  const { countFor } = useListTreeIndex(lists);
  // The active row or toggle, scrolled into view as the cursor walks up into this block. Kept here
  // rather than in the panes' own index-keyed refs, the two tracking their result rows differently.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // Whether the cursor has been on a row here before, which is what separates a cursor the reader
  // moved from the one an arrival places on the first row — revealing that one would scroll the
  // restored results back to the top.
  const cursorSeenRef = useRef(false);
  // Whether the cursor is on the toggle as "Fewer", which collapsing the block moves up.
  const onFewer = toggleActive && expanded;
  useEffect(() => {
    if (!activeId && !toggleActive) return;
    const placing = !cursorSeenRef.current;
    cursorSeenRef.current = true;
    if (placing) return;
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId, toggleActive, onFewer]);
  if (total === 0) return null;
  return (
    <div className="border-b border-ink/[.12] pb-1.5">
      <div className={`${padX} pt-3 pb-1.5 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3`}>
        {heading}
      </div>
      {hits.map((hit) => {
        const id = listBlockHitId(hit);
        const on = id === activeId;
        return (
          <button
            key={id}
            ref={on ? activeRef : undefined}
            className={`flex items-center gap-[11px] w-full text-left py-[10px] ${padX} ${on ? 'bg-ink/[.05]' : ''}`}
            style={on ? { boxShadow: 'inset 2px 0 0 rgb(var(--accent2))' } : undefined}
            onClick={() => onSelect(id)}
          >
            {'group' in hit ? (
              // A collection, on two lines as a sutta hit is: its reference and name, then its other
              // name beneath.
              <>
                <Library size={17} strokeWidth={2} className="flex-none text-ink-4" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-2">
                    {/* A nikaya has none, its name being unambiguous. */}
                    {'ref' in hit.group && <span className="flex-none font-sans text-ui-xs font-bold text-ink-3">{hit.group.ref}</span>}
                    <span className="font-serif text-ui-md font-medium truncate">
                      <MatchedText text={hit.group.label} query={query} />
                    </span>
                  </span>
                  {/* The Pali name beneath a chapter's English one; the English beneath a nikaya's Pali. */}
                  {hit.group.sub && (
                    <span className={`block text-ui-sm mt-[1px] truncate ${'ref' in hit.group ? 'font-serif italic text-accent-text' : 'font-sans text-ink-4'}`}>
                      <MatchedText text={hit.group.sub} query={query} />
                    </span>
                  )}
                </span>
                <span className="flex-none font-sans text-ui-xs font-medium text-ink-4">{hit.group.count}</span>
              </>
            ) : (
              <>
                <List size={17} strokeWidth={2} className="flex-none text-ink-4" />
                <span className="flex-1 min-w-0 flex items-baseline gap-2">
                  <span className="font-serif text-ui-md font-medium truncate">
                    <MatchedText text={hit.list.label} query={query} />
                  </span>
                  {hit.parents && (
                    <span className="font-sans text-ui-xs text-ink-4 truncate">
                      <MatchedText text={hit.parents} query={query} />
                    </span>
                  )}
                </span>
                <span className="flex-none font-sans text-ui-xs font-medium text-ink-4">{countFor(hit.list)}</span>
              </>
            )}
          </button>
        );
      })}
      {total > LIST_RESULTS_CAP && (
        // The expand toggle, as the description block above the results draws its own "More".
        <button
          ref={toggleActive ? activeRef : undefined}
          className={`flex items-center gap-1 w-full py-1.5 ${padX} font-sans text-ui-xs font-semibold text-ink-4 ${toggleActive ? 'bg-ink/[.05]' : ''}`}
          style={toggleActive ? { boxShadow: 'inset 2px 0 0 rgb(var(--accent2))' } : undefined}
          onClick={onToggleExpanded}
        >
          {expanded ? 'Fewer' : `${total - LIST_RESULTS_CAP} more`}
          <ChevronDown size={14} strokeWidth={2.25} className={`flex-none transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
