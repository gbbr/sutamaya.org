# Page parsing proposal status

Complete: all requested review, parser proposal, regeneration, verification and reports are finished. Branch `translations`; no commits. Repository writes are confined to this directory. Live segmenter and translation data have not been changed by this job.

Latest scope: all separately identifiable translator commentary moves into `notes/`. Translation words and order never change. The earlier introduction-only and two-cases-only restrictions were superseded by the user.

Completed:
- Reviewed all 126 oversized-row candidates: 89Thanissaro,37Bodhi. `cases.findings` ends with `# done`; `judgments.json` and `cases.md` record all causes and Pali locations.
- Reviewed the wider page inventory:22Thanissaro and18Bodhi candidates. Canonical speech/endings and abbreviated-passage placeholders retained. `commentary-inventory.findings` ends with `# done`.
- Patched both the segmenter and the independent upstream checker's own parser, in the isolated copy only.
- Regenerated both translations. Exactly18 corpus JSON files change in 9Thanissaro texts; Bodhi unchanged.
- Saved every newly moved passage in full:23 paragraphs/asides in `moved-passages.md` and `.json`, including source/destination keys.
- Exact preservation verified across 3,844 corpus JSON files: all moved words/order preserved, remaining translation words/order preserved, existing note words retained, all other files identical.
- Both translators: check-upstream0differ; check-integrity0problems. Logs saved here.
- `page-parsing.patch` matches the live current scripts and passes `git apply --check`.

Isolated copy: `/private/tmp/sutamaya-page-parsing`.
Fresh reproduction: `/private/tmp/sutamaya-page-parsing-reproduction-3012d6lh`.
Fresh runs complete: all 3,844 corpus JSON files and 8 alignment/report artifacts reproduced byte for byte. Reproduction logs and `reproduction.json` saved. `README.md` is finalized.
Next: no required work remains. The proposed patch is saved for review; it has not been applied to the live scripts. No commit.

Report-only findings:7Pali-elsewhere cases (`misplaced-pali.md`),6edition differences and14expanded shared openings (`cases.md`). AN8.54:5.6's settled anchor contains the removed commentary and is stale; no alignment repair has been applied. Generated translation changes there are only the removal of the commentary aside.

If an isolated copy disappears, recreate scripts/data from the repository, restore the saved baseline script versions and affected original JSON files where applicable, link node_modules, and apply the saved patch. A current data snapshot may include colleagues' newer changes; record a new baseline rather than pretending it is the frozen snapshot. Do not overwrite colleagues' files or copy regenerated translation data to the live repository.

Started2026-10-03T14:57:39Z. Earlier checkpoints/scope history are preserved in `run-log.md`.

Finished 2026-10-03 16:05:41 UTC. About 68 minutes elapsed, including interruptions. All 126 screening judgments and 23 moved commentary passages are saved.
