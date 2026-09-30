# Bodhi and Thanissaro translations, as published

Two more English translations of suttas the app carries, collected as their sources publish them.
`scripts/segment-translations.mjs` splits each text into the app's segments, in `data/sujato/`'s
layout, and writes them to `data/bodhi/` and `data/thanissaro/`. Nothing in the app uses them yet.

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
  `an1.21-40.html` covers only 1.21–30 and 1.39–40.
- In AN 1 and AN 2, where the app joins suttas into one text, a file is named by its single sutta:
  `an1.47.html` belongs to the app's `an1.41-50`.
- Where the Thai edition splits one of the app's suttas in two, its file holds both pages, one
  `<div id="sutta">` each: `an2.31.html` has dhammatalks.org's AN 2:29 and 2:30, and
  `sn22.126.html` its SN 22:126 and 22:127.

dhammatalks.org numbers suttas by the Thai edition, which differs from SuttaCentral's in parts of
AN, SN 35, Snp 5 and Thag, so 154 of its pages carry a different number here: its AN 3:66, the
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
  has the sutta. `an1.31-40` also has 1.39–40, which `an1.21-40.html` has in newer wording.
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

The app's wording rules are not meant to apply to either translation.

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
4. **Segment again**: `node scripts/segment-translations.mjs thanissaro` (or `bodhi`). It keeps the
   cuts a review settled (`data/<translator>/cuts.json`) and leaves unwritten any text whose segments
   aren't word for word its page.
5. **Review the cuts it is least sure of**: `--items 0.3` writes them in batches to
   `data/<translator>/review/batches/`, with the instructions for Claude, who writes the answers
   beside each batch. `--answers` keeps the answers so far in `cuts.json`. After an interruption,
   run `--answers --items 0.3`: only the cuts still undecided come back. For the cuts a first pass
   couldn't place, `--whole` shows both lines of each cut whole rather than 300 characters either
   side, and `--recheck key,…` puts settled cuts up again. `--overview` writes two pages over every
   text: `moves.html`, the cuts the review moved, and `empty.html`, the lines with no English of
   their own whose English is likely next door.
6. **Review the places a moved cut can't mend**: `--places` writes them in batches the same way: a
   line left with only a sentence's opening word or two, and a line left empty whose English is
   likely next door. An answer there may also leave a line without text or give an empty line its
   text, which `cuts.json` keeps beside the settled cuts. With `--keep-settled`, `--answers` leaves
   out an answer for a line a later review has settled, as when a band's answers come back after a
   round of places.
7. **Read every line**: `scripts/review-rounds.py <translator> read` writes the whole translation
   beside Sujato's to `review/read/`, and a reader saves each batch's findings beside it: where a
   line should start, or that it should hold none. `--findings` tries them, a group of findings on
   neighbouring lines at a time, together with `review/closing-lines.findings`, and writes
   `review/findings.json`: each group's lines before and after, and whether it passes, which it
   does if each of its findings takes effect and the text still reads whole. Opus judges 50 passing
   groups at random; `--keep-findings` keeps the passing groups in `cuts.json`.

## What's left

- Read the rest of Thanissaro's translation line by line, from batch 024 of `review/read/`, as
  [cloud-review.md](cloud-review.md)'s "Reading through" says, and take the findings in (step 7
  above). Bodhi's is read in full.
- Give more lines English of their own: some lines Sujato translates are empty here because the
  translator's English for them sits inside a neighbour's line, with no place to cut it apart.
  `empty.html` shows them, before any change to the segmenter.
- Decide how the app offers a second translation, keeping every Pali line as reachable as with
  Sujato: a line whose English sits on its neighbour opens its Pali with that neighbour's, and a
  line the translator leaves out, such as Bodhi's "as in 8:42" and Thanissaro's excerpts, shows
  its Pali on its own.
- Fit each translation's layout to the Pali's markup. A line's role — heading, verse, closing line —
  comes from `data/html`, whichever English sits on the line, so a translation is laid out as the
  Pali is. Prose and most verse fit. Three things don't:
  - **The translator's own headings.** Most have no Pali heading line to sit on, in both
    translations, and open the next line as plain words.
  - **Verse line breaks.** A Pali verse line often holds two or more of the translator's lines, and
    the segmenter runs them together: over a third of the verse lines in Thanissaro, about a tenth
    in Bodhi.
  - **Text on closing and summary lines.** The Pali's closing line ("Dutiyaṁ") and its chapter
    summary, which the app styles as an ending or leaves out, should take only a translator's
    closing words, such as Bodhi's "The Book of the Tens is finished." Nine of Bodhi's still hold
    the last words of the sutta, where the read-through's fix doesn't take effect.
- Where a translator points to another passage instead of translating it ("identical with 8:42",
  "The rest as in the preceding sutta"), show the passage itself in its place, with a link to it.
- Once these translations ship, each source needs a credit on the Help page.
- The Buddhist Publication Society's online library (bps.lk) was down on 29 September 2026; it may
  hold more of Bodhi's translations with notes.
