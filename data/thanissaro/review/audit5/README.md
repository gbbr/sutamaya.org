# Fifth audit of Ṭhānissaro's segmenting

This audit reads fresh SN, AN and KN texts after the Codex import is judged and kept. Every
selected row is read, including rows with only Pali. The original Pali is supplied on every row;
Sujato's English is secondary evidence when its word or verse order differs.

## The draw

`draw.py`, with seed `20261005`, draws whole texts from those collections and excludes every text
in audits 1–4. The target is roughly 2,500 displayed rows per translator, with roughly equal line
budgets across available collections. Texts are shuffled uniformly within each collection; this
is a stratified whole-text sample, not a uniform random sample of individual lines.
`draw.json` records every selected text and its line count. The batches are
`review-rounds.py thanissaro read audit5 --every` of those texts; `batch-NNN.pali.txt` adds the original Pali
to the saved comparison rows. Independent Codex subagents read all eight enriched batches using
the session's inherited model. The imported read's exact model/effort logs are in `../codex-read/`.

## Results

| Collection | Texts read | Rows read | Boundaries to correct | Rate |
|---|---:|---:|---:|---:|
| SN | 32 | 860 | 10 | 1.16% |
| AN | 28 | 807 | 13 | 1.61% |
| KN | 55 | 837 | 35 | 4.18% |
| **All** | **115** | **2,504** | **58** | **2.32%** |

The denominator is the displayed `read --every` rows, including Pali-only rows and the Dhammapada's
`:0` story headings where present. The numerator counts distinct approved boundary directives,
including lines emptied into a coherent group; it does not count every source and destination row.
These are rates before the audit repairs. Root review judges every proposal against the Pali;
`judgments.json` records any refinement or source-exact quote needed. The accepted repairs are
saved in `../hand/codex-audit5.findings` and the regenerated translations.

| Text needing a boundary correction | Correction keys |
|---|---:|
| an10.104 | 2 |
| an4.10 | 2 |
| an4.195 | 1 |
| an5.140 | 2 |
| an5.200 | 1 |
| an5.43 | 4 |
| an8.13 | 1 |
| dhp113 | 3 |
| dhp170 | 2 |
| dhp257 | 1 |
| dhp284 | 1 |
| dhp321 | 1 |
| dhp414 | 1 |
| dhp51 | 1 |
| iti112 | 1 |
| iti13 | 2 |
| iti33 | 2 |
| iti74 | 1 |
| iti76 | 6 |
| sn12.31 | 3 |
| sn3.15 | 1 |
| sn3.3 | 1 |
| sn35.229 | 2 |
| sn42.8 | 2 |
| sn56.42 | 1 |
| snp4.7 | 5 |
| thag13.1 | 3 |
| thag2.27 | 4 |
| thig6.8 | 1 |

## The errors, by kind

- Verse subdivisions follow a different English order from the Pali. The smallest coherent group
  preserves the translator's order where an individual cut would imply a false correspondence.
- Distinct sentences, list items and short introductions remain on a neighboring Pali line.
- An expanded English item sits on the next explicitly retained Pali item instead of inside the
  preceding ellipsis; the edition's abbreviation needs an explicit coverage record.

Reader reports preserve complete batch and per-text coverage, rationales, and concerns about
source omissions, shared passages and edition differences separately from boundary errors.

## Verdict

Every sampled collection exceeds the approximate 0.5% benchmark. The sample's identified cuts
are repaired, but this is not evidence that the remaining corpus meets that benchmark. Direct
Pali review of verse and explicit source/correspondence reconciliation remain necessary.
