# Bodhi and Thanissaro translations

Two more English translations of the suttas the app carries, Bhikkhu Bodhi's and Ṭhānissaro
Bhikkhu's. This folder keeps them as their sources publish them. The segmenter,
`scripts/segmenter/segment-translations.mjs`, cuts each text onto the Pali's lines, in `data/sujato/`'s layout, and writes them to `data/bodhi/`
and `data/thanissaro/`, where reviews settle the cuts it is unsure of.

## What's here

| Path | Contents |
|---|---|
| `bodhi/` | Bhikkhu Bodhi: 47 MN, 807 SN and 312 AN suttas from Wisdom Publications, and DN 1, 2 and 15 from the Buddhist Publication Society, all via SuttaCentral; Thag 8.1 from Access to Insight; notes for DN 1 |
| `thanissaro/` | Ṭhānissaro Bhikkhu: 1,428 texts from dhammatalks.org, 6 older ones from SuttaCentral for suttas dhammatalks.org lacks, and the Dhammapada's endnotes |
| `*/sources.json` | The source URL of every file, and the date they were fetched |

SuttaCentral's files are from sc-data at commit `8442c9f`. Every text is one the app has.

## Coverage

The share of the app's texts in each book that each translation covers. A text the app groups from
several suttas, as in AN 1 and AN 2, counts when any of them is covered.

| Book | Thanissaro | Bodhi |
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
`notes/`, as Sujato's do. Bodhi's files keep SuttaCentral's numbers, which are the app's.

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
- **SuttaCentral** — its HTML as published, with SuttaCentral and PTS references
  (`<a class='ref …'>`) and the licence at the end. None carries notes.
- **Thanissaro's older copies** — `an1.31-40`, `an5.257-263`, `an5.264`, `an5.265-271`, `an11.16`
  and `an11.17` are Access to Insight's 2013 versions, which dhammatalks.org supersedes wherever it
  has the sutta: `an1.31-40`'s 1.39–40 are read from `an1.21-30,39-40.html` instead.
- **Bodhi's notes** — free only for DN 1: `notes/dn/dn1.html` is Access to Insight's copy of the
  same translation with its notes, while `sutta/dn/dn1.html` has the fuller text. His notes to MN,
  SN and AN are only in Wisdom's books.

## Licences

| Source | Terms |
|---|---|
| Bodhi, Wisdom Publications | CC BY-NC-ND 3.0: credit, no charge, wording unchanged |
| Bodhi, Buddhist Publication Society | Free distribution: may be reformatted and shared free of charge; derived works marked as such |
| Thanissaro, dhammatalks.org | CC BY-NC 4.0; the author counts any sale as commercial |
| Thanissaro, older copies | CC BY-NC 4.0, or Access to Insight's free-distribution terms |

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
3. **SuttaCentral's files** (Bodhi, and Thanissaro's older copies): copy them again from sc-data's
   `html_text/en/pli/sutta/`, and update the commit above.
4. **Segment**: `node scripts/segmenter/segment-translations.mjs thanissaro` (or `bodhi`). A new text comes
   out with the segmenter's own cuts. A revised one keeps every settled cut that still fits, and the
   run names those that don't.
5. **Review** the new and revised texts, as "Reviewing new and revised texts" says.

## Segmenting

The segmenter aligns each text with the Pali's lines, reading what each line says from Sujato's
English and the dictionary, and scores how sure it is of every cut. It writes `data/<translator>/`
in `data/sujato/`'s layout:

| Path | Holds |
|---|---|
| `sutta/`, `notes/` | each Pali line's English, and the translator's notes; a sutta's title line also holds his introduction and "See also", or its first line where it has no title line |
| `cuts.json` | what the reviews settled, by line, kept across runs |
| `learned.json` | the translator's words learned for Sujato's |
| `report.json` | each text's alignment and how sure it is |
| `review/` | the review rounds, the read-throughs, the audits and the list of references |

- **The words are only cut**: a text whose lines, joined, aren't word for word its page is reported
  and not written.
- **Markup**: a line's English carries a newline where a verse line of the translator's starts
  inside it, `<span class="heading">` round a heading of his that no Pali heading line holds, or
  round a sutta's title that no title line holds, at the start of its text, and `<a href>` round a
  reference in his text to another sutta, written the app's way ("as in 3:2" becomes "as in
  AN3.2"), from `review/references.json`.

## Reviewing new and revised texts

The segmenter's unsure cuts, and the places a cut can't mend, go to reviewers in rounds, and
`cuts.json` keeps what they settle. `scripts/segmenter/review-rounds.py <translator> put <folder>
<segmenter options>` puts a round up in batches in `review/<folder>/`; reviewers answer beside them, as
[review-rounds.md](review-rounds.md) says; `keep <folder>` keeps the answers. Every text here has been
through the rounds, so a round takes only the texts in hand: `--only <page>,…` names them, as their
files here are named.

1. **Unsure cuts**: `put cuts --items 1.0`. Sonnet answers each cut, and Opus answers the same cuts
   on its own. `keep-agreed cuts` keeps what the two agree on. The rest goes to Opus once more, with
   both lines whole: `put final --items 1.0 --whole`, then `keep final`. `--recheck <key>,…` adds a
   revised text's settled cuts that no longer fit.
2. **Places**: `put places --places` puts up each line left with only a sentence's opening word or
   two, and each line left empty whose English sits next door. Opus answers; `keep places`.
3. **Read-through**: `read <folder> <text ID>…` writes the texts line by line beside Sujato's.
   Sonnet reads each batch and saves its findings beside it: where a line should start, or that it
   should hold none. The segmenter's `--findings` tries them, a group on neighbouring lines at a
   time, and writes `review/findings.json`: each group before and after, and whether it passes,
   which it does when each of its findings takes effect and the text still reads whole. Opus judges
   the passing groups, or 50 of them where there are more, as `check <path>` draws them from every
   collection. A group it finds worse comes
   out of the findings, and more than 2 of 50 worse means keeping none. `--keep-findings` keeps them.
   A fix made by hand goes in the same form in `review/hand/`, where it overrides the readers'.
   The findings `--findings` can't apply, whose words aren't found where their line can start or
   whose group takes no effect, `flagged <folder>` writes out in the stretches of text around them:
   Opus writes whole fixes for them into `review/hand/`, tried and judged as the readers' are.
   A second read, done on the text with the first read's findings kept, has the last word: where
   it names a line an earlier reader named differently, the earlier line stays in its file marked
   `# superseded: `, which the segmenter skips. Two readers who quote the same start at different
   lengths agree, and the longer quote is kept; otherwise a line two readers disagree on is left out,
   and `findings.json` lists it with each reader's finding. `disputed <folder>` writes those out as
   `flagged` does, and Opus settles them in `review/hand/`.
   A read-through lists only lines holding Sujato's English or the translation's, so `empty` puts
   up the rest, each line Sujato leaves empty with its Pali and the text around it: a translator
   who gives in full a passage Sujato abbreviates has it there, on the line next door. Its batches
   are read, tried and judged as a read-through's. Where both translators have a sutta, `cross`
   puts up each line one leaves empty while his line next door holds about as much as the other's two,
   with a sentence break in it: his text likely runs on. Opus reads them with both translations
   beside Sujato's, and they are tried and judged the same way.
   `lists` puts up each line holding a list parted by ellipses ("the skeleton… the piece of meat…")
   followed by lines the translator leaves empty where Sujato gives the items one a line; Opus splits
   the items onto their lines where each renders one.
   A fix can open new suspects for either round, so both run again after every round, in a new
   folder (`cross2`, `lists2`…), until they put up nothing: each leaves out the lines its earlier
   batches showed.
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
the texts earlier audits drew. Each translator's audits
are in `review/audit*/`, each with its draw and its rate.

## What's left

- Clean up unused folders in `data/{bodhi,thanissaro}/review/`? Is there any value in keeping them
or can we just take note of the history/what has been done and that's good enough? I don't mind keeping
them if it helps.

## Where to look

| What | Where |
|---|---|
| The segmenter and its options | `scripts/segmenter/segment-translations.mjs` |
| Putting rounds up and keeping their answers | `scripts/segmenter/review-rounds.py` |
| The word-for-word check against the pages | `scripts/segmenter/check-upstream.py` |
| The check of titles, headings, closing lines, notes and links | `scripts/segmenter/check-integrity.py` |
| The audits | `data/<translator>/review/audit*/` |
| How a session answers a round, and the prompts | [review-rounds.md](review-rounds.md) |
| The reader a read-through runs | `.claude/agents/line-reader.md` |
