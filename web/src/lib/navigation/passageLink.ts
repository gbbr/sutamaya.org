import type { MarkedBy } from '../search/text';

// A passage the reader lands on: the first and last segment it opens at and washes, those whose
// Pali it shows, and the words it marks there.
export interface Passage {
  segments: [number, number];
  paliSegments?: number[];
  markedBy?: MarkedBy;
}

// A segment position: a whole number, written without a sign or leading zeros.
const POSITION = /^(0|[1-9]\d*)$/;

// passageSearch returns the query string a /read link carries `passage` in, so the link opens on it
// wherever it is opened, a new tab included; empty for no passage. Segments are positions in the
// sutta's text, not keys.
//   at   – the first and last segment, "512-514", or one, "512"
//   pali – the segments whose Pali is shown, "512,513"
//   q    – each query the words are marked by, repeated
export function passageSearch(passage: Passage | undefined): string {
  if (!passage) return '';
  const [first, last] = passage.segments;
  const params = new URLSearchParams({ at: first === last ? `${first}` : `${first}-${last}` });
  if (passage.paliSegments?.length) params.set('pali', passage.paliSegments.join(','));
  for (const query of passage.markedBy?.queries ?? []) params.append('q', query);
  return `?${params}`;
}

// passageFromSearch returns the passage a /read link's query string carries, or undefined where it
// carries none, or a malformed one. Its words are marked by word, as a search result marks them.
export function passageFromSearch(search: string): Passage | undefined {
  const params = new URLSearchParams(search);
  const at = params.get('at')?.split('-');
  if (!at || at.length > 2 || !at.every((n) => POSITION.test(n))) return undefined;
  const first = Number(at[0]);
  const last = Number(at[1] ?? at[0]);
  if (last < first) return undefined;
  const pali = params.get('pali')?.split(',').filter((n) => POSITION.test(n)).map(Number);
  const queries = params.getAll('q').filter((q) => q.trim());
  return {
    segments: [first, last],
    ...(pali?.length ? { paliSegments: pali } : {}),
    ...(queries.length ? { markedBy: { queries, anywhere: false } } : {}),
  };
}
