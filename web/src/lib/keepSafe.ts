import type { HighlightsMap, ListDef, NotesMap } from './types';

// How much locally-made work is enough to warrant warning a signed-out user it could be lost. One
// note or one list is a deliberate act of authorship and counts on its own; a single highlight can
// be a stray drag, so it takes a second one to read as intent. Every warning that a signed-out
// reader's data lives only on this device asks this one question — the header banner, the footer's
// DataStatus, and both warning lines in Settings' Account card — so they can't drift apart
// on what counts as "something to lose", or appear to someone with nothing to lose.
const KEEP_SAFE_HIGHLIGHTS = 2;

export function hasLocalWorkWorthKeeping(lists: ListDef[], notes: NotesMap, highlights: HighlightsMap): boolean {
  return (
    lists.some((l) => !l.auto) ||
    Object.keys(notes).length > 0 ||
    new Set(Object.values(highlights).flatMap((rows) => rows.map((h) => h.g))).size >= KEEP_SAFE_HIGHLIGHTS
  );
}
