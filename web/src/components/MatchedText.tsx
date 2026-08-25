import { Fragment } from 'react';
import { matchRuns } from '../lib/searchMatch';
import type { ThemeColors } from '../lib/types';

interface MatchedTextProps {
  text: string;
  // The live search query. Empty (while browsing rather than searching) renders `text` untouched,
  // so a caller that draws both kinds of row can pass it unconditionally.
  query: string;
  // Present only in the Reader's search overlay — the reader has its own light/sepia/dark theme,
  // independent of the app shell's (see SuttaRowChips, which takes it for the same reason). The
  // library panes omit it and get the shell's own --selection.
  theme?: ThemeColors;
}

// Marks the words of the query wherever they appear in one field of a search result. A hit can
// match on any of ref, title, Pali, blurb, note or a list name, and after search stopped requiring
// the words to be adjacent it can match on several at once — so without this a row gives no
// account of itself, and a blurb-only hit looks like it arrived by accident.
//
// The fill is the theme's own text-selection color: finding words in a page is exactly what that
// color already means here, and it needs no new token to stay right in every theme. `color:
// inherit` because a bare <mark> would otherwise drag the browser's black-on-yellow into a row
// that has its own ink.
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
