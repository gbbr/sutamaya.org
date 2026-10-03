# Verse-open and audit6 status

As of 2026-10-03 14:41 UTC. Branch `translations`; no commits made or authorized. Main-worktree writes only under `data/thanissaro/`. Steps and checkpoints are preserved in `run-log.md`.

## Job 1: verified and copied back

All 14 open cases judged at xhigh against source HTML/Pali (108 focal verse rows):
- 13 boundary directives applied in six cases, changing 19 English rows.
- Five cases settled by grouping neighboring verses, retaining already compliant layouts.
- Three cases remain open because they need segmenter/checker changes: SN4.24 cross-text prose ownership; AN4.19 reordered prose; Ud7.8 trailing editorial-to-notes classification. Exact desired moves in `deferred.json`, all14 outcomes in `README.md`.
- Upstream 0 differ; integrity 0 problems; round 0 partial source lines, 0 hidden translated verse Pali, 0 newly hidden rows.
- Plain segmenter in a fresh copy exactly reproduced 2,679 corpus/cut/coverage files; verified results copied back.
- Disposable copies: `/private/tmp/sutamaya-thanissaro-verse-open` (applied); `/private/tmp/sutamaya-thanissaro-verse-open-regeneration` (verified rerun).

## Job 2: complete, verified and copied back

- Fresh draw seed 20261006, excludes all 157 distinct texts drawn by audits 1–5 (including original `audit/`).
- All 100 texts / 2,517 rows read at high effort, all 7 `.findings` end `# done`; reader coverage confirmed. SN828rows/33texts, AN831/25, KN858/42.
- Separate xhigh judge read no audit6 batches and accepted all 3 proposals: AN10.96:10.1, AN10.96:12.3, AN4.192:9.9.
- Rate recorded before repairs:3/2,517=0.12% (AN0.36%, SN0%, KN0%); audit5 was2.32%.
- Three directives passed isolated trial; six changed English rows across two texts. Upstream0differ, integrity0problems, round0partial source verse lines/0hidden translated verse Pali. Newly hidden AN4.192:9.9 is judged abbreviated repetition; it must stay hidden without coverage.
- Applied copy: `/private/tmp/sutamaya-thanissaro-audit6`.
- Fresh reproduction copy: `/private/tmp/sutamaya-thanissaro-audit6-regeneration`; plain segmenter exactly reproduced all 2,679 corpus/cut/coverage files.
- Verified results copied back; copy-back hashes match. audit6/README.md and results.json are final. No in-scope work remains.
- Later Claude cross-model review is pending outside this session.

A batch counts as read only when its `.findings` ends with `# done`. Isolated copies are disposable; recreate from the repository if lost.

- Final follow-up cross and lists rounds in the applied audit6 copy: 0 suspects each; no further repairs needed. Fresh plain reproduction and copy-back complete.

## Finished

Both requested jobs are complete within the data-only scope. All 14 Job 1 cases were judged; three explicitly require segmenter/checker support and remain open in deferred.json. Audit6 read all 2,517 rows, kept three repairs, and passed the required checks/reproduction. Next external work: the three segmenter-dependent cases and the subsequent Claude cross-model check. No commits made.

- Subsequent-Claude packets prepared: verse-open/claude-judge.txt (7 changed groups), audit6/claude-judge.txt (3). No audit batch remains unfinished.
