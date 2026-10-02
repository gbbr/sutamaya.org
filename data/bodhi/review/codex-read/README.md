# Codex SN, AN and KN read-through of Bodhi

The original batches and returned findings are preserved beside one another. `import.json` records
archive, input, finding and log hashes. Every imported log reports `gpt-6.1-sol` at `high` reasoning
effort; the saved input batches match the handoff archive byte for byte.

All 278 initially passing groups receive original-Pali review in `judgments.json`, with
`initial-groups.json` preserving their before/after snapshots. The initial verdicts are
247 better, 14 equivalent and 17 worse. A mechanical pass
only proves applicability and text preservation; worse proposals are replaced by hand repairs or
retain their previous placement. Failed and disputed findings are also resolved by hand, with
source/correspondence limitations explicitly deferred. Raw imported findings remain unchanged.

The Codex integration and its hand completions affect 674 English
segment rows and 443 stored cut decisions, before the separate
fresh audit repairs. The row count includes both vacated and filled keys; it is not a count of
independent mistakes. `../audit5/` holds that audit's frozen inputs, findings and result.

`followup-rounds.json` records cross/list judgments; `source-ranges.json` preserves source-mapping
work and limitations. The consolidated state and validation are in
[`data/upstream/codex-sn-an-kn-review.json`](../../../upstream/codex-sn-an-kn-review.json).
Earlier hand proposals superseded by reviewed corrections stay visible as comments. The app
implementation and MN/DN translations are outside this integration. The finished integration has the user’s specific commit approval.
