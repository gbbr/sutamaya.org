import { useEffect, useRef } from 'react';
import { ChevronDown, List } from 'lucide-react';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useUserData } from '../context/UserDataContext';
import { LIST_RESULTS_CAP, type ListHit } from '../lib/search/metadata';
import { MatchedText } from './MatchedText';

interface SearchListHitsProps {
  // The rows to draw, already trimmed; LibraryPage owns the expansion, so TreePane's arrow-key nav
  // walks exactly what is drawn.
  hits: ListHit[];
  // How many matched in all, so the toggle can name what is hidden.
  total: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  query: string;
  // The row the arrow-key cursor is on, while it is in this block rather than among the sutta hits.
  activeId?: string;
  onSelect: (nodeId: string) => void;
  // The surrounding pane's own row padding, so these line up with the results beneath them.
  padX: string;
}

// The user's own lists matching the query, as a labelled block above the sutta hits — a reader who
// types a list's name is looking for the list itself. One line each, so a list never outweighs a
// sutta hit. Drawn by whichever pane is showing results: ListPane on desktop, TreePane on mobile.
export function SearchListHits({ hits, total, expanded, onToggleExpanded, query, activeId, onSelect, padX }: SearchListHitsProps) {
  const { lists } = useUserData();
  const { countFor } = useListTreeIndex(lists);
  // The active row, scrolled into view as the cursor walks up into this block. Kept here rather
  // than in the panes' own index-keyed refs, the two tracking their result rows differently.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // Whether the cursor has been on a row here before, which is what separates a cursor the reader
  // moved from the one an arrival places on the first row — revealing that one would scroll the
  // restored results back to the top.
  const cursorSeenRef = useRef(false);
  useEffect(() => {
    if (!activeId) return;
    const placing = !cursorSeenRef.current;
    cursorSeenRef.current = true;
    if (placing) return;
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  if (total === 0) return null;
  return (
    <div className="border-b border-ink/[.12] pb-1.5">
      <div className={`${padX} pt-3 pb-1.5 font-sans text-ui-2xs font-bold tracking-[.12em] uppercase text-ink-3`}>
        Lists
      </div>
      {hits.map(({ list, parents }) => {
        const on = list.id === activeId;
        return (
          <button
            key={list.id}
            ref={on ? activeRef : undefined}
            className={`flex items-center gap-[11px] w-full text-left py-[10px] ${padX} ${on ? 'bg-ink/[.05]' : ''}`}
            style={on ? { boxShadow: 'inset 2px 0 0 rgb(var(--accent2))' } : undefined}
            onClick={() => onSelect(String(list.id))}
          >
            <List size={17} strokeWidth={2} className="flex-none text-ink-4" />
            <span className="flex-1 min-w-0 flex items-baseline gap-2">
              <span className="font-serif text-ui-md font-medium truncate">
                <MatchedText text={list.label} query={query} />
              </span>
              {parents && (
                <span className="font-sans text-ui-xs text-ink-4 truncate">
                  <MatchedText text={parents} query={query} />
                </span>
              )}
            </span>
            <span className="flex-none font-sans text-ui-xs font-medium text-ink-4">{countFor(list)}</span>
          </button>
        );
      })}
      {total > LIST_RESULTS_CAP && (
        // The expand toggle, as the description block above the results draws its own "More".
        <button className={`flex items-center gap-1 pt-1 pb-2 ${padX} font-sans text-ui-xs font-semibold text-ink-4`} onClick={onToggleExpanded}>
          {expanded ? 'Fewer' : `${total - LIST_RESULTS_CAP} more list${total - LIST_RESULTS_CAP === 1 ? '' : 's'}`}
          <ChevronDown size={14} strokeWidth={2.25} className={`flex-none transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
