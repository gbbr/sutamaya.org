On branch `translations`, take in Codex's read-through of Bodhi's and Ṭhānissaro's SN, AN and KN.
It read the batches in data/<translator>/review/codex-read/ (written with `read --every`) and
returned ~/Desktop/findings.zip, which holds bodhi/ and thanissaro/ batch-NNN.findings, named as
the batches, and a log per batch. If data/*/review/audit4/README.md isn't there yet, the MN and DN
audit is still running in another session: stop and tell me. Otherwise unzip the findings beside
their batches, and check from the logs that every batch ran at high effort and which model read
them.

Follow data/upstream/README.md ("Reviewing new and revised texts") and
data/upstream/review-rounds.md, including its Rules: try with --findings, judge every passing group
yourself, write fixes for findings that can't apply and settle disputes by hand in review/hand/,
keep with --keep-findings; then rerun `cross` and `lists` in new folders until they put up nothing;
finish with check-upstream.py and check-integrity.py for both translators: 0 differ, 0 problems.
Codex's last read flagged about 2% of the lines it read, so expect many groups. At most 3 subagents
in flight; I have usage limits, so keep your own reading lean.

Then run the next audit, of SN, AN and KN, as the audit paragraph that closes "Reviewing new and
revised texts" says: copy review/audit3/draw.py with a new seed, draw from those collections only,
leaving out texts any earlier audit drew, about 2,500 lines per translator. Readers are Opus with
"The reading prompt" (the line-reader agent defaults to Sonnet, so pass model opus). Write the
audit's README.md in audit3's form.

Last, with both new audits in hand (audit4 for MN and DN, and this one), propose, but don't make,
any change to the process in data/upstream/README.md: how many reads a new or revised text gets,
by which model, and whether every line; and whether audits should draw by lines rather than 2
texts per collection. Evidence so far: after one Sonnet read, the third audit found 1–5% of lines
misplaced in MN and DN; a full Opus read of every line then moved about 1.3% of their lines; the
third audit read only 90–182 lines of SN, AN and KN per translator. Weigh what the new audits
find, and how much Codex found that the earlier reads had missed.

Don't commit. Report briefly: how many lines Codex's findings moved, how many groups you rejected
and why, each translator's audit rate in SN, AN and KN against about 0.5%, and your proposal.
