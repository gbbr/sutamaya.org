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

// The 20 Khuddaka Nikāya books, in canonical order. Each is flattened to its leaf documents
// one level down (see flattenLeaves in build-corpus.mjs) — no intermediate vagga/nipāta rows.
export const KN_BOOKS = [
  { id: 'kp', label: 'Khuddakapāṭha', pali: 'Khuddakapāṭha' },
  { id: 'dhp', label: 'Dhammapada', pali: 'Dhammapada' },
  { id: 'ud', label: 'Udāna', pali: 'Udāna' },
  { id: 'iti', label: 'Itivuttaka', pali: 'Itivuttaka' },
  { id: 'snp', label: 'Sutta Nipāta', pali: 'Suttanipāta' },
  { id: 'vv', label: 'Vimānavatthu', pali: 'Vimānavatthu' },
  { id: 'pv', label: 'Petavatthu', pali: 'Petavatthu' },
  { id: 'thag', label: 'Verses of the Senior Monks', pali: 'Theragāthā' },
  { id: 'thig', label: 'Verses of the Senior Nuns', pali: 'Therīgāthā' },
  { id: 'tha-ap', label: 'Biographical Stories (Monks)', pali: 'Therāpadāna' },
  { id: 'thi-ap', label: 'Biographical Stories (Nuns)', pali: 'Therīapadāna' },
  { id: 'bv', label: 'Chronicle of the Buddhas', pali: 'Buddhavaṁsa' },
  { id: 'cp', label: 'Basket of Conduct', pali: 'Cariyāpiṭaka' },
  { id: 'ja', label: 'Jātaka Tales', pali: 'Jātaka' },
  { id: 'mnd', label: 'Mahāniddesa', pali: 'Mahāniddesa' },
  { id: 'cnd', label: 'Cūḷaniddesa', pali: 'Cūḷaniddesa' },
  { id: 'ps', label: 'Paṭisambhidāmagga', pali: 'Paṭisambhidāmagga' },
  { id: 'ne', label: 'Nettippakaraṇa', pali: 'Nettippakaraṇa' },
  { id: 'pe', label: 'Peṭakopadesa', pali: 'Peṭakopadesa' },
  { id: 'mil', label: 'Milinda’s Questions', pali: 'Milindapañhā' },
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
  const rest = name.slice(prefix.length);
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
export function findChapterNodes(node, pattern, results = []) {
  if (Array.isArray(node)) node.forEach((n) => findChapterNodes(n, pattern, results));
  else if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      if (pattern.test(key)) results.push({ key, leaves: flattenLeaves(val) });
      else findChapterNodes(val, pattern, results);
    }
  }
  return results;
}
