import { Fragment } from 'react';
import { matchRuns } from '../lib/searchMatch';
import { boldRuns } from '../lib/noteFormat';
import type { ThemeColors } from '../lib/types';

interface MatchedTextProps {
  text: string;
  // The live search query. Empty (while browsing rather than searching) renders `text` untouched,
  // so a caller that draws both kinds of row can pass it unconditionally.
  query: string;
  // Present only in the Reader's search overlay, which has its own light/sepia/dark theme
  // independent of the app shell's. The library panes omit it and get the shell's --selection.
  theme?: ThemeColors;
  // Renders `*word*` bold. Notes only: the reader writes those markers themselves, and no other
  // field this draws is theirs to mark up. See lib/noteFormat.
  notation?: boolean;
}

// Marks the words of the query wherever they appear in one field of a search result — a hit can
// match on any of ref, title, Pali, blurb, note or a list name, and on several at once, so this is
// what makes a row account for itself.
//
// The fill is the theme's own text-selection colour, which already means "found words" here and so
// stays right in every theme. `color: inherit` keeps a bare <mark> from dragging the browser's
// black-on-yellow into a row that has its own ink.
function Marked({ text, query, theme }: MatchedTextProps) {
  const runs = matchRuns(text, query);
  // One run can still be a hit — a field the query matches end to end, which a bold run inside a
  // note often is, since it is only the marked words. Testing the run, not the count, is what
  // keeps that one marked.
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

// The two passes compose in this order because search marks whole words and emphasis wraps them:
// splitting on the markers first hands each piece its own text to mark, so a query word inside a
// bold run is still found — and the markers themselves, now gone, can't swallow a match.
//
// 600 rather than 700: it is the heaviest weight all three reading faces ship (see index.css).
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
