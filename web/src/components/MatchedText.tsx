import { Fragment } from 'react';
import { matchRuns } from '../lib/searchMatch';
import { boldRuns } from '../lib/noteFormat';
import type { ThemeColors } from '../lib/types';

interface MatchedTextProps {
  text: string;
  // The live search query. Empty renders `text` untouched, so a caller that draws both kinds of
  // row can pass it unconditionally.
  query: string;
  // The reader's own theme, for its search overlay. The library omits it and takes the shell's.
  theme?: ThemeColors;
  // Renders `*word*` bold. Notes only, no other field being the reader's to mark up.
  notation?: boolean;
}

// Marks the query's words wherever they appear in one field, which is what makes a search result
// account for itself. Filled in the theme's own selection colour, which already means "found
// words", with `color: inherit` to keep the browser's black-on-yellow out of a row with its own ink.
function Marked({ text, query, theme }: MatchedTextProps) {
  const runs = matchRuns(text, query);
  // Tested on the run rather than the count, since a single run can be a hit — a field the query
  // matches end to end, which a bold run inside a note often is.
  if (runs.length === 1 && !runs[0].hit) return <>{text}</>;
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

// A field of a search result, with the query's words marked and, for a note, its `*bold*`
// rendered. Emphasis is split first, so each piece is marked on its own text and a query word
// inside a bold run is still found. Semibold, the heaviest weight all three reading faces ship.
export function MatchedText({ text, query, theme, notation }: MatchedTextProps) {
  if (!notation) return <Marked text={text} query={query} theme={theme} />;
  return (
    <>
      {boldRuns(text).map((run, i) => {
        const marked = <Marked text={run.text} query={query} theme={theme} />;
        return run.bold ? (
          <strong key={i} className="font-semibold">
            {marked}
          </strong>
        ) : (
          <Fragment key={i}>{marked}</Fragment>
        );
      })}
    </>
  );
}
