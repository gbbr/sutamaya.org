// The declared editorial layer over Bhikkhu Sujato's English — see docs/retranslation.md for the design this
// implements. Order is significant: a rule earlier in this array wins any same-word collision
// with a later one (see "The pass" in docs/retranslation.md). Each term rule's segment list, if any,
// lives in its own sidecar at scripts/update-data/rules/<id>.json — never inline here, since that
// list is machine-written by `update-data:triage` (see loadSidecar/saveSidecar in
// scripts/lib/retranslation.js).
//
// `forms` pairs are matched on English word boundaries, case-preserved; every inflection is listed
// explicitly rather than swapped by stem, since the corpus has unrelated words on the same stem —
// e.g. MN40's "water immerser" (someone who dunks in water), which a substring swap would turn
// into nonsense. Listing inflections is necessary but not sufficient: a listed inflection can
// itself be ordinary English elsewhere, which is what a rule's deny list is for.
//
// Grouped by term family below, in array order — the groups are for reading, and the order inside
// and between them is still what settles a same-word collision:
//
//   standalone terms   mendicant-bhikkhu, immersion-concentration,
//                      patisambhida-analytical-knowledge, dhamma-the-dhamma, atapi-ardent
//   awareness          satipatthana-establishment-of-awareness, sati-aware,
//                      sampajanna-clear-comprehension
//   arising / passing   samudaya-arising, vaya-passing-away, atthangama-disappearing,
//                      udayabbaya-arising-passing-away
//   change / alteration  viparinama-annathatta-change-unstable,
//                      viparinama-anuparivatti-changing
//   agitation          paritassati-agitated
//   thought / examination  vitakka-vicara-thought-examination
//   attention          yoniso-proper-attention
//   saṅkhāra           abhisankharoti-generate, sankhara-action-formations
//   segment overrides  one line each, applied last; sub-grouped by cause, order immaterial

export const RULES = [
  // ── Standalone terms ────────────────────────────────────────────────────────
  {
    id: 'mendicant-bhikkhu',
    why: 'Bhikkhu Sujato renders bhikkhu as "mendicant"; this app keeps the Pali. Nothing else in the ' +
      'corpus renders as "mendicant", so nothing needs excluding — open, empty deny list.',
    mode: 'deny',
    forms: [
      ['mendicant', 'bhikkhu'],
      ['mendicants', 'bhikkhus'],
    ],
  },
  {
    id: 'immersion-concentration',
    why: 'Bhikkhu Sujato renders samādhi as "immersion"; this app prefers "composure" (the DPD’s own gloss, ' +
      'alongside "stillness of mind" and "mental composure"; Bodhi and Ñāṇamoli have ' +
      '"concentration", Thanissaro "concentration", Anālayo "concentration"). Bare "composure", not ' +
      '"mental composure": a dictionary entry needs the qualifier because it has no context, but ' +
      'running text supplies it, and the stock lists would limp — "right mental composure", "born ' +
      'of mental composure". Two English words for the one term, split by grammatical slot, since ' +
      'no single word covers both: the noun is "composure", and the verbal slot takes "compose"/' +
      '"collect" — Bhikkhu Sujato himself already renders samāhita as "composed" at dn20:5.4 ' +
      '("resolute and composed", pahitattā samāhitā), so the participle matches his own usage, ' +
      'while the finite verb and gerund take "collect" instead to stay clear of the corpus’s ' +
      'existing "compose"/"composes" for writing verses (dn21, mn56, an4.231). "Unification" was ' +
      'considered and rejected: the DPD assigns it to ekaggatā, and MN 44’s definition of the term ' +
      '("cittassa ekaggatā ayaṁ samādhi") would have collapsed into "unification of the mind is ' +
      'unification". Carries the indefinite article in one form, since the word it agrees with is ' +
      'the word being replaced: "experiences an immersion of the heart" (DN 1, 30 segments) becomes ' +
      '"experiences composure of the heart", with the article dropped rather than left stranded. ' +
      'Open, but no longer with an empty deny list: several of the listed inflections are also ' +
      'ordinary English in Bhikkhu Sujato’s hands, translating no samādhi at all — "immerse on the ' +
      'gratification" (assādānupassino viharato), "immersing wholeheartedly" (sabbacetasā ' +
      'samannāharitvā), literal immersion in water (udakorohaka, MN 40 and friends), one term of ' +
      'MN 50’s mocking jhāyati/pajjhāyati/nijjhāyati/apajjhāyati string, and "mindfulness immersed ' +
      'in the body" (kāyagatā sati). Those are denied; nothing else needs excluding.',
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
      'knowledge" (Bodhi’s and Ñāṇamoli’s rendering) — the four paṭisambhidās are of meaning, ' +
      'text, terminology and eloquence, so "textual" names only the second of them. Open: every ' +
      'occurrence in the corpus is paṭisambhidā, so there is nothing to exclude. One form covers ' +
      'it: the phrase is always a noun, never plural or verbal, and caseAs handles the four Title ' +
      'Case headings it appears in ("Textual Analysis (1st)", "Sāriputta’s Attainment of Textual ' +
      'Analysis"). AN 1.175-186 carries it in the same sentence as "the fruit of knowledge and ' +
      'freedom" (vijjā) — one English word for two terms, accepted rather than overridden, since ' +
      're-rendering vijjā is a far larger decision than this rule. AN 1.593-595’s ' +
      'anekadhātupaṭisambhidā, which Bhikkhu Sujato gives as a bare "analysis", is deliberately left ' +
      'alone: no form can claim "analysis" on its own without taking the ~150 unrelated uses of ' +
      'the word with it.',
    mode: 'deny',
    predicate: /paṭisambhid/i,
    forms: [
      ['textual analysis', 'analytical knowledge'],
    ],
  },
  {
    id: 'dhamma-the-dhamma',
    why: 'Six segments where Bhikkhu Sujato renders dhamma as "text"; this app prefers "the Dhamma" ' +
      '(Bodhi’s rendering). The Early Buddhist Texts were transmitted orally, so "text" imports a ' +
      'written artifact the passages do not have: dhammapaṭisambhidā (AN 5.86, AN 5.95, AN 4.172) ' +
      'is knowledge of the teaching itself as against its meaning, and the attha–dhamma pair (AN ' +
      '4.186, Thig 13.2, Dhp 363) is that same contrast in a phrase. Closed, and necessarily so: ' +
      '"text" is otherwise ordinary English throughout the corpus — 265 "Abbreviated Texts" chapter ' +
      'headings (peyyāla), DN 27’s ganthe karontā ("compiling texts"), DN 30’s nimittakovidā ' +
      '("prognostic texts") and five parenthetical editorial notes — none of which is dhamma. ' +
      'Bhikkhu Sujato’s own usual rendering of the attha–dhamma pair is "the meaning and the ' +
      'teaching" (~40 segments, AN 4.6, AN 8.62, AN 8.78 and the rest); those are left alone, so ' +
      'the three rewritten here read "the Dhamma" where their siblings read "the teaching". The ' +
      'first form rebuilds the four-paṭisambhidā list rather than swapping one word, because "the ' +
      'Dhamma" cannot sit as a bare item beside "meaning" and "definition"; repeating the ' +
      'preposition is how Bodhi renders the list, and it leaves the other three members untouched.',
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
    why: 'Bhikkhu Sujato renders ātāpī as "keen"; this app prefers "ardent", which is the DPD’s own ' +
      'gloss ("avid; ardent; zealous") and what Bodhi, Ñāṇamoli and Thanissaro all use — and what ' +
      'Bhikkhu Sujato himself falls into twice (thag1.59, sn4.22). The literal sense is heat ' +
      '(ā + √tap, "burning"), which "keen" loses entirely and "ardent" keeps. Open: "keen" is ' +
      'ordinary English doing other work in 52 segments against 536 for ātāpī, and those 52 are ' +
      'two stock idioms rather than a scattering — tibba- ("keen enthusiasm", "keen respect", "a ' +
      'keen sense of conscience") and tikkha- ("keen faculties", "keenly develop"). The abstract ' +
      'noun ātappa takes "ardor" (US spelling, as the corpus uses throughout) and the adverb ' +
      'takes "ardently". The predicate misses ātāpī bound by sandhi (idhātāpī, kiccamātappaṁ, ' +
      'tenahātappaṁ) and the stock "diligent, keen, and resolute" wherever the Pali beside it is ' +
      'elided to …pe…, but an open rule covers those without listing them. AN 3.49 has Bhikkhu ' +
      'Sujato using "keen to <verb>" for ātappaṁ karoti, an idiom "ardent" cannot take, and its ' +
      'two lines are rebuilt by segment overrides instead.',
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
  // ── Awareness ───────────────────────────────────────────────────────────────
  // sati-aware and sampajanna-clear-comprehension meet in the satipaṭṭhāna formula ("keen, aware,
  // and mindful"), where sati-aware produces the very word the sampajañña rule consumes. Locking,
  // not order, is what keeps them apart — see "The pass" in docs/retranslation.md, and the pinned
  // example in update-data.test.js. satipatthana-establishment-of-awareness runs ahead of both
  // because it *is* a same-word collision: it claims the "mindfulness" of "mindfulness meditation"
  // that sati-aware would otherwise take on its own. vippasanna-calm sits here for a different
  // reason: it exists only because sampajañña became "clear comprehension", and its 14 segments are
  // the lines where the two words met.
  {
    id: 'satipatthana-establishment-of-awareness',
    why: 'Bhikkhu Sujato renders satipaṭṭhāna as "mindfulness meditation"; this app prefers "establishment ' +
      'of awareness", the compound read literally (sati-upaṭṭhāna). Open: the phrase is his ' +
      'dedicated rendering of this one term and nothing else in the corpus produces it — every one ' +
      'of its 382 segments is satipaṭṭhāna, so there is nothing to exclude. The plural "the four ' +
      'kinds of mindfulness meditation" absorbs "kinds of" rather than reading "the four kinds of ' +
      'establishments of awareness", and the bare singular carries its own article ("the ' +
      'establishment of awareness") since English will not take it without one; the two ' +
      'preposition forms exist so a title keeps that article lowercase ("The Longer Discourse on ' +
      'the Establishment of Awareness").',
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
    why: 'Bhikkhu Sujato renders sati as "mindfulness"/"mindful"; this app prefers "awareness"/"aware". ' +
      'Open: "mindful" is his dedicated term for sati and nothing else in the corpus renders as ' +
      'it, so the only exclusions are the "walking mindfully" passages, where the Pali is ' +
      'caṅkamati (walking meditation) with no sati in it at all. Leaves anussati/sarati alone — ' +
      'those render as "recollection"/"remember", and "recollection of the Buddha" is not an ' +
      'awareness of anything. Carries the indefinite article in one form, since the word it ' +
      'agrees with is the word being replaced: "a mindful disciple of the Buddha" (12 segments, ' +
      'mostly verse) would otherwise read "a aware".',
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
      'prefers "clear comprehension" — Bodhi’s rendering in SN/AN, and DPD’s own first gloss for ' +
      'the noun ("clear awareness"). Closed, because plain-English "aware" is common and ' +
      'unrelated — the formless attainments alone account for ~150 segments of "aware that ‘space ' +
      'is infinite’", which translates iti, not sampajañña. "Clear comprehension" is a noun phrase ' +
      'where Bhikkhu Sujato has both a noun and an adjective, but his own wording splits the two cleanly: ' +
      'the nouns "situational awareness"/"awareness" are sampajañña, while a bare "aware"/' +
      '"unaware" is the adjective sampajāna. So the adjective takes the participle instead — a ' +
      'noun phrase cannot stand in the satipaṭṭhāna formula\'s adjective slot ("keen, aware, and ' +
      'mindful" would give "keen, clear comprehension, and aware"), and that slot alone is ~250 ' +
      'segments.',
    mode: 'allow',
    predicate: /sampajañ|sampajān/i,
    forms: [
      ['situational awareness', 'clear comprehension'],
      ['awareness', 'clear comprehension'],
      ['aware', 'clearly comprehending'],
      // asampajāna. All nine of its segments are the negated term, so these carry no ambiguity of
      // their own — but they matter for the one line that has both terms negated at once, an5.210's
      // "falling asleep unmindful and unaware" (muṭṭhassatissa asampajānassa), which without them
      // reads "unaware and unaware" once sati-aware has had it.
      ['unawareness', 'lack of clear comprehension'],
      ['unaware', 'without clear comprehension'],
    ],
  },
  {
    id: 'vippasanna-calm',
    why: 'Bhikkhu Sujato renders vippasanna as "clear", which is right nearly everywhere it occurs — clear ' +
      'water, a clear gem, "faculties so very clear", "transparent, clear, and unclouded" — so this ' +
      'is deliberately not a rule about the term. It exists only for the lines where his "clear" ' +
      'for vippasanna sits beside this app’s "clear comprehension" for sampajañña, two unrelated ' +
      'terms a line apart on the same English word: SN 47.4’s satipaṭṭhāna formula (sampajānā … ' +
      'vippasannacittā) and Iti 47’s wakefulness verse, which states the phrase twice, once as ' +
      'prose and once as verse. "Calm" is the DPD’s own gloss for the compound (vippasannamana, ' +
      '"with clear mind; with calm mind") and the one candidate that isn’t already spoken for: ' +
      '"tranquil" is Bhikkhu Sujato’s word for passaddhi across 305 segments and "serene" his for samatha ' +
      'across 220, so either would trade this collision for a worse one. Closed, and not because ' +
      'the list is shorter — every occurrence of both phrases is already vippasanna, so an open ' +
      'rule would be no longer. It is closed because "clear" is the right rendering in the other 68 ' +
      'segments, and a line that gains one of these phrases for some other term should stop for ' +
      'review rather than be rewritten silently.',
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
  // One doctrinal pair across four Pali terms, which Bhikkhu Sujato renders with four different English
  // words: samudaya "origin", vaya "vanishing", atthaṅgama "disappearance", udayabbaya "rise and
  // fall". They land on "arising" and "passing away"/"disappearing" here, so the pair reads as a
  // pair. vaya runs before atthangama because both can claim "disappearance"; the rest are
  // order-independent, matching different words.
  {
    id: 'samudaya-arising',
    why: 'Bhikkhu Sujato renders samudaya as "origin" (and as the verb "originates"); this app prefers ' +
      '"arising", pairing it with atthaṅgama as "disappearing". Open: the exclusions are ' +
      'paṭiccasamuppanna ("dependently originated"), aggañña ("the origin of the world"), and a ' +
      'handful of other -sambhava/-samuṭṭhāna compounds. Deliberately leaves "source" (77 ' +
      'segments of samudaya) alone, and the noun "origination" with it: an open rule can\'t safely ' +
      'claim words that ordinary English uses as freely as those, and "origination" is sambhava ' +
      'four times out of five ("there is no origination of suffering") besides.',
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
      'Buddha disappearing from a scene — which is two thirds of the corpus\'s uses of the word ' +
      'and nothing to do with impermanence. The six segments where Bhikkhu Sujato renders vaya as ' +
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
    why: 'Bhikkhu Sujato renders atthaṅgama as "disappearance"; this app prefers "disappearing", ' +
      'pairing it with samudaya as "arising". Open: the one real exclusion is antaradhāna, "the ' +
      'decline and disappearance of the true teaching", which is a different term about the ' +
      'teaching being lost rather than about a phenomenon ceasing. Also picks up the six vaya ' +
      'segments Bhikkhu Sujato renders "disappearance" — see vaya-passing-away.',
    mode: 'deny',
    predicate: /atthaṅgam|atthagam/i,
    forms: [
      ['disappearance', 'disappearing'],
    ],
  },
  {
    id: 'udayabbaya-arising-passing-away',
    why: 'Bhikkhu Sujato renders udayabbaya as "rise and fall"; this app prefers "arising and passing ' +
      'away", which is what he already uses for the near-synonym udayatthagāminī. Closed: "rise ' +
      'and fall" is ordinary English, and even within this corpus it also renders uppādavaya in ' +
      'a verbal construction ("their nature is to rise and fall") the noun phrase can\'t replace.',
    mode: 'allow',
    predicate: /udayabbay|udayavyay/i,
    forms: [
      ['rise and fall', 'arising and passing away'],
    ],
  },
  // ── Change and alteration ───────────────────────────────────────────────────
  // vipariṇāma paired with aññathatta/aññathābhāva — the doublet AN 3.47 lists alongside uppāda
  // and vaya as the third mark of a conditioned phenomenon ("change while persisting"), which is
  // why this group sits next to arising / passing. The adjacency is doctrinal only: nothing above
  // produces "decay" or "perish" and nothing below consumes the "change"/"otherwise"/"alteration"/
  // "changing" these rules write, so there is no same-word collision here and the position
  // settles nothing.
  //
  // Two rules, splitting the term by construction rather than by meaning. The first takes the
  // doublet wherever Bhikkhu Sujato writes it as a whole clause ("decays and perishes"); the second takes
  // the one place he writes it as a compound noun instead ("the perishing of form"). One widened
  // predicate could carry both, but they are kept apart deliberately: they share no English word,
  // so neither's forms can reach what the other rewrites, and each then gets a predicate that
  // states its own construction and a match count that moves only when that construction does.
  {
    id: 'viparinama-annathatta-change-unstable',
    why: 'Bhikkhu Sujato renders the vipariṇāma/aññathā doublet as "decays and perishes"; this app ' +
      'prefers "changes and becomes otherwise". Both Pali terms are change-words — vipariṇāma is ' +
      'transformation, aññathā-bhāva is becoming-otherwise — and neither carries the destruction ' +
      '"perish" implies; Bhikkhu Sujato himself renders aññathatta as "change" in 100 of its 112 ' +
      'segments ("change while persisting", AN 3.47), so this brings the doublet into line with ' +
      'the rest of his own English. ' +
      'Aññathā-bhāva reads "becoming otherwise" wherever English will take a participle, which ' +
      'is the DPD\'s own gloss for aññathābhāvī ("changing; altering; becoming otherwise") — as ' +
      'a finite verb in 50 segments ("But that form changes and becomes otherwise"), and in ' +
      'SN 25\'s list of adjectives in 36 ("form is impermanent, changing, and becoming ' +
      'otherwise"). The nominal slot cannot take it, since a gerund will not stand where ' +
      '"their decay and perishing give rise to sorrow" puts a noun, so those 4 segments read ' +
      '"alteration" instead — the DPD\'s gloss for the compound vipariṇāmaññathābhāva, "change ' +
      'and alteration (of)", and Bodhi\'s and Ñāṇamoli\'s rendering of it. One stem under two ' +
      'renderings is the accepted cost of that. ' +
      'Open: every form here is a multi-word phrase that only this ' +
      'doublet produces, so there is nothing to exclude — the bare words are another matter, ' +
      'which is why none of them is a form. "decay" alone is never this family (all 21 segments ' +
      'are pārijuñña/jarā, MN 82\'s four kinds of decay), and a bare "perish" is mostly ' +
      'nassati ("the world will perish"). Deliberately leaves vipariṇāmadhamma ("perishable", ' +
      '209 segments with its negation) and the remaining vipariṇāma compound nouns (MN 137, ' +
      'SN 35.136–7, MN 44, vipariṇāmadukkhatā) alone: those are vipariṇāma on its own rather ' +
      'than the doublet, and they are a separate editorial decision. MN 138 and SN 22.7 were ' +
      'the exception worth taking — there the compound sits two segments from this rule\'s own ' +
      'output — and they are viparinama-anuparivatti-changing\'s, below. That leaves dn1:3.21.5 ' +
      'as the one line where the two renderings land in adjacent sentences. ' +
      'On the output side, "alteration" appears nowhere else in the retranslatable trees, and ' +
      '"otherwise" appears in 83 segments as ordinary English ("not otherwise", "wished ' +
      'otherwise") of which DN 1 is the only sutta this rule also rewrites — and DN 1\'s one ' +
      'rewrite is fourteen sections away from its plain-English uses, so the two never meet on ' +
      'a page.',
    mode: 'deny',
    predicate: /vipariṇ|vippariṇ|aññathatt|aññathābhāv/i,
    forms: [
      // The doublet as a whole predicate, singular and plural. The plural doubles as the bare
      // infinitive governed by "were to" — 9 segments across MN 87 and SN 21.2, where upstream
      // also writes "decay and perish" — because "become" is already the form that slot wants.
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
    why: 'The vipariṇāma compound noun of MN 138 and SN 22.7, which Bhikkhu Sujato renders "the ' +
      'perishing of form"/"of consciousness"; this app prefers "the changing of". The Pali is ' +
      'rūpavipariṇāmānuparivatti viññāṇaṁ — consciousness that trails after form\'s ' +
      'transformation (anuparivattati, "follows around; trails") — and, in the same segment, the ' +
      'ablative rūpavipariṇāmaññathābhāvā, which Bhikkhu Sujato collapses into that same phrase rather ' +
      'than rendering twice. Nothing in either word is destruction: the DPD gives vipariṇāma as ' +
      '"change; alteration; transformation" and vipariṇāmaññathābhāva as "change and alteration ' +
      '(of)", and Bodhi has "preoccupied with the change of form" where Ñāṇamoli/Bodhi have "the ' +
      'change of material form". So "perishing" is upstream\'s own outlier here, and without ' +
      'this rule MN 138 contradicts itself two segments apart: 20.4 already reads "But that form ' +
      'changes and becomes otherwise" from viparinama-annathatta-change-unstable, and 20.5 then ' +
      'said "latches on to the perishing of form" for the same word. Renders it "changing" — the ' +
      'vipariṇāma half — rather than reaching for one of that rule\'s words for the aññathābhāva ' +
      'half, since anuparivatti needs a process to trail rather than a property, and this is ' +
      'the compound noun of vipariṇāma proper. Open, with an empty deny ' +
      'list: "perishing of" occurs in exactly these 16 segments corpus-wide, so the phrase is ' +
      'this construction and nothing else. Two forms rather than a bare "perishing", which is ' +
      'MN 137/SN 35.136–7\'s vipariṇāmavirāganirodha and SN 22.43\'s — all deliberately left to ' +
      'a separate decision, and all safe from this rule because none of them names an aggregate ' +
      'after the preposition. Introduces no collision on the output side either: "changing of" ' +
      'appears nowhere else in the corpus.',
    mode: 'deny',
    predicate: /vipariṇāmānuparivatt/i,
    forms: [
      ['perishing of form', 'changing of form'],
      ['perishing of consciousness', 'changing of consciousness'],
    ],
  },
  // ── Agitation ───────────────────────────────────────────────────────────────
  // paritassati, which MN 138 and SN 22.7 present as what grasping makes of vipariṇāma — hence
  // the position after change and alteration, whose second rule rewrites the very phrase this
  // one's segment overrides quote ("latching on to the changing of form"). The adjacency is
  // doctrinal only: this rule shares no word with any rule above or below, so the position
  // settles nothing — but the overrides below it do depend on that rule having already run,
  // since a segment override anchors on the term rules' output.
  {
    id: 'paritassati-agitated',
    why: 'Bhikkhu Sujato renders paritassati as "anxious"/"anxiety"; this app prefers "agitated"/' +
      '"agitation". His own note on dn15:32.3 gives the term as conveying "the twin senses of ' +
      'desire and agitation", and agitation is the half that survives translation — "anxiety" ' +
      'reads as the modern affliction, which is not what a bhikkhu is warned off. Open: the ' +
      'English word means something else in only five segments — utrasta, terror, in sn2.17 and ' +
      'snp5.1; ubbigga in thag16.8; and an8.23\'s blurb, where "anxious to know" is ordinary ' +
      'English for eager. Deliberately leaves the term\'s four other renderings alone: "worry" in ' +
      'the contentment formula (an4.28, dn33, sn16.1), "relief" for aparitassāya in the frontier-' +
      'citadel simile (an7.67, an8.30), "bothered" (an5.106) and "nervous" (mn91). Those are ' +
      'Bhikkhu Sujato reading the word contextually rather than as the doctrinal term, and bringing them ' +
      'into line is a separate editorial decision. Shares "agitation" with calati — "For the ' +
      'independent there\'s no agitation", snp3.12 — which carries no paritassati at all, so the ' +
      'two renderings never meet in a sutta.',
    mode: 'deny',
    predicate: /paritass/i,
    forms: [
      ['anxious', 'agitated'],
      // The plural noun paritassanā, which Bhikkhu Sujato pluralizes too. English will not take
      // "Agitations occupy the mind", so this one sentence goes singular — and the verb has to
      // travel with the noun, which is what the longer form is for. Its negated twin, two
      // paragraphs later in the same two suttas, needs segment overrides instead; see them for
      // why a form can't reach it.
      ['anxieties occupy', 'agitation occupies'],
      ['anxieties', 'agitations'],
      ['anxiety', 'agitation'],
    ],
  },
  // ── Thought and examination ─────────────────────────────────────────────────
  {
    id: 'vitakka-vicara-thought-examination',
    why: 'Bhikkhu Sujato renders the jhāna pair vitakka/vicāra as "placing the mind"/"keeping it ' +
      'connected", reading them as movements of attention rather than as thinking; this app ' +
      'prefers "thought"/"examination" (Bodhi’s later rendering, and the DPD’s leading gloss for ' +
      'each — vitakka "thought; reflection; pondering", vicāra "consideration; exploring, ' +
      'examination"). It also unifies Bhikkhu Sujato with himself: outside this formula he already gives ' +
      'vitakka as "thought" in 440 segments, so the same Pali word currently reads two ' +
      'unrelated ways depending on whether it sits in the jhāna formula. SN 41.6 supports the ' +
      'discursive reading — the pair is the *verbal* process because "first you think and ' +
      'examine, then you break into speech". Open with an empty deny list: all 254 segments ' +
      'carrying this wording are the formula, and nothing else in the corpus produces it. ' +
      'Scoped to sutta since name/blurb never carry it. ' +
      'The pair is one interleaved English idiom, so the forms are phrases rather than words and ' +
      'both terms live in one rule — splitting them would leave "while thought and examination". ' +
      'The forms cover each grammatical slot the idiom stands in: appositive (savitakkaṁ ' +
      'savicāraṁ), genitive absolute (vitakkavicārānaṁ vūpasamā), privative (avitakkaṁ ' +
      'avicāraṁ), the vicāramatta middle term, bare subject noun, finite and negated verbs (na ' +
      'vitakketi na vicāreti), and vitakka standing alone. The longest form absorbs the ' +
      'article — "As the placing of the mind and keeping it connected are stilled" would ' +
      'otherwise leave "As the thought and examination are stilled" across 106 segments — while ' +
      'the bare-article form stays for MN 66 and AN 9.42, which have no "the". ' +
      'Bhikkhu Sujato’s own translator notes quote his wording and are never retranslated, so 14 suttas ' +
      'have a note reading in his terms beside text reading in ours.',
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
  // Placed after thought/examination, whose `why` records that Bhikkhu Sujato reads vitakka/vicāra as
  // movements of attention — the doctrinal neighbour, not a collision. Nothing else in the corpus
  // renders as "rational"/"rationally", and the words this rule produces ("proper", "attention")
  // are never consumed by a rule above it, so its position settles nothing on its own.
  {
    id: 'yoniso-proper-attention',
    why: 'Bhikkhu Sujato renders yoniso/ayoniso as "rational"/"irrational" and the compound ' +
      'yoniso manasikāra as "rational application of mind"; this app prefers "properly"/' +
      '"improperly" and "proper attention"/"improper attention". The DPD leads with exactly ' +
      'these glosses — yoniso "properly; prudently; thoroughly; carefully", ayoniso "improperly; ' +
      'imprudently; unwisely; carelessly", manasikāra "attention (to); bringing-to-mind" — and ' +
      'Horner used "proper attention" for the compound. (Bodhi, Ñāṇamoli and Anālayo say "wise ' +
      'attention", which is the better-known rendering; "proper" was chosen because it tracks ' +
      'the adverb, and the adverb has to carry the ~90 segments where yoniso stands alone.) ' +
      '"Rational" is the wrong register regardless: yoniso is literally "according to the ' +
      'source/origin", a matter of attending to a thing the right way round, not of reasoning. ' +
      'Open with a small deny list: Bhikkhu Sujato uses "rational"/"rationally" for essentially nothing ' +
      'but yoniso, so the exclusions are four segments of ordinary English. Nearby words on the ' +
      'same stem — "rationale", "rationalist", "rationality" — are different words and are never ' +
      'matched, since forms match on whole-word boundaries. ' +
      'The compound is a noun and cannot fill the verb slots, so the forms split by grammatical ' +
      'slot: the noun phrase takes "proper attention", while "apply the mind rationally" (and its ' +
      'other word order, "rationally apply the mind") becomes "attend properly", inflected for ' +
      'each of the four slots Bhikkhu Sujato uses — infinitive/imperative, third person, participle. Both ' +
      'orders are listed because Bhikkhu Sujato uses both, sometimes in the same sutta (mn2). The bare ' +
      'adverb and adjective come last, so they only catch the yoniso occurrences that stand ' +
      'outside the compound — "reflecting properly on the food that they eat", "a proper way to ' +
      'win the fruit" (mn126, yoni/ayoni). ' +
      'Shares "proper"/"properly" with ordinary English elsewhere in the corpus (343 segments — ' +
      '"practice properly", "the proper lifespan"), which costs nothing: the rendering that ' +
      'matters is the fixed compound "proper attention", and no rewrite of this rule lands within ' +
      'three segments of one of those.',
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
  // Where the group sits settles nothing — no rule above produces or consumes "choice",
  // "action formation" or "make". The order *within* it does, and is the whole reason the two
  // rules are written the way they are. abhisankharoti-generate has to run first, because its
  // forms span Bhikkhu Sujato's verb and the noun it governs together ("makes hurtful choices"),
  // and once sankhara-action-formations has rewritten that noun the span is locked and no
  // later form can cross it. Running the noun rule first and repairing the verb afterwards was the
  // other option, and it costs more than it looks: a form of bare "make" would put every one of
  // the corpus's ~2,300 other "make"s into the closed rule's untriaged queue at every refresh,
  // burying the tens of real cases the queue exists to surface.
  {
    id: 'abhisankharoti-generate',
    why: 'Bhikkhu Sujato governs his "choices" with "make" — "makes hurtful choices", "having ' +
      'made these choices", "not making choices", "stopped making karmic choices". Once ' +
      'sankhara-action-formations has turned that noun into "action formations", "make" ' +
      'no longer governs it in English, so this rule moves the verb to "generate". That is both ' +
      'what the Pali says — the DPD glosses abhisaṅkharoti "creates; constructs; generates; ' +
      'forms; fabricates" — and what Bodhi uses in the same passages ("generates a meritorious ' +
      'volitional formation", SN 12.51). ' +
      'Each form therefore carries the verb, the noun, and whatever adjective sits between them, ' +
      'and writes the finished phrase in one step — this rule, not ' +
      'sankhara-action-formations, is what renders saṅkhāra in these 54 segments. Twenty ' +
      'forms because that is how many distinct shapes Bhikkhu Sujato uses; two of them ("continue ' +
      'to make them", "stop making them") have a pronoun where the others have the noun, SN 56.42 ' +
      'having already named it in the preceding clause. ' +
      'The verb repeats the noun\'s own root, so "generates an action formation" is ' +
      'etymologically "forms a formation". That redundancy is in the Pali — abhisaṅkhāraṁ ' +
      'abhisaṅkharoti is a cognate accusative — and Bodhi keeps it rather than paraphrasing it ' +
      'away, which is the reason for keeping it here too. Snp 3.12\'s "karmic choices" drops its ' +
      'adjective instead of carrying it over: "action" already says what "karmic" was there to ' +
      'say, and the word is Bhikkhu Sujato\'s gloss rather than the verse\'s — the Pali is the ' +
      'bare Saṅkhāre uparundhiya. ' +
      'Closed, because a bare "make" form would be catastrophic — it is among the commonest verbs ' +
      'in the corpus. The multi-word forms make the list nearly self-selecting anyway; it is kept ' +
      'closed so that a new shape stops for review rather than being missed in silence.',
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
      'the saṅkhāra aggregate the six classes of intention, and AN 6.63 says intention is kamma ' +
      '(cetanāhaṁ, bhikkhave, kammaṁ vadāmi) — so what is formed is kamma, and kamma is action. ' +
      'The DPD glosses this sense "intention; volitional formation; choice; karmic activity", ' +
      'which is the same identification read off the dictionary. "Choices" narrows a word that ' +
      'covers far more than deliberate choosing; it is Bhikkhu Sujato\'s own departure from the ' +
      'other translators, not their consensus. ' +
      'Not Bodhi\'s "volitional formations", which Ñāṇamoli and Anālayo shorten to "formations": ' +
      '"volitional" states the mechanism where "action" states what the mechanism produces, and ' +
      'the shorter phrase costs a syllable less in the 137 lines that list the five aggregates. ' +
      'His other renderings of the same word are left alone and this rule never reaches them — ' +
      '"conditions"/"conditioned phenomena" for sabbe saṅkhārā, "physical process" for ' +
      'kāyasaṅkhāra in the breathing formula, "life force" for āyusaṅkhāra, "intentions" for ' +
      'manosaṅkhāra. Only the aggregate and dependent-origination sense moves. ' +
      'Not the bare "volitions": that is cetanā\'s word, and the two terms stand side by side in ' +
      'one list in eight segments (an1.314, an1.315, an10.104 — yā ca cetanā yā ca patthanā yo ca ' +
      'paṇidhi ye ca saṅkhārā), where "their intentions, aims, wishes, and volitions" would put ' +
      'two English synonyms in one enumeration of four distinct Pali terms. ' +
      '"Action" is already Bhikkhu Sujato\'s word for sammākammanta, the path factor, and the two ' +
      'share one segment exactly once, an10.104:3.1 — "right view, purpose, speech, action, ' +
      'livelihood …" ending one sentence, "their intentions, aims, wishes, and action formations" ' +
      'inside the next. Accepted: a sentence apart, "right action" is a fixed phrase in a ' +
      'different grammatical slot, and the same line renders kāyakamma as "deeds", so nothing ' +
      'else in it competes. Elsewhere the two are sentences or whole paragraphs apart — 14 suttas ' +
      'carry both, always as the path-factor list beside the aggregate list. The five lines where ' +
      'the collision was tight enough to hurt have segment overrides instead — see ' +
      'an4-171-instigates-deeds and sn12-37-old-deeds-generated. ' +
      'The plural is upstream\'s and the Pali\'s. saṅkhārā is the only one of the five aggregates ' +
      'that is grammatically plural, and 244 sites already agree with it ("choices cease", "these ' +
      'choices", "are choices"), so a singular would be a grammatical rewrite rather than a swap. ' +
      'Open: 17 exclusions out of 957 segments. Eleven are mn120, where saṅkhārupapatti is ' +
      'rebirth deliberately aspired to and the whole sutta turns on the choosing; four are the ' +
      'same English standing for a different Pali word (dn9\'s "make a choice" is ceteti, paired ' +
      'the other way round from every other passage; an6.63\'s is cetayitvā); two are ordinary ' +
      'English ("his choice to go forth", dn27\'s "human choices").',
    mode: 'deny',
    predicate: /saṅkhār/i,
    forms: [
      // SN 22's blurb names the aggregate and then glosses it in plain English — "action
      // formations (saṅkhārā, i.e. intention, will, or volition; the choice to perform an act)".
      // The first "choices" is the term and must move; the second is Bhikkhu Sujato explaining
      // it, and moving that too makes the gloss define the term with itself. This form claims the
      // phrase first (forms match longest-first), so the bare "choice" below never sees it.
      // "Decision" rather than "volition" or "will", both of which the same sentence already uses.
      ['the choice to perform', 'the decision to perform'],
      // The replacement begins with a vowel where Bhikkhu Sujato's word doesn't, so the article
      // has to travel with it. No segment needs this today — abhisankharoti-generate already
      // carries every "make a choice" — but the rule is open, so an upstream line that gains one
      // would otherwise be rewritten to "a action formation" with nothing to catch it.
      ['a choice', 'an action formation'],
      // saṅkhāradhātu, 8 lines in SN 22. English puts an attributive noun in the singular, and
      // hyphenates it when it is itself two words — "the choices element" comes through as "the
      // action-formation element" rather than stacking a plural in front of another noun.
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
  // predicate, so wherever Bhikkhu Sujato used his "aware" predicatively ("a mendicant is aware", "aware
  // of the situation") the clause has to be rebuilt around the noun — which a word-for-word form
  // can't do, and a form spanning more words can't either, since mendicant-bhikkhu has already
  // locked the "bhikkhu" in the middle of two of them.
  {
    id: 'sampajano-hoti-question',
    kind: 'segment',
    why: 'Kathañca bhikkhu sampajāno hoti, opening the sampajañña section — "how is a bhikkhu ' +
      'clearly comprehending?" reads as a progressive tense asking what he is doing right now. The ' +
      'noun carries the standing quality the section goes on to define. Paired with ' +
      'sampajano-hoti-answer, which closes the same section.',
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
      'asampajāna across all three moments. "Someone is clear comprehension when conceived" puts a ' +
      'noun phrase where a predicate belongs; "has clear comprehension" pairs with the "without ' +
      'clear comprehension" the negative already produces. The first kind needs no override — it is ' +
      'negative throughout, and "is without clear comprehension" was already fine.',
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
  // Nothing is wrong with the swap itself, but "clear comprehension" now lands beside Bhikkhu Sujato's
  // "comprehend", which is his word for abhisamaya — a different term entirely. Only this one
  // segment has both in the same sentence.
  {
    id: 'sn56-34-abhisamaya-understand',
    kind: 'segment',
    why: 'yathābhūtaṁ abhisamayāya, which Bhikkhu Sujato renders "truly comprehending" — his word for ' +
      'abhisamaya, unrelated to sampajañña. Once sampajañña is "clear comprehension" the two sit in ' +
      'one sentence saying different things with the same root. Only this segment has both, so ' +
      'abhisamaya moves rather than the app’s own term: "truly understand" reads the yathābhūtaṁ ' +
      'straight, and "in order to" makes the line parallel to 1.2’s "in order to extinguish it", ' +
      'which is the same karaṇīyaṁ construction in the Pali.',
    segment: 'sn56.34:2.1',
    from: '“Bhikkhus, so long as you have not encompassed the four noble truths, regard your burning head or clothes with equanimity, ignore them, and apply extraordinary enthusiasm, effort, zeal, vigor, perseverance, awareness, and clear comprehension to truly comprehending the four noble truths. ',
    to: '“Bhikkhus, so long as you have not encompassed the four noble truths, regard your burning head or clothes with equanimity, ignore them, and apply extraordinary enthusiasm, effort, zeal, vigor, perseverance, awareness, and clear comprehension in order to truly understand the four noble truths. ',
  },
  // ·· samudaya as a noun ··
  // The term rule is right to leave the noun "origination" alone (26 of its 30 segments are
  // sambhava, not samudaya — see samudaya-arising's why); these lines are the exception it can't
  // express.
  {
    id: 'samudaya-exclamation-arising',
    kind: 'segment',
    why: '‘Samudayo, samudayo’ — the awakening exclamation, paired with ‘Nirodho, nirodho’ ' +
      '(“Cessation, cessation”) a few lines later. Bhikkhu Sujato reaches for the noun "origination" only ' +
      'here, so samudaya-arising doesn’t catch it, and the line ends up contradicting its own ' +
      'sutta: sn12.65:3.7 already reads "this entire mass of suffering arises" and 8.6 "their ' +
      'arising".',
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
      'front. Only dn34 here: an5.27 carries the same line with a trailing elision mark, which is a ' +
      'different string and so a different anchor — see enter-with-awareness-elided.',
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
      'verb. One rule, three segments — the decision is the same one three times, and each segment ' +
      'still has to match the anchor on its own.',
    segments: ['thag1.31:1.3', 'thag3.9:2.3', 'thag15.1:12.3'],
    from: 'one should with awareness endure, ',
    to: 'one should endure with awareness, ',
  },
  // ·· paritassanā as a plural noun ··
  // The term rule already puts "Anxieties occupy the mind" into the singular, because the verb has
  // to move with the noun and one form can carry both. Its negated twin — the same passage of the
  // same two suttas, saying the same thing of a freed mind — puts those two words either side of a
  // fifteen-word em-dash clause, which no form can span, and the trailing half can't be a form of
  // its own either: "don’t occupy the mind" is ordinary English in AN 8.6, AN 9.26, MN 36 and
  // SN 35.134, none of which has anything to do with paritassanā. So it is four anchors, one per
  // wording: MN 138 has "the mind" where SN 22.7 has "their mind", and each says it of form and
  // again of consciousness.
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
  // caseAs reads a match as Title Case only when every significant word is capitalized, and it
  // counts "it" as significant (it isn't in TITLE_LOWERCASE), so a heading of Bhikkhu Sujato's that
  // lowercases "it" reads as a capitalized sentence and the replacement comes back in sentence
  // case. Fixed per heading rather than by adding "it" to that set, which would re-case every
  // rule's headings to solve one.
  {
    id: 'sn43-3-thought-examination-title',
    kind: 'segment',
    why: 'SN 43.3’s title, "Placing the Mind and Keeping it Connected" — Title Case, but the ' +
      'lowercase "it" makes caseAs treat it as a sentence, so ' +
      'vitakka-vicara-thought-examination returns "Thought and examination". This is the sutta’s ' +
      'displayed title (build-corpus’s headerTitle reads the highest "0.N" segment), so the case ' +
      'is visible in the browse tree, not just in the body text.',
    segment: 'sn43.3:0.3',
    from: 'Thought and examination ',
    to: 'Thought and Examination ',
  },
  // The same set read from the other end: caseAs treats a *single-word* match as a capitalized
  // sentence, because that is all a single-word replacement ever needs.
  // sankhara-action-formations' replacement is two words, so Bhikkhu Sujato's one-word
  // "Choices" comes back as "Action
  // formations" wherever it heads a sutta. Two headings, since the name-tree copy of AN 3.23's
  // title is unreachable — build-corpus prefers the sutta's own 0.N segment and only falls back to
  // sujato/name, which segment overrides can't address anyway.
  //
  // sankhara-action-formations is open, so a sutta upstream retitles to "Choices" would be
  // rewritten without review and would land here sentence-cased. Nothing detects that; it is the
  // known price of the open mode.
  {
    id: 'an3-23-action-formations-title',
    kind: 'segment',
    why: 'AN 3.23’s title, "Choices" — a one-word match whose two-word replacement needs Title ' +
      'Case. This is the sutta’s displayed title (build-corpus’s headerTitle reads the highest ' +
      '"0.N" segment), so the case shows in the browse tree.',
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
  // is abhisaṅkharoti. sankhara-action-formations and abhisankharoti-generate both deny these
  // three segments, since applying them would have labelled each Pali word with the other one's
  // English. The override swaps the two halves instead, so the line says what MN 140's identical
  // thought says once the term rules have run: "They neither generate an action formation nor
  // form an intention". Three rules rather than one because the closing punctuation differs — a
  // quoted thought inside single quotes, inside double quotes, and unquoted narration.
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
  // sankhara-action-formations' replacement shares a word with Bhikkhu Sujato's rendering of
  // kamma, and in most of the corpus that costs nothing — "right action" is a fixed path factor
  // and sits sentences away from the aggregate. In these five lines the two land in one clause,
  // and each takes upstream's own other word for the term that is not saṅkhāra.
  {
    id: 'an4-171-instigates-deeds',
    kind: 'segment',
    why: 'kāyasaṅkhāraṁ abhisaṅkharoti, with the bodily/verbal/mental triad written out — so the ' +
      'line reads "the action formation that gives rise to bodily, verbal, and mental action", ' +
      'the same English word twice in one clause for saṅkhāra and for kamma. "Deeds" is Bhikkhu ' +
      'Sujato’s own commonest rendering of kamma, and the phrase "bodily, verbal, or mental ' +
      'deeds" is his (an1.314), so this borrows it rather than inventing one.',
    segments: ['an4.171:2.1', 'sn12.25:11.1'],
    from: 'By oneself one instigates the action formation that gives rise to bodily, verbal, and mental action, conditioned by which that pleasure and pain arise in oneself. ',
    to: 'By oneself one instigates the action formation that gives rise to bodily, verbal, and mental deeds, conditioned by which that pleasure and pain arise in oneself. ',
  },
  {
    id: 'sn12-37-old-deeds-generated',
    kind: 'segment',
    why: 'Purāṇamidaṁ kammaṁ abhisaṅkhataṁ abhisañcetayitaṁ. Bhikkhu Sujato turns the two past ' +
      'participles into agents — "old deeds … produced by choices and intentions" — and with ' +
      'this app’s noun that becomes deeds produced by action formations, which says the same ' +
      'thing twice. The participles say it once: abhisaṅkhata is "generated", the verb ' +
      'abhisankharoti-generate already uses for this root, and abhisañcetayita is "intended". ' +
      'Bodhi reads it the same way ("generated and fashioned by volition"). Only the three lines ' +
      'whose subject is kamma need this; the other 22 places the stock phrase appears have a ' +
      'jhāna or a heart’s release as their subject and keep upstream’s wording.',
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
      'sankhara-action-formations turns the one outlier into "the stilling of all action ' +
      'formations" and leaves the other thirty as they were. The compound is outside this app’s ' +
      'scope for saṅkhāra — the aggregate and the dependent-origination link are what move — so ' +
      'this restores upstream’s own majority wording rather than inventing a third one.',
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
  // "keen to <verb>" is idiomatic English for being eager to do something, which is how Bhikkhu
  // Sujato renders ātappaṁ karoti in AN 3.49 — and "ardent" simply has no such construction. Only
  // this one sutta uses it; everywhere else "keen" is predicative or attributive, where the
  // adjective stands on its own. The gerund is the nearest thing English offers.
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
  // authorship instead. The copula has to come back — which is what he writes himself in the same
  // formula elsewhere ("when my mind had become immersed"), so these three lines are brought into
  // line with his own wording rather than given a new one.
  {
    id: 'mind-had-become-composed-past-lives',
    kind: 'segment',
    why: 'Evaṁ samāhite citte … pubbenivāsānussatiñāṇāya cittaṁ abhininnāmesiṁ — the first of the ' +
      'three knowledges, told in the first person. Paired with the two below, which are the same ' +
      'line ending in the other two knowledges.',
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
  // and the term rule gives that "collect" — except where he tells it in the past tense, which
  // takes the participle "composed" instead and splits one stock formula across two English words.
  // These three lines take "collected" so all seven read alike.
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

  // ·· a false positive sharing its line with a true one ··
  // Denying a segment takes the whole line out of the rule's reach, which is right where every
  // match on it is a false positive and wrong where the line carries both. MN 128's list of the
  // mind's corruptions is the only place that happens here.
  {
    id: 'mn128-excessive-contemplation-of-forms',
    kind: 'segment',
    why: 'Bhikkhu Sujato\'s "excessive immersion on forms" is atinijjhāyitattaṁ rūpānaṁ, excessive ' +
      'contemplation — no samādhi, and denied wherever it stands alone (mn128:26.8, 27.11, 30.11). ' +
      'This line also carries the real term in "my immersion fell away" (samādhi cavi), so the ' +
      'rule has to run and the false positive is put back afterwards.',
    segment: 'mn128:26.6',
    from: '‘Excessive composure on forms arose in me, and because of that my composure fell away. ',
    to: '‘Excessive immersion on forms arose in me, and because of that my composure fell away. ',
  },
];
