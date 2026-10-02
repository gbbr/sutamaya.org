# Fourth audit of Thanissaro's segmenting

A measure of what the full read-through of DN and MN (`../fullread/`, `../fullread-mn/`) leaves:
texts drawn from those two collections only, about 2,500 lines, none an earlier audit drew, every
line read, those with only Pali too.

## The draw

`draw.py`, run from the repository root, with seed `20261004`: DN's texts in random order up to
half the lines, at least one, then MN's up to 2,500 in all. DN 34's length takes DN past half.

| Collection | Drawn |
|---|---|
| DN | dn9, dn29, dn34 |
| MN | mn67, mn49, mn63, mn45, mn26 |

The batches are `review-rounds.py thanissaro read audit4 --every` of those texts.

## Results

| Text | Lines read | Lines to change |
|---|---|---|
| mn63 | 180 | 13 |
| dn9 | 472 | 5 |
| mn49 | 162 | 2 |
| dn29, dn34 | 1,355 | 0 |
| mn26, mn45, mn67 | 585 | 0 |
| **All** | **2,754** | **20** |

That is 0.7% of lines; in DN, 0.3%; in MN, 1.6%, or 0.3% without MN 63.

## The errors, by kind

- **A list of views on the line that introduces it** — `mn63:2.8`–2.9 and 2.12–2.13 ("If he
  discloses to me that / 'The cosmos is eternal,' … / or that 'After death…'"), `dn9:31.5` and
  31.8: views the Pali gives lines of their own sat on the line before, whole or in part.
- **A repetition's parts on one line** — `dn9:33.22`–33.24: the four truths, each "taught and
  declared to be a categorical teaching", on 33.21.
- **A clause on the line next door** — `mn63:6.4` and 6.20, "whose destruction I make known right
  in the here & now", and `mn63:7.2`, "and what is disclosed by me as disclosed", on the line
  above; `mn63:3.21`, "But if he doesn't know or see", on the line below.
- **A sentence spread over lines it doesn't render** — `mn63:3.39`, 3.41 and 3.46: "If he doesn't
  know or see whether after death a Tathāgata exists… does not exist…" lay on the lines that ask
  to be told; it sits whole on 3.49, which renders "If you don't know".
- **A verse in the Pali's order, not Sujato's** — `mn49:9.7`–9.8: "the state of what is as it
  is…" renders 9.7's *itthabhāvaññathābhāvaṁ*, where Sujato reorders his English.

Readers disagreed on `mn63:6.4`; `hand/audit4.findings` settles it. Readers also named
`dn34:2.3.25`–26 for the energetic monk, whom Thanissaro gives before the contented one, on
2.3.20; the words can't pass the passage after them, so `hand/audit4.findings` keeps those lines
empty.

## Verdict

DN is below half a percent, and so is MN but for MN 63, a sutta that abbreviates its
repetitions: the rounds left its lists of views and the clauses closing them on the lines next
door. What is left is the third audit's kind, list items and half sentences a line off, in texts
that repeat a formula.
