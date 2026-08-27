import { useEffect, useRef } from 'react';
import { ChevronDown, List } from 'lucide-react';
import { useListTreeIndex } from '../hooks/useListTreeIndex';
import { useUserData } from '../context/UserDataContext';
import { LIST_RESULTS_CAP, type ListHit } from '../lib/corpus';
import { MatchedText } from './MatchedText';

interface SearchListHitsProps {
  // Already trimmed to what should render — LibraryPage owns the expansion, since TreePane's
  // arrow-key nav has to walk exactly the rows ListPane is drawing.
  hits: ListHit[];
  // Every match, capped or not, so the toggle below can name what's still hidden.
  total: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  query: string;
  // The list row TreePane's arrow-key nav currently has highlighted, if the cursor is in this
  // block rather than down among the sutta hits.
  activeId?: string;
  onSelect: (nodeId: string) => void;
  // The horizontal padding of the surrounding pane's own rows — 'px-[22px]' in TreePane,
  // 'px-6' in ListPane — so these rows line up with the results underneath them.
  padX: string;
}

// The user's own lists that match the query, as a labelled block above the sutta hits, since a
// reader who types a list's name is looking for the list itself. The same query still reaches its
// members through searchCorpus's list-path haystack.
//
// Rendered by whichever pane is showing results: ListPane on desktop, TreePane on mobile. One line
// per list, so a list never outweighs a sutta hit.
export function SearchListHits({ hits, total, expanded, onToggleExpanded, query, activeId, onSelect, padX }: SearchListHitsProps) {
  const { lists } = useUserData();
  const { countFor } = useListTreeIndex(lists);
  // Keeps the keyboard cursor visible when it walks up into this block from the results below.
  // Done here rather than through the index-keyed refs the hit rows use, since this block renders
  // in two panes that track their result rows differently.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (activeId) activeRef.current?.scrollIntoView({ block: 'nearest' });
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
        // The same affordance the description block above the results uses for its own "More".
        <button className={`flex items-center gap-1 pt-1 pb-2 ${padX} font-sans text-ui-xs font-semibold text-ink-4`} onClick={onToggleExpanded}>
          {expanded ? 'Fewer' : `${total - LIST_RESULTS_CAP} more list${total - LIST_RESULTS_CAP === 1 ? '' : 's'}`}
          <ChevronDown size={14} strokeWidth={2.25} className={`flex-none transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
