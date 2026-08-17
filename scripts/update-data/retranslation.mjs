// The declared editorial layer over Sujato's English — see retranslation.md for the design this
// implements. Order is significant: a rule earlier in this array wins any same-word collision
// with a later one (see "The pass" in retranslation.md). Each term rule's segment list, if any,
// lives in its own sidecar at scripts/update-data/rules/<id>.json — never inline here, since that
// list is machine-written by `update-data:triage` (see loadSidecar/saveSidecar in
// scripts/lib/retranslation.js).
//
// `forms` pairs are matched on English word boundaries, case-preserved; every inflection is listed
// explicitly rather than swapped by stem, since the corpus has unrelated words on the same stem —
// e.g. MN40's "water immerser" (someone who dunks in water), which a substring swap would turn
// into the nonsense "water concentrater".

export const RULES = [
  {
    id: 'mendicant-bhikkhu',
    why: 'Sujato renders bhikkhu as "mendicant"; this app keeps the Pali. Nothing else in the ' +
      'corpus renders as "mendicant", so nothing needs excluding — open, empty deny list.',
    mode: 'deny',
    forms: [
      ['mendicant', 'bhikkhu'],
      ['mendicants', 'bhikkhus'],
    ],
  },
  {
    id: 'immersion-concentration',
    why: 'Sujato renders samādhi as "immersion"; this app prefers "concentration". Open: the ' +
      '"immers-" stem also covers unrelated words like "water immerser" (MN40), but those aren’t ' +
      'listed forms, so a substring swap never touches them — see the forms comment above.',
    mode: 'deny',
    forms: [
      ['immerse', 'concentrate'],
      ['immerses', 'concentrates'],
      ['immersed', 'concentrated'],
      ['immersing', 'concentrating'],
      ['immersion', 'concentration'],
      ['immersions', 'concentrations'],
    ],
  },
];
