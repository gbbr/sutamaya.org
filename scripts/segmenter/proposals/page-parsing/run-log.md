# Page parsing proposal status

Started 2026-10-03T14:57:39.344530+00:00. Branch translations. No commits. Repository writes only under scripts/segmenter/proposals/page-parsing/.

- Read current page parser and independent upstream/integrity checkers; inspected the five named examples.
- Isolated copy: /private/tmp/sutamaya-page-parsing; scripts/data copied, node_modules linked, Git baseline read-only. Disposable; recreate if missing.
- Baseline current parser/checkers saved under baseline/ with hashes. Concurrent translator/alignment changes must remain untouched.
- Next: reproducible oversized-row scan of both translations, review every candidate against original source and Pali, classify causes. Then repair only page-furniture parsing in isolate, regenerate both translators, check source/integrity, record exact changed texts and patch.
- Progress: 0 candidates judged; scan not yet run.

- Oversized-row scan complete: 126 candidates across both translations. Criteria and excluded abbreviation rows in scan.json; every candidate has Pali/English context and original source snapshot. Next: judge all candidates and inventory page structures for furniture fixes.

## User correction: binding scope

The translator's words and order never change. Only paragraphs the page itself marks as introductions may move to notes, as other introductions already do (SN1.8). Leave Ud7.8 trailing paragraphs, AN3.47 alternative rendering, AN9.42 editorial note, and all other non-introduction material exactly in the text; list them in the report only. Do not implement note-tail or alternative-rendering extraction. No parser edits have been made yet.

- Progress: scan126candidates (89Thanissaro,37Bodhi). First26 read against Pali/context; 27–47 partly inspected, full case judgments still to save. Original source inventory running (session69950); it only reads source pages and saves proposal evidence. Next: finish introduction inventory and all126 case judgments, then patch only explicitly styled introductory paragraphs in isolated copy.

- Applied only introduction recognition changes to isolated segment-translations.mjs and independent check-upstream.py. Existing0.90 rule retained; lower0.85 share allowed only when beginning/end carry italic markup, before body. Inventory4 candidates: DN15 already has introduction separator; SN1.7,SN1.8,SN7.18 should newly recognize their explicit introductory styling. Ud7.8,AN3.47,AN9.42 untouched. Baseline corpus hashes saved before regeneration.

- 2026-10-03 15:23 UTC: All126 Pali/context packets read (89Thanissaro,37Bodhi); final source judgments and destination verification still being saved. Thanissaro regeneration complete; exactly SN1.8 translation+notes changed. SN1.7/SN7.18/DN15 already recognized. Bodhi regeneration session93408; Thanissaro upstream session6143, integrity24512 running. Next: persist126 case judgments, finish both checks, exact word/order verification, patch and report. Approx24 minutes elapsed; estimate10–15 minutes remains.

- 2026-10-03 15:26 UTC: User clarified placement and explicitly authorized moving both Ud7.8 closing note paragraphs and AN3.47 alternative rendering into notes, preserving every word/order. This supersedes the earlier report-only instruction for those two cases only. Introduction-only regen changed exactly SN1.8 translation+notes; Bodhi unchanged. Thanissaro upstream0differ/integrity0problems; Bodhi checks finishing. Next: add note continuation and alternative-rendering recognition, then repeat regeneration/checks.

- 2026-10-03 15:40 UTC: All126 judgments persisted in judgments.json, cases.md and cases.findings (#done). Counts: 3 approved page repairs; 7 Pali-elsewhere cases; 6 edition differences; 14 shared openings; 2 retained editorial cases; 94 accepted expansion/sentence/lexical cases. Final regeneration changes exactly six JSON files for SN1.8,Ud7.8,AN3.47; no Bodhi change. Alternative rendering notes explicitly precede See also to preserve source order. Final check sessions: Thanissaro upstream pending, integrity pending; Bodhi upstream pending, integrity pending. Next: strict word/order verification, save final patch/diffs/check logs and README; then mark complete.

- 2026-10-03 15:35 UTC: User broadened scope: ALL separately identifiable translator commentary, including introductions, closing remarks and alternative renderings, belongs in notes; translation words/order immutable. Checker must use its own parser. Must save full text of every moved passage. Earlier narrow scope superseded. Next: expanded source-page inventory, classify remaining commentary candidates (including AN9.42,SN35.82), then rerun both corpora/checks and save full moved-passages dossier.

- 2026-10-03 15:47 UTC: Expanded commentary inventory read for both translators (22Thanissaro,18Bodhi candidates; canonical endings and abbreviation substitutes retained). Nine texts now change: SN1.8,Ud7.8,AN3.47,AN9.42,SN35.82,SN48.8,AN8.54,SN47.8,SN20.7. Includes3 explicitly attributed inline Commentary asides. Thanissaro checks0differ/0problems. Full moved-passage dossier generated; strict preservation check underway. Bodhi final regeneration session54022. Next: finish exact word/order check, fresh plain rerun, check logs, report and final patch. One AN8.54:5.6 settled cut anchor contains removed commentary and is stale; no alignment repair applied.

- 2026-10-03 15:49 UTC: Strict verification passed across3844 JSON corpus files: only18 files in9 texts differ; each of23 moved paragraphs/asides is exact; remaining translation words/order exact; all old note words preserved; Bodhi unchanged. Fresh reproduction copy: /private/tmp/sutamaya-page-parsing-reproduction-3012d6lh. Next: plain full reruns of both translators there and compare all files, then finalize README/logs/patch.
