// The title and description a link preview shows when someone shares a sutta or a browse group.
//
// WhatsApp, Slack, iMessage and the rest fetch the URL and read the HTML that comes back; none of
// them run the app, so the tags web/src/hooks/useDocumentMeta.ts writes once React mounts arrive
// far too late, and every link previews as the app's own generic title and description. This puts
// the same two values into the served HTML.
//
// Only /read/* and /browse/* are rewritten. /index.html above all is left exactly as the build
// produced it: the service worker precaches that path and hands the stored copy back for every
// in-app navigation, so a copy carrying one sutta's title would put that title on every page in
// the app. The paths rewritten here are only ever fetched on a cold load, which is why this is
// safe — see the navigation fallback in web/vite.config.ts.
//
// The lookups are ports of web/src/lib/corpus.ts (findNode, resolveCanonicalSuttaId) and the
// 155-character trim in web/src/lib/documentMeta.ts, and the titles are what ReaderPage and
// LibraryPage pass to useDocumentMeta, so a shared link previews as the page it opens. No module
// is shared between the two npm workspaces — change one, change the other. The descriptions
// deliberately don't match the page everywhere: see nodeMeta on what a card can't say.

// Only these two carry a subject of their own. A user list also lives under /browse, but its id is
// opaque and names nothing in the corpus, so it falls out of findNode below and the shell is left
// alone: a list is one reader's own and has no preview to show.
const SHAREABLE = /^\/(read|browse)\/([^/]+)/;

// Roughly what a preview card and a search result render before truncating, so a long blurb is cut
// at a word boundary here rather than chopped mid-word by whoever displays it.
const MAX_LENGTH = 155;

// A batched leaf uid like "dhp320-333" holds several verses in one document and has no entry for
// any single number inside the range, so "/read/dhp321" — a link the app itself produces and keeps
// in the address bar — has to resolve to the batch that contains it.
const RANGE_UID = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)-(\d+)$/;
const RANGE_QUERY = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)$/;

// Whatever the shell already says. A page with no subject of its own keeps it; a group with a
// title but no description has it removed, so the card shows the title alone rather than repeating
// the app's boilerplate under every one.
const DESCRIPTION_META = 'meta[name="description"]';

// web/public/share-card.png — the flat leaf mark from the landing page's wordmark, at the size a
// preview thumbnail wants. The app icon is the same leaf painted for a home screen, and at 512px
// square it fills the whole card instead of sitting beside the title.
const SHARE_IMAGE = '/share-card.png';

// The parsed corpus, for the life of the isolate. It is ~1MB of JSON and never changes between
// deploys, so parsing it once and holding it costs one slow request per isolate; a failure isn't
// held, so a request during a deploy doesn't poison every request after it.
let corpusCache = null;
let corpusInFlight = null;

export function loadCorpus(env, url) {
  if (corpusCache) return Promise.resolve(corpusCache);
  if (!corpusInFlight) {
    corpusInFlight = env.ASSETS.fetch(new URL('/data/corpus.json', url))
      .then((res) => (res.ok ? res.json() : null))
      .then((corpus) => {
        corpusInFlight = null;
        if (corpus) corpusCache = corpus;
        return corpus;
      })
      .catch(() => {
        corpusInFlight = null;
        return null;
      });
  }
  return corpusInFlight;
}

// The app shell with this URL's own title and description written into it, or the shell untouched
// when the path names nothing the corpus knows about — an unknown id, a user list, or any page
// outside /read and /browse.
export async function withShareMeta(shell, url, env) {
  if (!SHAREABLE.test(url.pathname)) return shell;
  const meta = shareMetaFor(await loadCorpus(env, url), url.pathname);
  return meta ? applyShareMeta(shell, meta, url) : shell;
}

// Writes one page's title and description into the shell as it streams past.
export function applyShareMeta(shell, meta, url) {
  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'sutamaya'],
    ['og:url', `${url.origin}${url.pathname}`],
    ['og:title', meta.title],
    ...(meta.description ? [['og:description', meta.description]] : []),
    // The leaf mark, small and square, which is what puts it beside the text as a thumbnail
    // rather than across the top of the card: WhatsApp and the rest pick that layout from the
    // image's proportions, and the dimensions are declared so they can pick it without
    // downloading the file first. 256px because Facebook's crawler — WhatsApp's too — drops an
    // image below 200px square outright.
    ['og:image', `${url.origin}${SHARE_IMAGE}`],
    ['og:image:width', '256'],
    ['og:image:height', '256'],
  ]
    .map(([property, content]) => `<meta property="${property}" content="${escapeAttr(content)}" />`)
    .join('');

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on(DESCRIPTION_META, {
      element(el) {
        // Removed rather than left at the default in the one case that reaches here with nothing —
        // a whole collection, which has no group above it to name. A bare title beats the same
        // sentence about the app appearing under every page on the site.
        if (meta.description) el.setAttribute('content', meta.description);
        else el.remove();
      },
    })
    .on('head', {
      element(el) {
        // A summary card with no image — the tags every platform reads, and nothing beyond them.
        el.append(`${tags}<meta name="twitter:card" content="summary" />`, { html: true });
      },
    })
    .transform(shell);
}

// What this path's page calls itself, or null when nothing in the corpus answers to it.
export function shareMetaFor(corpus, pathname) {
  const match = corpus && SHAREABLE.exec(pathname);
  if (!match) return null;
  const [, section, rawId] = match;
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  return section === 'read' ? suttaMeta(corpus, id) : nodeMeta(corpus, id);
}

// Ids are lowercase throughout the corpus while every reference on screen is capitalized, so a
// link shared from what someone is reading arrives as "/read/SN35.33-42" and has to be folded
// before any lookup — the same fold ReaderPage and LibraryPage apply to their own route ids.
function suttaMeta(corpus, id) {
  const sutta = corpus.suttas[resolveSuttaId(corpus, id.toLowerCase())];
  if (!sutta) return null;
  const found = sutta.node ? findNode(corpus, sutta.node) : null;
  return {
    title: `${sutta.ref} · ${sutta.en}`,
    // A sutta's title is its own name, so the leaf group holding it is still worth naming.
    description: summarize(sutta.blurb) ?? placeOf(found && [...found.ancestors, found.node], sutta.en),
  };
}

function nodeMeta(corpus, id) {
  const found = findNode(corpus, id) ?? findNode(corpus, id.toLowerCase());
  if (!found) return null;
  const { node } = found;
  return {
    title: node.ref ? `${node.ref} · ${node.label}` : node.label,
    // Its own description only. The page itself falls back to the nearest ancestor's and labels
    // what it borrowed — "About SN35 · The Six Sense Fields" — because a paragraph about the
    // saṁyutta above is not a description of these ten discourses. A card has nowhere to put that
    // label, so the borrowed paragraph would read as though it described the group named right
    // above it, and every vagga of a saṁyutta would preview identically. Saying where the group
    // sits is the honest thing the card can say instead.
    //
    // A group is named in the title already, so that comes from the levels above it — and a whole
    // collection, which has no levels above it, falls to its own English name ("Long Discourses"),
    // the one thing left to say about a title written in Pali.
    description: summarize(node.blurb) ?? placeOf(found.ancestors) ?? node.sub ?? null,
  };
}

// Where a document or a group sits in the canon — "Saṁyutta Nikāya · Six Sense Fields" — for the
// suttas and groups the source data describes nowhere. It is the one thing the card can say that
// the title above it doesn't already: which part of the canon someone is being sent into.
//
// Two levels: the collection, and the closest one under it the source data thought worth
// describing. Picking by description rather than by depth is what keeps the useful level — SN's
// saṁyuttas are described and their vaggas are not, so "Six Sense Fields" survives and "Sixty
// Abbreviated Texts" is passed over — and it sidesteps the pairs whose labels nearly repeat ("The
// Aggregates" above "Aggregates"), since only one of the two can be chosen. Where nothing under
// the collection is described, the nearest level stands in; where the title already carries a
// level's name, that level is skipped, since 37 of AN's documents are named after the very vagga
// holding them. A whole collection has nothing above it and gets no description at all.
//
// `chain` runs top-down from the collection, and whether it ends at the node itself or at its
// parent is the caller's decision — see the two above.
function placeOf(chain, exclude) {
  if (!chain?.length) return null;
  const [collection, ...inner] = chain;
  const candidates = inner.filter((n) => n.label !== exclude);
  const chosen = [...candidates].reverse().find((n) => n.blurb) ?? candidates[candidates.length - 1];
  return [...new Set([collection.label, chosen?.label].filter(Boolean))].join(' · ') || null;
}

function resolveSuttaId(corpus, id) {
  if (corpus.suttas[id]) return id;
  const m = RANGE_QUERY.exec(id);
  if (!m) return id;
  const num = Number(m[2]);
  for (const [batchId, range] of rangesFor(corpus)) {
    if (range.prefix === m[1] && num >= range.start && num <= range.end) return batchId;
  }
  return id;
}

const rangeCache = new WeakMap();

function rangesFor(corpus) {
  let cache = rangeCache.get(corpus);
  if (!cache) {
    cache = new Map();
    for (const id of Object.keys(corpus.suttas)) {
      const m = RANGE_UID.exec(id);
      if (m) cache.set(id, { prefix: m[1], start: Number(m[2]), end: Number(m[3]) });
    }
    rangeCache.set(corpus, cache);
  }
  return cache;
}

// Every browsable id — a nikaya, or a group at any depth under it. `ancestors` runs top-down from
// the nikaya to (but not including) the node itself, which is what lets a group borrow a
// description from the level that has one.
function findNode(corpus, id) {
  for (const nikaya of corpus.nikayas) {
    if (nikaya.id === id) return { node: nikaya, ancestors: [] };
    const found = findInChapters(nikaya.chapters, id, [nikaya]);
    if (found) return found;
  }
  return null;
}

function findInChapters(chapters, id, ancestors) {
  for (const chapter of chapters ?? []) {
    if (chapter.id === id) return { node: chapter, ancestors };
    const found = findInChapters(chapter.chapters, id, [...ancestors, chapter]);
    if (found) return found;
  }
  return null;
}

// Blurbs may carry inline HTML and run several sentences, so they are flattened to plain text and
// trimmed at a word boundary.
function summarize(html) {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length <= MAX_LENGTH) return text;
  const cut = text.slice(0, MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function escapeAttr(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
