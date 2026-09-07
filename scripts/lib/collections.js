// The canonical metadata for the top of the browse tree, plus the helpers build-corpus.mjs shapes
// the tree and a document's segments with. Everything below the collection level — leaf titles
// above all — is looked up from the data files instead.

export const NIKAYA_META = {
  dn: { label: 'Dīgha Nikāya', sub: 'Long Discourses' },
  mn: { label: 'Majjhima Nikāya', sub: 'Middle Discourses' },
  sn: { label: 'Saṁyutta Nikāya', sub: 'Linked Discourses' },
  an: { label: 'Aṅguttara Nikāya', sub: 'Numbered Discourses' },
  kn: { label: 'Khuddaka Nikāya', sub: 'Minor Collection' },
};

// AN's nipātas (an1..an11), named "Book of Ones/Twos/…" as the English convention has them.
export const AN_BOOK_NAMES = [
  'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Elevens',
];

// SN's 5 top-level "super-vaggas", which the tree wraps sn1..sn56 in. The labels are fixed glosses
// of Bhikkhu Sujato's titles, which don't all abbreviate cleanly through stripTitlePrefix.
export const SN_GROUPS = [
  { id: 'sn-sagathavaggasamyutta', label: 'Verses' },
  { id: 'sn-nidanavaggasamyutta', label: 'Causation' },
  { id: 'sn-khandhavaggasamyutta', label: 'The Aggregates' },
  { id: 'sn-salayatanavaggasamyutta', label: 'The Six Sense Fields' },
  { id: 'sn-mahavaggasamyutta', label: 'The Great Chapter' },
];

// Chapters whose only vagga is the chapter itself under a second name, the two levels having been
// translated independently — so an equal-label test doesn't collapse them. The value is the label
// the chapter keeps.
export const RESTATED_CHAPTERS = {
  sn8: 'Poet Vaṅgīsa', //           Vaṅgīsasaṁyutta   / Vaṅgīsavagga
  sn32: 'Gods of the Clouds', //    Valāhakasaṁyutta  / Valāhakavagga
  sn41: 'Citta the Householder', // Cittasaṁyutta     / Cittavagga
  sn44: 'Undeclared Points', //     Abyākatasaṁyutta  / Abyākatavagga
};

// The 6 Khuddaka Nikāya books this app carries, in canonical order. Each is flattened to its leaf
// documents unless `vaggas` is set — Snp and Ud, whose vaggas are the level their descriptions are
// written at.
export const KN_BOOKS = [
  { id: 'snp', label: 'Anthology of Discourses', pali: 'Suttanipāta', vaggas: true },
  { id: 'dhp', label: 'Sayings of Dhamma', pali: 'Dhammapada' },
  { id: 'ud', label: 'Heartfelt Sayings', pali: 'Udāna', vaggas: true },
  { id: 'iti', label: 'So It Was Said', pali: 'Itivuttaka' },
  { id: 'thag', label: 'Verses of Senior Monks', pali: 'Theragāthā' },
  { id: 'thig', label: 'Verses of Senior Nuns', pali: 'Therīgāthā' },
];

// Display abbreviation for a uid's leading letters (e.g. 'tha-ap' -> 'Tha-ap').
export const REF_ABBR = {
  dn: 'DN', mn: 'MN', sn: 'SN', an: 'AN',
  kp: 'Kp', dhp: 'Dhp', ud: 'Ud', iti: 'Iti', snp: 'Snp', vv: 'Vv', pv: 'Pv',
  thag: 'Thag', thig: 'Thig', 'tha-ap': 'Tha-ap', 'thi-ap': 'Thi-ap',
  bv: 'Bv', cp: 'Cp', ja: 'Ja', mnd: 'Mnd', cnd: 'Cnd', ps: 'Ps', ne: 'Ne', pe: 'Pe', mil: 'Mil',
};

// The display ref for a leaf uid: "sn22.11" -> "SN22.11", "an1.1-10" -> "AN1.1–10".
export function formatRef(uid) {
  const m = uid.match(/^([a-z][a-z-]*?)(\d.*)$/);
  if (!m) return uid;
  const [, prefix, digits] = m;
  const abbr = REF_ABBR[prefix] || prefix.toUpperCase();
  return `${abbr}${digits.replace(/-/g, '–')}`;
}

// The openings a chapter or vagga name is trimmed of, the browse tree wanting only the
// distinguishing part ("Linked Discourses With Deities" -> "Deities"). Longest first, so a longer
// prefix isn't shadowed by a shorter one it starts with.
const TITLE_PREFIXES = [
  'The Group of Linked Discourses With ',
  'The Group of Linked Discourses Beginning With ',
  'The Linked Discourses on the ',
  'The Linked Discourses on ',
  'The Linked Discourses With ',
  'The Linked Discourses with ',
  'The Linked Discourses ',
  'Linked Discourses on the ',
  'Linked Discourses on ',
  'Linked Discourses With ',
  'Linked Discourses with ',
  'Linked Discourses ',
  'The Chapter on a ',
  'The Chapter on the ',
  'The Chapter on ',
  'The Chapter of ',
  'The Chapter with ',
  'The Chapter with the ',
  'The Chapter Beginning With ',
  'The Chapter Beginning with ',
].sort((a, b) => b.length - a.length);

// Returns `name` with any TITLE_PREFIXES opening removed and the remainder capitalized.
export function stripTitlePrefix(name) {
  if (!name) return name;
  const prefix = TITLE_PREFIXES.find((p) => name.startsWith(p));
  if (!prefix) return name;
  const rest = name.slice(prefix.length).trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// Every leaf uid under `node`, in tree order.
export function flattenLeaves(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => flattenLeaves(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => flattenLeaves(v, out));
  return out;
}

// Walks the corpus tree depth-first, calling `visit(key, val)` on each named entry — array elements
// are walked straight through, carrying no key of their own. A truthy return is recorded as a match
// and stops the descent there; a falsy one keeps walking into that value.
function walkNamedGroups(node, visit, results = []) {
  if (Array.isArray(node)) node.forEach((n) => walkNamedGroups(n, visit, results));
  else if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      const match = visit(key, val);
      if (match) results.push(match);
      else walkNamedGroups(val, visit, results);
    }
  }
  return results;
}

// Every group node whose key matches `pattern`, not descending past a match — the chapter rows
// sn1..sn56 and an1..an11, wherever the grouping layers above them put them. Each result carries
// the raw subtree as well as its flattened leaves, for a caller that keeps walking.
export function findChapterNodes(node, pattern, results = []) {
  return walkNamedGroups(node, (key, val) => (pattern.test(key) ? { key, node: val, leaves: flattenLeaves(val) } : null), results);
}

// The subtree of the group named by `key`, anywhere under `node`.
export function findNodeByKey(node, key) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findNodeByKey(n, key);
      if (r) return r;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    if (key in node) return node[key];
    for (const v of Object.values(node)) {
      const r = findNodeByKey(v, key);
      if (r) return r;
    }
  }
  return null;
}

// Every leaf group beneath `node` — a named group holding leaf uids directly — which is what pulls
// the vagga rows out from under SN/MN/AN's "fifty" wrappers. The test is structural rather than a
// name pattern, no list of wrapper names covering every case (an2-peyyala nests real vaggas).
export function findLeafGroups(node, results = []) {
  return walkNamedGroups(node, (key, val) => (Array.isArray(val) && val.every((v) => typeof v === 'string') ? { key, leaves: val } : null), results);
}

// The [start, end] sutta numbers in a leaf uid's trailing segment: "sn22.11" -> [11, 11],
// "an1.1-10" -> [1, 10] (a batched range being one leaf), "mn1" -> [1, 1].
export function suttaNumRange(uid) {
  const seg = uid.includes('.') ? uid.slice(uid.lastIndexOf('.') + 1) : uid.replace(/^[a-z-]+/, '');
  const nums = (seg.match(/\d+/g) || []).map(Number);
  return [nums[0], nums[nums.length - 1]];
}

// The ref badge for a group of leaves: the range from its first to its last, "SN35.1–12" when
// `dotted`, "MN1–10" when not.
export function rangeNote(ref, leaves, dotted) {
  const [start] = suttaNumRange(leaves[0]);
  const [, end] = suttaNumRange(leaves[leaves.length - 1]);
  const sep = dotted ? '.' : '';
  return start === end ? `${ref}${sep}${start}` : `${ref}${sep}${start}–${end}`;
}

// The ref badge for a group wrapping whole chapters: their number span, "SN1–11". Sutta numbering
// restarts in each chapter, so a sutta range across several would mean nothing.
export function chapterSpanNote(ref, firstChapterKey, lastChapterKey) {
  const a = +firstChapterKey.match(/\d+$/)[0];
  const b = +lastChapterKey.match(/\d+$/)[0];
  return a === b ? `${ref}${a}` : `${ref}${a}–${b}`;
}

// A document's own title, taken from its highest "0.N" header line — "0.1" being the book label and
// an optional "0.2" the vagga name. Returns null for a batched range, whose segments are keyed by
// the inner uids rather than the batch id.
export function headerTitle(map, uid) {
  let best = null;
  let bestN = 1;
  for (const key of map.keys()) {
    const m = key.match(new RegExp(`^${uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:0\\.(\\d+)$`));
    if (m && +m[1] > bestN) {
      const value = map.get(key).trim();
      // "~" is SuttaCentral's "unchanged from the segment above" marker, not a title.
      if (value === '~') continue;
      bestN = +m[1];
      best = value;
    }
  }
  return best ? best.trim() : null;
}

// The patterns roleFor matches a segment's HTML template against, in the order it tries them.
// SuttaCentral's markup is language-independent, so one html/ file covers a segment in both
// languages.
//   heading   – an <h2>–<h5> sub-heading inside a document. <h1> is excluded: it is always the
//               document's own title line, which headerTitle takes.
//   verse     – a <span class='verse-line'>, inside a gatha or a chapter-end mnemonic alike
//   end       – a closing colophon (endsutta, endvagga, endbook, …, and uddana-intro)
//   speaker   – an inline dialogue attribution mid-verse ("said the Buddha,")
//   list-item – an <li>, a numbered list embedded in body prose
// The gatha open/close pair serves buildBodySegments' stateful fallback for verse: one file
// (an7.63 §§5–13) tags only each stanza's opening line, leaving the continuations unmarked.
const HEADING_RE = /^<h([2345])>/;
const VERSE_LINE_RE = /class=['"]verse-line['"]/;
const END_RE = /class=['"](?:end\w*|uddana-intro)['"]/;
const SPEAKER_RE = /class=['"]speaker['"]/;
const LIST_ITEM_RE = /<li>/;
const GATHA_OPEN_RE = /<blockquote class=['"](?:gatha|uddanagatha|vagguddanagatha)['"]>/;
const BLOCKQUOTE_CLOSE_RE = /<\/blockquote>/;

// An uddāna: the mnemonic verse listing a vagga's suttas by catchword, and the line introducing it.
// It is a table of contents for reciters, not teaching — the words in it are the sutta titles
// already on screen in the list pane — so it is dropped from the reader and from search alike.
// Its continuation lines carry no marker of their own, hence the same open/close tracking verse
// needs.
const UDDANA_INTRO_RE = /class=['"]uddana(?:-intro)?['"]/;
const UDDANA_OPEN_RE = /<blockquote class=['"](?:uddanagatha|vagguddanagatha)['"]>/;

// A segment's structural role from its HTML template, or undefined for ordinary prose.
export function roleFor(template) {
  if (!template) return undefined;
  const heading = HEADING_RE.exec(template);
  if (heading) return { role: 'heading', headingLevel: Number(heading[1]) };
  if (VERSE_LINE_RE.test(template)) return { role: 'verse' };
  if (END_RE.test(template)) return { role: 'end' };
  if (SPEAKER_RE.test(template)) return { role: 'speaker' };
  if (LIST_ITEM_RE.test(template)) return { role: 'list-item' };
  return undefined;
}

const NOTE_LINK_RE = /<a\b[^>]*>(.*?)<\/a>/gis;
// Returns a translator note with its suttacentral.net links reduced to their text. The rest of its
// inline HTML stays: a note is rendered as markup, with no character offsets to desync.
export function cleanNote(text) {
  return text.replace(NOTE_LINK_RE, '$1').trim();
}

const HTML_TAG_RE = /<[^>]+>/g;
// Returns a segment's English as plain text. Its inline markup — emphasis, a Pali loanword, the odd
// link — cannot survive: the reader slices this string by character offset to draw highlights.
export function stripHtmlTags(text) {
  return text.replace(HTML_TAG_RE, '').trim();
}

// One document's body segments, in Pali key order, each with its English, role and note. Title
// lines, uddāna verses and anything with no English are left out — a colophon counts as translated,
// standing in the English column as its own Pali.
export function buildBodySegments(paliMap, sujatoMap, htmlMap, notesMap) {
  const orderedKeys = paliMap.size ? [...paliMap.keys()] : [...sujatoMap.keys()];
  const segs = [];
  // Whether this segment falls inside an unclosed gatha blockquote, for the stanzas whose
  // continuation lines carry no marker of their own.
  let insideGathaBlockquote = false;
  let insideUddana = false;
  for (const key of orderedKeys) {
    const segId = key.slice(key.indexOf(':') + 1);
    if (segId === '0' || segId.startsWith('0.')) continue; // nikaya/book/vagga/sutta title lines
    const pali = (paliMap.get(key) || '').trim();
    // "<j>" is Bhikkhu Sujato's enjambment placeholder, not markup, and nothing renders it as a
    // line break.
    let en = stripHtmlTags((sujatoMap.get(key) || '').replace(/<j>/g, ''));
    // Tracked even for a segment skipped below, so a blank one mid-stanza doesn't lose the state.
    const template = htmlMap.get(key);
    if (template && GATHA_OPEN_RE.test(template)) insideGathaBlockquote = true;
    const stillInsideGatha = insideGathaBlockquote;
    if (template && BLOCKQUOTE_CLOSE_RE.test(template)) insideGathaBlockquote = false;
    if (template && UDDANA_OPEN_RE.test(template)) insideUddana = true;
    const uddana = insideUddana || (template && UDDANA_INTRO_RE.test(template));
    if (template && BLOCKQUOTE_CLOSE_RE.test(template)) insideUddana = false;
    if (uddana) continue;
    let roleInfo = roleFor(template);
    if (!roleInfo && stillInsideGatha) roleInfo = { role: 'verse' };
    // Nothing untranslated ships. Bhikkhu Sujato leaves a segment's English empty where he elides a
    // passage the Pali repeats in full — dn32 restates its whole first recitation section, mn15 the
    // clause before each refrain — and the English above such a run already says so ("repeating all
    // the verses spoken"). Shipping the Pali alone put a wall of it mid-page for a reader who asked
    // for English; hiding it while keeping it left search hits that scrolled nowhere.
    //
    // The test is the English itself, not a list of known passages, so nothing has to be revisited
    // when upstream translates one: the segment reappears in the reader, in search and in the
    // dictionary on the next data refresh, by having become translated.
    //
    // Colophons go with the rest. A Pali-only one is scribal bookkeeping rather than teaching —
    // 3,040 are the bare ordinal ("Paṭhamaṁ.", the sutta's number within its chapter, which the ref
    // above the text already gives) and the remainder close a vagga or saṁyutta the library tree
    // already draws.
    if (!en) continue;
    const seg = { key, pali, en };
    if (roleInfo) {
      seg.role = roleInfo.role;
      if (roleInfo.headingLevel) seg.headingLevel = roleInfo.headingLevel;
    }
    const rawNote = notesMap.get(key);
    if (rawNote && rawNote.trim()) seg.note = cleanNote(rawNote);
    segs.push(seg);
  }
  return segs;
}
