# Remaining direct-Pali work inventory

**Inventory complete; semantic reviews and the usage pilot remain pending.** The baseline is
`2bfb89b2`, on 2026-10-03. This inventory reads corpus and evidence files; it changes no alignment,
approved decisions, account memories or app files. Its outputs are outside active findings folders.

## Targeted queue

| Work counted | Bodhi | Ṭhānissaro | Total |
|---|---:|---:|---:|
| Documents inventoried | 1,166 | 1,451 | 2,617 |
| Eligible SN/AN/KN verse rows | 4,206 | 14,481 | 18,687 |
| Verse rows with credited current Pali evidence | 496 | 904 | 1,400 |
| Verse rows without that evidence | 3,710 | 13,577 | 17,287 |
| Deduplicated verse/known-problem review rows | 3,864 | 13,861 | **17,725** |
| Review rows plus minimum two-line context | 4,995 | 15,967 | **20,962** |
| Known coverage-record work, overlapping review | 1,002 | 406 | 1,408 |

Counts are translator–Pali rows, not unique Pali across translations, reading passes or error counts.
The targeted queue is about 15.7% of the 113,119 eligible body rows in translated inner suttas.
It includes uncredited verse, pending recovered proposals, source-range/numbering cases, recorded
correspondence problems and historical uncertainty. MN/DN verse is outside the new verse queue;
specific recorded suspects there remain included. Internal headings can count as body rows.

Of 403 recovered proposals, **78 have later current Pali-based boundary evidence**, including 13
superseded by a different reviewed boundary; **325 still need judgment**. Seven pending proposals
already match the current anchor but lack the required evidence. Matching words alone does not
close them. No candidate keys are missing. Source and coverage issues can remain after a boundary
is settled. The proposed fresh audits add about 2,500 reviewed rows per translator; they are not
selected or included in the queue. Whole stanza/source context can exceed the minimum context count.

## Complete-scope evidence gaps

[coverage-ledger.json](coverage-ledger.json) accounts for all **125,264 Pali keys** and **100,405
nonempty stored English segments** in these translation files, including titles and untranslated
inner suttas in grouped files. It identifies which body keys enter the targeted denominator.
It is an evidence inventory, not the final reviewed correspondence artifact.

There is credited local Pali evidence on 6,004 eligible body rows. The other **107,115 body rows
lack evidence credited by this inventory**. That figure overlaps the targeted queue; do not add
them. Absence of credited evidence does not prove a passage was never read. Reconcile additional
historical evidence before choosing further full-review work.

The ledger distinguishes direct-Pali audit-row reads, local boundary judgments and historical
MN/DN English-proxy reads. It **does not establish complete current direct-Pali reads, independent
verification or exact reviewed English-span/Pali-key correspondence for whole documents**. Even
credited rows retain those verification/coverage gaps. The targeted queue therefore does not
certify ordinary prose or define the entire cost of meeting the handoff's finish line.

Sujato is excluded from this counted inventory, rather than presumed fully verified. His inclusion
in the final coverage scope needs an explicit decision and a separate inventory. Notes and source
introductions are not part of the English-segment denominator. Coverage/omission/variant
dispositions for empty rows, headings and untranslated inner suttas remain to be reviewed.

## Evidence and exclusions

Audit5 credit requires a completed reader record, frozen packet bytes matching the saved hash and
accepted commit, and the same current Pali and English for the credited row. Import-group credit
requires an accepted `better`/`same` Pali judgment within its named span, matching current English.
Accepted Codex hand-boundary credit also requires an unchanged English document since integration.
Local judgment credit requires unchanged Pali since its recorded base. Input and evidence hashes
are preserved in [inputs.json](inputs.json); the ledger retains each row's evidence references.

These credits remove redundant boundary work, without claiming independent final verification.
Earlier proxy reads, failed automatic proposals and mechanically passing cuts are not credited
as direct-Pali completion. Historical narrative-only Pali observations, including audit3's
Thag 8.1 verse discussion, are retained in their existing records but not promoted to hashed current
row completion. Their exact unchanged coverage needs reconciliation before rereading that passage.

Verse detection includes single-line paragraphs, the Dhammapada and stanza continuations. It
excludes titles, explicit closing/summary material and whole inner suttas with no body English
from the targeted denominator; their keys remain in the complete-scope ledger. The checker
compares the eligible verse population with the existing corpus classifier.

## Check and resume

Run from the repository root:

```sh
node scripts/segmenter/check-pali-inventory.mjs
node scripts/segmenter/inventory-pali-review.mjs
node scripts/segmenter/check-pali-inventory.mjs --resume-check
```

The first command checks hashes, complete document/key populations, queue uniqueness, counts,
candidate accounting and verse selection, and saves `validation.json`. It performs no semantic
review. A changed input makes the check fail; rerun the inventory to reconcile it.

The second command rebuilds the inventory. Each complete document checkpoint is written atomically;
`progress.json` identifies the last finished document. Matching checkpoints are reused and stale
ones rebuilt. If interrupted, run the same command. The `documents/` cache is ignored because it is
reproducible: a fresh clone rebuilds it, and all final evidence/counts are retained outside it.
Deleting or losing that cache loses speed, not conclusions. Reports are consumable only after
`progress.json` says validation is complete. Run telemetry is separate from the reproducible queue,
ledger, candidates, input manifest and passage list.

The optional third command exercises a missing checkpoint and saves `resume-check.json`. Run the
inventory first if the local cache is absent. It moves only its own generated checkpoint aside,
regenerates it and compares the reports; it never moves corpus or other sessions' files.

The saved checks cover all 2,617 documents, 9,660 input hashes and 18,687 eligible verse rows,
including every audit5 coverage concern and source-variant concern across grouped document IDs.
The restart check removes one generated checkpoint, confirms 2,616 reused/one rebuilt, and compares
the reproducible reports. That proves inventory recovery, not idempotent alignment/correspondence
processing; the latter remains pilot work in [the handoff](../HANDOFF.md).

Next: choose the small usage/correspondence pilot, measure both reading passes, and use the complete
evidence gaps to decide additional review scope. Do not launch the whole queue or apply archived
findings automatically. Every individual commit still needs permission.

## Where to look

| What | Where |
|---|---|
| Counts and exclusions | [summary.json](summary.json) |
| Exact targeted key list, convenient for filtering | [passages.tsv](passages.tsv) |
| Reasons, source references and minimum context per document | [queue.json](queue.json) |
| Every current Pali/English key and credited evidence | [coverage-ledger.json](coverage-ledger.json) |
| Recovered proposals and individual dispositions | [candidates.json](candidates.json) |
| Current-state and restart validation | [validation.json](validation.json), [resume-check.json](resume-check.json) |
| Interruption checkpoint and next command | [progress.json](progress.json) |
| Quality standard and next review plan | [../HANDOFF.md](../HANDOFF.md) |
