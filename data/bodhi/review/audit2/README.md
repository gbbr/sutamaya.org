# Second audit of Bodhi's segmenting

A measure of the errors left after the left-out-lines round and the settling of the lines readers
disagreed on: 12 more texts drawn at random, none of the first audit's (`../audit/`), every line
read, those with only Pali too.

## The draw

`draw.py`, run from the repository root, with seed `20261002`, drawn as the first audit's, leaving
out the texts it drew.

| Collection | Texts | Share | Drawn |
|---|---|---|---|
| SN | 847 | 8.43 | sn35.47, sn46.44, sn35.155, sn11.22, sn45.71-75, sn4.19, sn35.118, sn22.76 |
| AN | 309 | 3.07 | an3.25, an3.17, an8.26 |
| MN | 46 | 0.46 | mn31 |
| DN | 3 | 0.03 | — |
| Thag | 1 | 0.01 | — |

The batches are `review-rounds.py bodhi read audit2 --every` of those texts, which lists every line
with its Pali, and the `.findings` beside them are the lines found wrong. They are kept as a fix by
hand, `review/hand/audit2.findings`, since two of them overrule earlier hand fixes.

## Results

| Lines | Read | Lines to change |
|---|---|---|
| With English of either translation | 344 | 14 |
| With only Pali | 36 | 0 |
| **All** | **380** | **14** |

That is 3.7% of lines, in 3 texts; outside MN 31, 4 lines in 335 (1.2%).

## The errors, by kind

- **A list Bodhi runs together with ellipses, on its first line** — `mn31`: the second, third and
  fourth jhāna on 11-13.4, the gods from the Thirty-three to Brahmā's retinue on 21.10, and "all
  merchants… all workers" on 22.10. Each item now sits on the Pali line it names. Earlier readers
  had counted these as one sentence over several lines, which is not an error; the audit counts a
  list of separate items as separate lines, so that each Pali line has its English.
- **A passage on the wrong one of two Pali lines that say it** — `sn11.22:2.2`: the gods' report to
  Sakka was on 2.5, where the Pali repeats the gods' complaint, not on 2.2, which it translates. A
  hand fix made the same night, settling a disagreement, had put it there.
- **An abbreviation away from what it stands for** — `an8.26`: "The rest as in 8:25" sat on 4.5,
  in the middle of the last answer, rather than on 1.4, where the answers it stands for start.

## Verdict

The left-out-lines round worked: none of the 36 lines with only Pali is wrong, where the first
audit found 3 in 14. What is left is a handful of single placements and one choice of policy, the
lists run together with ellipses, settled here for MN 31 and likely to recur in Bodhi's MN and DN.
