# Audit of Thanissaro's segmenting

A measure of the errors left in Thanissaro's translation after the review rounds: 12 texts drawn at
random, every line read beside Sujato's English or the Pali, as `data/upstream/review-rounds.md`'s
"Reading through" judges a line. It is drawn and read as Bodhi's was (`data/bodhi/review/audit/`).

## The draw

`draw.py`, run from the repository root, with seed `20261001`: each collection gets a share of the
12 in proportion to its number of texts holding Thanissaro's English, the largest remainders
rounding up, and its texts are drawn without replacement.

| Collection | Texts | Share | Drawn |
|---|---|---|---|
| KN | 824 | 5.18 | snp1.6, snp5.14, thig6.1, thag1.84, dhp8 |
| SN | 509 | 3.20 | sn48.43, sn12.68, sn42.2 |
| AN | 457 | 2.87 | an3.112, an3.70, an4.1 |
| MN | 106 | 0.67 | mn90 |
| DN | 14 | 0.09 | — |

The batches are `review-rounds.py thanissaro read audit` of those texts, and the `.findings` beside
them are the lines found wrong, in the read-through's form.

## Results

The batches list 739 lines. The read-through leaves out a line that holds neither Sujato's English
nor Thanissaro's, so those were read too, against the Pali: 63 of them carry a passage, not a
colophon or a summary verse.

| Lines | Read | Lines to change | Of them in AN 3.112 |
|---|---|---|---|
| Listed in the batches | 739 | 12 | 10 |
| Left out of the batches | 63 | 34 | 21 |
| **All** | **802** | **46** | **31** |

That is 5.7% of lines, two thirds of it in one text. Outside AN 3.112 it is 2 lines in 700 of
those a read-through lists, and 13 in 42 of those it leaves out.

## The errors, by kind

- **A passage Sujato condenses, given in full** — where the Pali spells out a repetition Sujato
  gives once, Thanissaro translates every repetition, and the lines Sujato leaves empty are left
  empty while their English runs on beside them:
  - `an3.112`: the past, future and present are three sections in the Pali and in Thanissaro, one
    in Sujato; all three sit on the first, so each line from 1.8 on holds a later section's words,
    in both halves of the sutta. Its repeated wording makes the findings ambiguous: a fix there
    names a line's start by words that recur on other lines.
  - `an3.70:16.6`–`16.9`: the five qualities, one sentence each, all on 16.5.
  - `mn90`: the messages repeated word for word, "King Pasenadi Kosala, lord, shows reverence…",
    on the line of the sentence that introduces them (2.4, 2.8–2.10, 3.5, 4.5–4.8).
- **One of a list on its neighbour's line** — `an4.1:2.4` holds both the concentration and the
  discernment sentence, and 2.5 is empty.
- **A verse line split by the wrong break** — `thig6.1:5.3` holds "the grief over my son", the
  Pali's 5.4.

## Verdict

The lines the read-throughs covered are low enough to ship outside the texts where Sujato condenses
what the Pali repeats. Those texts are not: the left-out lines need the round Bodhi's had, about
4,650 lines in 414 files, which also catches the texts like AN 3.112, where whole sections run on.
