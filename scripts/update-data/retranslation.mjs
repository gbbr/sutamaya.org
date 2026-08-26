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
//   standalone terms   mendicant-bhikkhu, immersion-concentration, jhana-pali,
//                      patisambhida-analytical-knowledge, dhamma-the-dhamma, atapi-ardent
//   mindfulness        satipatthana-establishment-of-mindfulness
//   arising / passing  samudaya-arising, vaya-passing-away, atthangama-disappearing,
//                      udayabbaya-arising-passing-away
//   change             viparinama-annathatta-change-unstable, viparinama-anuparivatti-changing
//   agitation          paritassati-agitated
//   thought            vitakka-vicara-thought-examination
//   attention          yoniso-proper-attention
//   saṅkhāra           abhisankharoti-generate, sankhara-pali
//   segment overrides  one line each, applied after the term rules; sub-grouped by cause, order
//                      immaterial
//   blurb openers      blurb-openers, applied last — trims the redundant frame off a group
//                      description's opening sentence

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
    id: 'jhana-pali',
    why: 'Bhikkhu Sujato renders jhāna as "absorption" and the verb jhāyati as "practice ' +
      'absorption"; this app keeps the Pali, as it does for bhikkhu, Dhamma and saṅkhāra. No sutta ' +
      'glosses jhāna with a synonym — it is defined by the formula it stands in ("quite secluded ' +
      'from sensual pleasures … rapture and bliss born of seclusion, with thought and examination"), ' +
      'so every English candidate names what the translator takes the state to be like rather than ' +
      'what the texts say it is. Bodhi, Ñāṇamoli and Thanissaro all leave the word untranslated; ' +
      'with inline Pali and a docked dictionary on the page, so does this app. The verb goes with ' +
      'the noun — iti78 and thag16.7 name "the four jhānas" and end lines with "who practice ' +
      'absorption" otherwise — and takes the noun rather than "meditate", which the corpus already ' +
      'spends some 2,000 times on viharati and others. The plural is anglicised (jhānas, not ' +
      'jhānā) because the corpus needs "the four jhānas" and "these jhānas", determiners the Pali ' +
      'plural cannot take; upstream writes it that way itself at an-blurbs:an4.124. Open with an ' +
      'empty deny list: all 965 segments carrying "absorption"/"absorptions" translate jhāna or ' +
      'jhāyati, with no homonym anywhere in the corpus. His "absorbed" is left alone — 10 of its ' +
      '16 segments are the dye simile (rajanaṁ paṭiggaṇheyya), two are samādhi, and the four that ' +
      'are jhāna already read as verse ("absorbed in jhāna", "Absorbed, rid of hopes").',
    mode: 'deny',
    predicate: /jhān|jhāy/i,
    forms: [
      // The SN 45 and SN 53 blurbs gloss the term with the Pali they are about to be given —
      // "absorption meditation (jhāna)", "the four absorptions (jhānas)" — which with the Pali
      // kept would define the word with itself, so the parenthesis goes. Forms match longest-first,
      // so these claim their phrase before the bare ones below; each carries the following word
      // because a form has to end on a word boundary and a closing parenthesis is not one. The
      // markup is upstream's own and is matched literally: should either blurb be reworded, the
      // form stops matching and the redundancy comes back, which nothing detects.
      ['absorption meditation (<i lang=\'pi\' translate=\'no\'>jhāna</i>), which',
        'jhāna, which'],
      ['absorptions (<i lang=\'pi\' translate=\'no\'>jhānas</i>) enables',
        'jhānas enables'],
      // His expansion of a bare jhāyati/jhāyanti: MN 50 and AN 6.46's "We practice absorption
      // meditation!", and three blurbs. "We practice jhāna!" says it without the gloss and leaves
      // the fourfold pun that follows — jhāyanti pajjhāyanti nijjhāyanti apajjhāyanti, "they
      // meditate and concentrate and contemplate and ruminate" — standing on its own.
      ['absorption meditation', 'jhāna'],
      // The same expansion the other way round, in two AN/MN blurbs — "profound meditation
      // absorption", "a particular meditative absorption". The qualifier goes with the gloss.
      ['meditation absorption', 'jhāna'],
      ['meditative absorption', 'jhāna'],
      ['absorptions', 'jhānas'],
      ['absorption', 'jhāna'],
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
  // ── Mindfulness ─────────────────────────────────────────────────────────────
  // sati itself is left as Bhikkhu Sujato has it ("mindfulness"/"mindful"), and so is sampajañña
  // ("situational awareness"). Only the compound is retranslated, so this group holds one rule.
  {
    id: 'satipatthana-establishment-of-mindfulness',
    why: 'Bhikkhu Sujato renders satipaṭṭhāna as "mindfulness meditation"; this app prefers ' +
      '"establishment of mindfulness", the compound read literally (sati-upaṭṭhāna) and the ' +
      'standard scholarly rendering — Bhikkhu Bodhi\'s in the Connected and Numerical Discourses, ' +
      'and Anālayo\'s. Open with an empty deny list: all 382 segments carrying the phrase are the ' +
      'term. The plural form absorbs "kinds of" rather than reading "the four kinds of ' +
      'establishments of mindfulness"; the bare singular carries its own article, and the two ' +
      'preposition forms exist so a title keeps that article lowercase ("The Longer Discourse on ' +
      'the Establishment of Mindfulness").',
    mode: 'deny',
    predicate: /satipaṭṭhān/i,
    forms: [
      ['kinds of mindfulness meditation', 'establishments of mindfulness'],
      ['kind of mindfulness meditation', 'establishment of mindfulness'],
      ['and mindfulness meditation', 'and the establishment of mindfulness'],
      ['on mindfulness meditation', 'on the establishment of mindfulness'],
      ['mindfulness meditations', 'establishments of mindfulness'],
      ['mindfulness meditation', 'the establishment of mindfulness'],
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
  // Where the group sits settles nothing — no rule above produces or consumes "choice", "saṅkhāra"
  // or "make". The order *within* it does. abhisankharoti-generate has to run first,
  // because its forms span Bhikkhu Sujato's verb and the noun it governs together ("makes hurtful
  // choices"), and once sankhara-pali has rewritten that noun the span is locked.
  // The other way round would need a form of bare "make", putting the corpus's ~2,300 other "make"s
  // into the closed rule's untriaged queue at every refresh.
  {
    id: 'abhisankharoti-generate',
    why: 'Bhikkhu Sujato governs his "choices" with "make" ("makes hurtful choices", "stopped making ' +
      'karmic choices"). Once sankhara-pali has turned that noun into "saṅkhāras", ' +
      '"make" no longer governs it in English, so this rule moves the verb to ' +
      '"generate". Each form therefore carries the verb, the noun and whatever adjective sits ' +
      'between them, writing the finished phrase in one step — this rule, not ' +
      'sankhara-pali, is what renders saṅkhāra in these 54 segments. Twenty forms ' +
      'because that is how many distinct shapes he uses; two have a pronoun where the others have ' +
      'the noun, SN 56.42 having already named it. Snp 3.12\'s "karmic choices" drops its ' +
      'adjective, since the Pali is the bare Saṅkhāre uparundhiya and saṅkhāra already carries ' +
      'the kammic sense. Closed, because a bare "make" form would claim one of ' +
      'the commonest verbs in the corpus, and so that a new shape stops for review.',
    mode: 'allow',
    predicate: /abhisaṅkhar/i,
    forms: [
      ['makes both hurtful and pleasing choices', 'generates both hurtful and pleasing saṅkhāras'],
      ['make an imperturbable choice', 'generate an imperturbable saṅkhāra'],
      ['making karmic choices', 'generating saṅkhāras'],
      ['makes hurtful choices', 'generates hurtful saṅkhāras'],
      ['makes pleasing choices', 'generates pleasing saṅkhāras'],
      ['continue to make them', 'continue to generate them'],
      ['made these choices', 'generated these saṅkhāras'],
      ['making such choices', 'generating such saṅkhāras'],
      ['make such choices', 'generate such saṅkhāras'],
      ['made such choices', 'generated such saṅkhāras'],
      ['makes a good choice', 'generates a good saṅkhāra'],
      ['make good choices', 'generate good saṅkhāras'],
      ['make a bad choice', 'generate a bad saṅkhāra'],
      ['make a good choice', 'generate a good saṅkhāra'],
      ['stop making them', 'stop generating them'],
      ['making choices', 'generating saṅkhāras'],
      ['makes a choice', 'generates a saṅkhāra'],
      ['make a choice', 'generate a saṅkhāra'],
      ['made choices', 'generated saṅkhāras'],
      ['make choices', 'generate saṅkhāras'],
    ],
  },
  {
    id: 'sankhara-pali',
    why: 'Bhikkhu Sujato renders saṅkhāra as "choices" in the aggregate and dependent-origination ' +
      'senses; this app keeps the Pali, as it does for bhikkhu and Dhamma. Every English candidate ' +
      'takes one of the term\'s senses and drops the rest: "choices" is selective where saṁ + √kar ' +
      'is productive, and cannot cover the breath or the life force; "volitional formations" and ' +
      '"constructions" cover those but say nothing to a reader who has not already read Bhikkhu ' +
      'Bodhi. The reader has inline Pali and a docked dictionary, so the untranslated word gives ' +
      'them the whole range instead of one sense of it. Only that sense moves; his other ' +
      'renderings of the word are left alone and this rule never reaches them — ' +
      '"conditions"/"conditioned phenomena" for sabbe saṅkhārā, "physical process" for ' +
      'kāyasaṅkhāra, "life force" for āyusaṅkhāra, "intentions" for manosaṅkhāra. The plural is ' +
      'anglicised rather than the Pali saṅkhārā, because the corpus needs "a saṅkhāra", "such ' +
      'saṅkhāras" and "the saṅkhāra element" — English determiners the Pali plural cannot take. ' +
      'Open: 17 denials out of 957 segments, eleven of them mn120, where saṅkhārupapatti is ' +
      'rebirth deliberately aspired to and the sutta turns on the choosing.',
    mode: 'deny',
    predicate: /saṅkhār/i,
    forms: [
      // SN 22's blurb names the aggregate and then glosses it — "…; the choice to perform an act)".
      // That second "choices" is Bhikkhu Sujato explaining the term, and leaving it in Pali would
      // make the gloss define the term with itself. Forms match longest-first, so this claims the
      // phrase before the bare "choice" below. "Decision" rather than "volition" or "will", both of
      // which the same sentence already uses.
      // SN 22's blurb walks the five aggregates as "English (Pali, i.e. gloss)" — "form (rūpa, …)",
      // "feeling (vedanā, …)". Keeping the Pali would make this entry gloss saṅkhāra with saṅkhārā,
      // so the parenthesised Pali goes and the gloss it introduces stays. The markup is upstream's
      // own and is matched literally; should the blurb be reworded, this form stops matching and
      // the bare "choices" form below produces the redundancy again, which nothing detects.
      ['choices (<i lang=\'pi\' translate=\'no\'>saṅkhārā</i>, i.e. intention',
        'saṅkhāras (i.e. intention'],
      ['the choice to perform', 'the decision to perform'],
      // The SN 12.38–40 blurb, three identical lines: "Intentions or choices are the force that
      // propels consciousness from one life to the next." The doublet is Bhikkhu Sujato equating
      // cetanā with the saṅkhāra link, which needs saying while saṅkhāra reads as "choices"; with
      // the Pali kept it reads as two different things instead of one, so the gloss goes and the
      // sutta's own word stands alone. A form rather than a segment override because overrides
      // resolve through sutta-only ids and this line lives in the blurb tree.
      ['intentions or choices', 'intentions'],
      // saṅkhāradhātu, 8 lines in SN 22. English puts an attributive noun in the singular.
      ['choices element', 'saṅkhāra element'],
      ['choices', 'saṅkhāras'],
      ['choice', 'saṅkhāra'],
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
    to: 'Why don’t I neither form an intention nor generate a saṅkhāra?’ ',
  },
  {
    id: 'dn9-cetana-sankhara-question-double',
    kind: 'segment',
    why: 'dn9-cetana-sankhara-question-single’s line, as the retold question in double quotes.',
    segment: 'dn9:18.9',
    from: 'Why don’t I neither make a choice nor form an intention?” ',
    to: 'Why don’t I neither form an intention nor generate a saṅkhāra?” ',
  },
  {
    id: 'dn9-cetana-sankhara-answer',
    kind: 'segment',
    why: 'dn9-cetana-sankhara-question-single’s line, as the narrated answer.',
    segment: 'dn9:17.6',
    from: 'They neither make a choice nor form an intention. ',
    to: 'They neither form an intention nor generate a saṅkhāra. ',
  },

  // ·· a definition that needs the Pali it derives from ··
  {
    id: 'sn22-79-sankhata-gloss',
    kind: 'segment',
    why: 'SN 22.79 derives the name of the aggregate from what it does — saṅkhataṁ abhisaṅkharonti, ' +
      'they construct the constructed. With saṅkhāra kept in Pali the line reads "saṅkhāras produce ' +
      'conditioned phenomena; that’s why they’re called saṅkhāras", which names the term twice and ' +
      'explains it once, leaving the derivation invisible. Naming saṅkhata beside its English puts ' +
      'the shared root back in front of the reader, which is the whole point of the passage. Twice, ' +
      'since the sutta states it before the analysis and again after it.',
    segments: ['sn22.79:5.2', 'sn22.79:5.5'],
    from: 'Saṅkhāras produce conditioned phenomena; that’s why they’re called ‘saṅkhāras’. ',
    to: 'Saṅkhāras produce the conditioned (saṅkhata); that’s why they’re called ‘saṅkhāras’. ',
  },
  {
    id: 'sn22-79-even-sankharas',
    kind: 'segment',
    why: 'The fourth clause of SN 22.79’s analysis turns the term on itself — saṅkhāre ' +
      'saṅkhārattāya saṅkhataṁ abhisaṅkharonti, saṅkhāras construct even saṅkhāras. Named three ' +
      'times in one clause with nothing marking the recursion, it reads as a mistake rather than ' +
      'as the point; "Even" says the sentence means what it says. The other four clauses are ' +
      'untouched.',
    segment: 'sn22.79:5.4',
    from: 'Form is a conditioned phenomenon; saṅkhāras are what make it into form. Feeling is a conditioned phenomenon; saṅkhāras are what make it into feeling. Perception is a conditioned phenomenon; saṅkhāras are what make it into perception. Saṅkhāras are conditioned phenomena; saṅkhāras are what make them into saṅkhāras. Consciousness is a conditioned phenomenon; saṅkhāras are what make it into consciousness. ',
    to: 'Form is a conditioned phenomenon; saṅkhāras are what make it into form. Feeling is a conditioned phenomenon; saṅkhāras are what make it into feeling. Perception is a conditioned phenomenon; saṅkhāras are what make it into perception. Even saṅkhāras are conditioned phenomena; saṅkhāras are what make them into saṅkhāras. Consciousness is a conditioned phenomenon; saṅkhāras are what make it into consciousness. ',
  },

  // ·· number the aggregate is stated in ··
  // saṅkhārā is grammatically plural and the corpus says so everywhere but these lines, where
  // Bhikkhu Sujato's own "choice"/"choices" varies. The Pali doesn't carry the slip the way an
  // English abstract noun did, so these align the odd ones with their own parallels.
  {
    id: 'mn9-three-kinds-of-sankharas',
    kind: 'segment',
    why: 'MN 9 alone writes the singular in the formula that SN 12.2, 12.27, 12.28 and 12.33 all ' +
      'state in the plural ("There are three kinds of saṅkhāras").',
    segment: 'mn9:62.2',
    from: 'There are these three kinds of saṅkhāra. ',
    to: 'There are these three kinds of saṅkhāras. ',
  },
  {
    id: 'mn131-aggregate-list-past-delight',
    kind: 'segment',
    why: 'MN 131’s abbreviated aggregate list drops to the singular where every other list in the ' +
      'corpus is plural. Four rules, since the four lines differ by mustering or not and by past ' +
      'or future.',
    segment: 'mn131:4.2',
    from: 'You muster delight there, thinking: ‘I had such form in the past.’ … ‘I had such feeling … perception … saṅkhāra … consciousness in the past.’ ',
    to: 'You muster delight there, thinking: ‘I had such form in the past.’ … ‘I had such feeling … perception … saṅkhāras … consciousness in the past.’ ',
  },
  {
    id: 'mn131-aggregate-list-past-no-delight',
    kind: 'segment',
    why: 'mn131-aggregate-list-past-delight’s line, where the delight is not mustered.',
    segment: 'mn131:5.2',
    from: 'You don’t muster delight there, thinking: ‘I had such form in the past.’ … ‘I had such feeling … perception … saṅkhāra … consciousness in the past.’ ',
    to: 'You don’t muster delight there, thinking: ‘I had such form in the past.’ … ‘I had such feeling … perception … saṅkhāras … consciousness in the past.’ ',
  },
  {
    id: 'mn131-aggregate-list-future-delight',
    kind: 'segment',
    why: 'mn131-aggregate-list-past-delight’s line, told of the future.',
    segment: 'mn131:6.2',
    from: 'You muster delight there, thinking: ‘May I have such form in the future.’ … ‘May I have such feeling … perception … saṅkhāra … consciousness in the future.’ ',
    to: 'You muster delight there, thinking: ‘May I have such form in the future.’ … ‘May I have such feeling … perception … saṅkhāras … consciousness in the future.’ ',
  },
  {
    id: 'mn131-aggregate-list-future-no-delight',
    kind: 'segment',
    why: 'mn131-aggregate-list-past-delight’s line, told of the future and not mustered.',
    segment: 'mn131:7.2',
    from: 'You don’t muster delight there, thinking: ‘May I have such form in the future.’ … ‘May I have such feeling … perception … saṅkhāra … consciousness in the future.’ ',
    to: 'You don’t muster delight there, thinking: ‘May I have such form in the future.’ … ‘May I have such feeling … perception … saṅkhāras … consciousness in the future.’ ',
  },
  {
    id: 'any-kind-of-sankhara-at-all',
    kind: 'segment',
    why: '"Any kind of X at all" takes the singular for every other aggregate — "any kind of form ' +
      'at all", "any kind of feeling at all" — and only saṅkhāra reads plural after it. The ' +
      'summing "all saṅkhāras" later in the same sentence stays plural, as it does there too. ' +
      'SN 22.95 is deliberately left alone: its sentence carries on with "examining them ' +
      'properly. And they appear to them…", so singularising only the head would leave the ' +
      'pronouns disagreeing with it.',
    segments: ['mn109:8.5', 'sn22.48:1.8', 'sn22.48:2.5', 'sn22.59:9.2', 'sn22.82:6.5'],
    from: 'Any kind of saṅkhāras at all … ',
    to: 'Any kind of saṅkhāra at all … ',
  },
  {
    id: 'any-kind-of-sankhara-at-all-you-should-see',
    kind: 'segment',
    why: 'any-kind-of-sankhara-at-all’s phrase, in the full formula as an instruction.',
    segment: 'sn12.70:16.4',
    from: 'You should truly see any kind of saṅkhāras at all—past, future, or present; internal or external; solid or subtle; inferior or superior; far or near: <em>all</em> saṅkhāras—with right understanding: ‘This is not mine, I am not this, this is not my self.’ ',
    to: 'You should truly see any kind of saṅkhāra at all—past, future, or present; internal or external; solid or subtle; inferior or superior; far or near: <em>all</em> saṅkhāras—with right understanding: ‘This is not mine, I am not this, this is not my self.’ ',
  },
  {
    id: 'any-kind-of-sankhara-at-all-they-see',
    kind: 'segment',
    why: 'any-kind-of-sankhara-at-all-you-should-see’s formula, narrated rather than instructed.',
    segment: 'an3.133:2.5',
    from: 'They truly see any kind of saṅkhāras at all—past, future, or present; internal or external; solid or subtle; inferior or superior; far or near: <em>all</em> saṅkhāras—with right understanding: ‘This is not mine, I am not this, this is not my self.’ ',
    to: 'They truly see any kind of saṅkhāra at all—past, future, or present; internal or external; solid or subtle; inferior or superior; far or near: <em>all</em> saṅkhāras—with right understanding: ‘This is not mine, I am not this, this is not my self.’ ',
  },

  // ·· a compound this rule is not meant to touch ··
  {
    id: 'snp3-12-stilling-of-all-activities',
    kind: 'segment',
    why: 'sabbasaṅkhārasamatha is "the stilling of all activities" in all thirty other places it ' +
      'appears; Snp 3.12 alone is where Bhikkhu Sujato wrote "choices" for it, so ' +
      'sankhara-pali catches the one outlier. The compound is outside this app’s ' +
      'scope for saṅkhāra, so this restores upstream’s own majority wording.',
    segment: 'snp3.12:16.3',
    from: 'through the stilling of all saṅkhāras, ',
    to: 'through the stilling of all activities, ',
  },

  // ·· number agreement upstream got wrong ··
  {
    id: 'snp3-12-sankhara-have-faded',
    kind: 'segment',
    why: 'Snp 3.12 reads "When choices has faded away" upstream — a number disagreement that ' +
      'predates this app, and that sankhara-pali would otherwise carry forward ' +
      'verbatim as "When saṅkhāras has faded away". Every parallel line in the same ' +
      'poem uses the plural verb.',
    segment: 'snp3.12:14.4',
    from: '‘When saṅkhāras has faded away and ceased with no residue left behind, there is no origination of suffering’: this is the second contemplation. ',
    to: '‘When saṅkhāras have faded away and ceased with no residue left behind, there is no origination of suffering’: this is the second contemplation. ',
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

  // ·· a preposition the noun cannot take ··
  // DN 19's karuṇaṁ jhānaṁ jhāyati, the Great Steward's four-month retreat, is the only place in
  // the corpus where a jhāna is named after its meditation subject. Bhikkhu Sujato governs it with
  // "on" — "practices the absorption on compassion" — which an English noun of state does not take;
  // jhana-pali swaps the noun and inherits the preposition, so these four lines set it to "of".
  {
    id: 'dn19-jhana-of-compassion-condition',
    kind: 'segment',
    why: 'The Divinity’s condition as the Great Steward first hears it reported.',
    segment: 'dn19:38.8',
    from: '‘Whoever goes on retreat for the four months of the rainy season and practices the jhāna on compassion sees the Divinity and discusses with him.’ ',
    to: '‘Whoever goes on retreat for the four months of the rainy season and practices the jhāna of compassion sees the Divinity and discusses with him.’ ',
  },
  {
    id: 'dn19-jhana-of-compassion-request',
    kind: 'segment',
    why: 'dn19-jhana-of-compassion-condition’s phrase, as the Steward asks the king’s leave — the infinitive.',
    segment: 'dn19:39.7',
    from: '“Sir, I wish to go on retreat for the four months of the rainy season and practice the jhāna on compassion. ',
    to: '“Sir, I wish to go on retreat for the four months of the rainy season and practice the jhāna of compassion. ',
  },
  {
    id: 'dn19-jhana-of-compassion-narration',
    kind: 'segment',
    why: 'dn19-jhana-of-compassion-condition’s phrase, narrated in the past tense once he does it.',
    segment: 'dn19:43.1',
    from: 'Then the Great Steward had a new ceremonial hall built to the east of his citadel, where he went on retreat for the four months of the rainy season and practiced the jhāna on compassion. ',
    to: 'Then the Great Steward had a new ceremonial hall built to the east of his citadel, where he went on retreat for the four months of the rainy season and practiced the jhāna of compassion. ',
  },
  {
    id: 'dn19-jhana-of-compassion-recollection',
    kind: 'segment',
    why: 'dn19-jhana-of-compassion-condition’s phrase again, unquoted, as the Steward recalls what he was told.',
    segment: 'dn19:43.5',
    from: 'whoever goes on retreat for the four months of the rainy season and practices the jhāna on compassion sees the Divinity and discusses with him. ',
    to: 'whoever goes on retreat for the four months of the rainy season and practices the jhāna of compassion sees the Divinity and discusses with him. ',
  },

  // ── Blurb openers ───────────────────────────────────────────────────────────
  // A group blurb renders in ListPane directly under the heading naming that group, so an opener
  // that re-announces the group by name and counts its suttas says twice over what the page has
  // already said — "SN 13 · Comprehension / 11 suttas" above "The “Linked Discourses on the
  // Breakthrough” contains 11 discourses on…". Only the *frame* is redundant, though: upstream
  // continues that same sentence into the topic, and four of these blurbs are that one sentence
  // and nothing else, so this trims the frame and re-leads on the substance rather than dropping
  // the sentence. Every word after the cut is Bhikkhu Sujato's, untouched.
  //
  // Counts are dropped with the frame, except where the sentence argues from the number rather
  // than merely reporting it (SN 49, 50, 53 — "N discourses, which are, however, a mere
  // instantiation of the standard repetition series"). SN 35 is deliberately absent: its opener is
  // about how editions disagree on the count, which is a real observation and not a name echo.
  {
    id: 'blurb-openers',
    kind: 'blurb',
    why: 'Trims the "The “<name>” contains N discourses" frame from the group blurbs that carry ' +
      'one — every one of them in SN, plus DN’s Sīlakkhandhavagga. The name and the count are ' +
      'both already on the page above the blurb (or in the "Part of SN 17 · Gains and Honor" ' +
      'label, where a vagga borrows its saṁyutta’s), so the frame costs a reader the first line ' +
      'of every collection description to tell them what they just clicked.',
    openers: [
      { blurb: 'dn-blurbs:dn-silakkhandhavagga',
        from: 'The Chapter Containing the Section on Ethics (Sīlakkhandhavagga) is a chapter of 13 discourses. Each of these contains ',
        to: 'Each of the thirteen discourses in the Sīlakkhandhavagga contains ' },
      { blurb: 'sn-blurbs:sn-sagathavaggasamyutta',
        from: 'The “Book With Verses” is the first of the five books of the Linked Discourses. It is divided into ',
        to: 'The first of the five books of the Linked Discourses, divided into ' },
      { blurb: 'sn-blurbs:sn-nidanavaggasamyutta',
        from: 'The “Book of Causation” is the second of the five books of the Linked Discourses. It is named after ',
        to: 'The second of the five books of the Linked Discourses, named after ' },
      { blurb: 'sn-blurbs:sn-khandhavaggasamyutta',
        from: 'The “Book of the Aggregates” is the third of the five books of the Linked Discourses. It is named after ',
        to: 'The third of the five books of the Linked Discourses, named after ' },
      { blurb: 'sn-blurbs:sn-salayatanavaggasamyutta',
        from: 'The “Book of the Six Sense Fields” is the fourth of the five books of the Linked Discourses. It is named after ',
        to: 'The fourth of the five books of the Linked Discourses, named after ' },
      { blurb: 'sn-blurbs:sn-mahavaggasamyutta',
        from: 'The “Great Book” is the last and largest of the five books of the Linked Discourses. It consists of ',
        to: 'The last and largest of the five books of the Linked Discourses, consisting of ' },
      { blurb: 'sn-blurbs:sn1',
        from: 'The “Linked Discourses on Deities” contains 81 discourses, each one of which depicts ',
        to: 'Discourses depicting ' },
      { blurb: 'sn-blurbs:sn2',
        from: 'The “Linked Discourses on Godlings” contains 30 discourses, each one of which depicts ',
        to: 'Discourses depicting ' },
      { blurb: 'sn-blurbs:sn3',
        from: 'The “Linked Discourses with the Kosalan” contains 25 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn4',
        from: 'The “Linked Discourses with Māra” contains 25 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn5',
        from: 'The “Linked Discourses with Nuns” contains 10 discourses describing ',
        to: 'Discourses describing ' },
      { blurb: 'sn-blurbs:sn6',
        from: 'The “Linked Discourses with Brahmās” contains 15 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn7',
        from: 'The “Linked Discourses with Brahmins” contains 22 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn8',
        from: 'The “Linked Discourses with Vaṅgīsa” contains 12 discourses with verses spoken by ',
        to: 'Discourses with verses spoken by ' },
      { blurb: 'sn-blurbs:sn9',
        from: 'The “Linked Discourses in the Woods” contains 14 discourses with verses telling ',
        to: 'Discourses with verses telling ' },
      { blurb: 'sn-blurbs:sn10',
        from: 'The “Linked Discourses with Spirits” contains 12 discourses with verses telling ',
        to: 'Discourses with verses telling ' },
      { blurb: 'sn-blurbs:sn11',
        from: 'The “Linked Discourses with Sakka” contains 25 discourses with verses telling ',
        to: 'Discourses with verses telling ' },
      { blurb: 'sn-blurbs:sn12',
        from: 'The “Linked Discourses on Causation” is a major collection containing 93 discourses on ',
        to: 'A major collection of discourses on ' },
      { blurb: 'sn-blurbs:sn13',
        from: 'The “Linked Discourses on the Breakthrough” contains 11 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn14',
        from: 'The “Linked Discourses on the Elements” contains 39 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn15',
        from: 'The “Linked Discourses on the Unknowable Beginning” contains 20 discourses that speak of ',
        to: 'Discourses that speak of ' },
      { blurb: 'sn-blurbs:sn16',
        from: 'The “Linked Discourses with Kassapa” contains 13 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn17',
        from: 'The “Linked Discourses on Gains and Honor” contains 43 discourses warning ',
        to: 'Discourses warning ' },
      { blurb: 'sn-blurbs:sn18',
        from: 'The “Linked Discourses with Rāhula” contains 22 discourses with the Buddha interrogating ',
        to: 'Discourses with the Buddha interrogating ' },
      { blurb: 'sn-blurbs:sn19',
        from: 'The “Linked Discourses with Lakkhaṇa” contains 21 discourses with the Buddha featuring ',
        to: 'Discourses with the Buddha featuring ' },
      { blurb: 'sn-blurbs:sn20',
        from: 'The “Linked Discourses with Similes” contains 12 discourses with parables or similes ',
        to: 'Discourses with parables or similes ' },
      { blurb: 'sn-blurbs:sn21',
        from: 'The “Linked Discourses with Monks” contains 12 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn22',
        from: 'The “Linked Discourses on the Aggregates” contains 159 discourses on ',
        to: 'Discourses on ' },
      // The one opener that isn't a lead trim: upstream runs the appendix remark into the same
      // sentence, where dropping the frame would leave "Discourses … and may be considered".
      { blurb: 'sn-blurbs:sn23',
        from: 'The “Linked Discourses with Rādha” contains 46 discourses with a monk named Rādha on the topic of the five aggregates, and may be considered as an appendix to the previous ',
        to: 'Discourses with a monk named Rādha on the topic of the five aggregates. This section may be considered an appendix to the previous ' },
      { blurb: 'sn-blurbs:sn24',
        from: 'The “Linked Discourses on Views” contains 96 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn25',
        from: 'The “Linked Discourses on Arrival” is the first of three ',
        to: 'The first of three ' },
      { blurb: 'sn-blurbs:sn26',
        from: 'The “Linked Discourses on Arising” is the second of three ',
        to: 'The second of three ' },
      { blurb: 'sn-blurbs:sn27',
        from: 'The “Linked Discourses on Corruptions” is the third of three ',
        to: 'The third of three ' },
      { blurb: 'sn-blurbs:sn28',
        from: 'The “Linked Discourses with Sāriputta” describes ',
        to: '' },
      { blurb: 'sn-blurbs:sn29',
        from: 'The “Linked Discourses on Dragons” is the first of four ',
        to: 'The first of four ' },
      { blurb: 'sn-blurbs:sn30',
        from: 'The “Linked Discourses on Phoenixes” is the second of four ',
        to: 'The second of four ' },
      { blurb: 'sn-blurbs:sn31',
        from: 'The “Linked Discourses on Centaurs” is the third of four ',
        to: 'The third of four ' },
      { blurb: 'sn-blurbs:sn32',
        from: 'The “Linked Discourses on Cloud Gods” is the last of four ',
        to: 'The last of four ' },
      { blurb: 'sn-blurbs:sn33',
        from: 'The “Linked Discourses with Vacchagotta” contains 55 discourses, each with ',
        to: 'Discourses each with ' },
      // Keeps both Pali names: the Jhānasaṁyutta/Samādhisaṁyutta pair is what tells this section
      // apart from SN 53, which the app also labels "Jhāna".
      { blurb: 'sn-blurbs:sn34',
        from: 'The “Linked Discourses on Jhāna” (Jhānasaṁyutta) is also known as the “Linked Discourses on Composure” (Samādhisaṁyutta). It contains 55 discourses dealing with ',
        to: 'The Jhānasaṁyutta, also known as the Samādhisaṁyutta or “Linked Discourses on Composure”, contains discourses dealing with ' },
      { blurb: 'sn-blurbs:sn36',
        from: 'The “Linked Discourses on Feelings” contains 31 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn37',
        from: 'The “Linked Discourses on Females” contains 34 discourses regarding ',
        to: 'Discourses regarding ' },
      { blurb: 'sn-blurbs:sn38',
        from: 'The “Linked Discourses with Jambukhādaka” contains 16 discourses recording ',
        to: 'Discourses recording ' },
      { blurb: 'sn-blurbs:sn39',
        from: 'The “Linked Discourses with Sāmaṇḍaka” contains 16 discourses recording ',
        to: 'Discourses recording ' },
      { blurb: 'sn-blurbs:sn40',
        from: 'The “Linked Discourses with Moggallāna” contains 11 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn41',
        from: 'The “Linked Discourses with Citta” contains 10 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn42',
        from: 'The “Linked Discourses with Chiefs” contains 13 discourses featuring ',
        to: 'Discourses featuring ' },
      { blurb: 'sn-blurbs:sn43',
        from: 'The “Linked Discourses on the Unconditioned” contains 44 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn44',
        from: 'The “Linked Discourses on the Undeclared” contains 11 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn45',
        from: 'The “Linked Discourses on the Path” contains 180 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn46',
        from: 'The “Linked Discourses on the Awakening Factors” contains 184 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn47',
        from: 'The “Linked Discourses on the Establishment of Mindfulness” contains 104 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn48',
        from: 'The “Linked Discourses on the Faculties” contains 178 discourses on ',
        to: 'Discourses on ' },
      // SN 49, 50 and 53 keep their counts: the sentence's point is that a section this large is
      // only the repetition series, which needs the number to land.
      { blurb: 'sn-blurbs:sn49',
        from: 'The “Linked Discourses on the Right Efforts” contains 54 discourses, ',
        to: 'Fifty-four discourses, ' },
      { blurb: 'sn-blurbs:sn50',
        from: 'The “Linked Discourses on the Five Powers” contains 108 discourses, ',
        to: 'One hundred and eight discourses, ' },
      { blurb: 'sn-blurbs:sn51',
        from: 'The “Linked Discourses on the Bases of Psychic Power” contains 86 discourses dealing with ',
        to: 'Discourses dealing with ' },
      { blurb: 'sn-blurbs:sn52',
        from: 'The “Linked Discourses with Anuruddha” contains 24 discourses with Anuruddha, ',
        to: 'Discourses with Anuruddha, ' },
      { blurb: 'sn-blurbs:sn53',
        from: 'The “Linked Discourses on Jhāna” contains 54 discourses on ',
        to: 'Fifty-four discourses on ' },
      { blurb: 'sn-blurbs:sn54',
        from: 'The “Linked Discourses on Breath Meditation” contains 20 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn55',
        from: 'The “Linked Discourses on Stream-Entry” contains 74 discourses on ',
        to: 'Discourses on ' },
      { blurb: 'sn-blurbs:sn56',
        from: 'The “Linked Discourses on the Truths” contains 131 discourses on ',
        to: 'Discourses on ' },
    ],
  },
];
