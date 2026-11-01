# Bodhi and Ṭhānissaro translations

Two more English translations of the suttas the app carries, Bhikkhu Bodhi's and Ṭhānissaro
Bhikkhu's. This folder keeps them as their sources publish them. The segmenter,
`scripts/segmenter/segment-translations.mjs`, cuts each text onto the Pali's lines, in
`data/sujato/`'s layout, and writes them to `data/bodhi/` and `data/thanissaro/`, where reviews
settle the cuts it is unsure of.

## What's left

The work has two aims: these texts aligned with their Pali, and a process that brings every new or
revised sutta from either translator into the same shape with as little review as possible. So
each rule the work settles goes, in the same change, into "Segmenting", as something the segmenter
does itself wherever it can, or into "Reviewing new and revised texts", leaving readers only what a
rule can't decide.

Both translations are segmented and reviewed, and what the rounds settled is in the files the
segmenter keeps: the rules are in "The files", "Segmenting" and "Building them into the app".

The app takes them in as "Building them into the app" sets out. The build writes the texts and the
index names them ([docs/corpus.md](../../docs/corpus.md)'s "Other translations"). The Reader shows
the translation the address names, with its markup and source credit; Help gives both
translations' terms. The translator button switches between them at the line being read, with one
step in the history, and opening a sutta preloads its other translations. Settings' offline
download, the native bundle and its over-the-air updates carry every offered translation,
including for suttas never opened. Each translation keeps its own highlights, which the badges
count together.

What remains is the question in "Open questions for the Reader": whether the search of the canon
covers them.

## What's here

| Path | Contents |
|---|---|
| `bodhi/` | Bhikkhu Bodhi: 47 MN, 798 SN and 312 AN pages from Wisdom Publications, and DN 1, 2 and 15 from the Buddhist Publication Society, all via SuttaCentral; Thag 8.1 from Access to Insight; notes for DN 1 |
| `thanissaro/` | Ṭhānissaro Bhikkhu: 1,427 texts from dhammatalks.org, 3 older ones from SuttaCentral for suttas dhammatalks.org lacks, and the Dhammapada's endnotes |
| `*/sources.json` | The source URL of every file, and the date they were fetched |

SuttaCentral's files are from sc-data at commit `8442c9f`. Every text is one the app has.

## Coverage

The share of the app's texts in each book that hold each translation's text. A text the app groups
from several suttas, as in AN 1 and AN 2, counts when any of them holds some.

| Book | Ṭhānissaro | Bodhi |
|---|---|---|
| DN | 41% | 9% |
| MN | 70% | 31% |
| SN | 27% | 44% |
| AN | 29% | 22% |
| Dhp | 100% | 0% |
| Iti | 100% | 0% |
| Snp | 100% | 0% |
| Thag | 39% | 0% |
| Thig | 47% | 0% |
| Ud | 100% | 0% |
| **All** | **36%** | **29%** |

## Layout and IDs

Each file sits in the folder that holds Sujato's text of the same sutta and is named by the app's
sutta ID: `thanissaro/sutta/an/an3/an3.65.html`. Notes published apart from their text go under
`notes/`, as Sujato's do. Bodhi's files keep SuttaCentral's numbers, which are the app's. His shared
SN 35 and SN 45 pages are named by their full coverage, as `sn35.43-52.html` for the app's
`sn35.43-51` and `sn35.52`, and `sn45.50-55.html` for `sn45.50-54` and `sn45.55`.

- A page covering several of the app's suttas is named by the span: `sn15.14-19.html`.
  A page covering several spans names each, after a comma: `an1.21-30,39-40.html`.
- In AN 1 and AN 2, where the app joins suttas into one text, a file is named by its single sutta:
  `an1.47.html` belongs to the app's `an1.41-50`.
- Where the Thai edition splits one of the app's suttas in two, its file holds both pages, one
  `<div id="sutta">` each: `an2.31.html` has dhammatalks.org's AN 2:29 and 2:30, and
  `sn22.126.html` its SN 22:126 and 22:127.

dhammatalks.org numbers suttas by the Thai edition, which differs from SuttaCentral's in parts of
AN, SN 35, Snp 5 and Thag, so 155 of its pages carry a different number here: its AN 3:66, the
Kālāma Sutta, is `an3.65`. Each number comes from comparing the page with Sujato's text and the Pali
title, cross-checked against SuttaCentral's copies of the same translations. The evidence is
thinnest where neighbouring suttas are near-identical (AN 3.96–97, AN 4.233–238, AN 5.74, AN 9.8)
and for the single-sutta names in AN 1 and AN 2. Segmenting finds no page whose English matches its
Pali lines poorly, as a wrongly numbered one would, though near-identical suttas match either way.

Some dhammatalks.org pages hold several suttas, each under its own `<h1>`, as SN 25's do; each is
saved under every sutta it holds, and only the section a file is named for is read as its text.

## The files

- **dhammatalks.org** — each page's text block, `<div id="sutta">`, without the site around it. The
  translator's introduction is the italic paragraphs after the `<h1>`; the notes close the block.
  The Dhammapada's notes are in `notes/kn/dhp/endnotes.html`, which its chapters link to.
  Its Thai-numbered AN 5:254–259 is saved unchanged as `sutta/an/an5/an5.254-271.html`: its six
  blocks belong to AN 5.254, 255, 256, 257–263, 264 and 265–271, in that order. The span in the
  filename supplies those app IDs to the segmenter, including the app's grouped texts.
- **SuttaCentral** — its HTML as published, with SuttaCentral and PTS references
  (`<a class='ref …'>`) and the licence at the end. None carries notes. Bodhi's shared SN 35.43–52
  body and eight shared SN 45 bodies are saved once, byte for byte from the range copy; the
  repeated terminal-sutta copy is absent, and `sources.json` gives the retained copy's URL under
  its full-span filename.
- **Ṭhānissaro's older copies** — `an1.31-40`, `an11.16` and `an11.17` are Access to Insight's
  2013 versions, which dhammatalks.org supersedes wherever it has the sutta: `an1.31-40`'s 1.39–40
  are read from `an1.21-30,39-40.html` instead. The older `an5.257-263`, `an5.264` and
  `an5.265-271` pages were removed; all three texts read dhammatalks.org's `an5.254-271.html`.
- **Bodhi's notes** — free only for DN 1: `notes/dn/dn1.html` is Access to Insight's copy of the
  same translation with its notes, while `sutta/dn/dn1.html` has the fuller text. His notes to MN,
  SN and AN are only in Wisdom's books.

## Licences

| Source | Terms |
|---|---|
| Bodhi, Wisdom Publications | CC BY-NC-ND 3.0: credit, no charge, wording unchanged |
| Bodhi, Buddhist Publication Society | Free distribution: may be reformatted and shared free of charge; derived works marked as such |
| Ṭhānissaro, dhammatalks.org | CC BY-NC 4.0; the author counts any sale as commercial |
| Ṭhānissaro, older copies | CC BY-NC 4.0, or Access to Insight's free-distribution terms |

The editorial rules over Sujato's English ([docs/retranslation.md](../../docs/retranslation.md))
are not meant for either translation. A citation shown in the app's form ("3:2" as "AN3.2", with a
link) counts as layout, not a change to the translator's wording.

## Pulling updates

dhammatalks.org revises its translations and adds new ones; Bodhi's change rarely.

1. **A page already here**: fetch its URL from `sources.json` again and keep what the files here
   keep: the page's `<title>` and its `<div id="sutta">`, in the same bare document. Replace the
   file only if that block changed, line breaks included, and update the fetch date.
2. **A page the site adds**: find it in the site's sutta index (`https://www.dhammatalks.org/suttas/`),
   name it by the app's sutta ID as above, checking the number against Sujato's text and the Pali
   title where the Thai numbering differs, and add its URL to `sources.json`. Only texts the app
   carries belong here.
   For Ṭhānissaro, a page's span names the app IDs it covers, even when the Thai title's span is
   shorter, as with AN 5:254–259 in `an5.254-271.html`. Remove older pages it replaces in full
   and their entries in `sources.json`; a partially replaced page stays for the suttas still
   read from it, as `an1.31-40.html` does.
3. **SuttaCentral's files** (Bodhi, and Ṭhānissaro's older copies): copy them again from sc-data's
   `html_text/en/pli/sutta/`, and update the commit above. For Bodhi's shared SN 35 and SN 45
   pages, keep one range copy under its full span, with its original URL; leave out its duplicate
   terminal copy, and confirm the two bodies still match before treating them as one.
4. **Review** the new and revised texts, as "Reviewing new and revised texts" says: the round
   segments them first.

## Segmenting

The segmenter aligns each text with the Pali's lines, reading what each line says from Sujato's
English and the dictionary, and scores how sure it is of every cut. It writes `data/<translator>/`
in `data/sujato/`'s layout:

| Path | Holds |
|---|---|
| `sutta/`, `notes/` | each Pali line's English, and the translator's notes; the note on a sutta's title line (or its first line, where it has none) holds his introduction and "See also" |
| `cuts.json` | what the reviews settled, by line, kept across runs |
| `learned.json` | the translator's words learned for Sujato's |
| `report.json` | each text's alignment and how sure it is |
| `covered.json` | the empty lines whose content the English above translates and whose Pali joins it, including within a hidden run |
| `references.json` | each place in his text, notes and introductions that points to another sutta or cites one |
| `page-layouts.json` | Ṭhānissaro's pages given whole to each app text they cover |

- **The words are only cut**: a text whose lines, joined, aren't word for word its page is reported
  and not written.
- **One file per app text, every line kept**: each file has the name and the line keys of the app's
  file for the same text, so the app matches a translation by its own sutta ID. A line the
  translator leaves empty stays in, as `""`. So does a sutta he doesn't translate at all, where the
  app's file covers more than his page does (`an1.142-149` in `an1.140-149`). Lines Sujato leaves
  empty can hold the translator's text.
- **One passage standing for several app texts**, as in Ṭhānissaro's SN 15.14–19 and Iti 10–13,
  is given whole to each of them, title included, on its own Pali lines, each copy aligned on its
  own; the page's words are learned once. The `wholePages` entries in `page-layouts.json` list
  these pages, and `check-upstream.py` reads the page for every copy. A page giving distinct
  formulations in sequence, as Bodhi's SN 35 and SN 45 pages do, is read as one stream across its
  texts instead.
- **Verse** is laid out by the segmenter itself: the translator's lines stay whole, the first on
  the verse's first Pali line; equal counts take one on each Pali line, and unequal counts use as
  many Pali lines as there are whole lines of his to fill them. A speaker's label stays with the
  speech. `report.json`'s `verseLayouts` lists the layouts applied, declined, or kept because a
  review settled them.
- **A note standing for a passage** ("As in AN8.46, including the verses", "This sutta is
  identical with the preceding one", "The rest…") goes whole on the first Pali line of the passage
  it stands for, with its page references and ellipses; one inside a sentence or a list keeps its
  place. `report.json`'s `notePlacements` records each placement tried.
- **Commentary** goes to the notes, in page order: the page readers take out introductory prose
  (short roman Pali terms in italic introductions included), labelled alternative renderings,
  closing note continuations and closing references. A bracketed aside inside a translated
  paragraph stays in the text. `check-upstream.py` reads these categories its own way, so moving
  commentary never excuses a missing or rewritten word.
- **Paragraph openings**: an unfinished quoted lead-in ending in a colon stays with the rest of
  its prose paragraph when it straddles a Pali paragraph break: from the last of several Pali
  prose lines to the next paragraph's first line, within the same sutta. A complete sentence or
  narrative attribution keeps its Pali alignment; his paragraph can span more than one of the
  Pali's. Thus DN 1's "“Or he might say:" and "“Or:" open the next item, leaving the untranslated
  refrain's Pali to join the line above by the Reader's usual rule. `report.json`'s
  `paragraphOpenings` records each join and each candidate kept by a settled cut.
- **Ṭhānissaro's hearing formula**: an *Evaṁ me sutaṁ* line holding only the unfinished prose
  “I have heard that” joins the next line's English within the same source paragraph and sutta.
  A source heading before the formula stays with it, and a Pali paragraph break does not split
  the sentence. The next line is empty; `covered.json` keeps its Pali under the opening even
  before more empty lines. This join applies to saved cuts splitting the formula too, and
  `report.json`'s `heardOpenings` lists the joined pairs. A complete opening sentence, including
  Bodhi's “Thus have I heard.”, keeps its alignment.
- **Settled cuts win** over the alignment, a verse's layout, a note's placement and a paragraph
  opening's join alike, wherever their words still fit; the run names those that no longer do,
  and `report.json` lists them under `stale`. A saved start before a lead-in is compatible with
  joining that opening to its continuation. Only the unfinished hearing formula above overrides
  a saved split. A verse a review settled keeps its layout.
- **Markup**: a line's English carries a newline where a verse line of the translator's starts
  inside it, `<p>` where two or more of his prose paragraphs share the line, and
  `<ul><li>` round his bulleted list items. The whitespace between blocks stays in the text.
  Ṭhānissaro's `<div class="iblock">` and `<div class="sq-list">` give tight, indented,
  unbulleted lists only where the wrapper holds at least two direct `<p>` children and no other
  content, and every item except the last ends in `;`, `,` or `—`, ignoring note markers and
  whitespace. Other source prose keeps ordinary paragraphs. The test uses complete source items;
  each list fragment keeps its wrapper when a Pali line cuts through it, including a fragment
  alone on a line. These classes carry layout only and do not affect the cuts.
  `<span class="heading">` marks a heading of his that no Pali heading line holds, or a sutta's
  title that no title line holds, at the start of its text. One source heading split across
  consecutive Pali heading lines sits whole on the first; the others' English is empty.
  `<span class="speaker">` keeps a source-marked speaker label: dhammatalks.org's `p.vspk`
  or SuttaCentral's `span.speaker`, including an attribution inline before prose. Its words,
  spacing and verse breaks keep their place; a name or colon alone never identifies a speaker.
  SN 5.9's editorial “*Alternative reading:”, which the source styles the same way, stays plain.
  `<a href>` marks a reference in his text to another sutta, written the app's way ("as in 3:2"
  becomes "as in AN3.2"), from `references.json`.

## Reviewing new and revised texts

An update brings a few texts at a time, new or revised. One strong model reads every line of each
against its Pali and fixes what is off, a model of the other kind judges its changes, and three
checks catch what neither would see: a changed word, a cut verse line, hidden Pali. The round runs
in an isolated copy, a git worktree with `node_modules` linked, since even `--findings` writes
files. Only its results come back: the texts, the notes and the files the segmenter keeps. Its
packets and answers stay in the worktree, since `cuts.json` keeps what they settle.

1. **Segment** the texts, named as their pages here are named, with a plain run; a text outside
   them that the run changes (`git status`) joins them. For a revised text, the settled cuts that
   no longer fit (`report.json`'s `stale`) come out of `cuts.json`, since the read covers every
   line. A new page shared by several texts goes into `wholePages` where it is one passage standing
   for each. The result is committed in the worktree, as the judge's starting point.
2. **Read** every line against the Pali, from `review-pali.py packet <translator> <page>… --out
   data/<translator>/review/<folder>`, with [review-rounds.md](review-rounds.md)'s "The reading
   prompt". The findings are kept with `--keep-findings`; any it can't apply
   (`review-rounds.py <translator> flagged`) are fixed by hand in `review/hand/` ("The flagged
   prompt"). The lines the read marks covered that `check-round.py` lists as hidden go into
   `covered.json`, with every line hidden in a verse he translates, and the texts' references into
   `references.json` ("The references prompt").
3. **Check**: `check-upstream.py` shows nothing beyond references, heading numbers and page
   furniture, `check-integrity.py` nothing at all, and `check-round.py <translator> --base <the
   branch's last commit>` no verse line cut and no newly hidden line but repetition the English
   abbreviates. Whatever they show is fixed by hand, or in the segmenter.
4. **Judge**: `review-rounds.py <translator> check` writes every change since the commit in step 1,
   with the Pali, for a model of the other kind ("The check prompt"): Codex where Claude read,
   Claude where Codex did, or, without Codex, Sonnet where Opus read. A change judged worse is fixed
   or dropped.
5. **Commit**, once a plain run writes nothing new: the results are copied back and committed.

Readers work at effort high, three at once on Claude and six on Codex, and one session at a time
writes a translator's files. The Pali decides; Sujato's English is context only. On Bodhi's shared
SN 35 and SN 45 pages, read as one stream, a formula the texts share stays where it is first
translated, each listed variant sits on its own Pali line, and the final passage on the terminal
sutta's. What a line's start can't mend, the segmenter learns, so that a fresh run writes it, and
its rule goes into "Segmenting".

## Building them into the app

Once segmenting is done, the app's build takes these translations in. What it must do:

- Offer a translation for a text only where it translates the whole text, so a reader never gets
  part of one. A file holding no more than titles isn't a translation (see "Segmenting"):
  - **a group** counts as whole when his pages cover every sutta in it, though an abbreviation can
    leave a sutta without a line of its own (Bodhi's SN 12.83–92, SN 43.14–43 in both). One he
    only partly translates, as with Ṭhānissaro's selections in AN 1 and AN 2, isn't offered;
  - **a sutta he gives in excerpt** isn't offered: Ṭhānissaro's DN 21, DN 26, MN 54 and MN 91;
  - **one page for several of the app's texts**, giving them in a single passage as Ṭhānissaro's
    SN 15.14–19 and Iti 10–13 do, is shown whole on each of them.
- Credit each text's source and keep its terms (see "Licences"): Bodhi's Wisdom texts are shown
  unchanged, and none of these is sold. The editorial rules over Sujato's English never apply.
- Lines pair with the Pali, not one to one with Sujato's, and a line Sujato leaves empty can hold
  text:
  - **prose**: a sentence spanning several Pali lines sits on the first and leaves the rest empty;
  - **verse**: the translator's lines are spread over the verse's Pali lines in order, each kept
    whole as he prints it, the way Sujato's are: his first line on the verse's first Pali line,
    and every Pali line showing under one of his. A line needn't translate the Pali it sits on;
    the verse must. The English never matches the Pali line for line, and the Pali's line keys
    never change;
  - **a note in place of a passage**, such as Bodhi's "As in AN8.46, including the verses": whole,
    on the first Pali line of the passage it stands for, whose other lines stay hidden. A note
    standing for part of a sentence or a list item sits where that sentence starts;
  - **a passage printed at a different point from the Pali**: it stays where his page puts it,
    on the nearest line, and its own Pali stays hidden, as with Ṭhānissaro's second prose
    paragraph in AN 4.19 (its Pali is 2.1–2.4, before both verses) and the closing sentence of
    his SN 4.24 (its Pali is SN 4.25:1.1). The translation never changes in any way: not a word,
    and not its order, which `check-upstream.py` enforces. His commentary on the same page
    (introductions, closing remarks, alternative renderings) isn't translation: it goes to
    `notes/`. A bracketed aside inside his paragraph, such as "[Commentary: the five
    hindrances]" or "[literally: otherness]", is part of his text and stays. Tapping such a
    passage shows the Pali of the line it sits on, as with the lines Sujato's text gives out of
    order: both texts keep their own order.
- The Pali under an English line follows the rule for Sujato's lines ([docs/corpus.md](../../docs/corpus.md)'s
  "A segment"): a lone empty line in its paragraph joins the line above, and a run of two or more
  stays hidden, since most runs are repetitions the translator abbreviates. The exception is the
  lines in `covered.json`, whose own content the English above renders, as where Bodhi gives a
  list whole in one sentence (AN 8.46:1.5–1.7): they join it too. A repetition the English
  abbreviates or compresses is never covered, even where the English mentions it, nor is a
  passage rendered earlier than its Pali (Bodhi's SN 4.25, 12.68 and 22.80, Ṭhānissaro's
  SN 22.58), and a doubtful line isn't either: a missing entry only hides Pali, while a wrong one
  puts repetition under a line. In a verse he translates, every Pali line the rule would hide is covered, unless he
  shortens the verse to "…", which leaves the rest of its Pali hidden like other repetition.
  A verse he gives only as a note, as in Bodhi's AN 4.56 ("The verses are identical with those
  of AN 4.55"), stays hidden too: the note's link takes the reader to the verse. The Pali's
  paragraphs come from its markup (`data/html`), not the line keys, which make each of the
  Dhammapada's verse lines a paragraph of its own.
- The markup to render:
  - **text** (`sutta/`): a newline inside a line where one of the translator's verse lines starts,
    as throughout the Dhammapada; `<p>` for his paragraphs sharing a line, or for one sharing a
    Pali verse line with his verse, as SN 4.24's closing sentence does, `<ul><li>` for his
    bulleted lists, and `<div class="iblock">` or `<div class="sq-list">` around `<p>` children
    for the unbulleted lists recognized in "Segmenting"; `<span class="heading">` for a heading
    or title, `<span class="speaker">` for a source-marked speaker label, and `<a href>` to
    suttacentral.net for a reference to another sutta. The build turns
    this markup into offsets over the unchanged plain text. The Reader draws the blocks around
    the highlights, so selecting part of a paragraph, list item or heading keeps its layout whole. `iblock` and `sq-list`
    lists have no bullets or gaps between items, even across Pali paragraphs. Speaker labels
    use the same muted, smaller type as Sujato's speaker lines. One opening a line, after at most
    the quotation mark opening its paragraph, stands on a line of its own above it, outside a
    verse's rule, as on his page; one closing a line after its other words names the speaker of
    the next line and stands above that one. His prose on a verse line is drawn as prose, outside
    the rule. Highlights and links keep their text offsets. Introductions and
    notes follow their own rules below;
  - **notes** (`notes/`): `<p>`, `<i>`, and `<a href='…'>` to suttacentral.net for references.
  The links open the cited sutta in the app instead: in the same translator's text where he has
  it, Sujato's otherwise.
- The note on a sutta's title line, or on its first line where it has none, holds the translator's
  introduction and "See also". Neither ships: an introduction belongs to a blog more than to a
  study app, and a "See also" list points the reader at dozens of suttas without shedding light on
  the line being read. Both stay in `notes/` in case that changes. Bodhi has notes only for DN 1.
- Only `sutta/`, `notes/` and `covered.json` ship. `cuts.json`, `learned.json`, `report.json`,
  `references.json` and `page-layouts.json` are the segmenter's own.

### Delivering them

Each translation travels the way Sujato's text does, so nothing about loading, caching or the
offline copy is new:

- **Complete documents.** The build writes each translation's texts beside Sujato's, in the same
  format and with its own Pali under its own lines: `text/bodhi/<uid>.json` and
  `text/thanissaro/<uid>.json`. Sujato's files stay as they are. The translations don't share one
  Pali file, so the document the build checks is the one the reader gets, and a newer English
  never meets an older cached Pali.
- **The index** (`corpus.json`) records which translators each text has, so the Reader knows
  without a fetch.
- **Caching, the offline download and the native bundle** take them in as they take Sujato's
  text, and the version that tells a device its offline copy is out of date covers them too.
- **Preloading**: opening a sutta preloads its alternatives, so switching to one is instant and
  works offline for any sutta the reader has opened. Its neighbours are preloaded in Sujato's
  English only, as now. Each is a file of its own, so the text the reader is waiting for never
  waits on the others.

### In the Reader

- **Sujato's text is the main one.** Every sutta opens in it, and Bodhi's and Ṭhānissaro's are
  there to consult. Choosing one is a step in the history, opening at the line being read, so the
  return arrow and Back go back to Sujato's text where the reader left off. Going from one
  alternative to the other replaces that step, so a single return lands on Sujato, and Next and
  Prev from an alternative open the next sutta in Sujato's text. Nothing remembers the choice;
  choosing another default may come once the others cover most of the canon.
- **The address** names an alternative as a query, `/read/mn10?by=bodhi&at=2.7`, the way `?at=`
  names a line: it is the same sutta, so the routes stay as they are. No parameter means Sujato,
  so every existing link keeps its meaning.
- **The switcher** is a pill at the right of the header, beside search and the menu, with the
  current translator's name without his title ("Sujato", "Bodhi", "Ṭhānissaro") and a chevron;
  an icon couldn't say whose text is showing. Its menu gives each name in full. A sutta only
  Sujato translates has no switcher.
- **Switching keeps the reader's place.** The first line wholly in view, 20px below the top of
  the reading pane, stays where it is on screen in the other translation. Where that translation
  doesn't show the line, the nearest line before it that it does takes its place, so nothing the
  reader was in the middle of is skipped. While the sutta's title is still on screen, the other
  translation opens at the top instead. Choosing Sujato in the switcher keeps the line now being
  read; Back and the return arrow restore where Sujato's text was left.
- **The credit** is the header's "Translation: …" line, naming the translator shown and linking
  to that text's source page. Sujato's stays "Bhikkhu Sujato (edited)", linked to the list of
  changes. Help gains a section crediting both translations with their terms, beside Sujato's and
  the dictionary's.
- **Highlights belong to the translation they're made in**, since they're anchored on characters
  of its English; a highlight that names no translation is Sujato's. The Highlights panel lists
  the current translation's first, then a section for each other translator with highlights in
  the sutta, headed by the count badge the sutta's header and the Library show. Tapping one opens
  that translation there, as the switcher does. The badges count the highlights of every
  translation. A new highlight displaces only overlapping ones in its own translation.

### Open questions for the Reader

What's left for when the Reader takes these translations in:

- **Search**: whether the search of the canon covers the alternatives. The sutta on screen is
  searched in the translation showing ([docs/search.md](../../docs/search.md)'s "The sutta being
  read"). Searching every translation at once means
  labelling each result with its translator, a filter would be the only one in the app, and
  searching Sujato's text alone fits its being the main one.

## Where to look

| What | Where |
|---|---|
| The segmenter and its options | `scripts/segmenter/segment-translations.mjs` |
| The read's packets, with the Pali on every row | `scripts/segmenter/review-pali.py` |
| The stretches for fixes by hand, and the judge's packets | `scripts/segmenter/review-rounds.py` |
| The word-for-word check against the pages | `scripts/segmenter/check-upstream.py` |
| The check of titles, headings, closing lines, notes and links | `scripts/segmenter/check-integrity.py` |
| The check of a round's changes against the pages and the reveal rule | `scripts/segmenter/check-round.py` |
| How a session answers a round, and the prompts | [review-rounds.md](review-rounds.md) |
| The reader a read runs | `.claude/agents/line-reader.md` |
| The app's translation choices, history and preloading | [docs/web-app.md](../../docs/web-app.md) |
