# Bodhi and Ṭhānissaro translations

Two more English translations of the suttas the app carries, Bhikkhu Bodhi's and Ṭhānissaro
Bhikkhu's. This folder keeps them as their sources publish them. The segmenter,
`scripts/segmenter/segment-translations.mjs`, cuts each text onto the Pali's lines, in
`data/sujato/`'s layout, and writes them to `data/bodhi/` and `data/thanissaro/`, where reviews
settle the cuts it is unsure of.

## What's left

The work has two aims: these texts aligned with their Pali, and a process that brings every new or
revised sutta from either translator into the same shape with as little review as possible. So
each rule the work settles goes into "Pulling updates" and "Reviewing new and revised texts" in
the same change, as something the segmenter does itself wherever it can, leaving readers only what
a rule can't decide.

1. **Covered lines**: each translation's `covered.json`, the lines in a run of two or more empty
   lines that the English above translates (see "Building them into the app"). Most such runs are
   repetitions the translator abbreviates, which stay out. A passage rendered earlier than its
   Pali, as in Bodhi's SN 4.25, 12.68 and 22.80 and Ṭhānissaro's SN 22.58, isn't covered by the
   line above it. The rounds are in `review/skipped/`.
2. **Verse**: in every collection, each verse's English sits in its own verse, in order, spread
   over its Pali lines as far as the translator's line breaks allow (see "Building them into the
   app"). The rounds are in `review/verse/`.
3. **Source mapping**: Bodhi's eight shared SN 45 pages (45.42–48 through 45.92–96)
   are each saved once under their full span, with their English spread once over both app texts
   by their Pali (`data/bodhi/review/source-mapping-final/`).
   Ṭhānissaro's mapping is settled: dhammatalks.org's Thai-numbered AN 5:254–259 is saved as
   `an5.254-271.html`, covering the app's AN 5.254, 255, 256, 257–263, 264 and 265–271. Each reads
   its part of that page once; the three older duplicate pages have left the folder. The cuts
   were reviewed with Pali on every row (`data/thanissaro/review/source-mapping-reread/`), with
   the numbering evidence in `data/thanissaro/review/codex-read/source-ranges.json`.
4. **Teach the segmenter**: the patterns items 1–3 settle become rules it applies to new texts,
   checked against the reviews' own answers, and the steps in "Reviewing new and revised texts"
   shrink to what the rules leave.
5. **A fresh audit** once the rest is done, drawn as `review/audit5/draw.py` draws, with a new
   seed.

## What's here

| Path | Contents |
|---|---|
| `bodhi/` | Bhikkhu Bodhi: 47 MN, 799 SN and 312 AN pages from Wisdom Publications, and DN 1, 2 and 15 from the Buddhist Publication Society, all via SuttaCentral; Thag 8.1 from Access to Insight; notes for DN 1 |
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
| SN | 26% | 44% |
| AN | 29% | 22% |
| Dhp | 100% | 0% |
| Iti | 98% | 0% |
| Snp | 100% | 0% |
| Thag | 39% | 0% |
| Thig | 47% | 0% |
| Ud | 100% | 0% |
| **All** | **36%** | **29%** |

## Layout and IDs

Each file sits in the folder that holds Sujato's text of the same sutta and is named by the app's
sutta ID: `thanissaro/sutta/an/an3/an3.65.html`. Notes published apart from their text go under
`notes/`, as Sujato's do. Bodhi's files keep SuttaCentral's numbers, which are the app's. His shared SN 45 pages
are named by their full coverage, as `sn45.50-55.html` for the app's `sn45.50-54` and `sn45.55`.

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
  (`<a class='ref …'>`) and the licence at the end. None carries notes. Bodhi's eight shared SN 45
  bodies are saved once, byte for byte from the range copy; the repeated terminal-sutta copy is
  absent, and `sources.json` gives the retained copy's URL under its full-span filename.
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
   file only if that block changed, and update the fetch date.
2. **A page the site adds**: find it in the site's sutta index (`https://www.dhammatalks.org/suttas/`),
   name it by the app's sutta ID as above, checking the number against Sujato's text and the Pali
   title where the Thai numbering differs, and add its URL to `sources.json`. Only texts the app
   carries belong here.
   For Ṭhānissaro, a page's span names the app IDs it covers, even when the Thai title's span is
   shorter, as with AN 5:254–259 in `an5.254-271.html`. Remove older pages it replaces in full
   and their entries in `sources.json`; a partially replaced page stays for the suttas still
   read from it, as `an1.31-40.html` does.
3. **SuttaCentral's files** (Bodhi, and Ṭhānissaro's older copies): copy them again from sc-data's
   `html_text/en/pli/sutta/`, and update the commit above. For Bodhi's shared SN 45 pages, keep
   one range copy under its full span, with its original URL; leave out its duplicate terminal
   copy, and confirm the two bodies still match before treating them as one.
4. **Segment**: `node scripts/segmenter/segment-translations.mjs thanissaro` (or `bodhi`). A new
   text comes out with the segmenter's own cuts. A revised one keeps every settled cut that still
   fits, and the run names those that don't.
5. **Review** the new and revised texts, as "Reviewing new and revised texts" says.

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
| `covered.json` | the lines in a run of two or more empty lines that the English above translates |
| `review/` | the review rounds, the read-throughs, the audits and the list of references |

- **The words are only cut**: a text whose lines, joined, aren't word for word its page is reported
  and not written.
- **One file per app text, every line kept**: each file has the name and the line keys of the app's
  file for the same text, so the app matches a translation by its own sutta ID. A line the
  translator leaves empty stays in, as `""`. So does a sutta he doesn't translate at all, where the
  app's file covers more than his page does (`an1.142-149` in `an1.140-149`) or his text sits on the
  first sutta of a shared page (SN 15.15–18 under 15.14). Lines Sujato leaves empty can hold the
  translator's text.
- **Markup**: a line's English carries a newline where a verse line of the translator's starts
  inside it, `<span class="heading">` round a heading of his that no Pali heading line holds, or
  round a sutta's title that no title line holds, at the start of its text, and `<a href>` round a
  reference in his text to another sutta, written the app's way ("as in 3:2" becomes "as in
  AN3.2"), from `review/references.json`.

## Reviewing new and revised texts

The segmenter's unsure cuts, and the places a cut can't mend, go to reviewers in rounds, and
`cuts.json` keeps what they settle. `scripts/segmenter/review-rounds.py <translator> put
<folder> <segmenter options>` puts a round up in batches in `review/<folder>/`; reviewers answer
beside them, as [review-rounds.md](review-rounds.md) says; `keep <folder>` keeps the answers. Every
text here has been through the rounds, so a round takes only the texts in hand: `--only <page>,…`
names them, as their files here are named. Bodhi's shared SN 45 pages are reviewed across both
app texts: a common formula stays where it is first translated, each listed variant sits on its
own Pali line, and the final full passage sits on the terminal sutta's Pali.

Every round keeps to these:

- **The Pali decides.** Sujato's English is context only: his verse lines often follow a different
  order from the Pali's. `scripts/segmenter/review-pali.py packet` writes texts with the Pali on
  every row.
- **Findings are tried and kept in an isolated copy** of the repository (scripts and data, with
  `node_modules` linked), and only the results are copied back, after the checks in step 5. The
  segmenter has no dry run: even `--findings` writes files.
- **One session at a time writes a translator's files** (`sutta/`, `notes/`, `cuts.json`,
  `report.json`). The segmenter works on one translator at a time, so sessions on different
  translators run side by side.
- **Readers work at effort high**, and nothing above it. The steps below name Sonnet and Opus; any
  strong model does the same work.

1. **Unsure cuts**: `put cuts --items 1.0`. Sonnet answers each cut, and Opus answers the same cuts
   on its own. `keep-agreed cuts` keeps what the two agree on. The rest goes to Opus once more, with
   both lines whole: `put final --items 1.0 --whole`, then `keep final`. `--recheck <key>,…` adds a
   revised text's settled cuts that no longer fit.
2. **Places**: `put places --places` puts up each line left with only a sentence's opening word or
   two, and each line left empty whose English sits next door. Opus answers; `keep places`.
3. **Read-through**: `read <folder> <text ID>…` writes the texts line by line beside Sujato's.
   Sonnet reads each batch and saves its findings beside it: where a line should start, or that it
   should hold none.
   - **Trying them**: the segmenter's `--findings` tries the findings, a group on neighbouring lines
     at a time, and writes `review/findings.json`: each group before and after, and whether it
     passes, which it does when each of its findings takes effect and the text still reads whole.
   - **Judging them**: Opus judges the passing groups, or 50 of them where there are more, as
     `check <path>` draws them from every collection. A group it finds worse comes out of the
     findings, and more than 2 of 50 worse means keeping none. `--keep-findings` keeps them.
   - **Fixes by hand** go in the same form in `review/hand/`, where they override the readers'. The
     findings `--findings` can't apply, whose words aren't found where their line can start or whose
     group takes no effect, `flagged <folder>` writes out in the stretches of text around them; Opus
     writes whole fixes for them into `review/hand/`, tried and judged as the readers' are.
   - **A second read**, done on the text with the first read's findings kept, has the last word:
     where it names a line an earlier reader named differently, the earlier line stays in its file
     marked `# superseded: `, which the segmenter skips.
   - **Disagreements**: two readers who quote the same start at different lengths agree, and the
     longer quote is kept; otherwise a line two readers disagree on is left out, and
     `findings.json` lists it with each reader's finding. `disputed <folder>` writes those out as
     `flagged` does, and Opus settles them in `review/hand/`.
   - **Left-out lines**: a read-through lists only lines holding Sujato's English or the
     translation's, so `empty` puts up the rest, each line Sujato leaves empty with its Pali and the
     text around it: a translator who gives in full a passage Sujato abbreviates has it there, on
     the line next door. Its batches are read, tried and judged as a read-through's.
   - **Cross-check**: where both translators have a sutta, `cross` puts up each line one leaves
     empty while his line next door holds about as much as the other's two, with a sentence break in
     it: his text likely runs on. Opus reads them with both translations beside Sujato's, and they
     are tried and judged the same way.
   - **Lists**: `lists` puts up each line holding a list parted by ellipses ("the skeleton… the
     piece of meat…") followed by lines the translator leaves empty where Sujato gives the items one
     a line; Opus splits the items onto their lines where each renders one.

   A fix can open new suspects for `cross` and `lists`, so both run again after every round, in a
   new folder (`cross2`, `lists2`…), until they put up nothing: each leaves out the lines its
   earlier batches showed.
4. **References**: Opus adds the texts' references to other suttas to `review/references.json`.
5. **Segment again** and check the run's last lines: no text left unwritten, and no settled cut
   that no longer fits. Then run `python3 scripts/segmenter/check-upstream.py <translator>`, which
   reads the pages its own way and compares them with the segmented text and notes word for word:
   anything it shows beyond references, heading numbers and page furniture blocks the commit. Then
   run `python3 scripts/segmenter/check-integrity.py <translator>`, which checks where the words
   sit: titles, headings, closing lines, notes, links and markup. Anything it shows is fixed by
   hand in `review/hand/`, or in the segmenter. Then commit.

An audit measures what the rounds leave: Opus reads texts drawn at random, 2 from each collection
so that DN and MN are always read, every line, the left-out ones too, as `read <folder> --every
<text ID>…` writes them. `review/audit3/draw.py` is the draw to copy, with a new seed, leaving out
the texts earlier audits drew. Each translator's audits are in `review/audit*/`, each with its draw
and its rate.

## Building them into the app

Once segmenting is done, the app's build takes these translations in. What it must do:

- Serve a translation only for the suttas where it has text beyond the title lines, checked sutta
  by sutta rather than file by file (see "Segmenting").
- Credit each text's source and keep its terms (see "Licences"): Bodhi's Wisdom texts are shown
  unchanged, and none of these is sold. The editorial rules over Sujato's English never apply.
- Lines pair with the Pali, not one to one with Sujato's, and a line Sujato leaves empty can hold
  text:
  - **prose**: a sentence spanning several Pali lines sits on the first and leaves the rest empty;
  - **verse**: the translator's lines are spread over the verse's Pali lines in order, at his own
    line breaks, the way Sujato's are. A line needn't translate the Pali it sits on; the verse
    must. The English never matches the Pali line for line, and the Pali's line keys never change.
- The Pali under an English line follows the rule for Sujato's lines ([docs/corpus.md](../../docs/corpus.md)'s
  "A segment"): a lone empty line in its paragraph joins the line above, and a run of two or more
  stays hidden, since most runs are repetitions the translator abbreviates. The exception is the
  lines in `covered.json`, whose own content the English above renders, as where Bodhi gives a
  list whole in one sentence (AN 8.46:1.5–1.7): they join it too. A repetition the English
  abbreviates or compresses is never covered, even where the English mentions it, and a doubtful
  line isn't either: a missing entry only hides Pali, while a wrong one puts repetition under a
  line. The rest of a sutta given in excerpt (Ṭhānissaro's DN 21, DN 26,
  MN 54 and MN 91) shows under no line. The paragraphs come from the
  Pali's markup (`data/html`), not the line keys, which make each of the Dhammapada's verse lines
  a paragraph of its own.
- The markup to render:
  - **text** (`sutta/`): a newline inside a line where one of the translator's verse lines starts,
    as throughout the Dhammapada (Sujato's lines never have one, so the Reader doesn't yet break
    on it), `<span class="heading">` round a
    heading or title of the translator's, and `<a href>` to suttacentral.net for a reference to
    another sutta;
  - **notes** (`notes/`): `<p>`, `<i>`, and `<a href='…'>` to suttacentral.net for references.
  The links should open the sutta in the app instead.
- The note on a sutta's title line, or on its first line where it has none, holds the translator's
  introduction and "See also". Bodhi has notes only for DN 1.
- Only `sutta/`, `notes/` and `covered.json` ship. `review/`, `cuts.json`, `learned.json` and
  `report.json` are working files.

## Where to look

| What | Where |
|---|---|
| The segmenter and its options | `scripts/segmenter/segment-translations.mjs` |
| Putting rounds up and keeping their answers | `scripts/segmenter/review-rounds.py` |
| The word-for-word check against the pages | `scripts/segmenter/check-upstream.py` |
| The check of titles, headings, closing lines, notes and links | `scripts/segmenter/check-integrity.py` |
| The audits | `data/<translator>/review/audit*/` |
| Review packets with the Pali on every row | `scripts/segmenter/review-pali.py` |
| How a session answers a round, and the prompts | [review-rounds.md](review-rounds.md) |
| The reader a read-through runs | `.claude/agents/line-reader.md` |
