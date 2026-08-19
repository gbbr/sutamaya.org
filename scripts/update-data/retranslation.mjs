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
// into the nonsense "water concentrater".
//
// Grouped by term family below, in array order — the groups are for reading, and the order inside
// and between them is still what settles a same-word collision:
//
//   standalone terms   mendicant-bhikkhu, immersion-concentration,
//                      patisambhida-analytical-knowledge
//   awareness          satipatthana-establishment-of-awareness, sati-aware,
//                      sampajanna-clear-comprehension
//   arising / passing   samudaya-arising, vaya-passing-away, atthangama-disappearing,
//                      udayabbaya-arising-passing-away
//   change / instability  viparinama-annathatta-change-unstable,
//                      viparinama-anuparivatti-changing
//   agitation          paritassati-agitated
//   thought / examination  vitakka-vicara-thought-examination
//   attention          yoniso-proper-attention
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
    why: 'Bhikkhu Sujato renders samādhi as "immersion"; this app prefers "concentration". Open: the ' +
      '"immers-" stem also covers unrelated words like "water immerser" (MN40), but those aren’t ' +
      'listed forms, so a substring swap never touches them — see the forms comment above. Carries ' +
      'the indefinite article in one form, since the word it agrees with is the word being ' +
      'replaced: "experiences an immersion of the heart" (DN 1, 30 segments) would otherwise read ' +
      '"an concentration".',
    mode: 'deny',
    forms: [
      ['an immersion', 'a concentration'],
      ['immerse', 'concentrate'],
      ['immerses', 'concentrates'],
      ['immersed', 'concentrated'],
      ['immersing', 'concentrating'],
      ['immersion', 'concentration'],
      ['immersions', 'concentrations'],
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
  // ── Change and instability ──────────────────────────────────────────────────
  // vipariṇāma paired with aññathatta/aññathābhāva — the doublet AN 3.47 lists alongside uppāda
  // and vaya as the third mark of a conditioned phenomenon ("change while persisting"), which is
  // why this group sits next to arising / passing. The adjacency is doctrinal only: nothing above
  // produces "decay" or "perish" and nothing below consumes the "change"/"unstable"/"changing"
  // these rules write, so there is no same-word collision here and the position settles nothing.
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
      'prefers "changes and is unstable". Both Pali terms are change-words — vipariṇāma is ' +
      'transformation, aññathā-bhāva is becoming-otherwise — and neither carries the destruction ' +
      '"perish" implies; Bhikkhu Sujato himself renders aññathatta as "change" in 100 of its 112 ' +
      'segments ("change while persisting", AN 3.47), so this brings the doublet into line with ' +
      'the rest of his own English. Open: every form here is a multi-word phrase that only this ' +
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
      'Shares "unstable" with adhuva (14 ' +
      'segments, "Conditions are unstable", AN 7.66); the two are near-synonyms and no sutta ' +
      'carries both renderings, so the overlap is accepted rather than worked around.',
    mode: 'deny',
    predicate: /vipariṇ|vippariṇ|aññathatt|aññathābhāv/i,
    forms: [
      // The doublet as a whole predicate, singular and plural.
      ['decays and perishes', 'changes and is unstable'],
      ['decay and perish', 'change and are unstable'],
      // Same words, but a bare infinitive governed by "were to" — 9 segments across MN 87 and
      // SN 21.2, where the finite plural above would give "were to change and are unstable".
      // Carries the governing words so the slot is unambiguous, and wins by longest-first.
      ['were to decay and perish', 'were to change and be unstable'],
      // The nominal slot: "their decay and perishing give rise to sorrow" (vipariṇāmaññathābhāvā).
      ['decay and perishing', 'change and instability'],
      // The adjectival slot, SN 25's formula (vipariṇāmī aññathābhāvī): "form is impermanent,
      // decaying, and perishing". One form covers both words — which is also what keeps the rule
      // off sn5.4:5.2's unrelated "decaying and frail", where there is no comma.
      ['decaying, and perishing', 'changing, and unstable'],
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
      'changes and is unstable" from viparinama-annathatta-change-unstable, and 20.5 then said ' +
      '"latches on to the perishing of form" for the same word. Renders it "changing" rather ' +
      'than "instability" deliberately — "instability" is this app\'s word for the *other* half ' +
      'of the doublet (aññathābhāva), so it would reintroduce one stem under two renderings, and ' +
      'anuparivatti needs a process to trail rather than a property. Open, with an empty deny ' +
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
  // the position after change and instability, whose second rule rewrites the very phrase this
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
];
