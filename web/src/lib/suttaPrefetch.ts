// Starting a sutta's text load on the press that opens it, rather than on the reader's own mount.
// The request is the one the reader would make either way, moved ahead of the navigation: the text
// is then in loadSuttaText's cache by the time the page mounts, so it renders in the reader's first
// commit and no loading placeholder appears.
//
// A press is only an intent to open, so the two presses that usually aren't — one that stops a
// momentum scroll, one that starts a flick — are left alone, and a connection the reader shouldn't
// be spending on speculation is skipped entirely.
import { loadSuttaText, resolveCanonicalSuttaId } from './corpus';
import type { Corpus } from './types';

// How long after a scroll a press is still read as part of it.
const SCROLL_QUIET_MS = 250;

// What the Network Information API offers here; typed locally, as lib.dom carries no declaration.
interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

let lastScrollAt = -Infinity;

if (typeof document !== 'undefined') {
  // Capture, since the panes scroll their own containers rather than the document.
  document.addEventListener(
    'scroll',
    () => {
      lastScrollAt = performance.now();
    },
    { capture: true, passive: true }
  );
}

// False on a connection the reader has asked to be frugal with: Save-Data, or 2G in either name.
function connectionAllowsPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/2g/.test(connection.effectiveType ?? '');
}

/**
 * Loads the text of the sutta `id` names, ahead of the reader that is about to ask for it. `id` is
 * resolved the way the reader resolves it, so a row naming an inner sutta prefetches the batched
 * document that actually holds it.
 */
export function prefetchSuttaText(corpus: Corpus | null, id: string): void {
  if (!corpus) return;
  if (performance.now() - lastScrollAt < SCROLL_QUIET_MS) return;
  if (!connectionAllowsPrefetch()) return;
  const uid = resolveCanonicalSuttaId(corpus, id);
  if (!corpus.suttas[uid]) return;
  loadSuttaText(uid).catch(() => {});
}
