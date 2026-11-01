// Bhikkhu Bodhi's and Ṭhānissaro Bhikkhu's translations as the build takes them in beside Sujato's:
// which texts each offers, where each was published, and what a line's markup marks
// (data/upstream/README.md's "Building them into the app").
import fs from 'node:fs';
import path from 'node:path';

// The translators offered beside Sujato, by the id the Reader's address names them by.
export const TRANSLATORS = ['bodhi', 'thanissaro'];

// The texts each translator gives only in excerpt, which are never offered.
export const EXCERPTS = { bodhi: [], thanissaro: ['dn21', 'dn26', 'mn54', 'mn91'] };

const NAME_RE = /^(.*?)(\d+)(?:-(\d+))?$/;

// Returns the suttas a page's or a document's name covers: its own, each of a span's
// ("sn15.14-19"), or each of several spans' ("an1.21-30,39-40").
export function suttasNamed(name) {
  const [first, ...more] = name.split(',');
  const m = NAME_RE.exec(first);
  if (!m || (!m[3] && !more.length)) return [name];
  const uids = [];
  for (const span of [`${m[2]}-${m[3] ?? m[2]}`, ...more]) {
    const [from, to = from] = span.split('-');
    for (let n = +from; n <= +to; n++) uids.push(m[1] + n);
  }
  return uids;
}

// Returns the suttas a document holds, from its line keys, a range its keys are named by spelled
// out.
export function documentSuttas(keys) {
  const named = new Set();
  for (const key of keys) named.add(key.slice(0, key.indexOf(':')));
  return [...named].flatMap(suttasNamed);
}

const SC_DATA_RE = /^https:\/\/github\.com\/suttacentral\/sc-data\/blob\/[^/]+\/html_text\/.*\/([^/]+)\.html$/;

// Returns the page a reader opens to see where a text was published: SuttaCentral's for one
// copied from sc-data, the publisher's own otherwise.
export function sourcePage(url, translator) {
  const scData = SC_DATA_RE.exec(url);
  return scData ? `https://suttacentral.net/${scData[1]}/en/${translator}` : url;
}

const TAG_RE = /<(\/?)([a-z]+)\b([^>]*)>/g;
const SPAN_ATTRS_RE = /^\s+class="(heading|speaker)"\s*$/;
const INDENT_ATTRS_RE = /^\s+class="(iblock|sq-list)"\s*$/;
const HREF_RE = /\bhref="([^"]*)"/;

/**
 * Returns a translator's line as the plain text the Reader slices for highlights, with the
 * stretches of it his markup marks, each as offsets into that text:
 *   headings – [from, to] round a heading or title of his that no Pali heading line holds
 *   speaker  – the source-marked speaker label opening the line, taken out of the text
 *   speakers – [from, to] round a source-marked speaker label later in the line
 *   blocks   – [from, to, kind] round a paragraph, list item or indented source line
 *   links    – [from, to, path] round a reference to another sutta, with the reader path it opens;
 *              one to a text the app doesn't hold is left as plain text
 * The newline where one of his verse lines starts stays in the text.
 */
export function parseLine(
  raw,
  // The reader path a link opens, or null where the app doesn't hold what it links to.
  readPath
) {
  let text = '';
  let last = 0;
  const open = [];
  const headings = [];
  const speakers = [];
  const links = [];
  const blocks = [];
  for (const m of raw.matchAll(TAG_RE)) {
    text += raw.slice(last, m.index);
    last = m.index + m[0].length;
    const [, closing, tag, attrs] = m;
    const block = (['p', 'ul', 'li'].includes(tag) && !attrs.trim())
      || (tag === 'div' && (closing ? !attrs.trim() : INDENT_ATTRS_RE.test(attrs)));
    const known = block || (tag === 'span' && (closing || SPAN_ATTRS_RE.test(attrs))) || (tag === 'a' && (closing || HREF_RE.test(attrs)));
    if (!known) throw new Error(`unexpected markup ${m[0]} in a translator's line: ${raw}`);
    if (!closing) {
      const parent = open.at(-1)?.tag;
      if (block && (tag === 'li' ? parent !== 'ul' : open.length > 0 && !(tag === 'p' && parent === 'div'))) {
        throw new Error(`invalid block nesting in a translator's line: ${raw}`);
      }
      open.push({ tag, attrs, from: text.length });
      continue;
    }
    const start = open.pop();
    if (start?.tag !== tag) throw new Error(`unbalanced markup in a translator's line: ${raw}`);
    if (tag === 'span') {
      const ranges = SPAN_ATTRS_RE.exec(start.attrs)[1] === 'speaker' ? speakers : headings;
      ranges.push([start.from, text.length]);
    } else if (tag === 'p' || tag === 'li') {
      const indent = INDENT_ATTRS_RE.exec(open.at(-1)?.attrs ?? '')?.[1];
      const kind = tag === 'li' ? 'list-item' : indent ? 'indented-item' : 'paragraph';
      blocks.push([start.from, text.length, kind]);
    }
    else if (tag === 'a') {
      const to = readPath(HREF_RE.exec(start.attrs)[1]);
      if (to) links.push([start.from, text.length, to]);
    }
  }
  if (open.length) throw new Error(`unbalanced markup in a translator's line: ${raw}`);
  text += raw.slice(last);
  let en = text.trim();
  const ranges = { headings, links, speakers, blocks };
  // Moves every range back by `cut` characters, dropping what is left empty.
  const shift = (cut) => {
    for (const [name, list] of Object.entries(ranges)) {
      ranges[name] = list
        .map(([from, to, ...rest]) => [Math.max(0, from - cut), Math.min(en.length, to - cut), ...rest])
        .filter(([from, to]) => to > from);
    }
  };
  shift(text.length - text.trimStart().length);
  // A speaker label opening the line, after at most the quotation mark opening the paragraph, with
  // words after it, leaves the text to stand above it.
  const opening = ranges.speakers.find(([from]) => /^[“‘]?$/.test(en.slice(0, from)));
  let speaker;
  if (opening && en.slice(opening[1]).trim()) {
    speaker = en.slice(0, opening[1]).trim();
    const rest = en.slice(opening[1]).trimStart();
    const cut = en.length - rest.length;
    en = rest;
    shift(cut);
    if (soleParagraph(ranges.blocks, en.length)) ranges.blocks = [];
  }
  return {
    en, ...(speaker && { speaker }), headings: ranges.headings, links: ranges.links,
    ...(ranges.speakers.length && { speakers: ranges.speakers }),
    ...(ranges.blocks.length && { blocks: ranges.blocks }),
  };
}

// Returns whether a line's blocks are one paragraph covering all `length` of it, which then shares
// the line with no other and marks nothing.
function soleParagraph(blocks, length) {
  return blocks.length === 1 && blocks[0][2] === 'paragraph' && blocks[0][0] === 0 && blocks[0][1] === length;
}

// Returns the range of the speaker label closing a built line after its other words, or null.
export function closingSpeaker(seg) {
  const range = seg.speakers?.at(-1);
  return range && range[0] > 0 && range[1] === seg.en.length ? range : null;
}

// takeClosingSpeaker removes the speaker label closing a built line and returns it, for the line
// after, whose speech it names.
export function takeClosingSpeaker(seg) {
  const range = closingSpeaker(seg);
  const label = seg.en.slice(range[0], range[1]).trim();
  seg.en = seg.en.slice(0, range[0]).trimEnd();
  for (const name of ['headings', 'speakers', 'links', 'blocks']) {
    if (!seg[name]) continue;
    const kept = seg[name]
      .filter((r) => r !== range)
      .map(([from, to, ...rest]) => [from, Math.min(to, seg.en.length), ...rest])
      .filter(([from, to]) => to > from);
    if (kept.length && !(name === 'blocks' && soleParagraph(kept, seg.en.length))) seg[name] = kept;
    else delete seg[name];
  }
  return label;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Returns every .json file under `dir`, by the document it holds: the name up to its first "_".
function indexFiles(dir, index = new Map()) {
  if (!fs.existsSync(dir)) return index;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) indexFiles(full, index);
    else if (entry.name.endsWith('.json')) index.set(entry.name.slice(0, entry.name.indexOf('_')), full);
  }
  return index;
}

// Returns whether a translator's file has text beyond titles: a line besides the title lines
// holding more than a heading.
function hasText(english) {
  return Object.entries(english).some(([key, raw]) => {
    const id = key.slice(key.indexOf(':') + 1);
    if (id === '0' || id.startsWith('0.')) return false;
    const { en, headings } = parseLine(raw, () => null);
    const rest = headings.reduceRight((text, [from, to]) => text.slice(0, from) + text.slice(to), en);
    return rest.trim().length > 0;
  });
}

/**
 * Returns one translator's texts as the build reads them from data/:
 *   english – each document's file of lines, by document
 *   notes   – each document's file of notes, by document
 *   covered – the empty lines whose content the English above renders (covered.json)
 *   offered – the documents he translates whole, each with the page it was published on: his pages
 *             cover every sutta in it, it isn't an excerpt, and it holds more than titles
 */
export function loadTranslation(dataDir, translator) {
  const dir = path.join(dataDir, translator);
  const english = indexFiles(path.join(dir, 'sutta'));
  const notes = indexFiles(path.join(dir, 'notes'));
  const covered = new Set(readJSON(path.join(dir, 'covered.json')));
  // Each sutta's page: the first in sources.json that covers it.
  const pageOf = new Map();
  for (const [file, urls] of Object.entries(readJSON(path.join(dataDir, 'upstream', translator, 'sources.json')).files)) {
    if (!file.startsWith('sutta/')) continue;
    const page = sourcePage([urls].flat()[0], translator);
    for (const uid of suttasNamed(path.basename(file, '.html'))) if (!pageOf.has(uid)) pageOf.set(uid, page);
  }
  const excerpts = new Set(EXCERPTS[translator]);
  const offered = new Map();
  for (const [doc, file] of english) {
    if (excerpts.has(doc)) continue;
    const lines = readJSON(file);
    const suttas = documentSuttas(Object.keys(lines));
    if (suttas.every((uid) => pageOf.has(uid)) && hasText(lines)) offered.set(doc, pageOf.get(suttas[0]));
  }
  return { english, notes, covered, offered };
}
