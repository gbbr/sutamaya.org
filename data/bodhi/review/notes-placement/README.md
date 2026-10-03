# Bodhi whole-passage note placement

Whole-passage substitute notes now sit whole on the first Pali row of the passage they replace.
Partial-sentence and individual-list-item notes retain their placement. All decisions used the
Pali as authority and Bodhi's source paragraphs to establish each note's extent; source words,
order, references and actual verse lines are preserved.

## Discovery and judgment

The independent scan inspected all 1,166 Bodhi text files, collecting 1,658 English rows after
empty Pali and 534 note-like phrase matches. Post-gap phrase matches plus an independent inventory
of 1,301 source `pe`/`add` spans produced 123 broad candidates; no external candidate list was
used. Raw inventories, candidates, and three Pali/source packets are saved here. Reviewers also
read complete corresponding Pali/source files where a packet did not show an earlier passage
start.

Three reviewers judged 41 candidates each at **effort high**, with no remaining uncertainties.
Every batch's `.findings` ends with `# done`. The consolidated `judgments.json` records every
candidate, scope, first Pali row and rationale; `moves.json` and `notes-left.json` provide the
smaller lists.

| Disposition | Count |
|---|---:|
| Distinct whole-passage notes moved | **81** |
| Partial-sentence notes left | 14 |
| Individual-list-item notes left | 5 |
| Notes already correctly placed, left | 4 |
| **Notes left altogether** | **23** |
| Ordinary translation rows excluded | 18 |
| Duplicate candidate from a split note | 1 |
| Broad candidates judged | **123** |

Split notes, ellipses and printed page-reference fragments forming the same source annotation
were reunited. Actual concluding quotations remained separate where they were translated text,
as at SN22.38. A note whose omitted dialogue begins within an existing Pali row can append to that
row's already translated question (SN44.6); it is still whole on its passage's first row.

## Kept repairs

All 81 groups passed an isolated trial: **183 changing boundary directives**, with 25 unchanged
anchors. The accepted findings were kept through `../hand/codex-notes-placement.findings`.
Quotes containing layout HTML or app-formatted citations were made source-exact for the
segmenter's lookup, as recorded in `source-exact-refinements.json`. The proposed locations were
unchanged. **81 reference records** moved with their notes so links remain intact.

Verified results were copied back:81 text files, cuts/report, reference metadata and hand
findings. Fourteen conflicting historical directives in nine findings files are marked
superseded rather than removed; `historical-conflicts.json` preserves their original text.
No upstream or segmenter files changed, and no commits were made.

## Checks

- `check-upstream.py bodhi`:1,158 pages match; **0 differ**.
- `check-integrity.py bodhi`: **0 problems**.
- `check-round.py bodhi`:193 text rows changed since HEAD (including prior audit6 repairs),
  82 Pali rows newly shown,104 newly hidden, **0 hidden Pali rows in translated verses**.
  Of the newly hidden rows,103 fall in the note-only omitted passages and one is the abbreviated
  goal already documented by audit6. They stay hidden; no coverage is added. There were no
  covered entries in the newly identified omitted spans; `covered.json` is unchanged.
- The round check prints **two false positives** for AN3.27:4.1 and SN46.17:2.1. They are intact
  source omission notes placed on the first Pali verse row, not translated verse lines. The
  checker compares their app links/citation labels with bare source numbers. Direct comparison
  after reversing only citation formatting proves each a whole source line;
  `check-round-note-exceptions.json` records the evidence. **No actual verse line was split.**
  A later checker change must normalize such citations/distinguish notes; no scripts were edited.
- Cross/list follow-ups: **0 new suspects**, with the other translator present for cross.
- Plain segmenter run in a separate fresh copy using current repository scripts: **0 not written**;
  all **1,166 texts**, the notes, and cuts/covered/learned/report/references reproduce **byte for
  byte**. See `reproduction.json`. Both isolated copies are disposable and named in STATUS.md.

## Audit6 correction

The initial audit passed three misplaced notes:AN8.48:12.2→2.3;SN35.102:1.16→1.1;and the split
SN35.137:1.9–1.10→1.1. They add seven boundary directives. The same follow-up also found ten
additional directives in five other originally sampled texts:SN35.62,SN44.6,SN45.96,SN47.73–84,
and SN47.85–94. All confirmed corrections belong in the original pre-repair rate:
**21/2,499 = 0.84%**, rather than the initial4/2,499=0.16%. The draw and denominator are unchanged.
Audit6's README/results/STATUS now record this correction and preserve the initial results.

All note candidates are settled. The two checker false positives require script work elsewhere.
The earlier SN1.34 attribution-order issue and external Claude follow-up remain outside this
note-placement round.
