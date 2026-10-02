# Fifth audit of Bodhi's segmenting

This audit reads fresh SN, AN and KN texts after the Codex import is judged and kept. Every
selected row is read, including rows with only Pali. The original Pali is supplied on every row;
Sujato's English is secondary evidence when its word or verse order differs.

## The draw

`draw.py`, with seed `20261005`, draws whole texts from those collections and excludes every text
in audits 1–4. The target is roughly 2,500 displayed rows per translator, with roughly equal line
budgets across available collections. Texts are shuffled uniformly within each collection; this
is a stratified whole-text sample, not a uniform random sample of individual lines.
`draw.json` records every selected text and its line count. The batches are
`review-rounds.py bodhi read audit5 --every` of those texts; `batch-NNN.pali.txt` adds the original Pali
to the saved comparison rows. Independent Codex subagents read all eight enriched batches using
the session's inherited model. The imported read's exact model/effort logs are in `../codex-read/`.

## Results

| Collection | Texts read | Rows read | Boundaries to correct | Rate |
|---|---:|---:|---:|---:|
| SN | 62 | 1,239 | 37 | 2.99% |
| AN | 31 | 1,243 | 9 | 0.72% |
| KN | 0 | 0 | 0 | not sampled |
| **All** | **93** | **2,482** | **46** | **1.85%** |

The denominator is the displayed `read --every` rows, including Pali-only rows and the Dhammapada's
`:0` story headings where present. The numerator counts distinct approved boundary directives,
including lines emptied into a coherent group; it does not count every source and destination row.
These are rates before the audit repairs. Root review judges every proposal against the Pali;
`judgments.json` records any refinement or source-exact quote needed. The accepted repairs are
saved in `../hand/codex-audit5.findings` and the regenerated translations.

| Text needing a boundary correction | Correction keys |
|---|---:|
| an3.34 | 4 |
| an4.25 | 3 |
| an5.35 | 1 |
| an8.30 | 1 |
| sn1.35 | 6 |
| sn1.39 | 3 |
| sn1.41 | 1 |
| sn1.43 | 1 |
| sn1.71 | 1 |
| sn11.15 | 1 |
| sn11.18 | 5 |
| sn11.4 | 6 |
| sn35.138 | 2 |
| sn35.229 | 1 |
| sn35.63 | 1 |
| sn35.76 | 1 |
| sn35.97 | 2 |
| sn4.11 | 1 |
| sn4.3 | 1 |
| sn4.6 | 1 |
| sn45.143 | 1 |
| sn46.43 | 2 |

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

Bodhi has no eligible fresh KN text: its only Thag text was drawn in audit3. KN is unsampled, not certified clean. The duplicate SN45 range/terminal source issue is recorded separately in `../codex-read/source-ranges.json`.
