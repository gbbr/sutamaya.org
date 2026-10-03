# Verse-open and audit6 status

Branch: translations. No commits authorized or made. Main-worktree writes restricted to data/thanissaro/.

## Job 1
- Read required upstream rules and audit5 method. No prior STATUS.md existed.
- Confirmed 15 openBoundaryCases entries: 14 to review here; snp4.9 already handled by verse-reveal.
- Next: independent xhigh review of all 14 cases, preserving whole source lines and source order across grouped adjacent verses; prose moved to its starting Pali row.
- Isolated copy: /private/tmp/sutamaya-thanissaro-verse-open (created from current scripts/data; node_modules and read-only Git baseline linked).

## Job 2
- Not started; depends on verified Job 1 copied back.
- Next: draw audit6 using a new seed, excluding audits 1–5 (including the unnumbered audit/ folder); prepare every-row Pali packets; high-effort readers and a separate xhigh judge.

A batch is read only when its .findings file ends with # done. Keep this status current after every step. Isolated copies are disposable and may be recreated.

## Progress
- Job 1: independent xhigh verse judge is reviewing all 14 cases and saving per-case progress. No corpus changes yet.
- Job 2 preparation: audit6/draw.py uses seed 20261006 and excludes unnumbered audit plus audits 2–5; not drawn until Job 1 is copied back.
- Baseline upstream, integrity, and round checks running; logs saved in verse-open/.
- Baseline checks complete: check-upstream 0 differ; check-integrity 0 problems; check-round saved for comparison.
- Baseline plain segmenter rerun completed in isolated copy: 0 changed paths; final comparison saved.
- Audit6 exclusions recorded: 157 distinct previously drawn texts across audits 1–5. Draw remains pending Job 1 copy-back.
- Job 1 structural review: sn3.19 bridge has no dedicated Pali row; sn4.24 closing narrative belongs to sn4.25:1.1 (cross-source ownership); an4.19 second prose is reordered by the source; ud7.8 trailing editorial belongs in notes but current source parser keeps it in body. Exact desired moves are being documented rather than forced onto unrelated Pali.
- Job 1 xhigh judge has inspected all 14 against source/Pali. Expected: 6 recut cases, 5 settled by grouping with current compliant layouts, 3 requiring source/prose ownership support (sn4.24, an4.19, ud7.8). Final findings/judgments pending; no corpus changes yet.
- Job 1 final findings: 13 directives in 6 cases, batch-001.findings ends # done; installed as hand findings in isolated copy, older same-key directives superseded. Trial run next.
- 2026-10-03 14:18 UTC (~11 minutes elapsed): all 14 Job 1 cases judged; 13 directives across 6 repair cases installed; isolated repair run active. Remaining Job 1: checks, fresh-copy reproduction, copy-back. Job 2: 0 rows read, draw pending copy-back. User requests ongoing count/time progress updates.
- Job 1 trial finished: 13 directives in 7 groups pass, no disputed directives, 0 texts unwritten. Required checks now running.
- Job 1 checks pass: upstream 0 differ, integrity 0 problems, round 0 partial source lines/0 newly hidden/0 hidden translated verse lines (19 changed rows). Fresh regeneration copy created at /private/tmp/sutamaya-thanissaro-verse-open-regeneration; plain rerun next.
- Job 1 assignment verification: all 90 applicable focal verse rows exactly match the xhigh judge’s source-line assignments; remaining 18 focal rows belong to the 3 deferred cases. Fresh-copy plain regeneration still running.
- Job 1 verified results copied back: plain fresh-copy regeneration reproduced all 2,679 corpus/cut/coverage files exactly. 13 kept directives/19 changed rows; 11 cases settled, 3 segmenter-dependent cases remain open in deferred.json. Job 2 draw/packets now next.
- Audit6 drawn with seed 20261006: 100 texts, 2517 rows, 7 every-row Pali batches; verified no overlap with any audit1–5 draw. Next: high-effort readers; separate xhigh judge afterward.
- Audit6 reading checkpoint: 1/7 completed batches, 406/2,517 rows; readers A=001/004/007, B=002/005, C=003/006 at high effort. Independent xhigh judge has read none of audit6 batches; judge pending proposals.
- Audit6 reader checkpoint: 3/7 batches complete, 1120/2,517 rows.
- Audit6 reading: 5/7 batches completed, 1,797/2,517 rows (71%); 3 proposed directives so far. Reader A finished. Separate xhigh judge reviewing proposals while B/C finish remaining 720 rows. Audit6 isolated copy created at /private/tmp/sutamaya-thanissaro-audit6; corpus unchanged during reading.
- Audit6 checkpoint: 7/7 batches complete; 2,517/2,517 rows (100%). All readers done; 3 total proposals awaiting independent xhigh judgment.
- Audit6 xhigh judge: first 2/3 proposals accepted (AN10.96:10.1 and :12.3), final AN4.192 proposal under review with reveal/coverage implications. All reader coverage claims verified against packet row counts; saved inputs unchanged.
- Audit6 all 3 proposed repairs accepted by independent xhigh judge. Before-repair rate recorded: 3/2,517=0.1192% overall (AN3/831=0.3610%, SN0/828, KN0/858). Kept repairs installed in /private/tmp/sutamaya-thanissaro-audit6; trial next. AN4.192:9.9 newly hidden repetition intentionally needs no coverage, per judge.
- Audit6 isolated application complete: all 3 kept directives pass in 3 groups, 0 disputes, 0 texts unwritten; required checks running. README drafted with before-repair rate and coverage; fresh reproduction/copy-back remain.
- Audit6 checks pass: upstream 0 differ; integrity 0 problems; round 0 partial source lines and 0 hidden translated verse Pali. Only newly hidden row AN4.192:9.9 was judged abbreviated repetition and stays hidden without coverage. Audit6 changed 6 English rows across 2 texts. Fresh copy /private/tmp/sutamaya-thanissaro-audit6-regeneration created; plain rerun next.
