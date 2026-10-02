# Parked alignment evidence

This archive makes the recovered work available from the repository, without access to local
Claude accounts or ignored recovery directories. [The handoff](../../HANDOFF.md) is the starting
point. Original local recovery files are left untouched so other sessions retain their evidence.

## Contents and status

| Path | What it holds | How to use it |
|---|---|---|
| `source/bodhi/` | 10 saved verse input packets and 2 named findings | Pending candidates; rebase and judge against current Pali alignment |
| `source/thanissaro/` | 62 verse input packets and 401 named findings in 10 files | Pending candidates; overlaps with later accepted repairs are possible |
| `source/mn-dn/` | Baselines, counts helper and recovered session log | Historical evidence for completed MN/DN work; not a new round |
| `scratch.zip` | All 54 recovered scratch files: snapshots, prompts, exploratory helpers and trial logs | Lossless compressed history; extract separately if useful; helpers are not maintained tools |
| `original-recovery-manifest.json` | Original hashes and historical source locations | Provenance; absolute paths are historical, not restart dependencies |
| `recovery-evaluation/` | Scope check, trial groups, dictionary comparisons, evaluator and logs | Mechanical recovery checks, not semantic approval |
| `working-tree-cleanup/` | Unfinished verse helper, original README/patch, 11 round12 packets and cleanup manifest | Parked prototypes and generated inputs; zero round12 findings; do not restore wholesale |
| `integration-provenance/` | Original Codex instructions, accepted integration commit message/result/scope and README patch | Historical commit `2b97d04c` provenance; past instructions/approval do not authorize new work |
| `manifest.json` | Repository payload and compressed-member hashes, sizes and dispositions | Authoritative archive inventory for byte-preservation checks |

All 137 files named in the original recovery source manifest are preserved: 83 readable verse
files, plus 54 scratch members in the ZIP. The four MN/DN files and later cleanup evidence have
new copy hashes. The archive contains no account credentials or account memory exports.

The directory is deliberately outside `data/<translator>/review/`: the segmenter reads
`review/*/*.findings`. None of these pending findings can be picked up automatically.

## Verify and recover safely

From the repository root:

```sh
python3 scripts/segmenter/review-pali.py archive-check
```

To inspect scratch files, extract `scratch.zip` into a fresh temporary directory, preserving its
`source/scratch/` paths. The manifest checks both the ZIP itself and every member; extracting it
is not required for normal restart. Historical helpers often expect the old scratch layout and
must be reviewed before execution.

For verse candidates, build current Pali-inclusive inputs, compare the candidate's effect against
current cuts, and record a fresh accepted/rejected/superseded/deferred disposition. Only then
copy selected findings into a named trial folder in an isolated scratch corpus. Do not copy all
archived `.findings` into an active `hand/` directory.

Round12 can supply a reading list but has no unique findings to recover. Regenerate only for a
specific review purpose. Keep the verse helper inactive until coverage is checked, especially
single-line paragraphs and Dhammapada stanzas. Keep the saved README patch as evidence; the
planned replacement process lives in the handoff.

Disposable rebuild trees, duplicate integration intermediates and raw account conversation files
are excluded. Accepted import batches, findings, logs, judgments and audit evidence already live
in `data/{bodhi,thanissaro}/review/{codex-read,audit5}/`; they do not need another archived copy.

## Where to look

| What | Where |
|---|---|
| Resume plan, pilot and incoming-sutta process | [../../HANDOFF.md](../../HANDOFF.md) |
| Payload hashes and restoration dispositions | [manifest.json](manifest.json) |
| Original provenance | [original-recovery-manifest.json](original-recovery-manifest.json) |
| Parked working-tree cleanup | [working-tree-cleanup/manifest.json](working-tree-cleanup/manifest.json) |
