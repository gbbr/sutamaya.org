import { Fragment } from 'react';
import { matchRuns } from '../lib/searchMatch';
import type { ThemeColors } from '../lib/types';

interface MatchedTextProps {
  text: string;
  // The live search query. Empty (while browsing rather than searching) renders `text` untouched,
  // so a caller that draws both kinds of row can pass it unconditionally.
  query: string;
  // Present only in the Reader's search overlay, which has its own light/sepia/dark theme
  // independent of the app shell's. The library panes omit it and get the shell's --selection.
  theme?: ThemeColors;
}

// Marks the words of the query wherever they appear in one field of a search result — a hit can
// match on any of ref, title, Pali, blurb, note or a list name, and on several at once, so this is
// what makes a row account for itself.
//
// The fill is the theme's own text-selection colour, which already means "found words" here and so
// stays right in every theme. `color: inherit` keeps a bare <mark> from dragging the browser's
// black-on-yellow into a row that has its own ink.
export function MatchedText({ text, query, theme }: MatchedTextProps) {
  const runs = matchRuns(text, query);
  if (runs.length === 1) return <>{text}</>;
  return (
    <>
      {runs.map((run, i) =>
        run.hit ? (
          <mark
            key={i}
            className={theme ? undefined : 'bg-[rgb(var(--selection))]'}
            style={{ color: 'inherit', background: theme?.selection }}
          >
            {run.text}
          </mark>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        )
      )}
    </>
  );
}
