// The title and description a link preview shows when someone shares a sutta or a browse group,
// written into the served HTML — a crawler never runs the app, so the tags
// web/src/hooks/useDocumentMeta.ts writes at mount arrive too late.
//
// Only /read/* and /browse/* are rewritten; /index.html is left as the build produced it, since the
// service worker precaches that path and serves it for every in-app navigation.
//
// The lookups port web/src/lib/corpus.ts (findNode, resolveCanonicalSuttaId) and the trim in
// web/src/lib/documentMeta.ts, and the titles match what ReaderPage and LibraryPage pass to
// useDocumentMeta. No module is shared between the two workspaces — change one, change the other.

// The paths that carry a subject of their own. A user list also lives under /browse, but its
// opaque id names nothing in the corpus, so findNode drops it and the shell is left alone.
const SHAREABLE = /^\/(read|browse)\/([^/]+)/;

// Longest description a card is given, in characters, cut at a word boundary.
const MAX_LENGTH = 155;

// A batched leaf uid ("dhp320-333") and a single number inside one ("dhp321"), which resolves to
// the batch holding it.
const RANGE_UID = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)-(\d+)$/;
const RANGE_QUERY = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)$/;

// The shell's own description tag, rewritten or removed per page.
const DESCRIPTION_META = 'meta[name="description"]';

// The preview thumbnail: the flat leaf mark, at the size a card wants.
const SHARE_IMAGE = '/share-card.png';

// The parsed corpus, held for the life of the isolate. A failed load is not held, so a request
// during a deploy doesn't poison the ones after it.
let corpusCache = null;
let corpusInFlight = null;

// Returns the parsed corpus, fetching it from the assets binding on first use, or null if it can't
// be read.
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

// Returns the app shell with this URL's title and description written into it, or the shell
// untouched when the path names nothing in the corpus.
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
    // Square and declared, so a crawler picks the thumbnail layout without fetching the file.
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
        // Removed rather than left at the shell's default, so a page with no description of its
        // own shows the title alone.
        if (meta.description) el.setAttribute('content', meta.description);
        else el.remove();
      },
    })
    .on('head', {
      element(el) {
        // A summary card, the layout every platform reads the same way.
        el.append(`${tags}<meta name="twitter:card" content="summary" />`, { html: true });
      },
    })
    .transform(shell);
}

// Returns `{title, description}` for a path, or null when nothing in the corpus answers to it.
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

// Returns one sutta's title and description. Corpus ids are lowercase and shared links carry the
// capitalized reference ("/read/SN35.33-42"), so the id is folded before the lookup.
function suttaMeta(corpus, id) {
  const sutta = corpus.suttas[resolveSuttaId(corpus, id.toLowerCase())];
  if (!sutta) return null;
  const found = sutta.node ? findNode(corpus, sutta.node) : null;
  return {
    title: `${sutta.ref} · ${sutta.en}`,
    // Its own blurb, else where it sits, the chain running down to the leaf group holding it.
    description: summarize(sutta.blurb) ?? placeOf(found && [...found.ancestors, found.node], sutta.en),
  };
}

// Returns a browse group's title and description.
function nodeMeta(corpus, id) {
  const found = findNode(corpus, id) ?? findNode(corpus, id.toLowerCase());
  if (!found) return null;
  const { node } = found;
  return {
    title: node.ref ? `${node.ref} · ${node.label}` : node.label,
    // Its own blurb only — never an ancestor's, which a card has nowhere to label as borrowed —
    // then where it sits, then a collection's English name.
    description: summarize(node.blurb) ?? placeOf(found.ancestors) ?? node.sub ?? null,
  };
}

// Returns where something sits in the canon — "Saṁyutta Nikāya · Six Sense Fields" — as two
// levels: the collection, and the deepest level under it carrying a blurb, else the nearest one.
// Returns null for a chain with nothing above the collection.
//
// `chain` runs top-down from the collection; whether it ends at the node or at its parent is the
// caller's choice.
//
// `exclude` is a label to skip, so a document named after its own vagga isn't placed in itself.
function placeOf(chain, exclude) {
  if (!chain?.length) return null;
  const [collection, ...inner] = chain;
  const candidates = inner.filter((n) => n.label !== exclude);
  const chosen = [...candidates].reverse().find((n) => n.blurb) ?? candidates[candidates.length - 1];
  return [...new Set([collection.label, chosen?.label].filter(Boolean))].join(' · ') || null;
}

// Returns the uid of the document holding `id`, folding a single number into the batch it falls in.
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

// Each corpus's parsed batch ranges, built once.
const rangeCache = new WeakMap();

// Returns a map of batched uid to `{prefix, start, end}`.
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

// Returns `{node, ancestors}` for a browsable id — a nikaya or a group at any depth under one — or
// null. `ancestors` runs top-down from the nikaya, not including the node itself.
function findNode(corpus, id) {
  for (const nikaya of corpus.nikayas) {
    if (nikaya.id === id) return { node: nikaya, ancestors: [] };
    const found = findInChapters(nikaya.chapters, id, [nikaya]);
    if (found) return found;
  }
  return null;
}

// findNode's recursive walk over one level of chapters.
function findInChapters(chapters, id, ancestors) {
  for (const chapter of chapters ?? []) {
    if (chapter.id === id) return { node: chapter, ancestors };
    const found = findInChapters(chapter.chapters, id, [...ancestors, chapter]);
    if (found) return found;
  }
  return null;
}

// Flattens a blurb's inline HTML to plain text and trims it to MAX_LENGTH at a word boundary.
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

// Escapes a value for use inside a double-quoted HTML attribute.
function escapeAttr(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
