import type { MarkedBy } from '../search/text';
import { isKeyLine, keyLine, keySutta } from '../corpus/segmentKeys';

// A passage the reader lands on: the first and last segment it opens at and washes, those whose
// Pali it shows, and the words it marks there. Segments are named by key, "sn46.53:15.4".
export interface Passage {
  segments: [string, string];
  paliSegments?: string[];
  markedBy?: MarkedBy;
}

// readLink returns the /read link that opens sutta `id` at `passage`, wherever it is opened, a new
// tab included. With a passage, the link names the sutta its segments belong to — an inner sutta of
// a batched document, where they are in one — and the query string names each segment by what
// follows its colon:
//   at   – the first and last segment, "15.4-15.6", or one, "15.4"
//   pali – the segments whose Pali is shown, "15.4,15.5"
//   q    – each query the words are marked by, repeated
export function readLink(id: string, passage?: Passage): string {
  if (!passage) return `/read/${encodeURIComponent(id)}`;
  const [first, last] = passage.segments;
  const params = new URLSearchParams({ at: first === last ? keyLine(first) : `${keyLine(first)}-${keyLine(last)}` });
  if (passage.paliSegments?.length) params.set('pali', passage.paliSegments.map(keyLine).join(','));
  for (const query of passage.markedBy?.queries ?? []) params.append('q', query);
  return `/read/${encodeURIComponent(keySutta(first))}?${params}`;
}

// passageFromSearch returns the passage a /read link's query string carries, its segments in sutta
// `uid`, or undefined where it carries none, or a malformed one. Its words are marked by word, as a
// search result marks them.
export function passageFromSearch(search: string, uid: string): Passage | undefined {
  const params = new URLSearchParams(search);
  const at = params.get('at')?.split('-');
  if (!at || at.length > 2 || !at.every(isKeyLine)) return undefined;
  const key = (line: string) => `${uid}:${line}`;
  const pali = params.get('pali')?.split(',').filter(isKeyLine).map(key);
  const queries = params.getAll('q').filter((q) => q.trim());
  return {
    segments: [key(at[0]), key(at[1] ?? at[0])],
    ...(pali?.length ? { paliSegments: pali } : {}),
    ...(queries.length ? { markedBy: { queries, anywhere: false } } : {}),
  };
}
