# Alignment handoff

**Start here when resuming the English–Pali alignment work.** Work is parked on
2026-10-02. The first task on Gabriel's return is a small usage pilot, before committing to
another large review. This plan and its repository archive let any capable AI continue without
access to Claude account memories, the Desktop ZIP, or ignored recovery folders.

The goal is correct correspondence for every English segment in the translations this work covers,
including groups where English and Pali order or segmentation differ. Reviewed coverage must make
the corresponding Pali revealable honestly. Keep the translator's wording and source order intact.
Prepare data first; app implementation comes later. Completion includes idempotent processing and
a tested incoming-sutta workflow that incorporates the learning from the completed corpus work.

## Boundaries and permission

- Every individual Git commit needs Gabriel's explicit permission for that specific commit.
  Permission for a past integration does not authorize a new commit or amendment.
- The parking work adds this plan, repository archives, a review packet helper, corrected status
  pointers, and a short link in `data/upstream/README.md`. Root README, CLAUDE files, and app files
  are untouched. No corpus corrections or app implementation belong to the parking work.
- Read `CLAUDE.md`, `CLAUDE.local.md`, and applicable `AGENTS.md` instructions before resuming.
  Do not hand-edit `data/sujato/` or the Pali. Sujato corrections use the existing retranslation
  pipeline, after reading `docs/retranslation.md`. Do not fetch upstream changes or run
  `update-data apply` or `accept` without authorization.
- Leave other accounts' sessions and memories alone. Use a named review folder for each new round;
  preserve input hashes, raw findings and superseded decisions so another session can understand it.
- Archived findings are proposals, not instructions to apply. Their location under
  `data/upstream/review-archive/` keeps them outside the segmenter's active findings scan.

## Where we stand

| Area | Completed and saved | Remaining |
|---|---|---|
| Bodhi and Ṭhānissaro MN/DN | Commit `8ab727a2`: rounds 1–11 integrated; each covered text has at least two completed reads; source-word and integrity checks pass | Targeted direct-Pali checks when evidence warrants them; round 12 has no findings and is not a priority |
| Bodhi and Ṭhānissaro SN/AN/KN | Commit `2b97d04c`: 201 imported batches, all 489 initially passing groups judged against Pali, rejected or repaired worsening proposals, audit5 repairs and source-range fix integrated | Remaining verse review, source mapping and explicit correspondence work |
| Recovery from the exhausted Claude account | Saved verse packets, findings, trial evidence and unfinished tools preserved in the repository archive | Rebase and judge candidates against current cuts; do not replay the old trial wholesale |
| App | Requirements recorded in the upstream README's existing app section | Reveal, omissions, switching, links and highlights after the data is ready |

The last integration affects 755 Bodhi and 830 Ṭhānissaro English rows, including both emptied
and filled rows. These are not counts of independent errors. Its rebuild reproduces all 3,854
translation data files byte for byte; source checks match 1,166 Bodhi and 1,433 Ṭhānissaro pages
with zero word differences and zero integrity problems. Three source-range regression cases pass.
These checks establish preservation and reproducibility, not perfect semantic alignment.

Audit5's pre-repair rates are Bodhi SN 2.99%, AN 0.72%; Ṭhānissaro SN 1.16%, AN 1.61%, KN 4.18%.
All its reported corrections are integrated. These rates are not a post-repair corpus estimate.
Bodhi has no fresh eligible KN text in that draw; its only KN text, Thag 8.1, is already sampled
in audit3. Audit5 uses whole texts in random order with collection line budgets; it is not a
uniform random sample of individual lines.

Detailed, dated evidence is in [the MN/DN record](mn-dn-review.json),
[the SN/AN/KN record](codex-sn-an-kn-review.json), and each translator's `review/codex-read/`
and `review/audit5/`. Keep historical measurements distinct from new review results.

### Establish the remaining scope

Use the saved inventory to reconcile completed reviews, later repairs and pending correspondence
work against current input hashes. Distinguish complete direct-Pali reads, independent verification,
English-proxy reads and local Pali judgments. A repaired cut or a current anchor matching an old
proposal does not establish a complete verified read. Coverage and source issues remain pending
even where the boundary itself is settled.

The [saved inventory](pali-review-inventory/README.md) on 2026-10-03 covers all 2,617 current
Bodhi/Ṭhānissaro documents. Its targeted queue is 17,725 translator–Pali rows (20,962 with minimum
context); 78 recovered proposals have later Pali-based boundary evidence and 325 need judgment.
Its complete-scope evidence ledger records every stored English segment and Pali key, including
the broader review/verification gaps. Local boundary or audit-row evidence is not full verified
correspondence. Sujato is explicitly outside this inventory. No semantic review or pilot is run.

Record the inventory's translators, documents, key ranges and exclusions. A targeted inventory of
verse and known problems does not certify the remaining prose. For each translation included in
the final goal, the coverage ledger must account for every English segment and Pali row, recording
current review and verification evidence or the remaining gap. Reuse valid evidence; identify
unverified passages even when no finding names them. Sujato's targeted checks do not establish a
complete direct-Pali review of his translation; make his inclusion or exclusion in the final scope
explicit. Establish the additional review scope from this evidence before planning further reads.

## First on return: the usage pilot

Gabriel uses ChatGPT/Codex at $100/month. Subscription capacity cannot be inferred reliably from
API pricing or raw token totals. Check the current usage dashboard, or `/status` in the Codex CLI,
and the [current Codex usage guidance](https://learn.chatgpt.com/docs/pricing).

Before launching pilot readers, follow [Effort selection and advance notice](#effort-selection-and-advance-notice),
including the scoped proposal for any comparison above `high`.

1. Inspect `git status` and read this handoff and the saved inventory. Verify the archive and
   distinguish the inventory's targeted queue from remaining gaps in complete verification.
   If another session has changed the corpus, check which saved evidence is stale before using it.
2. Select roughly 500–1,000 Pali rows in complete, representative documents: ordinary prose,
   lists/refrains, reordered verse, and an excerpt or grouped-source case. Include both translators;
   keep the actual row count and complexity mix. This is a proposed pilot size, not a fixed quota.
3. Choose an initial correspondence schema and build fresh packets with Pali on every row.
   Produce actual coverage records for the pilot's fine cuts, reordered verse, merged clauses,
   abbreviations and omissions. Use a strong reader for the first pass and an independent strong
   reader for verification. The verifier sees revised alignment, proposed correspondence and
   original sources, without the first reader's verdicts. Use model diversity if available and
   affordable; it is useful but not a substitute for independence.
4. On a small frozen subset containing ordinary and difficult passages, compare `high` with
   `xhigh` using the same model, source/Pali inputs, context and instructions. Readers work in
   fresh contexts without each other's findings. Include `max` only in an approved comparison
   scope. Judge each result independently against Pali, recording verified errors caught, missed
   or introduced, and remaining uncertainty. A higher-effort answer is not the reference truth.
5. Save inputs, findings, judgments, changes and uncertainty as the work proceeds. Measure actual
   allowance consumption, reset window, requested and effective model/effort, elapsed time,
   rows reviewed and verified, and the size of the context. Do not launch large parallel runs
   before this measurement.
   Count repeated comparison reads and adjudication in the workload and usage totals.
6. Report whether the allowance supports a comfortable batch size, how much work remains, and a
   realistic range of sessions. Set a checkpoint before allowance exhaustion. Never lower the
   accuracy standard just to fit a month; spread the work over more sessions if needed.
   Recommend effort levels and escalation criteria from verified accuracy, time and actual usage;
   retain the lightest setting that meets the quality standard for each kind of work.
7. Exercise the correspondence checks and replay saved approved decisions in isolation. Record
   whether identical inputs reproduce identical alignment and coverage without further review.
   Identify missing tooling before adopting the process for a large round.

The existing full imported pass alone logs about 5.9 million reported tokens across 201 batches.
That number is historical CLI telemetry, not a conversion to subscription quota or dollars.
Recovered verse input packets occupy about 2.5 MB, but they are only the recovered packet set,
not the full remaining workload. A fresh backlog inventory is required after rebasing them.

The pilot is future work. Packet-tool smoke checks during parking do not perform reviews,
change alignments, or measure account consumption.

### Effort selection and advance notice

Use `high` as the candidate baseline for full direct-Pali reads and independent verification;
the pilot must establish whether it meets the accuracy standard. Inventory, packet generation
and mechanical validation normally need no effort above `high`. Set and record each reader's
actual model and effort explicitly: an inherited or saved `max` default is not a reason to run
every review at that level.

Consider `xhigh` for reader disagreements, reordered or interleaved verse, noncontiguous coverage,
ambiguous source ranges or edition differences, and the design or review of the coverage schema
and reuse and invalidation rules. An incorrect shared rule can affect many texts. Consider `max`
for particularly difficult cases or where pilot evidence supports the additional work.
Alignment decisions still require Pali-based judgment and independent verification; preserve
uncertainty when more reasoning does not resolve it.

Before starting any handoff work above `high`, including pilot comparisons, present Gabriel with a
bounded proposal stating:

- Why higher effort is useful and which model/effort each reader or adjudicator will use.
- Which documents, passages or design questions it covers, with row/context counts where relevant.
- The number of agents, passes, batches and concurrent runs, including comparison and verification.
- Expected time and allowance consumption, the basis and uncertainty of the estimate, and the
  maximum planned scope plus the checkpoint at which work stops for reassessment.
- Any expected monetary charge and its billing route, if applicable. Subscription allowance is
  measured from the account; API token prices are not a conversion to subscription usage or cost.

Get Gabriel's go-ahead for that bounded proposal before launching. Authorization to delegate
does not by itself approve higher effort or an unbounded run. Reuse an already approved scope
without asking again for each passage; propose any increase in effort, agent count, passes or
workload beyond those bounds before starting it. Save approved bounds and actual usage so an
interrupted session can resume within them. Unknown usage is reported as unknown and measured
through a small agreed run rather than presented as a precise estimate.

When delegation is explicitly requested by Gabriel or applicable `AGENTS.md`/skill instructions,
Codex can select supported model/effort settings for individual subagents. Use fresh source/Pali
context, separate findings folders and no shared reviewer verdicts; review agents preserve the
corpus and the main agent coordinates isolated application. A restart instruction can be:
“Use subagents according to the handoff's effort policy; propose higher-effort batches before
starting them.” This handoff's recommendations alone do not enable unsolicited delegation.

If explicit subagent effort selection is unavailable, explain that before launching and ask
Gabriel to select the level through `/model` or run a separate session with the frozen inputs.
The main session's effort is a separate client setting. See the official
[subagent controls](https://learn.chatgpt.com/docs/agent-configuration/subagents#choosing-models-and-reasoning)
and [model controls](https://learn.chatgpt.com/docs/models#choose-a-model).

## Work order after the pilot

| Priority | Work | Done when |
|---|---|---|
| 1 | Reconcile recovered verse proposals and finish the unchecked SN/AN/KN verse, starting with the KN patterns exposed by audit5 | Every affected passage is judged against original Pali; accepted, rejected, superseded and unresolved candidates have dispositions; remaining coverage is counted |
| 2 | Resolve Bodhi duplicate source ranges and Ṭhānissaro legacy AN numbering/precedence | Canonical source mapping and aliases are explicit; all affected documents preserve source words and rebuild correctly |
| 3 | Verify Sujato's English–Pali correspondence where it affects alignment, especially reordered verse | Suspect patterns are checked directly; any correction follows the retranslation pipeline, with its review and validation |
| 4 | Finalize the schema exercised in the pilot and prepare coverage, omissions and source-edition differences | Exact English segments/groups and Pali key lists have reviewed correspondence; validation and the authoritative corpus artifact are defined |
| 5 | Correct patterns throughout the affected corpus and run a fresh audit | New, documented draw and independent Pali review; unresolved errors and unsampled collections are reported honestly |
| 6 | Demonstrate idempotence and finalize the incoming-sutta workflow from the completed work | Saved approved decisions reproduce alignment and coverage; the documented workflow passes representative incoming/revised cases and uses the learned rules |
| 7 | Discuss and implement the app requirements later | Reveal and translation switching use reviewed coverage and preserve the Pali location; app work has separate authorization |

Priorities can overlap when a verse issue depends on source mapping. Do not force a cut to avoid
recording such a dependency. A completed audit does not close an unresolved source problem.

### Specific source and coverage cases

- **Bodhi SN45:** eight duplicate range/terminal pairs, 42–47/48, 50–54/55, 57–61/62,
  64–68/69, 71–75/76, 78–82/83, 85–89/90 and 92–95/96. Identical source bodies carry different
  article IDs and cover more than one app document. Ordinary per-document cuts cannot settle
  source ownership and cross-document coverage. Evidence and hashes are in
  `data/bodhi/review/codex-read/source-ranges.json`.
- **Ṭhānissaro legacy AN5.254–259:** Thai numbering maps to canonical AN5.254, 255, 256,
  257–263, 264 and 265–271. Resolve numbering and precedence against the older SuttaCentral copies;
  preserve all English and avoid duplicate or displaced blocks. The 49 deferred start proposals
  in `data/thanissaro/review/codex-read/source-ranges.json` are not applied instructions.
- **Rendered earlier or interleaved:** Bodhi SN22.80, SN4.25 and SN12.68; Ṭhānissaro SN22.58.
  These need explicit, possibly noncontiguous Pali coverage rather than invented monotonic cuts.
- **Abbreviation/edition differences:** Bodhi SN35 faculty expansions and AN8.17/18 source lists.
  Record the actual source variant and translated scope, rather than claiming all intervening
  empty lines correspond to the English.
- One historical automatic uncertainty remains at Ṭhānissaro AN1.76, and 14 historical findings
  cannot apply. They are recorded in the SN/AN/KN status file, not newly introduced errors or
  silent certification of their passages.

### The recovered verse work and round 12

The verse recovery includes 403 named findings: 2 Bodhi and 401 Ṭhānissaro. An earlier verse
check selected 74 proposed groups, with 11 saved and 63 remaining at recovery. That selected
set is not the same thing as all mechanically passing trial groups. Current accepted cuts and
new audit repairs overlap with some old candidates. Recompute their effect before judging;
never assume the old counts are the current backlog.

Round 12 is eleven generated MN reading batches with zero saved findings. It provides a possible
reading list, not new conclusions. Keep the archive for provenance; regenerate with current
Pali-inclusive inputs only if another MN read has a concrete purpose.

The archived `verse-stanzas.mjs` prototype is inactive. Before adopting it, compare its selected
rows with **all** eligible verse rows, including the Dhammapada: its multi-line paragraph filter
can miss verse where each line is a separate paragraph. Verify prose/verse boundaries, single-line
verses, grouping and context. Its saved README patch is unfinished, not current policy.

## How alignment decisions should work

The original Pali decides correspondence; Sujato and the other translator provide context.
An English-to-English match can confidently reproduce a wrong Pali placement.

Split a group when its English has independent clauses, sentences, refrains or list items that
map faithfully to individual Pali lines, in the source's order. A short line is not a reason to
join it to its neighbour. Keep an indivisible or reordered sentence in the smallest coherent
group if splitting would create false matches. Do not impose one whole stanza per segment by
habit, and do not reorder or rewrite the translator's English to obtain finer cuts.

For a group, record the Pali keys actually covered. Distinguish translated content, an abbreviated
passage, an omission, a rendering elsewhere, and a source-edition difference. If correspondence
is uncertain, retain the uncertainty. Do not label every empty English row an omission, or join
all empty rows to the preceding English.

### Correspondence records

For four Pali verse lines and four English segments, preserve the English segments and their
source order. Record individual matches where meaning permits and exact group matches where
meaning crosses line boundaries. A necessary whole-stanza match names all four Pali keys and the
corresponding English segments. Its first-key placement is a storage anchor; the coverage record
establishes what it translates. Preserve the smallest faithful correspondence in each case.

Records must identify translator and document, exact English segments or source spans tied to the
source hash, ordered English groups, exact Pali keys, coverage kind, source evidence/variant,
input hashes and review disposition. Support one-to-many, many-to-one and many-to-many relations;
Pali key lists can be noncontiguous. Preserve stable line keys and identify group-only matches
where finer pairing would misrepresent meaning. Translator-added material without a Pali
counterpart needs an explicit disposition rather than an invented match.

Choose the schema and exercise its validator during the pilot. Checks must account for every
English span without accidental loss or duplication, validate references to current Pali keys,
and require reviewed explanations for overlapping or shared coverage. Every Pali row needs a
disposition: translated, abbreviated, omitted, rendered elsewhere, source-edition difference or
unresolved. Include independently Pali-reviewed examples of reordered verse, merged clauses,
compressed repetitions, noncontiguous coverage and source ranges. These checks establish valid
records; direct-Pali review and independent verification establish their semantic correctness.

Define the authoritative maintained corpus location for approved correspondence and its
reproducible build path before producing corpus-wide records. Round-local `coverage.json` holds
review evidence and proposals; the approved artifact must become an input to the later app build
and its reveal/location behavior. The README's current text-and-notes-only shipping rule needs
updating when that data path is implemented. This schema, validator and build path are planned
requirements, not existing capabilities; app implementation remains later work.

## Incoming and revised suttas: the agreed direction

This is the planned replacement for repeated broad English-proxy rereads. The active legacy
process text in [README.md](README.md) and [review-rounds.md](review-rounds.md) is unchanged during
parking. Its Claude model names, default English-proxy packets, early stop after low finding yield,
and small audits must not be mistaken for the direct-Pali quality standard below. The pilot
establishes a provisional process with actual tooling and budget; finalize the operational process
from the learning accumulated by completing the corpus goal.

1. **Identify the source.** Save URL/version/hash and translator; map its IDs directly against
   the Pali and source contents. Resolve edition numbering, grouped documents, excerpts and source
   precedence before trusting a generated cut. Preserve the translator's wording and licence.
2. **Generate an initial alignment.** Use the segmenter as a proposal generator, incorporating
   validated source mappings and alignment patterns learned from the completed work. Produce
   proposed correspondence alongside cuts. Mechanically applicable cuts and high scores are not
   semantic judgments.
3. **Read every line against the Pali.** A strong reader reviews the complete new/revised document,
   including empty English and omitted or abbreviated passages, with source and stanza context.
   Sujato is secondary. Record finer valid cuts, necessary groups and explicit coverage issues.
4. **Apply judged changes in isolation.** Judge every proposed changed group against original Pali,
   retain rejection reasons, resolve conflicts explicitly, and preserve raw findings. Check wording
   and structural integrity. Never use a passing mechanical verdict as semantic acceptance.
5. **Verify independently.** A second strong reader checks every line and proposed correspondence
   of the resulting new/revised text directly against Pali, without the first reader's conclusions.
   Investigate disagreements and verify subsequent changes. An early low yield does not excuse
   leaving a new text unread.
6. **Follow up narrowly.** Revisit unresolved/affected passages with adequate surrounding context.
   Recheck all texts sharing a discovered error pattern. Keep input and output hashes, model/effort,
   covered keys, judgments and source variants so unchanged verified work is not reread repeatedly.
7. **Validate and report.** Run preservation, integrity, correspondence and reproducible-rebuild
   checks, including a repeat replay from saved approved decisions. Save the verified state and
   keep uncertain correspondence pending. Summarize the concrete scope and get permission for
   the individual commit after the work is ready.

For a revised document, retained cuts are candidates until checked against the new source. The
budget-saving aim is two thorough passes once, followed by targeted work, not weaker checking.
For unchanged verified inputs, reuse saved decisions. For the existing corpus, use the inventory
to identify actual gaps and reuse valid direct-Pali evidence rather than replaying completed
historical rounds.

### Save progress where the next session can find it

Use `data/<translator>/review/pali-<round>/` for a new review, with `inputs-first/`,
`first/`, `inputs-verify/` and `verify/` subfolders. Keep proposed findings inside those nested
folders until judged; the active `review/*/*.findings` scan cannot read them there. Record accepted
overrides separately in a named `review/hand/` file after isolated validation.

Keep `progress.json`, `decisions.json` and, when the coverage schema is settled, `coverage.json`
at that round's root. Progress identifies each document and pass, its input manifest/hash,
model/effort, completed keys or exact ranges, last completed key, pending keys and uncertainty.
Decisions identify each candidate, disposition, Pali-based reason, affected keys and verification.
Distinguish a completed read with no findings from an unfinished empty file. Save before changing
tasks or approaching an account limit. These are the required contents, not a final imposed schema.

### Finalize the operational workflow

When the corpus goal is reached, consolidate the useful checks, rejected approaches, source
mapping rules and recurring alignment exceptions into the incoming-sutta workflow. Convert
validated patterns into better initial proposals and regression cases; preserve direct-Pali
review and independent verification. Remove redundant work where saved evidence establishes
that the same inputs and correspondence have already been verified.

Test the final workflow on representative incoming/revised cases: ordinary prose, lists/refrains,
reordered verse, excerpts, grouped sources and edition differences. Confirm accurate correspondence,
independent verification, repeatability, change invalidation and interrupted-run recovery. Record
actual time and usage and document the tested tools, prompts, checkpoints and exception handling
in the upstream README and `review-rounds.md`, including measured effort-selection rules,
escalation criteria and advance proposals for higher-effort work. These operational instructions
are finalized from all the corpus learning; the pilot alone does not settle them.

## Idempotence and reuse

Identical saved inputs, source mappings, approved decisions and processing rules must produce
byte-identical alignment, coverage and generated corpus artifacts. Include source texts, Pali,
markup and all other relevant inputs and rule versions in the saved manifests. Repeating the
process must preserve settled work, avoid duplicate records and skip review of unchanged verified inputs.
Keep volatile run telemetry separate from reproducible artifacts. Fresh AI judgments can vary;
idempotence comes from replaying saved, versioned approved decisions and explicit supersessions.

Track the input and rule dependencies of each verified passage. Source or Pali changes, changed
mapping/coverage rules, or new evidence of an error invalidate the affected decisions and their
relevant stanza, neighbouring or shared-source context. Do not reuse a decision solely because
its anchor words still match. Preserve verification for demonstrably unaffected work while
satisfying the incoming/revised document checks above. Widen the review to complete dependent
documents when the effect of a change cannot be bounded reliably.

Demonstrate a normal isolated rebuild followed by a repeat replay with identical inputs. Compare
alignment, coverage and generated data byte for byte and confirm no new decisions or duplicate
records. Replaying the same approved decisions from a saved checkpoint must converge to the
same result as uninterrupted processing. Report this evidence before declaring the process
complete.

## Audits and acceptance

Plan around 2,500 reviewed rows per translator, stratified by collection, with whole-text context
and an explicit line-weighted selection method. Report seed, eligible/excluded populations,
actual row denominator, weighting, sampled texts and any unsampled collection. Account for very
small collections separately rather than silently treating no eligible draw as a clean result.
Audit5's existing script is useful evidence, but its selection algorithm is not the proposed
line-weighted sampler; implement and check that sampler before calling a new draw line-weighted.

Approximately 0.5% is a review benchmark, not a proof of perfection or a statistical guarantee.
Report how error keys/groups are counted. Review patterns beyond the sample, apply and verify
repairs, then draw fresh evidence. Do not report pre-repair rates as post-repair quality. Empty
cross/list queues only mean no new candidates under their exclusion rules; they do not certify
previously shown passages or the whole corpus.

Audits detect missed patterns; they do not replace the complete review/verification ledger.
Legitimate groups, omissions, abbreviations and source differences count as resolved only with
reviewed explanations. Uncertain placement or coverage remains unfinished and cannot be counted
as correct alignment when claiming the corpus goal is reached.

## Tools and restart commands

Run from the repository root. The new helper writes review inputs only; it does not fetch sources,
apply cuts, edit app data or review a passage. Use a fresh folder for each pass.

```sh
git status --short
python3 scripts/segmenter/review-pali.py archive-check
python3 scripts/segmenter/review-pali.py packet thanissaro dhp1-20 --out /tmp/sutamaya-pali-pilot-first
python3 scripts/segmenter/review-pali.py verify /tmp/sutamaya-pali-pilot-first
```

The packet command takes **file document IDs**: `dhp1-20` or `an1.140-149`, not individual IDs
inside those files. It writes every Pali key, including headings and empty English, with P/S/T
columns, current source-page pointers, and a SHA-256 manifest of the English, Pali, Sujato,
markup, notes where present, and source pages. It refuses an existing output folder. Source
mapping follows the current report and still needs scrutiny for the known range/numbering cases.
Rows show plain text; inspect the hashed original files for stanza markup, notes and ambiguity.
Once the correspondence schema is adopted, review inputs must also preserve exact English group
identities and include the proposed coverage artifact in their manifests. The current packet
helper does not yet provide that coverage data.

`verify` checks the saved packets and whether their recorded corpus inputs still match. It does
not verify findings or semantics. Keep findings and coverage records separate from input packets;
record explicitly which packet and keys each reader completes. For a second pass, build new inputs
from the revised corpus. Give its reader the independent-verification prompt below.

Before applying candidates, create an isolated scratch copy containing `scripts/`, saved upstream
pages, Pali, Sujato, markup and the selected translator data, with the needed dependencies. The
segmenter has no dry-run mode: even `--findings` writes trial outputs and review files. The old
ignored `validation-repo` is disposable and is not required for recovery. Do not run a trial against
shared working data or another session's files.

The existing trial/application commands, **only in that isolated copy after candidates have been
rebased and selected**, are:

```sh
node scripts/segmenter/segment-translations.mjs thanissaro --findings
node scripts/segmenter/segment-translations.mjs thanissaro --keep-findings
node scripts/segmenter/segment-translations.mjs thanissaro
```

Read the full flags and application rules before using them. Put only reviewed candidates in
active findings folders; conflicting historical findings can affect trials. Preserve superseded
raw evidence and make overrides explicit. Judge groups between trial and keep; do not run all
three commands as an unattended acceptance pipeline. Repeat for Bodhi where appropriate.

For a proposed data change, run these existing checks for each affected translator:

```sh
python3 scripts/segmenter/check-upstream.py bodhi
python3 scripts/segmenter/check-integrity.py bodhi
python3 scripts/segmenter/check-upstream.py thanissaro
python3 scripts/segmenter/check-integrity.py thanissaro
npx vitest run scripts/segmenter/__tests__/source-ranges.test.js
```

Also rebuild normally in isolation and compare proposed output byte for byte. Word preservation
and integrity are necessary checks; they cannot establish correct Pali correlation. Review the
full data diff before transferring an accepted result. Avoid broad app tests for documentation
and review-input-only changes; run relevant app checks when app work is later authorized.

### First-reader prompt

```text
Review this entire document's English alignment against its original Pali. P is the authority;
S is secondary context. Read every row, including empty English, in source and stanza context.
Preserve T's wording and source order. Split independent clauses/items/refrains when they map
faithfully; retain the smallest coherent group when splitting would misrepresent reordered or
indivisible English. Report omissions, abbreviations, rendered-earlier passages and edition
variants distinctly. Do not infer coverage from empty rows alone.
Keep English segments identifiable within groups and record their exact Pali coverage, including
group-only correspondence and noncontiguous keys where needed. Source-only material needs an
explicit disposition. Produce correspondence proposals as well as boundary proposals.
Save exact starts/none proposals separately from coverage issues. Quote starts exactly from T,
using only enough words to identify the cut. Record covered keys, uncertainty, input manifest,
model/effort and progress. If interrupted, save the last completed key and resume there.
```

### Independent-verifier prompt

```text
Verify every row of the revised alignment directly against Pali and its source context. Do not
read the first reader's judgments. Check fine cuts as well as grouped, reordered, omitted,
abbreviated and rendered-elsewhere passages. Check the proposed English-span/Pali-key relations,
including group-only matches and shared coverage. Preserve source wording/order. Report remaining
errors and uncertain coverage; give an explicit completed-key record even when there are none.
Use the revised input manifest. A mechanical pass or agreement with S is not semantic evidence.
```

## What worked and what did not

| Lesson | Consequence for the next session |
|---|---|
| Direct-Pali judgments reject 36 of 489 initially passing import groups | Judge all changed groups; word preservation alone is insufficient |
| Sujato sometimes orders verse differently from Pali | Supply Pali on every row and check source order; do not align another translator to English order |
| Finer cuts work for independent clauses, lists and refrains | Split where meaning allows; do not prefer stanza-sized groups automatically |
| Source ranges and edition numbering can defeat good local cuts | Resolve mapping first; test grouped, partial and individual-key sources |
| Frozen packets, hashes, hand overrides and isolated rebuilds make results recoverable | Save evidence and dispositions as work proceeds; avoid dependence on account memory |
| Audits expose patterns left by earlier reads | Correct the pattern across affected texts, then obtain fresh evidence |
| Repeated proxy rereads and low-yield stopping leave gaps | Two thorough Pali passes for incoming texts; targeted follow-up with a coverage ledger |
| English emptiness alone cannot explain reveal behavior | Prepare explicit correspondence/omission data before changing the app |
| Exhausted-account scratch work can be useful but stale | Rebase saved proposals; archive failed experiments without treating them as active tools |

## Session close and finish line

At each checkpoint save completed keys, pending keys, input hashes, proposed/applied decisions,
rejections, uncertainties, validation results, approved effort/workload bounds, actual usage and
the next exact command/task. Update the dated status records when the state changes. Never claim
a read complete because a findings file exists unless coverage is explicit; an empty findings
file can be a completed clean read or an unfinished one. Keep historical commit approval separate
from current permission.

The data is ready for app implementation when every English segment in the declared scope has
verified correspondence or a reviewed explanation of material without a Pali counterpart, known
source mappings are settled, and all Pali rows have reviewed coverage/omission/variant dispositions.
The complete ledger must establish current direct-Pali review and independent verification;
unresolved alignment remains pending. Preservation, correspondence and rebuild checks pass,
approved coverage has an authoritative corpus artifact and a defined build path, and fresh audit
results are recorded. Completion also requires demonstrated idempotence and the tested final
incoming-sutta workflow based on the corpus learning. Scope exclusions remain explicit.

Corresponding Pali must be revealable honestly, including a distinct option for omitted Pali.
Do not create a false English match merely to make a line revealable. App requirements remain in
[Building them into the app](README.md#building-them-into-the-app).

### Parking verification

The parking checks on 2026-10-02 verify 119 archived payload files and 54 compressed members,
all handoff links, and complete ordered Pali coverage in four smoke-test documents (173 rows).
The packet helper rejects changed inputs, changed packet bytes, existing output folders and
unknown documents. Checks include verse, grouped SN, partially translated AN and hashed notes.
The tracked diff is limited to the upstream README pause link and the two status records; new
files are the handoff, archive and review helper. Root documentation, app and corpus data are
unchanged. No semantic review or usage pilot is performed. Gabriel subsequently authorizes
one commit of the finished parking work with “commit it”; alignment work stays paused.

## Where to look

| What | Where |
|---|---|
| Repository recovery archive, inventory and safe restoration | [review-archive/2026-10-02/README.md](review-archive/2026-10-02/README.md) |
| Remaining targeted queue, complete-scope evidence gaps and resumable scan | [pali-review-inventory/README.md](pali-review-inventory/README.md) |
| Complete MN/DN status | [mn-dn-review.json](mn-dn-review.json) |
| Consolidated SN/AN/KN evidence and deferrals | [codex-sn-an-kn-review.json](codex-sn-an-kn-review.json) |
| Accepted import provenance/judgments | `data/{bodhi,thanissaro}/review/codex-read/` |
| Frozen audit evidence | `data/{bodhi,thanissaro}/review/audit5/` |
| Pali packet builder and archive/input checks | `scripts/segmenter/review-pali.py` |
| Existing segmenter and preservation checks | `scripts/segmenter/` |
| Legacy round instructions, not yet updated to this planned process | [review-rounds.md](review-rounds.md) |
