# Third audit of Bodhi's segmenting

The first two audits drew in proportion to each collection's size, so DN, where Bodhi has three
long suttas, was never drawn. This one draws 2 texts from each collection, none an earlier audit
drew, and reads every line, those with only Pali too.

## The draw

`draw.py`, run from the repository root, with seed `20261003`.

| Collection | Drawn |
|---|---|
| DN | dn15, dn1 |
| MN | mn22, mn60 |
| SN | sn12.14, sn45.32 |
| AN | an10.211, an10.11 |
| Thag | thag8.1, its only text |

The batches are `review-rounds.py bodhi read audit3 --every` of those texts.

## Results

| Text | Lines read | Lines to change |
|---|---|---|
| dn1 | 660 | 2 |
| dn15 | 275 | 4 |
| mn22 | 357 | 25 |
| mn60 | 292 | 6 |
| thag8.1 | 35 | 2 |
| sn12.14, sn45.32, an10.11, an10.211 | 90 | 0 |
| **All** | **1,709** | **39** |

That is 2.3% of lines; in MN, 4.8%; in DN, 0.6%.

## The errors, by kind

- **A list Bodhi runs together with ellipses, on its first line** — `mn22`: the ten similes for
  sensual pleasures ("the skeleton… the piece of meat… the snake's head") at 3.9, 6.4, 8.7 and 8.12,
  and the five aggregates "not yours" at 41.22; `mn60`: the views it quotes at 31.8, 31.11 and 34.8.
  Each item now sits on its own Pali line, as in MN 31 in the second audit.
- **A repetition's parts on one line** — `dn15:24.1`, 24.4 and 24.7: each "one who describes self
  as…" ran on into the clause the Pali gives its own line, as 26.x had before the cross-check.
- **A closing line's words on the line above** — `dn1:3.74.7`, "Here ends the Brahmajāla Sutta";
  `dn15:34.9`, "Certainly not, venerable sir"; `dn1:1.31.8`, "in their modes and their details".
- **A verse in the Pali's order, not Sujato's** — `thag8.1:5.2`–5.3, the verse Dhp 6 shares: Bodhi
  follows the Pali's line order, where Sujato reorders his English.

The reader also moved DN 1's refrain "Or he might say:" (1.8 to 1.27, 38 lines) off the Pali line
that says it ("Iti vā hi … vaṇṇaṁ vadamāno vadeyya") onto the quotation after it. Those findings
are marked superseded: the line they would empty is the one Bodhi's words translate.

## Verdict

MN is where Bodhi's errors are: a list he abbreviates with ellipses, which the rounds left on its
first line. That one pattern is 31 of the 39 lines. DN's two long suttas are nearly clean.
