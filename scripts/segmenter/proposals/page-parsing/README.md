# Page parsing proposal

Completed on 2026-10-03, on `translations`, without committing. Only this proposal directory was written in the repository. The parser changes and regenerated data were tested in isolated copies; neither the live scripts nor the live translation data were changed by this job.

The patch moves the translator's separately identifiable commentary into `notes/`: introductions, closing remarks, alternative renderings and explicitly attributed Commentary asides. Every word and its order are preserved. `check-upstream.py` recognizes the same distinctions independently with its own Python HTML parser; it does not import or invoke the segmenter's parser.

[page-parsing.patch](page-parsing.patch) changes only `scripts/segmenter/segment-translations.mjs` and `scripts/segmenter/check-upstream.py`. It was made against the current repository scripts, whose original versions and hashes are saved in `baseline/` and `baseline-hashes.json`. `git apply --check` passes.

## What was read

The reproducible screen found **126 oversized rows: 89 Ṭhānissaro, 37 Bodhi**. It selects English of at least 35 words at eight times the Pali word count, or at least 200 characters at six times the Pali character count. Title rows, empty Pali, and explicit abbreviation markers on the current row are excluded. The broader character screen also catches long prose sentences and expansions of Pali compounds; the count is a screening count, not an error rate.

Another 434 rows with explicit Pali abbreviation markers were excluded and saved separately: 397 Ṭhānissaro, 37 Bodhi. Abbreviations in surrounding rows and compressed formulas were then judged manually rather than treated as errors. [scan.json](scan.json) holds every candidate with Pali, English, surrounding Pali and source paths; [cases.md](cases.md) gives every judgment and key. The original HTML is saved in `evidence/`.

| Cause among the 126 screened rows | Ṭhānissaro | Bodhi | Result |
|---|---:|---:|---|
| Marked introduction | 1 | 0 | SN1.8 moves to notes |
| Closing note/commentary | 2 | 0 | Ud7.8, AN9.42 move to notes |
| Alternative rendering | 2 | 0 | AN3.47, SN35.82 move to notes |
| English whose Pali lies elsewhere | 5 | 2 | Report only |
| Source edition additions | 5 | 1 | Translation retained; parallels or absent local Pali listed |
| Expanded shared opening | 14 | 0 | Translation retained |
| Surrounding abbreviation/formula expanded | 41 | 4 | Accepted |
| Short Pali formula expanded | 5 | 0 | Accepted |
| Whole sentence or compressed passage | 13 | 27 | Accepted under the prose rule |
| Lexical explanation of compounds/names | 1 | 3 | Accepted |
| **Total** | **89** | **37** | **126/126 read** |

The wider page inventory also examined 22 Ṭhānissaro and 18 Bodhi candidates, and searched explicitly attributed bracketed commentary throughout both source trees. It found four further movements below the oversized-row thresholds: SN48.8's closing reference line and three Commentary asides. Italic canonical speech, the canonical naming endings of DN21/MN49, and placeholders for passages the translator abbreviates stay in the translation. Those judgments are saved in [commentary-inventory.findings](commentary-inventory.findings).

## Every movement and changed text

**Nine Ṭhānissaro texts change; no Bodhi text changes.** Each has its translation JSON and notes JSON changed: 18 files altogether, listed exactly in [changed-files.json](changed-files.json). All changed rows are in [changed-rows.json](changed-rows.json); the individual `.diff` files show the generated data changes for review.

| Text | Commentary moved | From sutta row(s) | Into notes row |
|---|---|---|---|
| SN1.8 | Italic introduction interrupted by roman Pali terms | 1.2 | 0.3 |
| Ud7.8 | Three closing paragraphs continuing the verse's note | 4.6 | 4.4 |
| AN3.47 | Alternative heading and four rendering paragraphs | 2.4 | 0.3 |
| AN9.42 | Closing `Note:` about the following three discourses | 12.2 | 0.3 |
| SN35.82 | Alternative explanation and eight rendering paragraphs | 2.8–2.9 | 0.3 |
| SN48.8 | `See also SN 45:8 and SN 56:11.` | 1.18 | 0.3 |
| AN8.54 | Bracketed Commentary explanation of “fruit-tree eater” | 5.5 | 5.5 |
| SN47.8 | `[Commentary: the five hindrances]` | 3.5 | 3.5 |
| SN20.7 | Bracketed Commentary account of the drum's sound | 1.6 | 1.4 |

**All 23 newly moved paragraphs/asides, totaling 488 words, are printed in full in [moved-passages.md](moved-passages.md).** [moved-passages.json](moved-passages.json) also retains their original HTML, source paths, affected translation keys and destination note keys. The alternative renderings precede “See also” in their notes, matching their page order. A footnote previously attached to the second SN35.82 rendering follows that rendering into its title notes; its words are retained.

The introduction rule retains the existing 90% italic rule and recognizes a paragraph with short roman interruptions when its beginning and end are italic and its italic share is at least 85%, before the body begins. DN15, SN1.7 and SN7.18 were inspected and already classified as introductions, so they do not change. Note continuations after a closing box containing a nested verse, separately labelled editorial notes, styled alternative-rendering headings, and “See also” without a colon are recognized. The inline rule extracts only brackets explicitly attributed to the Commentary; translated bracketed wording and speaker attributions remain in the translation.

## Pali elsewhere: left as printed

[misplaced-pali.md](misplaced-pali.md) lists all seven cases and the Pali destinations; no placement repair is applied:

| Translator | Current key | Pali location |
|---|---|---|
| Ṭhānissaro | AN10.18:8.2 | Quoted assessment starts at 8.1; final newcoming-monks clause is 8.2 |
| Ṭhānissaro | AN4.19:4.1 | Second prose paragraph: 2.1–2.4 |
| Ṭhānissaro | AN6.45:9.1 | Separate desires/resolves/speaks/effort sentences: 9.2 |
| Ṭhānissaro | DN33:1.11.141 | Pleasant-now/painful-future: 1.11.143; painful/painful: 1.11.141 |
| Ṭhānissaro | SN4.24:10.4 | Closing Māra narrative: SN4.25:1.1 |
| Bodhi | MN8:14.4 | Numbered items 21–43: 14.5 |
| Bodhi | SN35.52:1.1 | Ten source formulations: SN35.43–52:1.1 respectively |

The six edition differences and 14 shared openings are also listed individually in `cases.md`. Where the app's local Pali lacks a passage, the report says so and gives a parallel where one exists; these are preserved as translation text. In particular, the Thai-edition expansions in MN10, MN62, MN82 and SN35.88 are not commentary extraction candidates.

## Verification and remaining alignment issue

Both full regenerations write every expected text. Both translators' final checks pass:

| Check | Ṭhānissaro | Bodhi |
|---|---|---|
| `check-upstream.py` | 0 differ | 0 differ |
| `check-integrity.py` | 0 problems | 0 problems |

The individual regeneration/check logs are saved beside this report. [verification.json](verification.json) records exact comparison of 3,844 translation/notes JSON files: only the listed 18 change; every moved passage is exact; all remaining translation words and their order are exact; every old note word is retained; all other files are identical. The frozen baseline was taken when this job began, independently of colleagues' later changes.

A plain full rerun of both translators in a fresh isolated copy reproduces **all 3,844 corpus JSON files and eight cuts/coverage/learning/report artifacts byte for byte**. [reproduction.json](reproduction.json) records the comparison; `*-reproduction.txt` holds the logs.

One saved anchor, **AN8.54:5.6**, contains the Commentary phrase now extracted from the previous sentence and is reported stale on both runs. No alignment change is made here; the generated translation changes only by removal of the Commentary aside. This stale anchor is left for the alignment session. The seven Pali-elsewhere cases likewise remain report only.

Isolated copy: `/private/tmp/sutamaya-page-parsing`. Fresh reproduction copy: `/private/tmp/sutamaya-page-parsing-reproduction-3012d6lh`. They are disposable; the patch, evidence, judgments, baseline hashes, original affected files and verification results are saved here. [STATUS.md](STATUS.md) is the resumption entry point.
