# Audit of Bodhi's segmenting

A measure of the errors left in Bodhi's translation after the review rounds: 12 texts drawn at
random, every line read beside Sujato's English or the Pali, as `data/upstream/review-rounds.md`'s
"Reading through" judges a line.

## The draw

`draw.py`, run from the repository root, with seed `20261001`: each collection gets a share of the
12 in proportion to its number of texts holding Bodhi's English, the largest remainders rounding up,
and its texts are drawn without replacement.

| Collection | Texts | Share | Drawn |
|---|---|---|---|
| SN | 855 | 8.42 | sn45.145, sn46.53, sn45.34, sn35.32, sn56.19, sn56.44, sn12.3, sn45.166 |
| AN | 312 | 3.07 | an3.60, an4.36, an4.7 |
| MN | 47 | 0.46 | mn57 |
| DN | 3 | 0.03 | — |
| Thag | 1 | 0.01 | — |

`batch-001.txt` and `batch-002.txt` are `review-rounds.py bodhi read audit` of those texts, and the
`.findings` beside them are the lines found wrong, in the read-through's form.

## Results

The batches list 441 lines. The read-through leaves out a line that holds neither Sujato's English
nor Bodhi's, so those were read too, against the Pali: 14 of them carry a passage, not a colophon or
a summary verse.

| Lines | Read | Places wrong | Lines to change |
|---|---|---|---|
| Listed in the batches | 441 | 2 | 2 |
| Left out of the batches | 14 | 3 | 4 |
| **All** | **455** | **5** | **6** |

That is 1.3% of lines, or 1.1% counted by place. On the lines a read-through lists it is 0.5%;
on the lines it leaves out, 3 places in 14.

## The errors, by kind

- **Text on the line below a line Sujato leaves empty** — where Sujato abbreviates a passage the Pali
  gives in part, Bodhi's rendering of that part sits on a neighbouring line:
  - `mn57:12.3`: the simile of the refuge formula ("made the Dhamma clear in many ways…") is on
    12.4.
  - `an4.36:4.2`: the gandhabba, yakkha and human taints, "(2) … (3) … (4) …", are on 4.1.
  - `sn45.145:5.2`: "so too …", the Pali's "evameva kho …pe…", closes 5.1.
- **A clause's opening on the line above** — `sn12.3:3.2` ends with "with the cessation of
  volitional formations,", which opens 3.3's clause.
- **A repeated formula cut two ways** — in `sn56.19` the first truth's statement sits whole on 1.2,
  but the fourth's is cut after "In this statement," leaving 1.7 with a sentence's opening and 1.8
  with the rest.

## Verdict

The lines the read-throughs covered are low enough to ship: 2 misplacements in 441, both small. The
lines they never showed are not: a line Sujato leaves empty and the segmenter left empty is never
read, and 3 of the 14 sampled hold an error. Bodhi has about 2,900 such lines with Pali before
each sutta's closing, in some 315 files; most are repetitions he abbreviates too, but they need one
more round, a read that also lists those lines with their Pali.
