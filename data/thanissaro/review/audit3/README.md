# Third audit of Thanissaro's segmenting

The first two audits drew in proportion to each collection's size, so DN was never drawn and MN
once. This one draws 2 texts from each collection, none an earlier audit drew, and reads every
line, those with only Pali too.

## The draw

`draw.py`, run from the repository root, with seed `20261003`.

| Collection | Drawn |
|---|---|
| DN | dn1, dn2 |
| MN | mn148, mn48 |
| SN | sn12.52, sn43.17 |
| AN | an1.328, an5.37 |
| KN | dhp230, iti81 |

The batches are `review-rounds.py thanissaro read audit3 --every` of those texts.

## Results

| Text | Lines read | Lines to change |
|---|---|---|
| dn1 | 660 | 16 |
| dn2 | 648 | 7 |
| mn148 | 225 | 5 |
| mn48, sn12.52, sn43.17, an1.328, an5.37, dhp230, iti81 | 182 | 0 |
| **All** | **1,715** | **28** |

That is 1.6% of lines; in DN, 1.8%.

## The errors, by kind

- **A section number at the end of the line before its section** — `dn1`: Thanissaro numbers the
  62 views, and "1.", "5.", "9.", "14.", "17." and "58." ended the question before them.
- **A list run together on its first line** — `dn1:2.27.9`–11 and 2.27.19, `dn2:32.6`, 32.9 and
  32.17: the eel-wriggler's "if there are beings who wander on… if there aren't…"; `mn148`: the
  "Thus the intellect is not-self…" summaries at 12.6 to 15.6, on the line before.
- **A sentence's second half on the line above** — `dn1:2.17.7`, 2.18.11, 2.19.13 ("I know that /
  the cosmos is finite"), `dn1:2.20.5`, `dn2:41.3` ("and reflects:"), `dn2:49.3`, `mn148:10.5`.
- **A heading one line off** — `dn1:3.1.0` (it opened 3.1.1) and `dn2:34.0.2` (it sat on 34.0.1,
  the chapter's heading, rather than the section's).

The reader also moved DN 1's refrain "Or:" (1.24.4 to 1.26.4) off the Pali line that says it onto
the quotation after it; those findings are marked superseded, as in Bodhi's third audit.

## Verdict

The long DN suttas hold most of what is left, in small placements: numbers, list items, half
sentences. The short texts drawn are clean, as the second audit found.
