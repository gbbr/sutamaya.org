# Bodhi's segmented English against the Pali's markup

How Bhikkhu Bodhi's English in `data/bodhi/sutta/` fits the line roles in `data/html/pli/ms/sutta/`,
for three things that fit badly: closing and summary lines, his own headings, and verse line breaks.

All counts come from a script run over every file. It reads each page in `data/upstream/bodhi/sutta/`
the way `scripts/segmenter/segment-translations.mjs` does, and maps it onto the segmented text one character
at a time, with whitespace ignored. 1,170 of the 1,174 texts map exactly. The other four
(`sn12.5`, `sn45.103`, `sn45.115`, `sn45.127`) have no segmented file, so they are left out.

## Summary

| Question | Count |
|---|---|
| (a) Closing and summary lines holding English | **112** |
| — the translator's own closing words | 32: 10 colophons, 20 uddāna verse lines, 2 end-of-chapter notes |
| — body text on a closing line | 80: 75 belong on a line above, 5 on the line below |
| (b) His section headings (`<h2>`/`<h3>` in the page body) | **233**, in 25 texts |
| — on a Pali heading line | 70, including 5 that leave their number on the line before |
| — opening a plain line, followed by body text | 148 |
| — elsewhere on a plain line | 15: 11 after body text, mid-line; 4 alone on a plain line |
| His sutta titles | 1,179: 1,165 on the Pali title line; 14 not in the segmented text |
| (c) Pali verse lines holding two or more of his verse lines | **364** of the 3,746 Pali verse lines with English (9.7%), in 168 texts |
| — his verse lines on them | 757 in all, 666 of them whole; 392 of his line breaks fall inside a Pali line |
| — Pali lines holding two or more of his lines whole | 280 |

## (a) Closing and summary lines

**Method.** A closing or summary line is a Pali line whose template has the class `endsutta`,
`endvagga`, `endsection`, `endkanda`, `endbook` or `uddana-intro`, or is a verse line inside
`<blockquote class='uddanagatha'>` or `'vagguddanagatha'`. `<p class='end'>` has no English
anywhere. The call is made by rule and was checked by reading all 112 lines:
- **Own words**: his colophon ("… is finished", "Here ends …"), a whole verse line of his translated
  uddāna, or a whole note of his that closes a chapter ("… to be elaborated …").
- **Body text**: anything else. It goes below when a paragraph of his starts on the closing line and
  runs on into the next body line; otherwise it goes above.
The two end-of-chapter notes (`sn47.51-62:2.7`, `sn47.95-104:4.5`) are a judgement call: they are
his instructions for the chapter's abbreviated suttas, placed where the chapter ends.

| Pali role | Lines | Own words | Body text |
|---|---|---|---|
| `endsutta` | 46 | 2 | 44 |
| uddāna verse | 36 | 20 | 16 |
| `endbook` | 11 | 8 | 3 |
| vagga-uddāna verse | 5 | 0 | 5 |
| `uddana-intro` | 5 | 0 | 5 |
| `endsection` | 5 | 0 | 5 |
| `endkanda` | 2 | 1 | 1 |
| `endvagga` | 2 | 1 | 1 |

The body text is mostly one of these: the last words of a sutta's final sentence or verse line; his
stand-in for an abbreviated sutta ("As in §118.", "All as above."), which lands on the closing line
because the body lines above it are empty; the closing formula ("This is what the Blessed One said.
Elated, …") in AN's collected peyyāla suttas; or the tail of a bracketed page reference ("61]").

Own words:

| Segment | Pali role | Pali | English on the line | Call |
|---|---|---|---|---|
| `an10.267-746:1.28` | endbook | Dasakanipātapāḷi niṭṭhitā. | The Book of the Tens is finished. | his colophon |
| `an3.183-352:8.6` | endbook | Tikanipātapāḷi niṭṭhitā. | The Book of the Threes is finished. | his colophon |
| `an5.308-1152:4.13` | endbook | Pañcakanipātapāḷi niṭṭhitā. | The Book of the Fives is finished. | his colophon |
| `sn11.25:4.5` | endbook | Sagāthāvaggasaṁyuttapāḷi niṭṭhitā. | The Book with Verses is finished. | his colophon |
| `sn21.12:6.6` | endbook | Nidānavaggasaṁyuttapāḷi niṭṭhitā. | The Book of Causation is finished. | his colophon |
| `dn15:36.6` | endsutta | Mahānidānasuttaṁ niṭṭhitaṁ dutiyaṁ. | Here ends the Mahānidāna Sutta. | his colophon |
| `dn2:102.7` | endsutta | Sāmaññaphalasuttaṁ niṭṭhitaṁ dutiyaṁ. | Here ends the Sāmaññaphala Sutta | his colophon |
| `sn47.51-62:3.4` | uddāna verse | vaggo tena pavuccatīti. | Thus the subchapter is recited. | his uddāna verse |
| `sn47.63-72:2.1` | uddāna verse | Tathāgataṁ padaṁ kūṭaṁ, | Tathagata, footprint, roof peak, | his uddāna verse |
| `sn47.95-104:4.5` | endkanda | Satipaṭṭhānasaṁyuttaṁ tatiyaṁ. | The Connected Discourses on the Establishments of Mindfulness is to be elaborated in the same way as the Conn… | his end-of-chapter note |

Body text that belongs above:

| Segment | Pali role | Pali | English on the line | Call |
|---|---|---|---|---|
| `an3.48:6.5` | endsutta | Navamaṁ. | delighting in the deva world. | belongs above |
| `an4.21:12.5` | endsutta | Paṭhamaṁ. | too.” | belongs above |
| `an4.54:11.5` | endsutta | Catutthaṁ. | 61] | belongs above |
| `an10.267-746:1.27` | endbook | Pañcamo paṇṇāsako samatto. | Elated, those bhikkhus delighted in the Blessed One’s statement. | belongs above |
| `an8.50:15.3` | uddāna verse | Anuruddhaṁ puna visākhe, | but addressed to the bhikkhus. | belongs above |
| `sn16.13:6.7` | endkanda | Kassapasaṁyuttaṁ samattaṁ. | to its nondecay and nondisappearance.” | belongs above |
| `sn22.102:13.0` | uddana-intro | Tassuddānaṁ | ‘I am.’” | belongs above |
| `sn35.125:1.7` | endsutta | Dutiyaṁ. | As in §118. | belongs above |
| `sn45.64-68:1.8` | endsutta | Chaṭṭhaṁ. | Accomplishment in careful attention … complete as in §63 … He develops right concentration, which is based up… | belongs above |
| `an5.308-1152:4.2` | vagga-uddāna verse | Pañcaṅgikañca sumanaṁ; | This is what the Blessed One said. | belongs above |

Body text that belongs below (all five):

| Segment | Pali role | Pali | English on the line | Call |
|---|---|---|---|---|
| `dn1:1.10.22` | endsection | Cūḷasīlaṁ niṭṭhitaṁ. | 2. | belongs below: the number of the next heading |
| `dn1:1.20.4` | endsection | Majjhimasīlaṁ niṭṭhitaṁ. | 3. | belongs below: the number of the next heading |
| `dn1:1.37.2` | endsection | Paṭhamabhāṇavāro. | 2. | belongs below: the number of the next heading |
| `dn1:2.36.6` | endsection | Dutiyabhāṇavāro. | IV. | belongs below: the number of the next heading |
| `mn4:19.7` | endsection | Soḷasapariyāyaṁ niṭṭhitaṁ. | “I considered thus: | belongs below: the next paragraph's opening |

## (b) His headings

**Method.** His section headings are the `<h2>`–`<h6>` elements in a page's body (249 on the
published pages). The 16 of them that head a sutta on a page of several suttas are counted as sutta
titles, which leaves 233. Each heading is placed on the Pali line that holds most of its characters.
That line is a heading line if its template opens with `<h1>`–`<h6>`. Speaker labels (`span.speaker`)
and the chapter names in SuttaCentral's page header are not counted; the segmenter drops the header.

The 70 that land on a heading line are all in DN 1, DN 2, DN 15, MN 2 and MN 8, where the Pali has
section headings of its own. Nine headings are split across two lines, a number cut from its words:
five in DN 1 on a heading line, whose number sits on the Pali line before (four of those numbers are
on an `endsection` line, listed in (a)), and four in DN 1 and SN 43.12 that open plain lines. The 11
mid-line headings follow body text on the same plain line (`mn9:23.1` holds "…makes an end of
suffering. Birth …"), in MN 9 (6), MN 38 (2), MN 148, MN 77 and SN 43.12. The 4 alone on a plain line
are `mn38:21.52` and his "At Sāvatthī."-style headings in SN 12.24, 12.25 and 12.32.

**Sutta titles.** Of his 1,179 sutta titles, 1,165 land on the Pali title line. The segmenter puts
them there directly. Fourteen are not in the segmented text:
- 6 titles of later suttas on a joined page, where the segmenter keeps only the first title
  (`sn35.33-42`, `sn45.146-148`, `sn47.95-104`, `sn12.83-92`, `an5.308-1152`);
- 4 in `sn45.141-145`, whose Pali document has one title line for five suttas;
- 4 in the four texts with no segmented file.

On a Pali heading line:

| Segment | His heading | Pali role | English on the line |
|---|---|---|---|
| `dn1:1.0` | I. Talk on Wanderers (Paribbājakakathā) | h2 | I. Talk on Wanderers (Paribbājakakathā) |
| `dn1:2.38.0` | 1. Doctrines of Percipient Immortality (Saññīvādā): Views 19–34 | h4 | same |
| `dn1:3.71.0` | 3. Exposition of the Round (Diṭṭhigatikādhiṭṭhānavaṭṭakathā) | h3 | same |
| `dn15:35.0` | The Eight Emancipations | h2 | same |
| `dn2:25.0` | The Doctrine of Pakudha Kaccāyana | h3 | same |
| `dn2:56.0` | The Large Section on Moral Discipline | h5 | same |
| `dn2:79.0` | The Third Jhāna | h5 | same |
| `dn2:93.0` | The Knowledge of Recollecting Past Lives | h5 | same |
| `mn2:18.0` | Taints to be Abandoned by Enduring | h2 | same |
| `mn8:16.0` | The Way of Extinguishing | h2 | same |

Opening a plain line:

| Segment | His heading | Pali role | English on the line |
|---|---|---|---|
| `dn15:4.1` | Aging and Death | plain | Aging and Death “It was said: ‘With birth as condition there is aging and death.’ How tha… |
| `mn1:147.1` | The Tathāgata—I | plain | The Tathāgata—I “Bhikkhus, the Tathāgata, too, accomplished and fully enlightened, direct… |
| `mn12:32.1` | Four Kinds of Generation | plain | Four Kinds of Generation “Sāriputta, there are these four kinds of generation. |
| `mn22:10.1` | The Simile of the Snake | plain | The Simile of the Snake “Here, bhikkhus, some misguided men learn the Dhamma— |
| `mn28:16.1` | The Fire Element | plain | The Fire Element “What, friends, is the fire element? |
| `mn46:6.1` | The Ignorant Person | plain | The Ignorant Person (1) “Now, bhikkhus, one who is ignorant, not knowing this way of unde… |
| `mn77:17.1` | 3. The Four Bases for Spiritual Power | plain | 3. The Four Bases for Spiritual Power “Again, Udāyin, I have proclaimed to my disciples t… |
| `mn77:36.1` | 19. The Destruction of the Taints | plain | 19. The Destruction of the Taints “Again, Udāyin, I have proclaimed to my disciples the w… |
| `sn12.25:1.2` | i | plain | i Then, in the evening, the Venerable Bhūmija emerged from seclusion and approached the V… |
| `sn47.8:5.1` | ii. The competent cook | plain | ii. The competent cook “Suppose, bhikkhus, a wise, competent, skilful cook were to presen… |

## (c) Verse lines holding several of his lines

**Method.** His verse lines are the lines inside a `<blockquote>` on his page, each `<br>` starting
a new one; for Thag 8.1, which comes from Access to Insight, they are the lines of its free-verse
block. That gives 4,047 lines. The DN 1 and DN 2 question lists that use `<br>` outside a blockquote
are not verse and are left out. A Pali verse line is a `verse-line` inside `<blockquote class='gatha'>`,
since uddāna verse is covered in (a). A Pali line counts when one of his line breaks falls inside its
English, meaning the end of one of his lines and the start of the next sit on it together. "His
lines on them" counts every line with any part there, so a line cut between two Pali lines counts
on both. The "whole" count avoids this.

By collection: SN 185, AN 161, MN 13, Thag 5. 340 of the 364 hold two of his lines, 21 hold three,
2 hold four, and `sn1.32:14.1` holds six.

| Segment | Pali line | His lines | English, his breaks as " / " |
|---|---|---|---|
| `sn1.32:14.1` | Dhammaṁ care yopi samuñjakaṁ care, | 6 | “If one practises the Dhamma / Though getting on by gleaning, / If while one supports one’s wife / One gives from the little one has, / Then a hundred thousand offerings / Of those who sacrifice a th… |
| `an4.3:4.1` | Appamatto ayaṁ kali, | 4 | Slight is the unlucky throw at dice / that results in the loss of one’s wealth, / the loss of all, oneself included; / much worse is this unlucky throw |
| `sn22.82:15.1` | “Dve khandhā taññeva siyaṁ, | 4 | These are the ten questions / The bhikkhu came to ask: / Two about the aggregates, / Whether the same, can there be, |
| `an3.29:5.4` | Bhogāni pariyesati. | 3 | is a hypocrite who seeks wealth, / sometimes righteously / and sometimes unrighteously. |
| `mn82:42.18` | Citaṁ samādāya tatoḍahanti. | 3 | To place it on a pyre and burn it there. / Clad in a shroud, he leaves his wealth behind, / Prodded with stakes he burns upon the pyre. |
| `sn1.20:25.6` | Saggesu vā sabbanivesanesu. | 3 | Here and beyond, in the heavens and all abodes, / They do not find the one whose knots are cut, / The one untroubled, free of longing. |
| `an8.29:18.1` | Khaṇaṁ paccaviduṁ loke, | 3 | Those who have practiced the path, / proclaimed by the Tathāgata, / have penetrated the right moment in the world |
| `thag8.1:2.2` | Yāyaṁ vandanapūjanā kulesu; | 2 | They knew as a bog this homage and veneration / Obtained among devoted families. |
| `an4.13:2.1` | Sammappadhānā māradheyyābhibhūtā, | 2 | Those who strive rightly / overcome the realm of Māra; |
| `sn5.4:6.4` | sabbattha vihato tamo”ti. | 2 | And those peaceful attainments too: / Everywhere darkness has been destroyed.” |
