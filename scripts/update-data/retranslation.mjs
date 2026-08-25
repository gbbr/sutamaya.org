// The declared editorial layer over Bhikkhu Sujato's English — see docs/retranslation.md for the
// spec. Order is significant: a rule earlier in this array wins any same-word collision with a
// later one. A term rule's segment list, if any, lives in its own sidecar at
// scripts/update-data/rules/<id>.json, machine-written by `update-data triage`.
//
// `forms` pairs match on English word boundaries, case-preserved. Every inflection is listed
// explicitly rather than swapped by stem, since the corpus has unrelated words on the same stem —
// MN 40's "water immerser" (someone who dunks in water). A listed inflection can itself be
// ordinary English elsewhere, which is what a rule's deny list is for.
//
// Groups below, in array order; order inside and between them settles same-word collisions:
//
//   standalone terms   mendicant-bhikkhu, immersion-concentration,
//                      patisambhida-analytical-knowledge, dhamma-the-dhamma, atapi-ardent,
//                      vedana-sensation
//   awareness          satipatthana-establishment-of-awareness, sati-aware,
//                      sampajanna-clear-comprehension, vippasanna-calm
//   arising / passing  samudaya-arising, vaya-passing-away, atthangama-disappearing,
//                      udayabbaya-arising-passing-away
//   change             viparinama-annathatta-change-unstable, viparinama-anuparivatti-changing
//   agitation          paritassati-agitated
//   thought            vitakka-vicara-thought-examination
//   attention          yoniso-proper-attention
//   saṅkhāra           abhisankharoti-generate, sankhara-action-formations
//   segment overrides  one line each, applied last; sub-grouped by cause, order immaterial

export const RULES = [
  // ── Standalone terms ────────────────────────────────────────────────────────
  {
    id: 'mendicant-bhikkhu',
    why: 'Bhikkhu Sujato renders bhikkhu as "mendicant"; this app keeps the Pali. Open with an empty ' +
      'deny list — nothing else in the corpus renders as "mendicant".',
    mode: 'deny',
    forms: [
      ['mendicant', 'bhikkhu'],
      ['mendicants', 'bhikkhus'],
    ],
  },
  {
    id: 'immersion-concentration',
    why: 'Bhikkhu Sujato renders samādhi as "immersion"; this app prefers "composure". Two English ' +
      'words split by grammatical slot, since no single word covers both: the noun and participle ' +
      'are "composure"/"composed", while the finite verb and gerund take "collect" to stay clear of ' +
      'the corpus’s existing "compose"/"composes" for writing verses (dn21, mn56, an4.231). One ' +
      'form carries the indefinite article, since the word it agrees with is the word being ' +
      'replaced ("experiences an immersion of the heart", DN 1). Open: the denials are the ' +
      'inflections that translate no samādhi at all — "immerse on the gratification", "immersing ' +
      'wholeheartedly", literal immersion in water (udakorohaka), MN 50’s jhāyati string, and ' +
      '"mindfulness immersed in the body" (kāyagatā sati).',
    mode: 'deny',
    predicate: /samādh|samāhit|samādah|cetosamādh/i,
    forms: [
      ['an immersion', 'composure'],
      ['immerse', 'collect'],
      ['immerses', 'collects'],
      ['immersed', 'composed'],
      ['immersing', 'collecting'],
      ['immersion', 'composure'],
      ['immersions', 'composures'],
    ],
  },
  {
    id: 'patisambhida-analytical-knowledge',
    why: 'Bhikkhu Sujato renders paṭisambhidā as "textual analysis"; this app prefers "analytical ' +
      'knowledge" — the four paṭisambhidās are of meaning, text, terminology and eloquence, so ' +
      '"textual" names only the second of them. Open with an empty deny list: every occurrence of ' +
      'the phrase is the term, and it is always a noun, so one form covers it. AN 1.593-595’s ' +
      'anekadhātupaṭisambhidā, which he gives as a bare "analysis", is left alone — no form can ' +
      'claim "analysis" without taking the ~150 unrelated uses of the word with it.',
    mode: 'deny',
    predicate: /paṭisambhid/i,
    forms: [
      ['textual analysis', 'analytical knowledge'],
    ],
  },
  {
    id: 'dhamma-the-dhamma',
    why: 'Six segments where Bhikkhu Sujato renders dhamma as "text"; this app prefers "the Dhamma", ' +
      'since the Early Buddhist Texts were transmitted orally and "text" imports a written artifact ' +
      'the passages do not have. Closed, and necessarily so: "text" is otherwise ordinary English ' +
      'throughout the corpus — 265 "Abbreviated Texts" chapter headings (peyyāla), DN 27’s ganthe ' +
      'karontā, DN 30’s nimittakovidā — none of which is dhamma. The first form rebuilds the ' +
      'four-paṭisambhidā list rather than swapping one word, because "the Dhamma" cannot sit as a ' +
      'bare item beside "meaning" and "definition".',
    mode: 'allow',
    scope: ['sujato/sutta'],
    predicate: /dhammapaṭisambhid|atthaṁ dhammañca|atthamaññāya dhammamaññāya/i,
    forms: [
      ['of meaning, text, definition, and eloquence', 'of meaning, of the Dhamma, of definition, and of eloquence'],
      ['the text', 'the Dhamma'],
    ],
  },
  {
    id: 'atapi-ardent',
    why: 'Bhikkhu Sujato renders ātāpī as "keen"; this app prefers "ardent", which keeps the literal ' +
      'sense of heat (ā + √tap, "burning") that "keen" loses. The abstract noun ātappa takes "ardor" ' +
      '(US spelling, as the corpus uses throughout) and the adverb "ardently". Open: the denials are ' +
      'the 52 segments where "keen" is ordinary English, two stock idioms rather than a scattering — ' +
      'tibba- ("keen enthusiasm") and tikkha- ("keen faculties"). AN 3.49’s "keen to <verb>" for ' +
      'ātappaṁ karoti is an idiom "ardent" cannot take, and is rebuilt by segment overrides.',
    mode: 'deny',
    predicate: /(^|[^a-zāīūṁṅñṭḍṇḷ])(an)?[aā]tāp|(^|[^a-zāīūṁṅñṭḍṇḷ])ātapp/i,
    forms: [
      // The article travels with the word it agrees with, or SN 1.23 reads "a ardent bhikkhu".
      ['a keen', 'an ardent'],
      ['keenness', 'ardor'],
      ['keenly', 'ardently'],
      ['keen', 'ardent'],
    ],
  },
  {
    id: 'vedana-sensation',
    why: 'Bhikkhu Sujato renders vedanā as "feeling"; this app prefers "sensation", since "feeling" ' +
      'in ordinary English has drifted towards emotion, which vedanā is not. Only the noun is ' +
      'rewritten: his verbs "feel"/"feels"/"felt" render vediyati and paṭisaṁvedeti, a different ' +
      'grammatical slot that "sensation" has no form for, so leaving them gives grammatical English ' +
      'throughout ("they feel a pleasant sensation"). Open: 37 denials out of 2,163 segments, ' +
      'twenty-four of them ordinary English and thirteen vedanaṁ vedayamāno, where the participle ' +
      'is the only match on the line. SN 22.79’s and MN 43’s etymology puns on the verb, which the ' +
      'noun swap alone breaks, so those paragraphs are rebuilt by segment overrides.',
    mode: 'deny',
    predicate: /vedan|vedayit/i,
    forms: [
      ['feeling', 'sensation'],
      ['feelings', 'sensations'],
    ],
  },
  // ── Awareness ───────────────────────────────────────────────────────────────
  // sati-aware and sampajanna-clear-comprehension meet in the satipaṭṭhāna formula ("keen, aware,
  // and mindful"), where sati-aware produces the very word the sampajañña rule consumes. Locking,
  // not order, keeps them apart — see "The pass" in docs/retranslation.md.
  // satipatthana-establishment-of-awareness runs ahead of both because it *is* a same-word
  // collision: it claims the "mindfulness" of "mindfulness meditation". vippasanna-calm exists only
  // because sampajañña became "clear comprehension".
  {
    id: 'satipatthana-establishment-of-awareness',
    why: 'Bhikkhu Sujato renders satipaṭṭhāna as "mindfulness meditation"; this app prefers ' +
      '"establishment of awareness", the compound read literally (sati-upaṭṭhāna). Open with an ' +
      'empty deny list: all 382 segments carrying the phrase are the term. The plural form absorbs ' +
      '"kinds of" rather than reading "the four kinds of establishments of awareness"; the bare ' +
      'singular carries its own article, and the two preposition forms exist so a title keeps that ' +
      'article lowercase ("The Longer Discourse on the Establishment of Awareness").',
    mode: 'deny',
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
    why: 'Bhikkhu Sujato renders sati as "mindfulness"/"mindful"; this app prefers ' +
      '"awareness"/"aware". Open: the only denials are the "walking mindfully" passages, where the ' +
      'Pali is caṅkamati (walking meditation) with no sati in it. Leaves anussati/sarati alone — ' +
      'those render as "recollection"/"remember". One form carries the indefinite article, since ' +
      '"a mindful disciple of the Buddha" would otherwise read "a aware".',
    mode: 'deny',
    predicate: /(?<!s)sat[iīāo]|ānāpānassati|kāyagatāsati|upaṭṭhitassati|muṭṭhassa|patissat/i,
    forms: [
      ['a mindful', 'an aware'],
      ['mindfulness', 'awareness'],
      ['mindful', 'aware'],
      ['mindfully', 'with awareness'],
      ['unmindfulness', 'unawareness'],
      ['unmindful', 'unaware'],
      ['unmindfully', 'without awareness'],
    ],
  },
  {
    id: 'sampajanna-clear-comprehension',
    why: 'Bhikkhu Sujato renders sampajañña as "situational awareness"/"awareness"/"aware"; this app ' +
      'prefers "clear comprehension". Closed, because plain-English "aware" is common and ' +
      'unrelated — the formless attainments alone account for ~150 segments of "aware that ‘space ' +
      'is infinite’", which translates iti. The adjective takes the participle "clearly ' +
      'comprehending" instead, since a noun phrase cannot stand in the satipaṭṭhāna formula\'s ' +
      'adjective slot ("keen, aware, and mindful"), which is ~250 segments on its own.',
    mode: 'allow',
    predicate: /sampajañ|sampajān/i,
    forms: [
      ['situational awareness', 'clear comprehension'],
      ['awareness', 'clear comprehension'],
      ['aware', 'clearly comprehending'],
      // asampajāna. All nine of its segments are the negated term. They matter for the one line
      // with both terms negated at once — an5.210's "falling asleep unmindful and unaware" —
      // which without them reads "unaware and unaware" once sati-aware has had it.
      ['unawareness', 'lack of clear comprehension'],
      ['unaware', 'without clear comprehension'],
    ],
  },
  {
    id: 'vippasanna-calm',
    why: 'Bhikkhu Sujato renders vippasanna as "clear", which is right nearly everywhere it occurs, ' +
      'so this is not a rule about the term. It covers only the 14 lines where his "clear" for ' +
      'vippasanna sits beside this app’s "clear comprehension" for sampajañña: SN 47.4’s ' +
      'satipaṭṭhāna formula and Iti 47’s wakefulness verse. "Calm" is the DPD’s gloss for the ' +
      'compound and the one candidate not already spoken for — "tranquil" is his word for passaddhi ' +
      'and "serene" his for samatha. Closed, so a line that gains one of these phrases for some ' +
      'other term stops for review rather than being rewritten silently.',
    mode: 'allow',
    predicate: /vippasann/i,
    // Both forms carry the neighbouring words rather than claiming "clear" on its own, which would
    // take the gems and lakes with it.
    forms: [
      ['minds that are clear', 'minds that are calm'],
      ['joyful and clear', 'joyful and calm'],
    ],
  },
  // ── Arising and passing away ────────────────────────────────────────────────
  // One doctrinal pair across four Pali terms, which Bhikkhu Sujato renders with four different
  // English words: samudaya "origin", vaya "vanishing", atthaṅgama "disappearance", udayabbaya
  // "rise and fall". They land on "arising" and "passing away"/"disappearing" here, so the pair
  // reads as a pair. vaya runs before atthangama because both can claim "disappearance"; the rest
  // match different words and are order-independent.
  {
    id: 'samudaya-arising',
    why: 'Bhikkhu Sujato renders samudaya as "origin" (and as the verb "originates"); this app prefers ' +
      '"arising", pairing it with atthaṅgama as "disappearing". Open: the denials are ' +
      'paṭiccasamuppanna ("dependently originated"), aggañña ("the origin of the world"), and a ' +
      'handful of other -sambhava/-samuṭṭhāna compounds. Leaves "source" and the noun "origination" ' +
      'alone — ordinary English uses both too freely for an open rule to claim, and "origination" ' +
      'is sambhava four times out of five besides.',
    mode: 'deny',
    predicate: /samuday|samudet/i,
    forms: [
      ['origin', 'arising'],
      ['originates', 'arises'],
      ['originate', 'arise'],
    ],
  },
  {
    id: 'vaya-passing-away',
    why: 'Bhikkhu Sujato renders vaya as "vanishing"/"vanish"; this app prefers "passing away". Closed, ' +
      'because "vanish" in this corpus is overwhelmingly antaradhāyati — Māra, a deity or the ' +
      'Buddha disappearing from a scene — which is two thirds of its uses of the word. The six ' +
      'segments where Bhikkhu Sujato renders vaya as "disappearance" instead (an6.55/an9.26) are ' +
      'left to atthangama-disappearing, since claiming that word here would drag all 355 of its ' +
      'segments into this rule\'s queue.',
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
    why: 'Bhikkhu Sujato renders atthaṅgama as "disappearance"; this app prefers "disappearing", ' +
      'pairing it with samudaya as "arising". Open: the one real denial is antaradhāna, "the ' +
      'decline and disappearance of the true teaching", a different term. Also picks up the six ' +
      'vaya segments Bhikkhu Sujato renders "disappearance" — see vaya-passing-away.',
    mode: 'deny',
    predicate: /atthaṅgam|atthagam/i,
    forms: [
      ['disappearance', 'disappearing'],
    ],
  },
  {
    id: 'udayabbaya-arising-passing-away',
    why: 'Bhikkhu Sujato renders udayabbaya as "rise and fall"; this app prefers "arising and passing ' +
      'away", his own wording for the near-synonym udayatthagāminī. Closed: "rise and fall" is ' +
      'ordinary English, and within this corpus it also renders uppādavaya in a verbal construction ' +
      '("their nature is to rise and fall") the noun phrase can\'t replace.',
    mode: 'allow',
    predicate: /udayabbay|udayavyay/i,
    forms: [
      ['rise and fall', 'arising and passing away'],
    ],
  },
  // ── Change and alteration ───────────────────────────────────────────────────
  // vipariṇāma paired with aññathatta/aññathābhāva — AN 3.47's third mark of a conditioned
  // phenomenon, which is why this group sits next to arising / passing. The adjacency is doctrinal
  // only: no rule here shares a word with one above or below, so the position settles nothing.
  //
  // Two rules, split by construction rather than by meaning. The first takes the doublet wherever
  // Bhikkhu Sujato writes it as a whole clause ("decays and perishes"); the second the one place he
  // writes it as a compound noun ("the perishing of form"). Kept apart so each gets a predicate
  // stating its own construction and a match count that moves only when that construction does.
  {
    id: 'viparinama-annathatta-change-unstable',
    why: 'Bhikkhu Sujato renders the vipariṇāma/aññathā doublet as "decays and perishes"; this app ' +
      'prefers "changes and becomes otherwise", since neither Pali term carries the destruction ' +
      '"perish" implies. Aññathā-bhāva reads "becoming otherwise" wherever English will take a ' +
      'participle; the nominal slot takes "alteration" instead, since a gerund will not stand where ' +
      '"their decay and perishing give rise to sorrow" puts a noun. Open with an empty deny list: ' +
      'every form is a multi-word phrase only this doublet produces — the bare words are another ' +
      'matter, which is why none of them is a form. Leaves vipariṇāmadhamma ("perishable") and the ' +
      'remaining vipariṇāma compound nouns alone as a separate decision, except MN 138 and SN 22.7, ' +
      'which are viparinama-anuparivatti-changing\'s below.',
    mode: 'deny',
    predicate: /vipariṇ|vippariṇ|aññathatt|aññathābhāv/i,
    forms: [
      // The doublet as a whole predicate, singular and plural. The plural doubles as the bare
      // infinitive governed by "were to" (MN 87, SN 21.2), since "become" is already the form
      // that slot wants.
      ['decays and perishes', 'changes and becomes otherwise'],
      ['decay and perish', 'change and become otherwise'],
      // The nominal slot: "their decay and perishing give rise to sorrow" (vipariṇāmaññathābhāvā).
      ['decay and perishing', 'change and alteration'],
      // The adjectival slot, SN 25's formula (vipariṇāmī aññathābhāvī): "form is impermanent,
      // decaying, and perishing". One form covers both words — which is also what keeps the rule
      // off sn5.4:5.2's unrelated "decaying and frail", where there is no comma.
      ['decaying, and perishing', 'changing, and becoming otherwise'],
    ],
  },
  {
    id: 'viparinama-anuparivatti-changing',
    why: 'The vipariṇāma compound noun of MN 138 and SN 22.7 (rūpavipariṇāmānuparivatti viññāṇaṁ), ' +
      'which Bhikkhu Sujato renders "the perishing of form"/"of consciousness"; this app prefers ' +
      '"the changing of". Without it MN 138 contradicts itself two segments apart: 20.4 already ' +
      'reads "But that form changes and becomes otherwise" from ' +
      'viparinama-annathatta-change-unstable, while 20.5 said "latches on to the perishing of ' +
      'form" for the same word. Renders the vipariṇāma half rather than reaching for one of that ' +
      'rule\'s words for aññathābhāva, since anuparivatti needs a process to trail. Open with an ' +
      'empty deny list: "perishing of" occurs in exactly these 16 segments corpus-wide. Two forms ' +
      'rather than a bare "perishing", which is MN 137/SN 35.136–7\'s vipariṇāmavirāganirodha and ' +
      'SN 22.43\'s, all left to a separate decision.',
    mode: 'deny',
    predicate: /vipariṇāmānuparivatt/i,
    forms: [
      ['perishing of form', 'changing of form'],
      ['perishing of consciousness', 'changing of consciousness'],
    ],
  },
  // ── Agitation ───────────────────────────────────────────────────────────────
  // paritassati, which MN 138 and SN 22.7 present as what grasping makes of vipariṇāma — hence the
  // position after change and alteration. The adjacency is doctrinal only: this rule shares no word
  // with any rule above or below. Its segment overrides do depend on that group having run, since
  // they anchor on the phrase it writes ("latching on to the changing of form").
  {
    id: 'paritassati-agitated',
    why: 'Bhikkhu Sujato renders paritassati as "anxious"/"anxiety"; this app prefers "agitated"/' +
      '"agitation", since "anxiety" reads as the modern affliction. Open: the English word means ' +
      'something else in only five segments — utrasta (sn2.17, snp5.1), ubbigga (thag16.8), and ' +
      'an8.23\'s blurb, where "anxious to know" is ordinary English for eager. Leaves the term\'s ' +
      'four contextual renderings alone as a separate decision: "worry" (an4.28, dn33, sn16.1), ' +
      '"relief" for aparitassāya (an7.67, an8.30), "bothered" (an5.106) and "nervous" (mn91).',
    mode: 'deny',
    predicate: /paritass/i,
    forms: [
      ['anxious', 'agitated'],
      // The plural noun paritassanā. English will not take "Agitations occupy the mind", so this
      // one sentence goes singular, and the verb has to travel with the noun — which is what the
      // longer form is for. Its negated twin needs segment overrides; see them for why.
      ['anxieties occupy', 'agitation occupies'],
      ['anxieties', 'agitations'],
      ['anxiety', 'agitation'],
    ],
  },
  // ── Thought and examination ─────────────────────────────────────────────────
  {
    id: 'vitakka-vicara-thought-examination',
    why: 'Bhikkhu Sujato renders the jhāna pair vitakka/vicāra as "placing the mind"/"keeping it ' +
      'connected", reading them as movements of attention rather than as thinking; this app prefers ' +
      '"thought"/"examination". It also unifies him with himself: outside this formula he already ' +
      'gives vitakka as "thought" in 440 segments. Open with an empty deny list — all 254 segments ' +
      'carrying this wording are the formula — and scoped to sutta, since name/blurb never carry it. ' +
      'The pair is one interleaved English idiom, so the forms are phrases rather than words and ' +
      'both terms live in one rule; splitting them would leave "while thought and examination". The ' +
      'forms cover each grammatical slot the idiom stands in, and the longest absorbs the article, ' +
      'which would otherwise leave "As the thought and examination are stilled" across 106 segments. ' +
      'His translator notes quote his wording and are never retranslated, so 14 suttas have a note ' +
      'in his terms beside text in ours.',
    mode: 'deny',
    scope: ['sujato/sutta'],
    predicate: /vitakk|vicār/i,
    forms: [
      // the pair
      ['the placing of the mind and the keeping it connected', 'thought and examination'],
      ['without placing the mind, merely keeping it connected', 'without thought, with just examination'],
      ['neither placing the mind nor keeping it connected', 'neither thinking nor examining'],
      ['without placing the mind and keeping it connected', 'without thought or examination'],
      ['without placing the mind or keeping it connected', 'without thought or examination'],
      ['neither place the mind nor keep it connected', 'neither think nor examine'],
      ['while placing the mind and keeping it connected', 'with thought and examination'],
      ['the placing of the mind and keeping it connected', 'thought and examination'],
      ['placing of the mind and keeping it connected', 'thought and examination'],
      ['placing the mind and keeping it connected', 'thought and examination'],
      ['placing the mind, keeping it connected', 'thought, examination'],
      ['place the mind and keep it connected', 'think and examine'],
      ['placing and keeping', 'thought and examination'],
      // vitakka alone
      ['not placing the mind', 'no thought'],
      ['placing the mind', 'thought'],
      ['place the mind', 'think'],
      // vicāra alone
      ['keeping it connected', 'examination'],
      ['keep it connected', 'examine'],
    ],
  },
  // ── Attention ───────────────────────────────────────────────────────────────
  // Placed after thought/examination as its doctrinal neighbour, not a collision: nothing else in
  // the corpus renders as "rational"/"rationally", and no rule above consumes the "proper" or
  // "attention" this one produces, so the position settles nothing.
  {
    id: 'yoniso-proper-attention',
    why: 'Bhikkhu Sujato renders yoniso/ayoniso as "rational"/"irrational" and the compound ' +
      'yoniso manasikāra as "rational application of mind"; this app prefers "properly"/' +
      '"improperly" and "proper attention"/"improper attention". Yoniso is literally "according to ' +
      'the source/origin" — attending to a thing the right way round, not reasoning — so "rational" ' +
      'is the wrong register. Open with a small deny list: four segments of ordinary English. The ' +
      'compound is a noun and cannot fill the verb slots, so the forms split by grammatical slot — ' +
      '"apply the mind rationally" becomes "attend properly", inflected for each of the four slots ' +
      'and listed in both of his word orders, which he uses interchangeably (mn2). The bare adverb ' +
      'and adjective come last, so they catch only the yoniso standing outside the compound.',
    mode: 'deny',
    predicate: /yoni/i,
    forms: [
      // yoniso manasikāra, the noun
      ['irrational application of mind', 'improper attention'],
      ['rational application of mind', 'proper attention'],
      // yoniso manasi karoti, the verb — both of Bhikkhu Sujato's word orders, per slot.
      // The SN 12 dependent-origination lines (sādhukaṁ yoniso manasi karoti) put a second adverb
      // in front of the verb, which the bare form would strand as "carefully and attends
      // properly", so that whole phrase is one form and the adverbs move behind the verb.
      ['carefully and rationally applies the mind', 'attends carefully and properly'],
      ['irrationally applying the mind', 'attending improperly'],
      ['rationally applying the mind', 'attending properly'],
      ['applying the mind irrationally', 'attending improperly'],
      ['applying the mind rationally', 'attending properly'],
      ['irrationally applies the mind', 'attends improperly'],
      ['rationally applies the mind', 'attends properly'],
      ['applies the mind irrationally', 'attends improperly'],
      ['applies the mind rationally', 'attends properly'],
      ['irrationally apply the mind', 'attend improperly'],
      ['rationally apply the mind', 'attend properly'],
      // AN 3.68 has "apply the mind rationally *on*" where every other line has "to"; "attend"
      // only takes "to", so the preposition travels with the verb rather than being stranded.
      ['apply the mind rationally on', 'attend properly to'],
      ['apply the mind irrationally', 'attend improperly'],
      ['apply the mind rationally', 'attend properly'],
      // yoniso standing alone
      ['irrationally', 'improperly'],
      ['rationally', 'properly'],
      ['irrational', 'improper'],
      ['rational', 'proper'],
    ],
  },
  // ── Saṅkhāra ────────────────────────────────────────────────────────────────
  // Where the group sits settles nothing — no rule above produces or consumes "choice", "action
  // formation" or "make". The order *within* it does. abhisankharoti-generate has to run first,
  // because its forms span Bhikkhu Sujato's verb and the noun it governs together ("makes hurtful
  // choices"), and once sankhara-action-formations has rewritten that noun the span is locked. The
  // other way round would need a form of bare "make", putting the corpus's ~2,300 other "make"s
  // into the closed rule's untriaged queue at every refresh.
  {
    id: 'abhisankharoti-generate',
    why: 'Bhikkhu Sujato governs his "choices" with "make" ("makes hurtful choices", "stopped making ' +
      'karmic choices"). Once sankhara-action-formations has turned that noun into "action ' +
      'formations", "make" no longer governs it in English, so this rule moves the verb to ' +
      '"generate". Each form therefore carries the verb, the noun and whatever adjective sits ' +
      'between them, writing the finished phrase in one step — this rule, not ' +
      'sankhara-action-formations, is what renders saṅkhāra in these 54 segments. Twenty forms ' +
      'because that is how many distinct shapes he uses; two have a pronoun where the others have ' +
      'the noun, SN 56.42 having already named it. Snp 3.12\'s "karmic choices" drops its ' +
      'adjective, since "action" already says what "karmic" was there to say and the Pali is the ' +
      'bare Saṅkhāre uparundhiya. Closed, because a bare "make" form would claim one of the ' +
      'commonest verbs in the corpus, and so that a new shape stops for review.',
    mode: 'allow',
    predicate: /abhisaṅkhar/i,
    forms: [
      ['makes both hurtful and pleasing choices', 'generates both hurtful and pleasing action formations'],
      ['make an imperturbable choice', 'generate an imperturbable action formation'],
      ['making karmic choices', 'generating action formations'],
      ['makes hurtful choices', 'generates hurtful action formations'],
      ['makes pleasing choices', 'generates pleasing action formations'],
      ['continue to make them', 'continue to generate them'],
      ['made these choices', 'generated these action formations'],
      ['making such choices', 'generating such action formations'],
      ['make such choices', 'generate such action formations'],
      ['made such choices', 'generated such action formations'],
      ['makes a good choice', 'generates a good action formation'],
      ['make good choices', 'generate good action formations'],
      ['make a bad choice', 'generate a bad action formation'],
      ['make a good choice', 'generate a good action formation'],
      ['stop making them', 'stop generating them'],
      ['making choices', 'generating action formations'],
      ['makes a choice', 'generates an action formation'],
      ['make a choice', 'generate an action formation'],
      ['made choices', 'generated action formations'],
      ['make choices', 'generate action formations'],
    ],
  },
  {
    id: 'sankhara-action-formations',
    why: 'Bhikkhu Sujato renders saṅkhāra as "choices" in the aggregate and dependent-origination ' +
      'senses; this app prefers "action formations". The suttas define the term: SN 22.56 makes ' +
      'the aggregate the six classes of intention, and AN 6.63 says intention is kamma — so what ' +
      'is formed is kamma, and kamma is action. Only that sense moves; his other renderings of the ' +
      'word are left alone and this rule never reaches them — "conditions"/"conditioned phenomena" ' +
      'for sabbe saṅkhārā, "physical process" for kāyasaṅkhāra, "life force" for āyusaṅkhāra, ' +
      '"intentions" for manosaṅkhāra. The plural is upstream\'s and the Pali\'s: saṅkhārā is the ' +
      'only one of the five aggregates that is grammatically plural, and 244 sites already agree ' +
      'with it. "Action" is also his word for sammākammanta, the path factor, but the two are ' +
      'sentences or paragraphs apart wherever they co-occur; the five lines where the collision was ' +
      'tight have segment overrides. Open: 17 denials out of 957 segments, eleven of them mn120, ' +
      'where saṅkhārupapatti is rebirth deliberately aspired to and the sutta turns on the choosing.',
    mode: 'deny',
    predicate: /saṅkhār/i,
    forms: [
      // SN 22's blurb names the aggregate and then glosses it — "…; the choice to perform an act)".
      // That second "choices" is Bhikkhu Sujato explaining the term, and moving it too would make
      // the gloss define the term with itself. Forms match longest-first, so this claims the phrase
      // before the bare "choice" below. "Decision" rather than "volition" or "will", both of which
      // the same sentence already uses.
      ['the choice to perform', 'the decision to perform'],
      // The replacement begins with a vowel where Bhikkhu Sujato's word doesn't, so the article
      // travels with it. No segment needs this today — abhisankharoti-generate carries every "make
      // a choice" — but the rule is open, so a line that gains one would otherwise be rewritten to
      // "a action formation" with nothing to catch it.
      ['a choice', 'an action formation'],
      // saṅkhāradhātu, 8 lines in SN 22. English puts an attributive noun in the singular, and
      // hyphenates it when it is itself two words.
      ['choices element', 'action-formation element'],
      ['choices', 'action formations'],
      ['choice', 'action formation'],
    ],
  },

  // ── Segment overrides ───────────────────────────────────────────────────────
  // These run last, over the term rules' output — so `from` is the post-processed text, not
  // upstream's. `segments: [...]` is for a line the corpus repeats verbatim, where one from/to is
  // the whole decision.
  //
  // Grouped below by what forced the override, under `·· cause ··` sub-banners. Unlike the term
  // families above, this order carries nothing: a segment rule applies last whatever its array
  // position, so the sub-banners are navigation only and regrouping them costs nothing.

  // ·· sampajañña predicate rebuilds ··
  // Its adjective form is a participle, which stands in a list of adjectives but not as a whole
  // predicate, so wherever Bhikkhu Sujato used his "aware" predicatively the clause has to be
  // rebuilt around the noun — which a word-for-word form can't do, and a wider-spanning one can't
  // either, since mendicant-bhikkhu has already locked the "bhikkhu" in the middle of two of them.
  {
    id: 'sampajano-hoti-question',
    kind: 'segment',
    why: 'Kathañca bhikkhu sampajāno hoti, opening the sampajañña section — "how is a bhikkhu ' +
      'clearly comprehending?" reads as a progressive tense, where the noun carries the standing ' +
      'quality. Paired with sampajano-hoti-answer, which closes the same section.',
    segments: ['dn16:2.13.1', 'sn36.7:4.1', 'sn36.8:4.1', 'sn47.2:3.1', 'sn47.35:3.1'],
    from: 'And how is a bhikkhu clearly comprehending? ',
    to: 'And how does a bhikkhu have clear comprehension? ',
  },
  {
    id: 'sampajano-hoti-answer',
    kind: 'segment',
    why: 'Evaṁ kho bhikkhu sampajāno hoti — sampajano-hoti-question’s line as the section’s ' +
      'closing answer, and worded to match it.',
    segments: ['sn47.35:3.5', 'sn36.8:4.3', 'dn16:2.13.3'],
    from: 'That’s how a bhikkhu is clearly comprehending. ',
    to: 'That’s how a bhikkhu has clear comprehension. ',
  },
  {
    id: 'sampajano-situation-they',
    kind: 'segment',
    why: 'Itiha tattha sampajāno hoti. "They are clearly comprehending of the situation" is not a ' +
      'construction English takes — the participle can\'t govern "of". The verb says it plainly ' +
      'instead.',
    segments: ['mn122:9.5', 'mn122:9.12', 'mn122:10.6', 'mn122:10.13', 'mn122:11.3', 'mn122:11.6',
      'mn122:11.9', 'mn122:11.12', 'mn122:12.3', 'mn122:12.5', 'mn122:13.3', 'mn122:13.5',
      'mn122:15.7', 'mn122:15.12', 'mn122:17.4', 'an7.49:3.3', 'an7.49:3.6', 'an7.49:15.3',
      'an7.49:16.3'],
    from: 'In this way they are clearly comprehending of the situation. ',
    to: 'In this way they clearly comprehend the situation. ',
  },
  {
    id: 'sampajano-situation-he',
    kind: 'segment',
    why: 'sampajano-situation-they’s line, as an8.9 has it: singular.',
    segments: ['an8.9:1.9', 'an8.9:2.8'],
    from: 'In this way he’s clearly comprehending of the situation. ',
    to: 'In this way he clearly comprehends the situation. ',
  },
  {
    id: 'sampajano-conception-second',
    kind: 'segment',
    why: 'The four kinds of conception (gabbhāvakkanti), whose Pali alternates sampajāna and ' +
      'asampajāna across all three moments. "Has clear comprehension" pairs with the "without clear ' +
      'comprehension" the negative already produces. The first kind needs no override — it is ' +
      'negative throughout.',
    segments: ['dn28:5.4', 'dn33:1.11.177'],
    from: 'Furthermore, someone is clearly comprehending when conceived in their mother’s womb, but without clear comprehension as they remain there, and without clear comprehension as they emerge. This is the second kind of conception. ',
    to: 'Furthermore, someone has clear comprehension when conceived in their mother’s womb, but without clear comprehension as they remain there, and without clear comprehension as they emerge. This is the second kind of conception. ',
  },
  {
    id: 'sampajano-conception-third',
    kind: 'segment',
    why: 'sampajano-conception-second’s line, for the third kind: clear comprehension through ' +
      'conception and gestation, not through birth.',
    segments: ['dn28:5.5', 'dn33:1.11.178'],
    from: 'Furthermore, someone is clearly comprehending when conceived in their mother’s womb, clearly comprehending as they remain there, but without clear comprehension as they emerge. This is the third kind of conception. ',
    to: 'Furthermore, someone has clear comprehension when conceived in their mother’s womb, with clear comprehension as they remain there, but without clear comprehension as they emerge. This is the third kind of conception. ',
  },
  {
    id: 'sampajano-conception-fourth',
    kind: 'segment',
    why: 'sampajano-conception-second’s line, for the fourth kind: clear comprehension throughout.',
    segments: ['dn28:5.6', 'dn33:1.11.179'],
    from: 'Furthermore, someone is clearly comprehending when conceived in their mother’s womb, clearly comprehending as they remain there, and clearly comprehending as they emerge. This is the fourth kind of conception. ',
    to: 'Furthermore, someone has clear comprehension when conceived in their mother’s womb, with clear comprehension as they remain there, and with clear comprehension as they emerge. This is the fourth kind of conception. ',
  },
  // ·· sampajañña meeting Bhikkhu Sujato's own "comprehend" ··
  // "Clear comprehension" lands beside Bhikkhu Sujato's "comprehend", which is his word for
  // abhisamaya — a different term. Only this one segment has both in the same sentence.
  {
    id: 'sn56-34-abhisamaya-understand',
    kind: 'segment',
    why: 'yathābhūtaṁ abhisamayāya, which Bhikkhu Sujato renders "truly comprehending" — his word for ' +
      'abhisamaya, unrelated to sampajañña. Once sampajañña is "clear comprehension" the two say ' +
      'different things with the same root in one sentence, so abhisamaya moves rather than the ' +
      'app’s own term. "In order to" makes the line parallel to 1.2, the same karaṇīyaṁ ' +
      'construction in the Pali.',
    segment: 'sn56.34:2.1',
    from: '“Bhikkhus, so long as you have not encompassed the four noble truths, regard your burning head or clothes with equanimity, ignore them, and apply extraordinary enthusiasm, effort, zeal, vigor, perseverance, awareness, and clear comprehension to truly comprehending the four noble truths. ',
    to: '“Bhikkhus, so long as you have not encompassed the four noble truths, regard your burning head or clothes with equanimity, ignore them, and apply extraordinary enthusiasm, effort, zeal, vigor, perseverance, awareness, and clear comprehension in order to truly understand the four noble truths. ',
  },
  // ·· samudaya as a noun ··
  // The term rule leaves the noun "origination" alone (26 of its 30 segments are sambhava, not
  // samudaya); these lines are the exception it can't express.
  {
    id: 'samudaya-exclamation-arising',
    kind: 'segment',
    why: '‘Samudayo, samudayo’ — the awakening exclamation. Bhikkhu Sujato reaches for the noun ' +
      '"origination" only here, so samudaya-arising doesn’t catch it and the line contradicts its ' +
      'own sutta: sn12.65:3.7 already reads "this entire mass of suffering arises".',
    segments: ['sn12.10:4.4', 'sn12.65:3.8'],
    from: '‘Origination, origination.’ Such was the vision, knowledge, wisdom, realization, and light that arose in me regarding teachings not learned before from another. ',
    to: '‘Arising, arising.’ Such was the vision, knowledge, wisdom, realization, and light that arose in me regarding teachings not learned before from another. ',
  },
  {
    id: 'samudaya-exclamation-arising-vipassi',
    kind: 'segment',
    why: 'samudaya-exclamation-arising’s line, as sn12.4 tells it of Vipassī.',
    segment: 'sn12.4:13.4',
    from: '‘Origination, origination.’ While Vipassī was intent on awakening, such was the vision, knowledge, wisdom, realization, and light that arose in him regarding teachings not learned before from another. ',
    to: '‘Arising, arising.’ While Vipassī was intent on awakening, such was the vision, knowledge, wisdom, realization, and light that arose in him regarding teachings not learned before from another. ',
  },
  {
    id: 'samudaya-exclamation-arising-dn14',
    kind: 'segment',
    why: 'samudaya-exclamation-arising’s line, as DN 14 tells it of Vipassī.',
    segment: 'dn14:2.19.6',
    from: '‘Origination, origination.’ Such was the vision, knowledge, wisdom, realization, and light that arose in Vipassī, the one intent on awakening, regarding teachings not learned before from another. ',
    to: '‘Arising, arising.’ Such was the vision, knowledge, wisdom, realization, and light that arose in Vipassī, the one intent on awakening, regarding teachings not learned before from another. ',
  },
  // ·· awareness word order ··
  // Places where sati-aware's "mindfully" → "with awareness" lands in a word order English won't
  // take; the phrase is fine, it just has to move.
  {
    id: 'enter-with-awareness',
    kind: 'segment',
    why: 'satova samāpajjāmi — "I with awareness enter into" isn’t English; the phrase moves to the ' +
      'front. an5.27 carries the same line with a trailing elision mark, a different anchor — see ' +
      'enter-with-awareness-elided.',
    segment: 'dn34:1.6.74',
    from: '‘I with awareness enter into and emerge from this composure.’ ',
    to: '‘With awareness, I enter into and emerge from this composure.’ ',
  },
  {
    id: 'enter-with-awareness-elided',
    kind: 'segment',
    why: 'enter-with-awareness’s line, as an5.27 has it: followed by an elision mark.',
    segment: 'an5.27:1.8',
    from: '‘I with awareness enter into and emerge from this composure.’ … ',
    to: '‘With awareness, I enter into and emerge from this composure.’ … ',
  },
  {
    id: 'thag16-10-walk-with-awareness',
    kind: 'segment',
    why: 'Satiṁ upaṭṭhapetvāna, which Bhikkhu Sujato compresses to "very mindfully" — "very with awareness" ' +
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
      'verb.',
    segments: ['thag1.31:1.3', 'thag3.9:2.3', 'thag15.1:12.3'],
    from: 'one should with awareness endure, ',
    to: 'one should endure with awareness, ',
  },
  // ·· paritassanā as a plural noun ··
  // The term rule already puts "Anxieties occupy the mind" into the singular. Its negated twin puts
  // those two words either side of a fifteen-word em-dash clause, which no form can span, and the
  // trailing half can't be a form of its own either — "don’t occupy the mind" is ordinary English
  // in AN 8.6, AN 9.26, MN 36 and SN 35.134. So it is four anchors, one per wording: MN 138 has
  // "the mind" where SN 22.7 has "their mind", and each says it of form and again of consciousness.
  {
    id: 'paritassana-not-occupy-mind-form',
    kind: 'segment',
    why: 'The negated half of MN 138’s paritassanā passage, of form.',
    segment: 'mn138:21.6',
    from: 'Agitations—born of latching on to the changing of form and originating in accordance with natural principles—don’t occupy the mind. ',
    to: 'Agitation—born of latching on to the changing of form and originating in accordance with natural principles—doesn’t occupy the mind. ',
  },
  {
    id: 'paritassana-not-occupy-mind-consciousness',
    kind: 'segment',
    why: 'paritassana-not-occupy-mind-form’s line, of consciousness.',
    segment: 'mn138:21.14',
    from: 'Agitations—born of latching on to the changing of consciousness and originating in accordance with natural principles—don’t occupy the mind. ',
    to: 'Agitation—born of latching on to the changing of consciousness and originating in accordance with natural principles—doesn’t occupy the mind. ',
  },
  {
    id: 'paritassana-not-occupy-their-mind-form',
    kind: 'segment',
    why: 'paritassana-not-occupy-mind-form’s line, as SN 22.7 has it: "their mind".',
    segment: 'sn22.7:6.6',
    from: 'Agitations—born of latching on to the changing of form and originating in accordance with natural principles—don’t occupy their mind. ',
    to: 'Agitation—born of latching on to the changing of form and originating in accordance with natural principles—doesn’t occupy their mind. ',
  },
  {
    id: 'paritassana-not-occupy-their-mind-consciousness',
    kind: 'segment',
    why: 'paritassana-not-occupy-their-mind-form’s line, of consciousness.',
    segment: 'sn22.7:9.4',
    from: 'Agitations—born of latching on to the changing of consciousness and originating in accordance with natural principles—don’t occupy their mind. ',
    to: 'Agitation—born of latching on to the changing of consciousness and originating in accordance with natural principles—doesn’t occupy their mind. ',
  },

  // ·· heading case ··
  // caseAs reads a match as Title Case only when every significant word is capitalized, and counts
  // "it" as significant (it isn't in TITLE_LOWERCASE), so a heading that lowercases "it" reads as a
  // capitalized sentence and the replacement comes back in sentence case. Fixed per heading rather
  // than by adding "it" to that set, which would re-case every rule's headings to solve one.
  {
    id: 'sn43-3-thought-examination-title',
    kind: 'segment',
    why: 'SN 43.3’s title, "Placing the Mind and Keeping it Connected" — the lowercase "it" makes ' +
      'caseAs treat it as a sentence, so vitakka-vicara-thought-examination returns "Thought and ' +
      'examination". This is the sutta’s displayed title, so the case shows in the browse tree.',
    segment: 'sn43.3:0.3',
    from: 'Thought and examination ',
    to: 'Thought and Examination ',
  },
  // The same set read from the other end: caseAs treats a *single-word* match as a capitalized
  // sentence, so sankhara-action-formations' two-word replacement gives "Action formations"
  // wherever Bhikkhu Sujato's one-word "Choices" heads a sutta. Two headings, since the name-tree
  // copy of AN 3.23's title is unreachable — build-corpus prefers the sutta's own 0.N segment.
  //
  // sankhara-action-formations is open, so a sutta upstream retitles to "Choices" would land here
  // sentence-cased without review. Nothing detects that; it is the known price of the open mode.
  {
    id: 'an3-23-action-formations-title',
    kind: 'segment',
    why: 'AN 3.23’s title, "Choices" — a one-word match whose two-word replacement needs Title ' +
      'Case. This is the sutta’s displayed title, so the case shows in the browse tree.',
    segment: 'an3.23:0.3',
    from: 'Action formations ',
    to: 'Action Formations ',
  },
  {
    id: 'sn33-4-action-formations-title',
    kind: 'segment',
    why: 'an3-23-action-formations-title’s problem in SN 33.4, where the heading has a ' +
      'preceding word ("Not Knowing Choices") and only the replaced half loses its case.',
    segment: 'sn33.4:0.3',
    from: 'Not Knowing Action formations ',
    to: 'Not Knowing Action Formations ',
  },

  // ·· saṅkhāra rendered the other way round ··
  // DN 9 pairs ceteti with abhisaṅkharoti, and Bhikkhu Sujato assigns them the opposite way to
  // every other passage in the corpus: his "make a choice" is ceteti here, and "form an intention"
  // is abhisaṅkharoti. Both term rules deny these three segments, since applying them would label
  // each Pali word with the other one's English; the override swaps the two halves instead. Three
  // rules rather than one because the closing punctuation differs — a quoted thought inside single
  // quotes, inside double quotes, and unquoted narration.
  {
    id: 'dn9-cetana-sankhara-question-single',
    kind: 'segment',
    why: 'DN 9’s ceteti/abhisaṅkharoti pair, as the reflected question in single quotes.',
    segment: 'dn9:17.5',
    from: 'Why don’t I neither make a choice nor form an intention?’ ',
    to: 'Why don’t I neither form an intention nor generate an action formation?’ ',
  },
  {
    id: 'dn9-cetana-sankhara-question-double',
    kind: 'segment',
    why: 'dn9-cetana-sankhara-question-single’s line, as the retold question in double quotes.',
    segment: 'dn9:18.9',
    from: 'Why don’t I neither make a choice nor form an intention?” ',
    to: 'Why don’t I neither form an intention nor generate an action formation?” ',
  },
  {
    id: 'dn9-cetana-sankhara-answer',
    kind: 'segment',
    why: 'dn9-cetana-sankhara-question-single’s line, as the narrated answer.',
    segment: 'dn9:17.6',
    from: 'They neither make a choice nor form an intention. ',
    to: 'They neither form an intention nor generate an action formation. ',
  },

  // ·· "action" is already there, for kamma ··
  // sankhara-action-formations' replacement shares a word with Bhikkhu Sujato's rendering of kamma,
  // which costs nothing where "right action" sits sentences away from the aggregate. In these five
  // lines the two land in one clause, and each takes upstream's own other word for the term that is
  // not saṅkhāra.
  {
    id: 'an4-171-instigates-deeds',
    kind: 'segment',
    why: 'kāyasaṅkhāraṁ abhisaṅkharoti, with the bodily/verbal/mental triad written out, so the line ' +
      'reads "the action formation that gives rise to bodily, verbal, and mental action" — the same ' +
      'English word twice in one clause for saṅkhāra and for kamma. "Bodily, verbal, or mental ' +
      'deeds" is Bhikkhu Sujato’s own phrase for kamma (an1.314).',
    segments: ['an4.171:2.1', 'sn12.25:11.1'],
    from: 'By oneself one instigates the action formation that gives rise to bodily, verbal, and mental action, conditioned by which that pleasure and pain arise in oneself. ',
    to: 'By oneself one instigates the action formation that gives rise to bodily, verbal, and mental deeds, conditioned by which that pleasure and pain arise in oneself. ',
  },
  {
    id: 'sn12-37-old-deeds-generated',
    kind: 'segment',
    why: 'Purāṇamidaṁ kammaṁ abhisaṅkhataṁ abhisañcetayitaṁ. Bhikkhu Sujato turns the two past ' +
      'participles into agents — "old deeds … produced by choices and intentions" — which with this ' +
      'app’s noun becomes deeds produced by action formations, saying the same thing twice. Read as ' +
      'participles it says it once: abhisaṅkhata is "generated", the verb abhisankharoti-generate ' +
      'already uses for this root, and abhisañcetayita "intended". Only the three lines whose ' +
      'subject is kamma need this; the other 22 keep upstream’s wording.',
    segment: 'sn12.37:1.3',
    from: 'It’s old deeds, and should be seen as produced by action formations and intentions, as something to be felt. ',
    to: 'It’s old deeds, and should be seen as generated and intended, as something to be felt. ',
  },
  {
    id: 'sn35-146-old-deeds-generated-eye',
    kind: 'segment',
    why: 'sn12-37-old-deeds-generated’s line as SN 35.146 opens the sense fields with it.',
    segment: 'sn35.146:1.4',
    from: 'The eye is old deeds. It should be seen as produced by action formations and intentions, as something to be felt. ',
    to: 'The eye is old deeds. It should be seen as generated and intended, as something to be felt. ',
  },
  {
    id: 'sn35-146-old-deeds-generated-mind',
    kind: 'segment',
    why: 'sn12-37-old-deeds-generated’s line as SN 35.146 closes the sense fields with it, after ' +
      'the elision.',
    segment: 'sn35.146:1.6',
    from: 'mind is old deeds. It should be seen as produced by action formations and intentions, as something to be felt. ',
    to: 'mind is old deeds. It should be seen as generated and intended, as something to be felt. ',
  },

  // ·· a compound this rule is not meant to touch ··
  {
    id: 'snp3-12-stilling-of-all-activities',
    kind: 'segment',
    why: 'sabbasaṅkhārasamatha is "the stilling of all activities" in all thirty other places it ' +
      'appears; Snp 3.12 alone is where Bhikkhu Sujato wrote "choices" for it, so ' +
      'sankhara-action-formations catches the one outlier. The compound is outside this app’s scope ' +
      'for saṅkhāra, so this restores upstream’s own majority wording.',
    segment: 'snp3.12:16.3',
    from: 'through the stilling of all action formations, ',
    to: 'through the stilling of all activities, ',
  },

  // ·· number agreement upstream got wrong ··
  {
    id: 'snp3-12-sankhara-have-faded',
    kind: 'segment',
    why: 'Snp 3.12 reads "When choices has faded away" upstream — a number disagreement that ' +
      'predates this app, and that sankhara-action-formations would otherwise carry forward ' +
      'verbatim as "When action formations has faded away". Every parallel line in the same ' +
      'poem uses the plural verb.',
    segment: 'snp3.12:14.4',
    from: '‘When action formations has faded away and ceased with no residue left behind, there is no origination of suffering’: this is the second contemplation. ',
    to: '‘When action formations have faded away and ceased with no residue left behind, there is no origination of suffering’: this is the second contemplation. ',
  },

  // ·· an idiom the replacement adjective cannot take ··
  // "keen to <verb>" is how Bhikkhu Sujato renders ātappaṁ karoti in AN 3.49, and "ardent" has no
  // such construction. Only this sutta uses it; everywhere else "keen" is predicative or
  // attributive, where the adjective stands on its own. The gerund is the nearest English offers.
  {
    id: 'an3-49-ardent-in-preventing',
    kind: 'segment',
    why: 'ātappaṁ karaṇīyaṁ, "one should make an effort" — Bhikkhu Sujato\'s "you should be keen ' +
      'to prevent" takes an infinitive that "ardent" cannot govern. Rebuilt on the gerund.',
    segment: 'an3.49:1.3',
    from: 'You should be ardent to prevent bad, unskillful qualities from arising. You should be ardent to give rise to skillful qualities. And you should be ardent to endure physical pain—sharp, severe, acute, unpleasant, disagreeable, life-threatening. ',
    to: 'You should be ardent in preventing bad, unskillful qualities from arising. You should be ardent in giving rise to skillful qualities. And you should be ardent in enduring physical pain—sharp, severe, acute, unpleasant, disagreeable, life-threatening. ',
  },
  {
    id: 'an3-49-ardent-in-preventing-answer',
    kind: 'segment',
    why: 'an3-49-ardent-in-preventing’s line as the section’s answer, ātappaṁ karoti.',
    segment: 'an3.49:2.1',
    from: 'It’s a bhikkhu who is ardent to prevent bad, unskillful qualities from arising. They’re ardent to give rise to skillful qualities. And they’re ardent to endure physical pain—sharp, severe, acute, unpleasant, disagreeable, life-threatening. ',
    to: 'It’s a bhikkhu who is ardent in preventing bad, unskillful qualities from arising. They’re ardent in giving rise to skillful qualities. And they’re ardent in enduring physical pain—sharp, severe, acute, unpleasant, disagreeable, life-threatening. ',
  },

  // ·· samādhi's participle as a past perfect ··
  // "Immersed" doubles as an intransitive verb, so Bhikkhu Sujato can write "when my mind had
  // immersed in samādhi". "Composed" is only ever the state, and "my mind had composed" reads as
  // authorship. The copula has to come back — which is what he writes himself in the same formula
  // elsewhere ("when my mind had become immersed").
  {
    id: 'mind-had-become-composed-past-lives',
    kind: 'segment',
    why: 'Evaṁ samāhite citte … pubbenivāsānussatiñāṇāya cittaṁ abhininnāmesiṁ — the first of the ' +
      'three knowledges, in the first person. The two below are the same line ending in the other ' +
      'two knowledges.',
    segments: ['mn85:34-37.5', 'mn100:34.1', 'mn19:18.1', 'mn36:38.1', 'an8.11:14.1'],
    from: 'When my mind had composed in samādhi like this—purified, bright, flawless, rid of corruptions, pliable, workable, steady, and imperturbable—I extended it toward recollection of past lives. ',
    to: 'When my mind had become composed in samādhi like this—purified, bright, flawless, rid of corruptions, pliable, workable, steady, and imperturbable—I extended it toward recollection of past lives. ',
  },
  {
    id: 'mind-had-become-composed-rebirth',
    kind: 'segment',
    why: 'mind-had-become-composed-past-lives’s line, ending in the knowledge of death and rebirth.',
    segments: ['mn85:38.1', 'mn100:36-38.1', 'mn36:40.1', 'an8.11:16.1'],
    from: 'When my mind had composed in samādhi like this—purified, bright, flawless, rid of corruptions, pliable, workable, steady, and imperturbable—I extended it toward knowledge of the death and rebirth of sentient beings. ',
    to: 'When my mind had become composed in samādhi like this—purified, bright, flawless, rid of corruptions, pliable, workable, steady, and imperturbable—I extended it toward knowledge of the death and rebirth of sentient beings. ',
  },
  {
    id: 'mind-had-become-composed-defilements',
    kind: 'segment',
    why: 'mind-had-become-composed-past-lives’s line, ending in the knowledge of the ending of defilements.',
    segments: ['mn85:40.1', 'mn100:39.1', 'mn36:42.1', 'mn112:19.1', 'an8.11:18.1'],
    from: 'When my mind had composed in samādhi like this—purified, bright, flawless, rid of corruptions, pliable, workable, steady, and imperturbable—I extended it toward knowledge of the ending of defilements. ',
    to: 'When my mind had become composed in samādhi like this—purified, bright, flawless, rid of corruptions, pliable, workable, steady, and imperturbable—I extended it toward knowledge of the ending of defilements. ',
  },

  // ·· one formula, two of samādhi's slots ··
  // Bhikkhu Sujato uses "immerse" for the santhapeti/sannisādeti/ekodi-karoti/samādahati series,
  // and the term rule gives that "collect" — except in the past tense, which takes the participle
  // "composed" and splits one stock formula across two English words. These lines take "collected"
  // so all seven read alike.
  {
    id: 'collected-my-mind-internally',
    kind: 'segment',
    why: 'ajjhattameva cittaṁ saṇṭhapesiṁ sannisādesiṁ ekodiṁ akāsiṁ samādahaṁ, first person — the ' +
      'same series that reads "still, settle, unify, and collect their mind" elsewhere.',
    segments: ['mn19:8.11', 'mn19:9-10.12'],
    from: 'So I stilled, settled, unified, and composed my mind internally. ',
    to: 'So I stilled, settled, unified, and collected my mind internally. ',
  },
  {
    id: 'collected-my-mind-same-subject',
    kind: 'segment',
    why: 'collected-my-mind-internally’s series, as MN 36 has it: in samādhi, on the same meditation subject.',
    segment: 'mn36:45.6',
    from: 'When that talk was finished, I stilled, settled, unified, and composed my mind in samādhi internally in the same meditation subject as a basis of composure as before, in which I regularly meditate.” ',
    to: 'When that talk was finished, I stilled, settled, unified, and collected my mind in samādhi internally in the same meditation subject as a basis of composure as before, in which I regularly meditate.” ',
  },

  // ·· vedanā's participle standing beside its noun ··
  // Bhikkhu Sujato writes both slots as "feeling", and DN 15's and MN 45's five lines are the only
  // places the participle and the noun share one — vedanaṁ vedayamāno elsewhere is alone on its
  // line, and denied instead.
  {
    id: 'dn15-when-feeling-pleasant',
    kind: 'segment',
    why: 'Sukhaṁ vedanaṁ vedayamāno — vedayamāno is the participle, which stays "feeling"; only ' +
      'the vedanā beside it becomes "sensation".',
    segment: 'dn15:29.4',
    from: 'When sensation a pleasant sensation they think: ‘This is my self.’ ',
    to: 'When feeling a pleasant sensation they think: ‘This is my self.’ ',
  },
  {
    id: 'dn15-when-feeling-painful',
    kind: 'segment',
    why: 'Dukkhaṁ vedanaṁ vedayamāno — the painful member of the same three lines.',
    segment: 'dn15:29.6',
    from: 'When sensation a painful sensation they think: ‘This is my self.’ ',
    to: 'When feeling a painful sensation they think: ‘This is my self.’ ',
  },
  {
    id: 'dn15-when-feeling-neutral',
    kind: 'segment',
    why: 'Adukkhamasukhaṁ vedanaṁ vedayamāno — the neutral member of the same three lines.',
    segment: 'dn15:29.8',
    from: 'When sensation a neutral sensation they think: ‘This is my self.’ ',
    to: 'When feeling a neutral sensation they think: ‘This is my self.’ ',
  },
  {
    id: 'mn45-sensual-pleasures-feeling',
    kind: 'segment',
    why: 'Kāmahetu… dukkhā tibbā kaṭukā vedanā vediyāmi — vediyāmi is the finite verb, which stays ' +
      '"feeling"; the vedanā it governs becomes "sensations".',
    segment: 'mn45:3.12',
    from: '‘This is that future danger that those ascetics and brahmins saw. For it is because of sensual pleasures that I’m sensation painful, sharp, severe, acute sensations.’ ',
    to: '‘This is that future danger that those ascetics and brahmins saw. For it is because of sensual pleasures that I’m feeling painful, sharp, severe, acute sensations.’ ',
  },
  {
    id: 'mn45-creeper-seed-feeling',
    kind: 'segment',
    why: 'The same sentence in the camel’s foot creeper simile that closes the sutta.',
    segment: 'mn45:4.21',
    from: 'It’s because of that camel’s foot creeper seed that I’m sensation painful, sharp, severe, acute sensations.’ ',
    to: 'It’s because of that camel’s foot creeper seed that I’m feeling painful, sharp, severe, acute sensations.’ ',
  },

  // ·· a pun on the verb the noun swap leaves behind ··
  // SN 22.79 and MN 43 both derive vedanā from its verb, which Bhikkhu Sujato's "It feels; that's
  // why it's called 'feeling'" carries across intact. vedana-sensation rewrites only the noun,
  // stranding the pun ("It feels… called 'sensation'"), so each paragraph's verb moves with it.
  // MN 43's next paragraph is the identical derivation for saññā, so every line of the vedanā one
  // has to hold the same shape.
  {
    id: 'vedana-etymology-derivation',
    kind: 'segment',
    why: 'Vedayatīti kho, bhikkhave, tasmā ‘vedanā’ti vuccati — the derivation itself, so the verb ' +
      'has to share a root with the noun the rule now uses.',
    segments: ['sn22.79:3.2', 'sn22.79:3.5'],
    from: 'It feels; that’s why it’s called ‘sensation’. ',
    to: 'It senses; that’s why it’s called ‘sensation’. ',
  },
  {
    id: 'vedana-etymology-question',
    kind: 'segment',
    why: 'Kiñca vedayati / Kiñca vedeti — the question each derivation answers, kept in its verb. ' +
      'MN 43 words it exactly as SN 22.79 does, so one rule covers both.',
    segments: ['sn22.79:3.3', 'mn43:7.4'],
    from: 'And what does it feel? ',
    to: 'And what does it sense? ',
  },
  {
    id: 'vedana-etymology-answer',
    kind: 'segment',
    why: 'Sukhampi vedayati / Sukhampi vedeti — the answer, in the same verb as its question, and ' +
      'again worded identically in both suttas.',
    segments: ['sn22.79:3.4', 'mn43:7.5'],
    from: 'It feels pleasure, pain, and neutral. ',
    to: 'It senses pleasure, pain, and neutral. ',
  },
  {
    id: 'mn43-vedana-etymology-open',
    kind: 'segment',
    why: '‘Vedeti vedetī’ti kho, āvuso, tasmā vedanāti vuccati — Sāriputta’s derivation opening ' +
      'the exchange. MN 43 puts the clauses the other way round from SN 22.79, so it needs its own ' +
      'rule rather than joining the two above.',
    segment: 'mn43:7.3',
    from: '“It’s called sensation because it feels. ',
    to: '“It’s called sensation because it senses. ',
  },
  {
    id: 'mn43-vedana-etymology-close',
    kind: 'segment',
    why: 'The same derivation repeated to close the exchange, as mn43:8.6 does for saññā.',
    segment: 'mn43:7.6',
    from: 'It’s called sensation because it feels.” ',
    to: 'It’s called sensation because it senses.” ',
  },
];
