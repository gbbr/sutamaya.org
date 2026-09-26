// The title and description a search result shows. Google renders the app before indexing it, so
// the tags rewritten here are what reaches the result page. index.html carries the same pair as
// its static default, for the moment before React mounts — keep the two in step.
export const DEFAULT_TITLE = 'sutamaya';

export const DEFAULT_DESCRIPTION =
  'An offline reader for the Pali suttas: browse the whole canon, keep lists, highlight passages, take notes, and tap any word for a dictionary.';

// How much of a description survives on a search page, so a blurb is cut here at a word boundary
// rather than chopped there mid-word.
const MAX_LENGTH = 155;

// Sets the meta description to a group or sutta blurb, or restores the app-wide default with null.
export function setMetaDescription(text: string | null | undefined): void {
  const el = document.querySelector('meta[name="description"]');
  if (!el) return;
  el.setAttribute('content', text ? summarize(text) : DEFAULT_DESCRIPTION);
}

// Flattens a blurb's inline HTML to plain text and trims it to MAX_LENGTH at a word boundary.
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
