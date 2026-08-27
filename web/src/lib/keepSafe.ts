import type { HighlightsMap, ListDef, NotesMap } from './types';

// How much locally-made work warrants warning a signed-out user it could be lost. One note or one
// list counts on its own; a single highlight can be a stray drag, so it takes two to read as
// intent. Every such warning — the header banner, the account badge's dot, and both lines in
// Settings' Account card — asks this one question, so they can't drift apart.
const KEEP_SAFE_HIGHLIGHTS = 2;

export function hasLocalWorkWorthKeeping(lists: ListDef[], notes: NotesMap, highlights: HighlightsMap): boolean {
  return (
    lists.some((l) => !l.auto) ||
    Object.keys(notes).length > 0 ||
    new Set(Object.values(highlights).flatMap((rows) => rows.map((h) => h.g))).size >= KEEP_SAFE_HIGHLIGHTS
  );
}
