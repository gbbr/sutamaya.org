# Note placement status

Finished, 2026-10-03. No commits. Shared implementation/data unchanged;
all repository writes for this task confined to this proposals folder.

Isolated copy: `/private/tmp/sutamaya-note-placement-6u13htcx` (disposable,
node_modules linked). Branch `translations`, HEAD `ea9dcea1278f3fa2495417af36ae96a90275a4cb`.
Base: verse-layout.patch; compatible current-README base saved here as
verse-layout-current.patch. baseline/ keeps pre-review context and verse-patched
source; reviewed/ keeps final hand-reviewed outputs; prototype/ keeps logs.

Done:
- Read required upstream rules, segmenter, verse patch/tests/report and hand-review evidence.
- Implemented whole source-note detection/grouping and first omitted-Pali-row ownership,
  Pali sentence-tail handling, conservative inline/overlap exclusions and settled-cut priority.
- Bodhi hand session finished; copied its final results. Both reviewed snapshots still match
  the shared repository's current sutta/notes files exactly.
- Final independent measurement, hand answers withheld: 81/81 distinct moved notes;
  82/82 moved candidates include one duplicate; 23/23 unchanged notes and 18/18 ordinary
  controls unchanged; 0 broken source streams. Gold targets never feed placement inference.
- Saved reproducible production-function harness and 208 pre-review cut-key values;
  183 changing directives and 25 no-op keys withheld. Existing prose/verse context disclosed.
- Plain full runs exactly reproduce 1167 Bodhi and 2677 Thanissaro sutta/notes files:
  0 changed/missing/extra files; 0 texts left unwritten. No data refined to fit the rule.
- Independent checks: both translators 0 word differences and 0 integrity problems.
- 15 note CLI tests plus 10 verse CLI tests pass; full npm test passes 122 files, 1730 tests.
- Added short README review rule; removed completed combined segmenter task from What's left.
- Saved final note-placement.patch on top of verse layout. Other sessions rewrote the shared
  README, so verse-layout-current.patch refreshes its README changes while keeping the verse
  source/tests identical and preserving their updated completed-round/commentary information.
- Both patches apply in order to current shared files and produce all four tested files exactly;
  note reverse-check and segmenter syntax check pass. Source/patch hashes saved in summary.json.
- All test and segmenter processes finished. Process inspection found no Vitest/workerd;
  no unrelated process stopped. Environment-only Vite/cache/build-data changes excluded.

Artifacts:
- note-placement.patch — segmenter, its real CLI tests, README; applies on the verse base.
- verse-layout-current.patch — compatible verse prerequisite for the shared README as it is now.
- report.txt — short findings, method/limits, checks, remaining reader work and reproduction.
- summary.json, measurement.json — summary/hashes and per-candidate scoring evidence.
- measure-notes.mjs, withheld-cuts.json — rerunnable inference with hand answers withheld.

Next: none. Work finished. Apply the compatible verse base then note-placement.patch only
when the user wants the shared implementation updated; this task saved proposals only.
If the disposable copy is lost, follow report.txt to recreate it and rerun measurements.
