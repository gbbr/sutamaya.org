// The title and description a search result shows. Google renders the app before indexing it — a
// crawl of /browse/dn comes back with the whole sutta list — so the tags rewritten here are the
// ones that reach the result page.
//
// index.html carries this same pair as its static default, for a page that sets nothing of its own
// and for the moment before React mounts. Keep the two in step.
export const DEFAULT_TITLE = 'sutamaya';

export const DEFAULT_DESCRIPTION =
  'An offline reader for the Pali suttas: browse the whole canon, keep lists, highlight passages, take notes, and tap any word for a dictionary.';

// Google renders about this much of a description before truncating it, so a blurb is cut here
// rather than left for the search page to chop mid-word.
const MAX_LENGTH = 155;

// Pass a group or sutta description to use it, or null to restore the app-wide default. Called
// through hooks/useDocumentMeta.ts rather than directly.
export function setMetaDescription(text: string | null | undefined): void {
  const el = document.querySelector('meta[name="description"]');
  if (!el) return;
  el.setAttribute('content', text ? summarize(text) : DEFAULT_DESCRIPTION);
}

// Blurbs may carry inline HTML (see ChapterRow.blurb) and run several sentences long, so they are
// flattened to plain text and trimmed at a word boundary.
function summarize(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_LENGTH) return text;
  const cut = text.slice(0, MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
