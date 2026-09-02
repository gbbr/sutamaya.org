import type { HighlightsMap, ListDef, NotesMap } from './types';

// How many highlights read as intent rather than a stray drag; a note or a list counts on its own.
const KEEP_SAFE_HIGHLIGHTS = 2;

// True when this device holds enough of the reader's own work to warn them it could be lost. Every
// such warning asks this one question, so they can't drift apart.
export function hasLocalWorkWorthKeeping(lists: ListDef[], notes: NotesMap, highlights: HighlightsMap): boolean {
  return (
    lists.some((l) => !l.auto) ||
    Object.keys(notes).length > 0 ||
    Object.values(highlights).reduce((n, rows) => n + rows.length, 0) >= KEEP_SAFE_HIGHLIGHTS
  );
}
