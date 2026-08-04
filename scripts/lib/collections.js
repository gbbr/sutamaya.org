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

// SN's 5 top-level "super-vaggas" — the tree wraps sn1..sn56 in these, per §1 of BRIEF.md.
// Fixed, canonical, English glosses given by explicit product decision (matches the Sujato
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

// The 20 Khuddaka Nikāya books, in canonical order. Each is flattened to its leaf documents
// one level down (see flattenLeaves in build-corpus.mjs) — no intermediate vagga/nipāta rows.
export const KN_BOOKS = [
  { id: 'snp', label: 'Sutta Nipāta', pali: 'Suttanipāta' },
  { id: 'dhp', label: 'Dhammapada', pali: 'Dhammapada' },
  { id: 'ud', label: 'Udāna', pali: 'Udāna' },
  { id: 'iti', label: 'Itivuttaka', pali: 'Itivuttaka' },
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

// Sujato's English chapter/vagga names are full sentences ("Linked Discourses With Deities",
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

// Finds every group node whose key matches `pattern` anywhere in the tree, without
// descending further once matched (used to pull sn1..sn56 / an1..an11 "chapter" rows out
// from underneath the super-vagga / vagga grouping layers we're deliberately skipping).
// Returns the raw subtree (`node`) alongside the flattened `leaves` so callers that need to
// keep walking (e.g. findLeafGroups, for vagga-level categories) can do so.
export function findChapterNodes(node, pattern, results = []) {
  if (Array.isArray(node)) node.forEach((n) => findChapterNodes(n, pattern, results));
  else if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      if (pattern.test(key)) results.push({ key, node: val, leaves: flattenLeaves(val) });
      else findChapterNodes(val, pattern, results);
    }
  }
  return results;
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
  if (Array.isArray(node)) node.forEach((n) => findLeafGroups(n, results));
  else if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      if (Array.isArray(val) && val.every((v) => typeof v === 'string')) results.push({ key, leaves: val });
      else findLeafGroups(val, results);
    }
  }
  return results;
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
