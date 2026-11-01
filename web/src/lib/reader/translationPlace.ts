import type { SegmentFile } from '../corpus/corpus';
import { compareSegmentKeys } from '../corpus/segmentKeys';
import { getUiScale } from '../ui/uiPrefs';
import { jumpScrollBy } from './segmentScroll';

// Where a switch of translation keeps the reader (data/upstream/README.md's "In the Reader").
export interface TranslationPlace {
  // The key of the line held in place.
  key: string;
  // Its top's distance below the reading pane's, in unscaled pixels.
  offset: number;
}

/** translationPlace returns the first English segment wholly in view below the pane's 20px inset. */
export function translationPlace(pane: HTMLElement): TranslationPlace | undefined {
  const bounds = pane.getBoundingClientRect();
  const scale = getUiScale();
  let clipped: TranslationPlace | undefined;
  for (const line of pane.querySelectorAll<HTMLElement>('[data-seg]')) {
    const rect = line.getBoundingClientRect();
    const key = line.closest<HTMLElement>('[id]')?.id;
    if (!key || rect.height === 0) continue;
    const place = { key, offset: (rect.top - bounds.top) / scale };
    if (place.offset >= 20 && rect.bottom <= bounds.bottom) return place;
    if (!clipped && rect.bottom > bounds.top + 20 * scale && rect.top < bounds.bottom) clipped = place;
  }
  return clipped;
}

/** restoreTranslationPlace keeps a segment, or its nearest predecessor, at the saved screen offset. */
export function restoreTranslationPlace(pane: HTMLElement, segments: SegmentFile[], place: TranslationPlace) {
  let index = 0;
  for (let i = 0; i < segments.length && compareSegmentKeys(segments[i].key, place.key) <= 0; i++) index = i;
  const line = pane.querySelector<HTMLElement>(`[data-seg="${index}"]`);
  if (!line) return;
  const offset = (line.getBoundingClientRect().top - pane.getBoundingClientRect().top) / getUiScale();
  jumpScrollBy(pane, offset - place.offset);
}
