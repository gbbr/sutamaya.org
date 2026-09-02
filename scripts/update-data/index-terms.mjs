// The editorial layer over the CIPS topic index, the counterpart to retranslation.mjs.
//
// CIPS is written in Bhikkhu Bodhi's English, not Bhikkhu Sujato's, so the retranslation rules
// don't reach it — a headword reading "concentration (samādhi)" under a sutta whose text reads
// "composure" looks like it came from somewhere else. This maps the terms that collide onto the
// words this app displays. The wording CIPS used is kept as a search alias, so a reader who knows
// the term either way still finds the sutta.
//
// It lives here rather than beside the importer because it is an editorial decision that has to
// survive a refresh of the index.

// Substring rewrites, longest first so a phrase wins over the words inside it.
const PHRASES = [
  ['placing of the mind and keeping it connected', 'thought and examination'],
  ['concentration', 'composure'],
  ['immersion', 'composure'],
  ['mendicants', 'bhikkhus'],
  ['mendicant', 'bhikkhu'],
  ['monks', 'bhikkhus'],
  ['monk', 'bhikkhu'],
  ['keenness', 'ardor'],
  ['anxiety', 'agitation'],
  ['vanishing', 'passing away'],
];

// Whole headwords, where a substring rule would also rewrite "dependent origination" — which the
// app keeps.
const EXACT = {
  'origination (samudaya)': 'arising (samudaya)',
  'noble truth of the origin of suffering': 'noble truth of the arising of suffering',
  'origin, ending (samudayañca atthaṅgamañca)': 'arising, disappearing (samudayañca atthaṅgamañca)',
};

/**
 * Returns a CIPS headword worded as this app words it.
 *   label – what the reader sees
 *   alias – CIPS's own wording, kept searchable; empty where nothing changed
 */
export function indexTerm(headword) {
  const term = headword.trim();
  if (EXACT[term]) return { label: EXACT[term], alias: term };
  let label = term;
  // Word boundaries, so "monk" leaves "monkey" alone.
  for (const [from, to] of PHRASES) label = label.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  return { label, alias: label === term ? '' : term };
}
