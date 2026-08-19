import type { HighlightsMap, ListDef, NotesMap } from './types';

// How much locally-made work is enough to warrant warning a signed-out user it could be lost. One
// note or one list is a deliberate act of authorship and counts on its own; a single highlight can
// be a stray drag, so it takes a second one to read as intent. Shared by HeaderBanner (the
// dismissible nudge) and SettingsPage (the standing warning in the Account card) so the two can't
// drift apart on what counts as "something to lose".
const KEEP_SAFE_HIGHLIGHTS = 2;

export function hasLocalWorkWorthKeeping(lists: ListDef[], notes: NotesMap, highlights: HighlightsMap): boolean {
  return (
    lists.some((l) => !l.auto) ||
    Object.keys(notes).length > 0 ||
    new Set(Object.values(highlights).flatMap((rows) => rows.map((h) => h.g))).size >= KEEP_SAFE_HIGHLIGHTS
  );
}
