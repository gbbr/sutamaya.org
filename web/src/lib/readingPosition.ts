import type { SegmentFile } from './corpus';
import { SEGMENT_START_MARGIN } from './segmentScroll';
import { getUiScale } from './uiPrefs';

// Where a reading is, as something that survives the trip to another device.
//
// The reader's own scroll memory (hooks/useScrollMemory.ts) is a pixel offset in localStorage,
// which means nothing on another screen size and nothing under this app's typography controls. The
// put-aside set crosses devices, so it remembers the segment at the top of the reading instead —
// the same anchor highlights use.

// Slack on the line a segment is measured against. Segments are flush — one's bottom is the next
// one's top — so after a restore the line falls exactly on a boundary, and which side of it the
// browser reports a rect on is down to subpixel rounding. Without the slack a reading comes back
// naming the segment above the one it was restored to, and reopening it repeatedly walks it up the
// sutta a segment at a time. Two pixels of a line is not somewhere a reader is.
const BOUNDARY_TOLERANCE = 2;

/**
 * The head of the document, which is a place no segment key names: above the first segment sit the
 * breadcrumb, the sutta's title, its Pali title and — in a batched document — a table of contents.
 * Anchored to the first segment instead, a reading anywhere in that run comes back with the whole
 * of it scrolled off.
 *
 * It holds the position on exactly the terms a segment does: until the first segment's own top
 * reaches the line, the head is what is under it. So reading down through the heading stays at the
 * top, and the first segment takes over the moment it would have counted anyway.
 *
 * The empty string rather than a new field: entries cross the wire and the device's own store, and
 * both already carry `key` as a plain string of whatever the client wrote.
 */
export const READING_TOP = '';

/** The line at the top of the reading, and how far through the sutta it is. */
export interface ReadingPosition {
  /** SuttaCentral's segment id (`mn10:2.7`), or `READING_TOP` for the head of the document. */
  key: string;
  /** 0–100, for a label a device that holds no copy of the sutta can still show. */
  pct: number;
}

/**
 * Reads the topmost segment still on screen in `container`, or null where nothing is rendered yet.
 *
 * A pane whose first segment has not yet reached that edge reads as `READING_TOP` rather than as
 * that segment: everything above it — title, Pali title, a batched document's contents — is a place
 * of its own, and one no key names.
 *
 * Topmost visible rather than nearest: a reader stopped mid-paragraph is looking at the line whose
 * text is under the top edge, so the segment is taken as soon as its bottom clears that edge.
 *
 * The edge is where `scrollToSegment(i, 'start')` puts a segment's top, not the pane's own top — so
 * reading a position back straight after restoring one names the same segment, and a set-aside
 * sutta reopened over and over stays put instead of climbing a segment each time.
 *
 * That margin is written in scroll units and scaled by the UI scale on the way to the screen, where
 * these rects are read: at 120% a restore leaves the segment 17px down, and a threshold still at 14
 * catches the previous segment's last three pixels and names that one instead.
 */
export function readingPositionOf(container: HTMLElement | null, segments: SegmentFile[] | null): ReadingPosition | null {
  if (!container || !segments?.length) return null;
  const top = container.getBoundingClientRect().top + SEGMENT_START_MARGIN * getUiScale() + BOUNDARY_TOLERANCE;
  const rendered = container.querySelectorAll<HTMLElement>('[data-seg]');
  // A pane with nothing drawn in it is a reading that has not started, not one scrolled to the end:
  // there is no position to read, and answering with one would overwrite a real place with a
  // guess.
  if (!rendered.length) return null;
  // The heading is still crossing the line, so it is what the reader is on.
  if (rendered[0].getBoundingClientRect().top > top) return { key: READING_TOP, pct: 0 };
  for (const el of rendered) {
    // The first segment whose text has not yet scrolled off the top edge.
    if (el.getBoundingClientRect().bottom <= top) continue;
    const i = Number(el.dataset.seg);
    const segment = segments[i];
    if (!segment) break;
    return { key: segment.key, pct: percentAt(i, segments.length) };
  }
  // Scrolled past the last rendered segment: the end of the sutta.
  const last = segments[segments.length - 1];
  return { key: last.key, pct: 100 };
}

/** How far through a document of `total` segments the one at `i` is, 0–100. */
export function percentAt(i: number, total: number): number {
  if (total <= 1) return 0;
  return Math.min(100, Math.max(0, Math.round((i / (total - 1)) * 100)));
}
