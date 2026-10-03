# Verse layout status

Finished, 2026-10-03. No commits. The patch is saved, not applied to the shared repository.
All task changes in the repository are confined to scripts/segmenter/proposals/verse-layout/.

Isolated copy: `/private/tmp/sutamaya-verse-layout-o3_1wta_` (disposable; node_modules linked).
Snapshot: branch `translations`, HEAD `ea9dcea1278f3fa2495417af36ae96a90275a4cb`.
The other sessions' later data changes are outside this snapshot and were not touched.

Done:
- Read the upstream README, segmenter, and proposal patch/tests/report; applied the proposal in the copy.
- Replaced prototype-only tests with ten Vitest tests that run the actual segmenter CLI;
  the replacement lives inside the patch at scripts/segmenter/__tests__/verse-layout.test.js.
- Both plain full runs reproduced sutta/notes byte for byte: 1167 Bodhi and 2677 Thanissaro files,
  zero changed files/rows, zero texts left unwritten. No review answers or translation data changed.
- Independent layout inference with internal review cuts withheld:
  Bodhi 1127/1172 exact (930/975 translated), 20 different, 25 declined, 197 empty no-ops;
  Thanissaro 2952/3966 exact (2661/3675 translated), 965 different, 49 declined, 291 empty no-ops.
  Whole-verse ownership is supplied, as in the previous report; it is not part of these match figures.
- Both upstream checks: zero word differences. Both integrity checks: zero problems.
- npm test passed: 121 test files, 1715 tests. The copy required generated data/sujato.post,
  local Vite linked-dependency/cache configuration, and an approved run outside the sandbox for
  Cloudflare's worker runtime. Environment-only config changes are excluded from the patch.
- Updated README in the patch: completed What's left item 1 removed; update/review verse steps
  reduced to unequal-count grouping/gaps, ownership across verses, and declined/prose cases.
- Saved one patch against the repository's current segmenter/tests/README; git apply --check
  passes in the repository, reverse-check passes in the modified copy. Source hashes are saved.
- Saved and reran the measurement harness; it reproduces summary.json's figures exactly.
- Every started process/session finished. Process inspection found no remaining Vitest/workerd;
  no unrelated process was stopped.

Artifacts:
- verse-layout.patch — segmenter, real CLI tests, upstream README (the only applyable patch).
- report.txt — method, per-translator figures, limits, validation and remaining reader work.
- summary.json — machine-readable figures, snapshot details and before/after source hashes.
- measure-reviewed.mjs — rerun in an isolated patched copy, one translator at a time.
- The copy's baseline/ holds source/sutta/notes snapshots; prototype/ holds measurements and logs.

Next: none for this task. After the other translator sessions finish, the saved patch can be
applied to the repository. No commit is authorized. If this copy disappears, the report explains
remeasurement in a fresh isolated copy; the saved patch/report/summary remain the finished result.
