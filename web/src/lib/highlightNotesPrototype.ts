import { useMemo, useSyncExternalStore } from 'react';
import type { HlSpan } from './highlights';
import type { Highlight, Translator } from './types';

// The highlight-notes prototype's notes, held in memory only: nothing is saved or synced, and a
// reload clears them. Keyed by span rather than highlight id, since a recolour mints a new id over
// the same span.
let notes: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** highlightNoteKey returns the key the note on a sutta's span, in one translation, is held under. */
export function highlightNoteKey(suttaId: string, by: Translator, span: HlSpan): string {
  return [suttaId, by, span.k0, span.o0, span.k1, span.o1].join('|');
}

/** setHighlightNote stores a note's text, dropping the note when the text is blank. */
export function setHighlightNote(key: string, text: string): void {
  const next = new Map(notes);
  if (text.trim()) next.set(key, text);
  else next.delete(key);
  notes = next;
  for (const listener of listeners) listener();
}

/** useHighlightNotes returns every note by key. */
export function useHighlightNotes(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, () => notes);
}

/** useHighlightNote returns one note's text, or '' when there is none. */
export function useHighlightNote(key: string): string {
  return useSyncExternalStore(subscribe, () => notes.get(key) ?? '');
}

/** useNotedHighlightIds returns the ids of the highlights that carry a note, a new set only when that changes. */
export function useNotedHighlightIds(suttaId: string | undefined, by: Translator, highlights: Highlight[]): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribe, () =>
    suttaId
      ? highlights
          .filter((h) => notes.has(highlightNoteKey(suttaId, by, h)))
          .map((h) => h.id)
          .join(' ')
      : ''
  );
  return useMemo(() => new Set(ids ? ids.split(' ') : []), [ids]);
}
