# Fourteen open places in Ṭhānissaro’s verse

All fourteen cases were judged directly against the original upstream HTML and Pali at effort
xhigh. Snp 4.9 was excluded because `../verse-reveal/` already settled it. Source paragraphs,
`<pre>` lines and `<br>` breaks, with note markers omitted, determine the translator’s actual
lines; existing app cuts are not evidence of those breaks.

A crossing of neighboring verses makes their smallest coherent span one group. Source lines
stay whole and in source order throughout that group, whose first source line sits on its first
Pali line. Every Pali line must show. A lone empty row reveals its Pali under the row above and
is therefore allowed; the round does not recut an already compliant spread merely because its
lines differ from the Pali’s order.

| Open place | Judgment and intended result |
|---|---|
| SN 3.19:7.1 | Start the verse at its first real line, “Like water”. The edition-added speech bridge, absent from the app’s Pali, stays at the end of preceding prose 6.6. |
| SN 4.24:10.4 | The final narrative belongs to SN 4.25:1.1. Its cross-text source transfer needs segmenter/checker support; deferred. The verse itself is already four whole lines. |
| AN 3.39:10.3 | Group verses 10–11. Keep health, youth and life in one source line; start 11.1 at “as one who sees” and 11.2 at “renunciation as rest.” |
| AN 4.19:4.1 | Second prose belongs on 2.1–2.4, before the first verse in the app’s Pali, although the source puts it after that verse. Prose reordering needs segmenter/checker support; deferred. Both verse spreads are already whole. |
| AN 5.36:3.1 | Group verses 2–3; the inspired-heart/noble-recipient source line crosses them. Existing eleven-line spread over ten Pali rows is compliant; keep it. |
| AN 5.57:14.3 | Group verses 14–15; make the same whole-line repair as AN 3.39, with new starts at 15.1 and 15.2. |
| AN 6.45:21.3 | Group verses 21–22. Start 21.4 at “righteously-gained,”, keeping “making gifts of his belongings,” whole on 21.3. Existing lone empty 22.2 reveals its Pali. |
| AN 8.54:18.2 | Group verses 17–18. Eight true source lines on eight Pali lines require one per row; fill 17.3 and shift following starts through 18.2. |
| Snp 3.1:6.4 | Group verses 6–7 because mindful/downcast precedes the plow-length ending. Existing nine whole lines across eight Pali rows are compliant; keep them. |
| Snp 3.12:25.1 | Group verses 25–26 because “Knowing that” precedes the feelings list. Existing seventeen whole lines across ten Pali rows are compliant; keep them. |
| Thag 17.2:22.3 | Group verses 22–23, whose distinguishing endings reverse the Pali’s order. Existing eight lines across eight Pali rows are compliant. The body-laying/awaiting-time variant is a source difference, not a boundary error. |
| Thig 6.7:3.1 | Group verses 3–4 because abandoning the lower fetters precedes their list. Existing seven whole lines reveal all eight Pali rows, including lone empties 4.2 and 4.4; keep them. |
| Ud 7.8:4.6 | Verse ends at “attachment.” Three following paragraphs are editorial commentary without a Pali counterpart. Preserve them; classifying and moving them to notes needs segmenter/checker support. Deferred, with no invented closing-line correspondence. |
| Snp 3.6:46.1 | Group verses 45–46. Eight actual source lines across eight Pali rows restore whole starts at 45.4, 46.1 and 46.4, including “no hindrances. Your despairs” and the complete steadfast/enduring-in-truth line. |

The fourteen groups contain **108 focal Pali verse rows**. Six cases propose **13 boundary
directives**; five settle through grouped ownership with no corpus recuts. Three structural
cases remain explicitly open. This is a targeted review, so it does not estimate an error rate.

`batch-001.findings` contains only the thirteen applicable directives and ends with `# done`.
`judgments.json` records every target row’s Pali, its assigned complete source lines, the group,
and the rationale. `superseded.json` identifies six incompatible older directives; the active
findings must also be installed as a hand override. `deferred.json` records the exact desired
prose/commentary placements and the missing segmenter behavior; these are not active findings.
`<text>.evidence.txt` and `source-lines.json` preserve direct-source evidence. `prepare.py` and
`save_judgments.py` rebuild the evidence and judgment records without modifying the corpus.

The judge did not run the segmenter or change any corpus file. Root integration supplies the
isolated trial, required checks, regeneration comparison and copy-back records before Job 2.

## Isolated application

The 13 kept directives passed in seven trial groups and changed 19 English rows across six
texts. The isolated checks report 0 upstream differences, 0 integrity problems, 0 changed verse
fragments, 0 newly hidden Pali lines, and 0 hidden translated verse lines. No coverage entries
were needed. Fresh-copy plain regeneration reproduced all 2,679 text, note, cut and coverage files exactly;
the verified results have been copied back to `translations`. Logs and per-row evidence
are saved beside this report.

`claude-judge.txt` supplies every changed group with its original Pali, source page and before/after
text for the subsequent judge from another model. That external review is pending.
