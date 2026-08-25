// Static, canonical metadata for the top of the browse tree. These are fixed collection
// names that don't need to be derived from the data files (unlike leaf sutta titles, which
// are looked up dynamically — see build-corpus.mjs).

export const NIKAYA_META = {
  dn: { label: 'Dīgha Nikāya', sub: 'Long Discourses' },
  mn: { label: 'Majjhima Nikāya', sub: 'Middle Discourses' },
  sn: { label: 'Saṁyutta Nikāya', sub: 'Linked Discourses' },
  an: { label: 'Aṅguttara Nikāya', sub: 'Numbered Discourses' },
  kn: { label: 'Khuddaka Nikāya', sub: 'Minor Collection' },
};

// AN's nipātas (an1..an11) are conventionally named "Book of Ones/Twos/..." in English,
// not by their Pali vagga names — matches the user's explicit browse-tree spec.
export const AN_BOOK_NAMES = [
  'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Elevens',
];

// SN's 5 top-level "super-vaggas" — the tree wraps sn1..sn56 in these (see data/README.md's
// "Layout" section for the tree/ shape).
// Fixed, canonical, English glosses given by explicit product decision (matches the Bhikkhu Sujato
// title's own gist word — "Verses", "Causation", ... — rather than deriving from name files,
// since the raw titles ("The Group of Linked Discourses Beginning With …") don't abbreviate
// cleanly via stripTitlePrefix for all five).
export const SN_GROUPS = [
  { id: 'sn-sagathavaggasamyutta', label: 'Verses' },
  { id: 'sn-nidanavaggasamyutta', label: 'Causation' },
  { id: 'sn-khandhavaggasamyutta', label: 'The Aggregates' },
  { id: 'sn-salayatanavaggasamyutta', label: 'The Six Sense Fields' },
  { id: 'sn-mahavaggasamyutta', label: 'The Great Chapter' },
];

// Chapters whose only vagga is the chapter itself under a second name — Bhikkhu Sujato translates
// the two levels independently, so the same Pali comes out worded differently at each ("Cloud Gods"
// / "Gods of the Clouds") and they don't collapse on an equal-label test the way the other sole
// vaggas do (see buildCategoryRows in build-corpus.mjs, which drops the vagga row either way).
// The value is the label the chapter keeps: the more descriptive of the two names.
export const RESTATED_CHAPTERS = {
  sn8: 'Poet Vaṅgīsa', //           Vaṅgīsasaṁyutta   / Vaṅgīsavagga
  sn32: 'Gods of the Clouds', //    Valāhakasaṁyutta  / Valāhakavagga
  sn41: 'Citta the Householder', // Cittasaṁyutta     / Cittavagga
  sn44: 'Undeclared Points', //     Abyākatasaṁyutta  / Abyākatavagga
};

// Selected 6 key Khuddaka Nikāya books, in canonical order. Each is flattened to its leaf documents
// one level down (see flattenLeaves in build-corpus.mjs) — no intermediate vagga/nipāta rows.
export const KN_BOOKS = [
  { id: 'snp', label: 'Anthology of Discourses', pali: 'Suttanipāta' },
  { id: 'dhp', label: 'Sayings of Dhamma', pali: 'Dhammapada' },
  { id: 'ud', label: 'Heartfelt Sayings', pali: 'Udāna' },
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

export function formatRef(uid) {
  const m = uid.match(/^([a-z][a-z-]*?)(\d.*)$/);
  if (!m) return uid;
  const [, prefix, digits] = m;
  const abbr = REF_ABBR[prefix] || prefix.toUpperCase();
  return `${abbr}${digits.replace(/-/g, '–')}`;
}

// Bhikkhu Sujato's English chapter/vagga names are full sentences ("Linked Discourses With Deities",
// "The Chapter on a Reed") where the browse tree just wants the distinguishing part ("Deities",
// "A Reed"). Sorted longest-first so e.g. "The Chapter with the " is tried before the shorter
// "The Chapter with " it would otherwise be shadowed by.
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

export function stripTitlePrefix(name) {
  if (!name) return name;
  const prefix = TITLE_PREFIXES.find((p) => name.startsWith(p));
  if (!prefix) return name;
  const rest = name.slice(prefix.length).trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function flattenLeaves(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => flattenLeaves(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => flattenLeaves(v, out));
  return out;
}

// Depth-first walk of the corpus tree, visiting each named object entry (array elements are
// walked straight through, since they carry no key of their own to match against) via
// `visit(key, val)`: a truthy return records that value as a match and stops descending into it,
// a falsy one keeps walking into it looking for matches deeper down. Shared by findChapterNodes
// and findLeafGroups below, which are otherwise identical shape and differ only in their own match
// condition and what they record — see each's own comment for what it's actually finding.
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

// Finds every group node whose key matches `pattern` anywhere in the tree, without
// descending further once matched (used to pull sn1..sn56 / an1..an11 "chapter" rows out
// from underneath the super-vagga / vagga grouping layers we're deliberately skipping).
// Returns the raw subtree (`node`) alongside the flattened `leaves` so callers that need to
// keep walking (e.g. findLeafGroups, for vagga-level categories) can do so.
export function findChapterNodes(node, pattern, results = []) {
  return walkNamedGroups(node, (key, val) => (pattern.test(key) ? { key, node: val, leaves: flattenLeaves(val) } : null), results);
}

// Finds a named group's subtree anywhere under `node`, by exact key (used to pull out SN's 5
// hardcoded super-vagga ids).
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

// Finds every "leaf group" beneath `node` — a named group whose value is directly an array of
// leaf sutta uids, with no further nesting — used to pull vagga-level categories out from
// under SN/MN/AN's "fifty" (pannasaka/pannasa) super-vagga wrappers. Deliberately structural,
// not name-based (pannasaka/pannasa/peyyala wrappers all get flattened through the same way,
// regardless of what they're called), since a name-based pattern can't cover every wrapper
// name in the data (e.g. an2-peyyala, which further nests real vaggas but isn't itself one).
export function findLeafGroups(node, results = []) {
  return walkNamedGroups(node, (key, val) => (Array.isArray(val) && val.every((v) => typeof v === 'string') ? { key, leaves: val } : null), results);
}

// Extracts the [start, end] sutta numbers from a leaf uid's trailing numeric segment:
// "sn22.11" -> [11, 11]; "an1.1-10" -> [1, 10] (a batched range is itself one leaf); "mn1" ->
// [1, 1] (no dot: the whole trailing digit run, since MN uids have no chapter-number prefix).
export function suttaNumRange(uid) {
  const seg = uid.includes('.') ? uid.slice(uid.lastIndexOf('.') + 1) : uid.replace(/^[a-z-]+/, '');
  const nums = (seg.match(/\d+/g) || []).map(Number);
  return [nums[0], nums[nums.length - 1]];
}

// A sutta-range note spanning the first through last leaf of a group, in tree order — e.g.
// "SN35.1–12" (dotted, chapter ref "SN35") or "MN1–10" (undotted, nikaya ref "MN"). Used as
// the `ref` badge for vagga-level categories (and chapter/group rows), per explicit product
// decision that every added grouping level shows the sutta range it covers.
export function rangeNote(ref, leaves, dotted) {
  const [start] = suttaNumRange(leaves[0]);
  const [, end] = suttaNumRange(leaves[leaves.length - 1]);
  const sep = dotted ? '.' : '';
  return start === end ? `${ref}${sep}${start}` : `${ref}${sep}${start}–${end}`;
}

// A chapter-number span for a group that wraps whole numbered chapters (e.g. SN's 5 super-
// vaggas spanning sn1..sn11) — "SN1–11" rather than a sutta-number range, since chapter
// numbering restarts within each chapter and a single sutta-number range would be meaningless
// across several of them.
export function chapterSpanNote(ref, firstChapterKey, lastChapterKey) {
  const a = +firstChapterKey.match(/\d+$/)[0];
  const b = +lastChapterKey.match(/\d+$/)[0];
  return a === b ? `${ref}${a}` : `${ref}${a}–${b}`;
}

// For a leaf that is exactly one segmented document (not a batch/range of several, like
// "an1.1-10"), the title lives *inside* that document as the last header line before the
// body — "0.1" is always the nikaya/book label, an optional "0.2" the vagga name, and
// (only when the sutta has its own title, as most do) the highest "0.N" is the sutta title
// itself. Batches don't have this — their segment keys are prefixed by the inner sutta uids
// (an1.1, an1.2, ...), never by the batch id — so this naturally only fires for true 1:1 docs.
export function headerTitle(map, uid) {
  let best = null;
  let bestN = 1;
  for (const key of map.keys()) {
    const m = key.match(new RegExp(`^${uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:0\\.(\\d+)$`));
    if (m && +m[1] > bestN) {
      const value = map.get(key).trim();
      // "~" is SuttaCentral's own "unchanged from the segment above" marker (seen in several
      // AN Rāgapeyyāla/"etc." batch documents) — it's a placeholder, not a real title, so skip
      // it and keep the next-highest real "0.N" segment (typically the enclosing vagga name)
      // instead of surfacing the bare tilde as the sutta's title.
      if (value === '~') continue;
      bestN = +m[1];
      best = value;
    }
  }
  return best ? best.trim() : null;
}

// SuttaCentral's own structural markup (see data/html/pli/ms/sutta/, fetched by
// scripts/fetch-html-structure.mjs from bilara-data's `html/` tree) gives a per-segment HTML
// template — this is language-independent structure (a verse is a verse regardless of
// translation), so one `html/` file covers both the Pali and English text for the same segment
// keys. Checked in this order (a segment matches at most one, based on inspecting a broad sample
// of the actual data — see that script's own comment):
//   - `heading`: a `<h2>`–`<h5>` sub-heading inside a longer document (e.g. DN9's internal
//     sections, or DN2's numbered "4.3.3.2. Mind-Made Body" sub-sections, which nest as deep as
//     <h5>). Not to be confused with `<h1>` (`class='sutta-title'`/`'range-title'`), which is
//     always the document's own "0"/"0.*" title line, already stripped elsewhere (headerTitle()) —
//     so `<h1>` is deliberately excluded here rather than just never occurring in body segments.
//   - `verse`: `<span class='verse-line'>` inside a `<blockquote class='gatha'>` — a line of
//     poetry, vs. plain `<p>` for prose. Also covers the `uddanagatha`/`vagguddanagatha` mnemonic
//     verses at a chapter's end, which nest `verse-line` the same way.
//   - `end`: a closing colophon note (`endsutta`, `endvagga`, `endsection`, `endbook`, `endkanda`,
//     bare `end`, and `uddana-intro` — "Their mnemonic:") — often Pali-only (see
//     build-corpus.mjs's buildBodySegments, which falls back to Pali for these when there's no
//     English at all, rather than leaving a blank paragraph the tap-to-reveal interaction would
//     otherwise never make visible).
//   - `speaker`: an inline dialogue attribution embedded mid-verse (e.g. "said the Buddha,").
//   - `list-item`: an `<li>` inside an `<ol>` — a genuine numbered list embedded in body prose
//     (e.g. DN28 §10's four types of practice), rather than the usual run of plain `<p>`
//     paragraphs. Every segment in a list carries its own `<li>` (unlike the gatha case below), so
//     this one's a plain per-template check.
//
// `verse` has a second, stateful path in buildBodySegments below: almost every gatha/uddanagatha/
// vagguddanagatha blockquote tags each of its own lines with `<span class='verse-line'>` (checked
// here), but at least one file in this dataset (an7.63, §§5–13) instead only tags the blockquote's
// own opening `<p data-counter='N'>` per stanza, joining lines with a bare `<br>` and carrying no
// per-segment marker at all on the continuation lines — so buildBodySegments also tracks whether
// it's currently between an unclosed `<blockquote class='gatha'|'uddanagatha'|'vagguddanagatha'>`
// and its matching `</blockquote>`, and falls back to `verse` for any such segment `roleFor` alone
// didn't already classify. Confirmed (via a full-corpus scan) that every gatha-class blockquote in
// this dataset has a balanced open/close, so the fallback can't leak into text past a stanza it
// doesn't belong to.
const HEADING_RE = /^<h([2345])>/;
const VERSE_LINE_RE = /class=['"]verse-line['"]/;
const END_RE = /class=['"](?:end\w*|uddana-intro)['"]/;
const SPEAKER_RE = /class=['"]speaker['"]/;
const LIST_ITEM_RE = /<li>/;
const GATHA_OPEN_RE = /<blockquote class=['"](?:gatha|uddanagatha|vagguddanagatha)['"]>/;
const BLOCKQUOTE_CLOSE_RE = /<\/blockquote>/;

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

// Bhikkhu Sujato's own translator notes (data/sujato/notes/, same uid/segment-keyed, range-batched files
// as everything else — see data/README.md) carry inline HTML (`<i>`/`<em>`/`<b>`/`<span>`, kept
// as-is) and cross-reference links to other suttas on suttacentral.net (`<a href='https://
// suttacentral.net/...'>`) — stripped down to their plain text here rather than kept as live
// links, since a link off to the actual live website doesn't belong in an offline-first reader
// (and may point at a sutta this dataset doesn't even have translated). Safe to keep the rest of
// the markup here since a note is rendered wholesale via dangerouslySetInnerHTML
// (SegmentedText.tsx) when expanded — there's no character-offset system it could desync.
const NOTE_LINK_RE = /<a\b[^>]*>(.*?)<\/a>/gis;
export function cleanNote(text) {
  return text.replace(NOTE_LINK_RE, '$1').trim();
}

// Bhikkhu Sujato's main sutta translation text (data/sujato/sutta/) carries the same occasional inline
// HTML — `<b>`/`<em>` emphasis, `<i lang='pi' translate='no'>` around an untranslated Pali
// loanword, and rarely an `<a href='...'>` cross-reference link — but unlike a note, a segment's
// English text is rendered as plain text sliced by character offset for highlighting
// (SegmentedText.tsx's buildParts, offsets computed in useHighlightPopup.ts): keeping the tags
// would desync those offsets from what the user actually sees and selects, and could split a tag
// in half at a highlight boundary. Stripped down to plain text instead — losing the occasional
// emphasis/loanword styling (a small fraction of segments) is cheaper than that risk.
const HTML_TAG_RE = /<[^>]+>/g;
export function stripHtmlTags(text) {
  return text.replace(HTML_TAG_RE, '').trim();
}

export function buildBodySegments(paliMap, sujatoMap, htmlMap, notesMap) {
  const orderedKeys = paliMap.size ? [...paliMap.keys()] : [...sujatoMap.keys()];
  const segs = [];
  // See roleFor's own comment — tracks whether the segment currently being visited falls between
  // an unclosed gatha/uddanagatha/vagguddanagatha blockquote and its matching close, for html
  // structure data that doesn't tag every line of a stanza individually (e.g. an7.63).
  let insideGathaBlockquote = false;
  for (const key of orderedKeys) {
    const segId = key.slice(key.indexOf(':') + 1);
    if (segId === '0' || segId.startsWith('0.')) continue; // nikaya/book/vagga/sutta title lines
    const pali = (paliMap.get(key) || '').trim();
    // Bhikkhu Sujato's verse translations mark an enjambment (a long line split across two for
    // typesetting) with a bare "<j>" placeholder, always as "<space><j><word>" — dropped rather
    // than turned into a real line break, since nothing renders it as one. stripHtmlTags below
    // would also catch it, but this stays explicit since it's a Bhikkhu Sujato-specific placeholder, not
    // real markup.
    let en = stripHtmlTags((sujatoMap.get(key) || '').replace(/<j>/g, ''));
    // Open/close state is updated even for a segment with no text on either side (skipped just
    // below) — otherwise a blank segment landing mid-stanza would drop the open/close tracking.
    const template = htmlMap.get(key);
    if (template && GATHA_OPEN_RE.test(template)) insideGathaBlockquote = true;
    const stillInsideGatha = insideGathaBlockquote;
    if (template && BLOCKQUOTE_CLOSE_RE.test(template)) insideGathaBlockquote = false;
    if (!pali && !en) continue;
    let roleInfo = roleFor(template);
    if (!roleInfo && stillInsideGatha) roleInfo = { role: 'verse' };
    // A colophon note ("Tevijjasuttaṁ niṭṭhitaṁ terasamaṁ." — "The Tevijja Sutta is finished")
    // is frequently Pali-only, since it's a scribal marker rather than teaching content Bhikkhu Sujato
    // translated — falling back to Pali here (only for this role) means the reader always has
    // *something* to show for it, instead of a blank paragraph with nothing to tap-reveal.
    if (roleInfo?.role === 'end' && !en) en = pali;
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
