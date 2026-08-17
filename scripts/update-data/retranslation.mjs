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
//
// Grouped by term family below, in array order — the groups are for reading, and the order inside
// and between them is still what settles a same-word collision:
//
//   standalone terms   mendicant-bhikkhu, immersion-concentration
//   awareness          satipatthana-establishment-of-awareness, sati-aware,
//                      sampajanna-understanding
//   arising / passing   samudaya-arising, vaya-passing-away, atthangama-disappearing,
//                      udayabbaya-arising-passing-away
//   segment overrides  one line each, applied last

export const RULES = [
  // ── Standalone terms ────────────────────────────────────────────────────────
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
  // ── Awareness ───────────────────────────────────────────────────────────────
  // sati-aware and sampajanna-understanding meet in the satipaṭṭhāna formula ("keen, aware, and
  // mindful"), where sati-aware produces the very word sampajanna-understanding consumes. Locking,
  // not order, is what keeps them apart — see "The pass" in retranslation.md, and the pinned
  // example in update-data.test.js. satipatthana-establishment-of-awareness runs ahead of both
  // because it *is* a same-word collision: it claims the "mindfulness" of "mindfulness meditation"
  // that sati-aware would otherwise take on its own.
  {
    id: 'satipatthana-establishment-of-awareness',
    why: 'Sujato renders satipaṭṭhāna as "mindfulness meditation"; this app prefers "establishment ' +
      'of awareness", the compound read literally (sati-upaṭṭhāna). Open: the phrase is his ' +
      'dedicated rendering of this one term and nothing else in the corpus produces it — every one ' +
      'of its 382 segments is satipaṭṭhāna, so there is nothing to exclude. The plural "the four ' +
      'kinds of mindfulness meditation" absorbs "kinds of" rather than reading "the four kinds of ' +
      'establishments of awareness", and the bare singular carries its own article ("the ' +
      'establishment of awareness") since English will not take it without one; the two ' +
      'preposition forms exist so a title keeps that article lowercase ("The Longer Discourse on ' +
      'the Establishment of Awareness"). Skips sujato/notes: MN 10\'s and DN 22\'s notes are ' +
      'Sujato explaining the very choice this rule reverses ("satipaṭṭhāna refers especially to a ' +
      'conscious development of contemplative practices based on mindfulness, i.e. \'mindfulness ' +
      'meditation\'"), which rewritten reads as its own tautology, and a note arguing for a ' +
      'rendering is better left saying what he said.',
    mode: 'deny',
    scope: ['sujato/sutta', 'sujato/name', 'sujato/blurb'],
    predicate: /satipaṭṭhān/i,
    forms: [
      ['kinds of mindfulness meditation', 'establishments of awareness'],
      ['kind of mindfulness meditation', 'establishment of awareness'],
      ['and mindfulness meditation', 'and the establishment of awareness'],
      ['on mindfulness meditation', 'on the establishment of awareness'],
      ['mindfulness meditations', 'establishments of awareness'],
      ['mindfulness meditation', 'the establishment of awareness'],
    ],
  },
  {
    id: 'sati-aware',
    why: 'Sujato renders sati as "mindfulness"/"mindful"; this app prefers "awareness"/"aware". ' +
      'Open: "mindful" is his dedicated term for sati and nothing else in the corpus renders as ' +
      'it, so the only exclusions are the "walking mindfully" passages, where the Pali is ' +
      'caṅkamati (walking meditation) with no sati in it at all. Leaves anussati/sarati alone — ' +
      'those render as "recollection"/"remember", and "recollection of the Buddha" is not an ' +
      'awareness of anything.',
    mode: 'deny',
    predicate: /(?<!s)sat[iīāo]|ānāpānassati|kāyagatāsati|upaṭṭhitassati|muṭṭhassa|patissat/i,
    forms: [
      ['mindfulness', 'awareness'],
      ['mindful', 'aware'],
      ['mindfully', 'with awareness'],
      ['unmindfulness', 'unawareness'],
      ['unmindful', 'unaware'],
      ['unmindfully', 'without awareness'],
    ],
  },
  {
    id: 'sampajanna-understanding',
    why: 'Sujato renders sampajañña as "situational awareness"/"awareness"/"aware"; this app ' +
      'prefers "understanding". Closed, because plain-English "aware" is common and unrelated — ' +
      'the formless attainments alone account for ~150 segments of "aware that ‘space is ' +
      'infinite’", which translates iti, not sampajañña. Skips sujato/notes, which shares its ' +
      'segment ids with sujato/sutta and so can\'t be decided separately: Sujato\'s notes use ' +
      '"awareness" freely for citta, viññāṇa and saññā ("‘Mind’ (citta) is simple awareness"), and ' +
      'a note that explains his choice of word is better left saying what he said.',
    mode: 'allow',
    scope: ['sujato/sutta', 'sujato/blurb'],
    predicate: /sampajañ|sampajān/i,
    forms: [
      ['situational awareness', 'understanding'],
      ['awareness', 'understanding'],
      ['aware', 'understanding'],
      // asampajāna. All nine of its segments are the negated term, so these carry no ambiguity of
      // their own — but they matter for the one line that has both terms negated at once, an5.210's
      // "falling asleep unmindful and unaware" (muṭṭhassatissa asampajānassa), which without them
      // reads "unaware and unaware" once sati-aware has had it.
      ['unawareness', 'lack of understanding'],
      ['unaware', 'without understanding'],
    ],
  },
  // ── Arising and passing away ────────────────────────────────────────────────
  // One doctrinal pair across four Pali terms, which Sujato renders with four different English
  // words: samudaya "origin", vaya "vanishing", atthaṅgama "disappearance", udayabbaya "rise and
  // fall". They land on "arising" and "passing away"/"disappearing" here, so the pair reads as a
  // pair. vaya runs before atthangama because both can claim "disappearance"; the rest are
  // order-independent, matching different words.
  {
    id: 'samudaya-arising',
    why: 'Sujato renders samudaya as "origin" (and as the verb "originates"); this app prefers ' +
      '"arising", pairing it with atthaṅgama as "disappearing". Open: the exclusions are ' +
      'paṭiccasamuppanna ("dependently originated"), aggañña ("the origin of the world"), and a ' +
      'handful of other -sambhava/-samuṭṭhāna compounds. Deliberately leaves "source" (77 ' +
      'segments of samudaya) alone: an open rule can\'t safely claim a word that ordinary ' +
      'English uses as freely as that one — and skips sujato/notes for the same reason, since ' +
      '"origin story", "origin myth" and "a humble origin" are all Sujato writing plain English ' +
      'about the text rather than translating it (and notes can\'t be excluded by id, sharing ' +
      'theirs with sujato/sutta).',
    mode: 'deny',
    scope: ['sujato/sutta', 'sujato/blurb'],
    predicate: /samuday|samudet/i,
    forms: [
      ['origin', 'arising'],
      ['originates', 'arises'],
      ['originate', 'arise'],
    ],
  },
  {
    id: 'vaya-passing-away',
    why: 'Sujato renders vaya as "vanishing"/"vanish"; this app prefers "passing away". Closed, ' +
      'because "vanish" in this corpus is overwhelmingly antaradhāyati — Māra, a deity or the ' +
      'Buddha disappearing from a scene — which is two thirds of the corpus\'s uses of the word ' +
      'and nothing to do with impermanence. The six segments where Sujato renders vaya as ' +
      '"disappearance" instead ("observing disappearance", an6.55/an9.26) are left to ' +
      'atthangama-disappearing: claiming that word here would drag all 355 of its segments into ' +
      'this rule\'s queue to buy a difference between two renderings this app treats as ' +
      'interchangeable.',
    mode: 'allow',
    predicate: /(^|[^a-zāīūṁṅñṭḍṇḷ])vay|(?:khaya|nirodha|uppāda)vay|vayadhamm/i,
    forms: [
      ['vanishing', 'passing away'],
      ['vanishes', 'passes away'],
      ['vanished', 'passed away'],
      ['vanish', 'pass away'],
    ],
  },
  {
    id: 'atthangama-disappearing',
    why: 'Sujato renders atthaṅgama as "disappearance"; this app prefers "disappearing", ' +
      'pairing it with samudaya as "arising". Open: the one real exclusion is antaradhāna, "the ' +
      'decline and disappearance of the true teaching", which is a different term about the ' +
      'teaching being lost rather than about a phenomenon ceasing. Also picks up the six vaya ' +
      'segments Sujato renders "disappearance" — see vaya-passing-away.',
    mode: 'deny',
    predicate: /atthaṅgam|atthagam/i,
    forms: [
      ['disappearance', 'disappearing'],
    ],
  },
  {
    id: 'udayabbaya-arising-passing-away',
    why: 'Sujato renders udayabbaya as "rise and fall"; this app prefers "arising and passing ' +
      'away", which is what he already uses for the near-synonym udayatthagāminī. Closed: "rise ' +
      'and fall" is ordinary English, and even within this corpus it also renders uppādavaya in ' +
      'a verbal construction ("their nature is to rise and fall") the noun phrase can\'t replace.',
    mode: 'allow',
    predicate: /udayabbay|udayavyay/i,
    forms: [
      ['rise and fall', 'arising and passing away'],
    ],
  },
  // ── Segment overrides ───────────────────────────────────────────────────────
  // These run last, over the term rules' output — so `from` is the post-processed text, not
  // upstream's. Each is a place where sati-aware's "mindfully" → "with awareness" lands in a word
  // order English won't take; the phrase is fine, it just has to move. `segments: [...]` is for a
  // line the corpus repeats verbatim, where one from/to is the whole decision.
  {
    id: 'enter-with-awareness',
    kind: 'segment',
    why: 'satova samāpajjāmi — "I with awareness enter into" isn’t English; the phrase moves to the ' +
      'front. Only dn34 here: an5.27 carries the same line with a trailing elision mark, which is a ' +
      'different string and so a different anchor — see enter-with-awareness-elided.',
    segment: 'dn34:1.6.74',
    from: '‘I with awareness enter into and emerge from this concentration.’ ',
    to: '‘With awareness, I enter into and emerge from this concentration.’ ',
  },
  {
    id: 'enter-with-awareness-elided',
    kind: 'segment',
    why: 'enter-with-awareness’s line, as an5.27 has it: followed by an elision mark.',
    segment: 'an5.27:1.8',
    from: '‘I with awareness enter into and emerge from this concentration.’ … ',
    to: '‘With awareness, I enter into and emerge from this concentration.’ … ',
  },
  {
    id: 'thag16-10-walk-with-awareness',
    kind: 'segment',
    why: 'Satiṁ upaṭṭhapetvāna, which Sujato compresses to "very mindfully" — "very with awareness" ' +
      'is not a phrase, and the Pali is plainer than the intensifier anyway.',
    segment: 'thag16.10:27.3',
    from: 'very with awareness; ',
    to: 'with awareness established; ',
  },
  {
    id: 'mn12-step-with-awareness',
    kind: 'segment',
    why: 'satova abhikkamāmi, satova paṭikkamāmi — "ever so mindfully" carries an intensity "ever so ' +
      'with awareness" can’t.',
    segment: 'mn12:47.2',
    from: 'I’d step forward or back ever so with awareness, so I was full of pity regarding even a drop of water, thinking: ',
    to: 'I’d step forward or back with such care and awareness, so I was full of pity regarding even a drop of water, thinking: ',
  },
  {
    id: 'endure-with-awareness',
    kind: 'segment',
    why: 'A verse line the Theragāthā repeats verbatim in three poems: the adverb has to follow the ' +
      'verb. One rule, three segments — the decision is the same one three times, and each segment ' +
      'still has to match the anchor on its own.',
    segments: ['thag1.31:1.3', 'thag3.9:2.3', 'thag15.1:12.3'],
    from: 'one should with awareness endure, ',
    to: 'one should endure with awareness, ',
  },
];
