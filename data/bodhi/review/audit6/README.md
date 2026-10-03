# Sixth audit of Bodhi's segmenting

A fresh audit of whole SN and AN texts after the verse reviews. Every selected row was read,
including rows with only Pali. The original Pali appears on every enriched row; Sujato is secondary
context. Source verse lines stay whole and in Bodhi's order, with the first on the verse's first
Pali row. A verse line need not translate the particular Pali row it sits on.

## The draw

`draw.py`, with seed `20261006`, follows audit5's stratified whole-text draw: roughly 2,500 displayed
rows, with equal budgets across available SN, AN and KN collections, uniform shuffling within each
collection, and the nearest whole-text stopping point. It explicitly excludes all 134 text IDs in
audits 1–5, including the first audit's folder named `audit`. `draw.json` records the draw. This is
not a uniform random sample of individual rows. No fresh Bodhi KN text remains: his only Thag text
was drawn in audit3. DN and MN are outside audit5's draw design.

The saved `batch-NNN.txt` files are `review-rounds.py bodhi read audit6-batches --every` output;
`batch-NNN.pali.txt` adds original Pali on every row, marks Pali verse rows, and retains English
source-line breaks as `⏎`. Three independent Codex readers at effort high read all eight enriched
batches. Their `.reader.json` files record complete coverage and rationales. A batch counts as read
only when its `.findings` ends with `# done`; all eight do.

## Results

| Collection | Texts read | Rows read | Boundaries to correct | Rate |
|---|---:|---:|---:|---:|
| SN | 66 | 1,253 | 16 | 1.28% |
| AN | 33 | 1,246 | 5 | 0.40% |
| KN | 0 | 0 | 0 | not sampled |
| **All** | **99** | **2,499** | **21** | **0.84%** |

As in audit5, the denominator is displayed `read --every` rows, including Pali-only rows. The
numerator counts distinct approved boundary directives, including lines emptied into coherent
prose, rather than every changed source/destination row. The rate is measured before repairs.
Audit5 reported 46/2,482 (1.85%). Audit6 initially reported 4/2,499 (0.16%); the
notes-placement follow-up corrects that to **21/2,499 (0.84%)**, on the original pre-repair sample. These separate whole-text samples
are descriptive measures, not a corpus-wide certificate.

The initial readers proposed 11 directives. A separate Codex judge at effort xhigh, who read none of the
batches, checked every directive against full Pali and exact source order in `judge-packet.md`:
four actual changes accepted, six anchors already correct, one proposal rejected. `judgments.json`
records every decision. The rejected finding is commented in its original batch; `proposals.json`
preserves the original proposal. Accepted directives are in `approved.findings` and
`../hand/codex-audit6.findings`. A Claude session's check from another model follows this audit,
as arranged; it has not been performed here.

| Text needing a boundary correction | Correction keys |
|---|---:|
| an10.267-746 | 2 |
| an8.23 | 1 |
| an8.48 | 2 |
| sn12.57 | 1 |
| sn35.102 | 2 |
| sn35.137 | 3 |
| sn35.62 | 3 |
| sn44.6 | 1 |
| sn45.96 | 2 |
| sn47.73-84 | 2 |
| sn47.85-94 | 2 |

## The errors, by kind

- The separate ellipsis-linked heedlessness list item sat on the last abbreviated goal instead
  of the first Pali row naming heedlessness. Move it to 1.16 and empty 1.24.
- A speaker attribution at AN8.23:4.2 belongs with the Buddha's reply at 7.1.
- SN12.57:4.3 held a sentence beginning with cutting actions abbreviated on 4.2; keep that complete
  sentence on its first Pali row, 4.2.

Actual source omissions, edition differences, partial-sentence/list-item notes and acceptable
verse reordering are not boundary errors. A **whole-passage substitute note below the first Pali
row of its passage is an error**, even when the translator omits that passage. The initial audit
incorrectly passed these notes as editorial-placement concerns.

### Notes-placement follow-up: the three misses

- **AN8.48:12.2 → 2.3**: the note stands for the remainder after the translated question,
  including its verses. Two changing directives.
- **SN35.102:1.16 → 1.1**: the note stands for the whole sutta. Two changing directives.
- **SN35.137:1.9–1.10 → 1.1**: one source note was split over two rows; it now sits whole at
  the beginning. Three changing directives.

These three misses add seven boundary directives: four original plus seven would be 11/2,499
(0.44%). The independent whole-corpus follow-up also found ten directives in five other texts
already in this same sample: **SN35.62, SN44.6, SN45.96, SN47.73–84 and SN47.85–94**. All seventeen
additional sampled directives must count, giving **21/2,499 (0.84%)**. See
`notes-placement-follow-up.json` and [the follow-up report](../notes-placement/README.md).
Original reader reports and the initial results are preserved, including
`results-before-notes-placement.json`; no rows were redrawn or added to the denominator.

## Initial repairs and checks (before the notes follow-up)

All proposals were tried, and accepted repairs kept, in the disposable isolated copy recorded in
`STATUS.md` and `baseline.json`, with `node_modules` linked. Historical findings were disabled
only there; settled cuts remained. The accepted round changed six text rows in three files and
saved its four decisions in `cuts.json`. Only verified Bodhi results were copied back;
`copy-back.json` lists them. No upstream or segmenter files were edited, and no commits were made.

- `check-upstream.py bodhi`: 1,158 pages match, **0 differ**.
- `check-integrity.py bodhi`: **0 problems**.
- `check-round.py bodhi`: **0 partial verse lines**, **0 hidden Pali lines in translated verses**.
  One Pali row becomes visible; AN10.267–746:1.24 becomes hidden. Its `paṭinissaggāya …pe…` is a
  repeated goal Bodhi abbreviates; the rules require it to stay hidden, so no coverage entry is
  added. `validation.json` records this permitted disposition.
- Cross/list follow-ups, with the other translation present for cross-checking: **0 new suspects**.
- Plain `node scripts/segmenter/segment-translations.mjs bodhi` in a separate fresh copy using the
  repository's current scripts: **0 not written**; all **1,166 text files**, the notes, and
  cuts/covered/learned/report reproduce **byte for byte**. See `reproduction.json` and the saved logs.

## Follow-up repairs and checks

The notes follow-up kept 81 whole-passage note moves corpus-wide through
`../hand/codex-notes-placement.findings`; eight of them are in this audit sample. References move
with the notes, and older conflicting findings are marked superseded. The word check again has
**0 differ**, integrity **0 problems**, and fresh plain regeneration is byte-identical. There are
**0 hidden translated-verse Pali lines**. The raw round checker flags two whole omission notes
(AN3.27:4.1 and SN46.17:2.1, both outside this sample) because their linked app citations differ
from raw source numbers; direct source-normalized checks prove both notes whole. This checker
limitation is documented in the follow-up; no scripts were edited.

## Verdict and what remains open

The corrected sampled approved-boundary rate **exceeds** the approximate 0.5% benchmark. All
identified repairable sampled boundaries are fixed, including the missed notes, but this does not
certify the remaining corpus or the unsampled KN.

**SN1.34:7.1–7.3 remains open.** Bodhi's second whole verse line precedes the Mogharāja attribution
in his source, whereas the Pali places the attribution between its first two verse rows. Moving
that English line to 7.3 while keeping the attribution on 7.2 reverses source order. The proposed
move was rejected; no forced verse/prose cut was kept. Later segmenter support must settle this
source-order conflict while preserving whole lines and all visible Pali. It is recorded separately
from the corrected 21 approved repair directives. The cross-model Claude judgment is also pending.
