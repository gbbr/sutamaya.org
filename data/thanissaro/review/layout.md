# How Ṭhānissaro's translation fits the Pali's markup

The app takes each line's role — heading, prose, verse line, closing line — from the Pali's markup in
`data/html`, whatever English sits on the line. This report measures where Ṭhānissaro Bhikkhu's
segmented English (`data/thanissaro/sutta/`) and that markup disagree, in the three places
`data/upstream/README.md` names under "Fit each translation's layout to the Pali's markup": text on
closing and summary lines, the translator's own headings, and his verse line breaks.

## What it is drawn from

| | Count |
|---|---|
| Texts (translation files) | 1,448 |
| Upstream pages read | 1,434 files, 1,442 texts (some files hold several) |
| Lines (Pali segment keys) | 80,019 |
| Lines with English | 63,225 |
| Lines with English found verbatim, in order, in the parsed page | 61,822 |
| Title lines (from the page's `<h1>`, not its body) | 1,411 |

The pages are read the way the segmenter reads them (`scripts/segment-translations.mjs`): each
page becomes a run of blocks, one per paragraph, heading, speaker label or verse line, each verse
line being a `<p>` in a `div.verse` or `div.verse-add`, a line of a `<pre>`, or a line after a
`<br>`. Every line with English outside the titles is found word for word, in order, in that run,
so each line's English can be placed against the translator's blocks exactly: where it starts and
ends, and which blocks it touches.

A line's role is the innermost element open at its `{}` in `data/html`, and for a verse line the
`<blockquote>` around it. The roles that hold English:

| Role in the Pali markup | Lines | With English |
|---|---|---|
| `<p>` (prose) | 56,070 | 47,029 |
| `span.verse-line` in `blockquote.gatha` | 15,774 | 14,256 |
| `h1.sutta-title`, `h1.range-title` | 1,448 | 1,410 |
| `h2.sutta-title`, `h2`–`h5` | 755 | 117 |
| closing and summary lines (below) | 2,616 | 190 |
| `li` in the header, `span.evam`, `span.speaker`, other | 3,356 | 223 |

## Closing and summary lines

The Pali's closing and summary lines, by the classes the markup uses:

| Class | Lines | With English |
|---|---|---|
| `p.endsutta` ("Paṭhamaṁ.", "… Upacālā therī …") | 1,383 | 130 |
| `p.endsection` ("Cūḷasīlaṁ niṭṭhitaṁ.") | 69 | 28 |
| `span.verse-line` in `blockquote.uddanagatha` (chapter summary) | 776 | 17 |
| `p.endvagga` ("Bālavaggo pañcamo.") | 169 | 8 |
| `p.uddana-intro` ("Tassuddānaṁ") | 150 | 4 |
| `p.endbook` ("Sattakanipāto niṭṭhito.") | 38 | 3 |
| `p.endkanda`, `p.end`, `blockquote.vagguddanagatha` | 31 | 0 |
| **All** | **2,616** | **190** |

None of the 190 translates the Pali on its line: Ṭhānissaro doesn't render the closing numbers,
chapter ends or summaries. What sits there is one of these:

| What the English is | Lines |
|---|---|
| **Belongs on the line above**: the sutta's or section's last words | 155 |
| — a later line of a stanza begun above | 120 |
| — the rest of a paragraph or verse line begun above | 34 |
| — the translation of the Pali line just above, which is left empty | 1 |
| **The translator's own closing words**, with no Pali line of their own | 10 |
| — on the sutta's closing line, where they suit it | 7 |
| — on a chapter-end or summary line | 3 |
| **An editorial remark** at the end: a cross-reference or note | 3 |
| **Belongs on the line below**: a section number or heading that opens the next part | 22 |

### How they were told apart

Each line's English was placed against the page's blocks, then sorted by these rules, in order.
All 190 were then read against the lines around them, and the rules' sorting stands.

1. It is a closing formula the Pali lacks ("That is what the Blessed One said. Gratified…", "the
   Blessed One said.") — own closing words. None of the six suttas with "That is what the Blessed
   One said" has an "Idamavoca" line in the Pali.
2. It begins "See also", "Note:" or "For more on" — an editorial remark.
3. It starts partway into one of the translator's blocks — belongs above.
4. It starts a verse line that isn't the first of its stanza — belongs above.
5. It starts a block that runs on into the next line — belongs below.
6. The line just above has no English, and Sujato translates it — belongs above.

Rules 1, 2 and 6 are heuristic, matching words; rules 3 to 5 rest on exact positions.

### Own closing words

| Key | English | Role | Pali on the line |
|---|---|---|---|
| sn45.8:10.7 | That is what the Blessed One said. Gratified, the monks delighted in the Blessed One's words. | `p.endsutta` | Aṭṭhamaṁ. |
| an8.53:3.12 | That is what the Blessed One said. Gratified, Mahāpājapati Gotamī delighted in his words. | `p.endsutta` | Tatiyaṁ. |
| an6.19:16.4 | That is what the Blessed One said. Gratified, the monks delighted in the Blessed One's words. | `p.endsutta` | Navamaṁ. |
| an3.136:1.16 | That is what the Blessed One said. Gratified, the monks delighted at his words. | `p.endsutta` | Catutthaṁ. |
| an5.28:16.3 | That is what the Blessed One said. Gratified, the monks delighted in the Blessed One's words. | `p.endsutta` | Aṭṭhamaṁ. |
| snp4.13:20.5 | the Blessed One said. | `p.endsutta` | Mahābyūhasuttaṁ terasamaṁ. |
| snp4.15:20.5 | the Blessed One said. | `p.endsutta` | Attadaṇḍasuttaṁ pannarasamaṁ. |
| an6.20:8.3 | That is what the Blessed One said. | `p.endvagga` | Sāraṇīyavaggo dutiyo. |
| an6.20:9.0 | Gratified, the monks delighted in the Blessed One's words. | `p.uddana-intro` | Tassuddānaṁ |
| snp4.16:22.3 | the Blessed One said. | `uddanagatha` verse line | Metteyyo ca pasūro ca, |

The three remarks: ud7.8:4.7 "For more on this topic, see The Paradox of Becoming, chapter 5.",
sn48.8:1.20 "See also SN 45:8 and SN 56:11." and an9.42:12.3 "Note: The following three discourses
show…", all on `p.endsutta`.

### Belongs on the line above

| Key | English | Role | Pali on the line | Why |
|---|---|---|---|---|
| ud5.1:6.5 | if you love yourself. | `p.endsutta` | Paṭhamaṁ. | last line of the closing stanza |
| dhp75:7 | instead. | `p.endvagga` | Bālavaggo pañcamo. | last line of the chapter's last verse |
| thig7.3:8.1 | End-maker, | `p.endsutta` | … Upacālā therī …. | a stanza line; the next one is on the `endbook` line |
| thig7.3:9.1 | struck down. | `p.endbook` | Sattakanipāto niṭṭhito. | last line of the same stanza |
| iti99:8.3 | citing, | `p.endvagga` | Pañcamo vaggo. | a stanza line; "reciting." sits on the summary |
| ud3.10:10.0 | Such. | `p.uddana-intro` | Tassuddānaṁ | end of the verse line ": Such.", its colon on the `endsutta` line |
| an9.41:17.1 | There is now no further becoming.'" | `uddanagatha` verse line | Dve vihārā ca nibbānaṁ, | end of the sutta's last paragraph |
| mn35:30.8 | that will be for you." | `p.endsutta` | Cūḷasaccakasuttaṁ niṭṭhitaṁ pañcamaṁ. | end of the sutta's last paragraph |
| mn1:98.5 | I tell you. | `p.endsection` | Khīṇāsavavasena … niṭṭhito. | end of the section's last sentence |
| dn2:45.21 | "This, too, is part of his virtue. | `p.endsection` | Cūḷasīlaṁ niṭṭhitaṁ. | translates dn2:45.20, "Idampissa hoti sīlasmiṁ.", left empty |

### Belongs on the line below

In MN 10 and DN 22, the numbers that open each part ("[2]", "[3]") and the letters of the part
headings ("A." of "A. Body", "E." of "E. Conclusion") land on the `p.endsection` line before them:
19 lines. The other three are an1.30:1.3 "39." (the next sutta's number, on `p.endsutta`), and
sn56.102:1.9 "Then the Blessed One," and sn56.103:1.2 "…", the next sutta's opening words on a
page holding several.

## The translator's own headings

His headings in the text are the `<h2>` and `<h3>` elements inside `<div id="sutta">`, after the
introduction; `h2.intro` ("Introduction") is part of the introduction and not the text. There are
274 in 36 texts (263 `<h2>`, 11 `<h3>`), most in DN and MN. DN 1 also has 10 bold lines
(`<p class="seealso"><strong>`, "Eternalism", "Partial Eternalism", …), which the segmenter keeps
with the notes as "see also" and not in the text; they are not counted here.

| Where the heading lands | Headings |
|---|---|
| **On a Pali heading line**, alone on it | 78 |
| — `h2` | 46 |
| — `h3` | 15 |
| — `h5` | 16 |
| — `h4` | 1 |
| **On a plain line** (`<p>`, or a verse line once) | 192 |
| — opening the line, the paragraph's words after it | 171 |
| — after the end of the paragraph before it, on the same line | 19 |
| — alone, on a line whose Pali is prose | 2 |
| **Split**: its letter on a `p.endsection` line, the rest on the `h2` below | 4 |

Of the 192 on plain lines, 190 have no Pali heading line near them: the Pali has no heading there
at all. The other two have an empty Pali heading line just above (dn29:6.0, `h2`; sn43.12:0.1,
`li.division`). All 78 that fit are in DN 1, 2, 11, 15, 16, 22, 29, 33, 34 and MN 10, where the Pali's own
section headings match his.

The count is exact: a heading lands where its first word falls.

### On a Pali heading line

| Key | His heading | Pali role | Sujato's heading |
|---|---|---|---|
| dn1:1.0 | [ I ] | `h2` | 1. Talk on Wanderers |
| dn1:2.1.0 | [ II ] | `h4` | 3.1.2. Partial Eternalism |
| dn1:3.45.0 | Conditioned by Contact | `h3` | 4.2. Dependent On contact |
| dn2:22.0 | Annihilation | `h3` | 3.3. The Doctrine of Ajita of the Hair Blanket |
| dn2:66.0 | Contentedness | `h5` | 4.3.2.3. Contentment |
| dn2:89.0 | Clairaudience | `h5` | 4.3.3.4. Clairaudience |
| dn11:6.0 | The Miracle of Telepathy | `h2` | 2. The Demonstration of Revealing |
| dn15:23.0 | Delineations of a Self | `h2` | 2. Describing the Self |
| dn16:2.1.0 | [ II ] | `h2` | 8. Talk on the Noble Truths |
| dn22:11.0 | B. Feelings | `h2` | 2. Observing the Feelings |

### On a plain line

| Key | English on the line | Pali role |
|---|---|---|
| an10.176:6.1 | **Unskillful Bodily Action** "And how is one made impure in three ways by bodily action? | `p` |
| an10.99:11.1 | **Virtue** "When he has thus gone forth, endowed with the monks' training & livelihood, then… | `p` |
| dn15:4.1 | **Aging-&-Death** "'From birth as a requisite condition comes aging-&-death.' Thus it has been said… | `p` |
| mn9:2.8 | **Skillful & Unskillful** Ven. Sāriputta said, | `p` |
| mn38:9.1 | **On Becoming** "Monks, do you see, 'This has come to be'?" | `p` |
| mn77:15.1 | **The Four Establishings of Mindfulness** "Further, I have pointed out to my disciples… | `p` |
| sn46.51:1.4 | **Feeding the hindrances** "And what is the food for the arising of unarisen sensual desire… | `p` |
| snp5.1:1.1 | **Prologue** From the delightful city of the Kosalans, | verse line |
| dn2:13.5 | "Ask, great king, whatever you like." **The King's Question** | `p` |
| mn43:1.4 | he sat to one side. **Discernment** As he was sitting there, he said to Ven. Sāriputta… | `p` |

The split ones are dn22:1.13 and mn10:3.6 ("A." of "A. Body") and dn22:21.42 and mn10:45.5 ("E." of
"E. Conclusion").

### Speaker labels

His speaker labels in verse (`p.vspk`, "The Buddha:", "Dhaniya:") are headings of a kind, and are
counted apart: 305 of them. 12 land on the Pali's own `span.speaker` line, 8 of them alone; 286 open
or sit inside a verse line and 7 a prose line.

## Verse lines holding several of his lines

| | Count |
|---|---|
| Pali verse lines (`span.verse-line`, all blockquotes) | 16,558 |
| — with English | 14,273 |
| — holding two or more of his verse lines, whole or in part | 5,564 (39%) |
| — — of which at least two are whole lines | 5,292 |
| — — of which a new stanza of his starts inside the line | 167 |
| His line breaks falling inside a Pali verse line | 7,094 |
| Lines touching two or more of his blocks but only one verse line, the rest a speaker label or prose | 179 (not counted above) |

By collection:

| Book | Verse lines with English | Holding two or more of his | Share |
|---|---|---|---|
| Snp | 4,520 | 1,884 | 42% |
| Thag | 1,859 | 691 | 37% |
| SN | 1,803 | 718 | 40% |
| Dhp | 1,631 | 777 | 48% |
| Iti | 1,061 | 420 | 40% |
| AN | 1,051 | 316 | 30% |
| Thig | 1,002 | 298 | 30% |
| MN | 512 | 187 | 37% |
| DN | 431 | 73 | 17% |
| Ud | 403 | 200 | 50% |

The count is exact: a Pali verse line counts when its English touches two or more of the page's
verse lines (`<p>` in a verse div, `<pre>` line or `<br>` line). A line he breaks across two Pali
lines counts on both.

### Examples

" / " marks where his line breaks fall inside the one Pali line.

| Key | English, with his breaks | Pali |
|---|---|---|
| dhp1:2 | ruled by the heart, / made of the heart. | manoseṭṭhā manomayā; |
| dhp96:4 | one who's released through right knowing, / pacified, / Such. | upasantassa tādino. |
| snp4.4:3.2 | Unsmeared with regard / to what's seen, heard, sensed, / habits or practices, | Diṭṭhe sute sīlavate mute vā; |
| thag17.2:11.4 | that place is delightful / where arahants dwell. | Taṁ bhūmirāmaṇeyyakaṁ. |
| thig14.1:8.3 | You want to go / unaccompanied | Asahāyikā gantumicchasi, |
| ud3.9:8.1 | Supporting himself / without a craft– / light, desiring the goal– | "Asippajīvī lahu atthakāmo, |
| iti49:6.1 | Those, having seen / what's come to be / as what's come to be, | "Ye bhūtaṁ bhūtato disvā, |
| an6.45:20.1 | He, / with evil actions, / his wisdom weak, | So pāpakammo dummedho, |
| mn128:6.40 | Go alone, / doing no evil, | Eko care na ca pāpāni kayirā, |
| dn20:21.14 | a storm cloud bursts with thunder, / lightning, & torrents of rain. | thanayanto savijjuko; |

## Where to look

| What | Where |
|---|---|
| The segmented translation | `data/thanissaro/sutta/` |
| The Pali's markup, which gives each line its role | `data/html/pli/ms/sutta/` |
| The translator's pages | `data/upstream/thanissaro/sutta/` |
| Sujato's text on the same keys | `data/sujato/sutta/` |
| How a page is read into headings, paragraphs and verse lines | `scripts/segment-translations.mjs` |
| The layout work this measures | `data/upstream/README.md`'s "What's left" |
