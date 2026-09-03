#!/usr/bin/env node
// The one entry point for refreshing data/ from a checked-out sc-data (SC_DATA_PATH). Three verbs,
// in the order you run them, modelled on plan/apply/accept because the shape is the same — propose,
// review, commit:
//
//   npm run update-data           plan    read-only: what upstream changed, and what it breaks here
//   npm run update-data apply     apply   copy it in and re-run the rules, leaving the tree dirty
//   npm run update-data accept    accept  re-baseline, once you've reviewed that dirty tree
//
// The review between apply and accept is the part that needs a human, and it is deliberately not a
// command: it's `git diff data/sujato/` (what upstream changed), `git diff data/diff/` (what this
// app's rules did differently as a result), and `update-data triage` for what the refresh did to
// the rules themselves. Everything else here is plumbing that should stay out of the way.
//
// Two more subcommands serve rule authoring rather than a refresh, where the pipeline above doesn't
// apply — see docs/retranslation.md:
//
//   npm run update-data post      re-run the rules over the current data/sujato (iterate on a rule)
//   npm run update-data counts    re-record rule footprints without touching the segment baseline
//
// Each subcommand ends by naming the next one, so the sequence never has to be remembered. Which
// step you're on is read from data/manifest.json rather than assumed: `sourceCommit` is what was
// last copied in, `snapshotCommit` what was last accepted, and they differ exactly when a refresh
// is applied but not yet accepted.
import fs from 'node:fs';
import path from 'node:path';
import { requireSourceRoot, sourceGitInfo, MANIFEST_PATH, SNAPSHOT_PATH, red, green, yellow, bold, dim } from './lib/dataSync.js';
import { banner, row, block, next, done, n, PAD } from './lib/ui.js';
import { runCheck } from './update-data-check.mjs';
import { runCopy } from './update-data-copy.mjs';
import { runPost } from './update-data-post.mjs';
import { runAccept } from './update-data-accept.mjs';
import { runCounts, reportCounts } from './update-data-counts.mjs';
import { runTriage } from './update-data-triage.mjs';
import { runDictionary, DICT_PATH } from './update-data-dictionary.mjs';

const COMMANDS = ['plan', 'apply', 'accept', 'triage', 'post', 'counts', 'dictionary', 'help'];

// Where the pipeline currently stands, from the provenance manifest copy and accept both write.
// 'applied' is the only interesting one: a refresh is in the working tree and hasn't been accepted,
// which is the state the review happens in.
function pipelineState() {
  if (!fs.existsSync(MANIFEST_PATH)) return { phase: 'unknown' };
  const { sourceCommit = null, snapshotCommit = null } = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return { phase: sourceCommit && sourceCommit !== snapshotCommit ? 'applied' : 'accepted', sourceCommit, snapshotCommit };
}

function source() {
  const { scDataPath, bilaraRoot } = requireSourceRoot();
  const gitInfo = sourceGitInfo(scDataPath);
  return { scDataPath, bilaraRoot, gitInfo };
}

function sourceMeta(gitInfo) {
  return `sc-data @ ${gitInfo.commit.slice(0, 12)}${gitInfo.dirty ? yellow(' (dirty)') : ''}`;
}

// ── plan ───────────────────────────────────────────────────────────────────────────────────────

// runCheck's findings, grouped so the rows read as a checklist of what was verified rather than as
// a list of whatever happened to fail. Each group prints as one row, with its findings below it.
function planSections(result, bilaraRoot) {
  return [
    { key: 'localIssues', kind: 'fail', label: 'Local tree', pass: 'matches the accepted baseline', fail: (c) => `${c} file(s) drifted from snapshot.json` },
    { key: 'upstreamIssues', kind: 'fail', label: 'Upstream', pass: `structure unchanged in ${path.basename(bilaraRoot)}`, fail: (c) => `${c} file(s) renamed, removed or resegmented` },
    { key: 'integrityIssues', kind: 'fail', label: 'Alignment', pass: 'Pali / Sujato / HTML segment ids line up', fail: (c) => `${c} upstream mismatch(es) between Pali, Sujato and HTML` },
    { key: 'localIntegrityIssues', kind: 'fail', label: 'Local ids', pass: 'local trees line up with each other', fail: (c) => `${c} local mismatch(es) between Pali, Sujato and HTML` },
    { key: 'ruleIssues', kind: 'fail', label: 'Rules', pass: 'every rule still matches and every override anchors', fail: (c) => `${c} rule(s) no longer apply as written` },
  ];
}

async function plan() {
  const { bilaraRoot, gitInfo } = source();
  const result = await runCheck({ bilaraRoot });
  const state = pipelineState();

  banner('plan', `${sourceMeta(gitInfo)} · ${n(result.totalTracked)} files tracked`);

  for (const s of planSections(result, bilaraRoot)) {
    const found = result[s.key];
    if (!found.length) {
      row('ok', s.label, s.pass);
      continue;
    }
    row('fail', s.label, s.fail(found.length));
    for (const issue of found) block(issue);
    if (s.key === 'ruleIssues') block(dim('→ docs/retranslation.md, "Reconciling an upstream change"'));
    console.log();
  }

  // Neither of the next two is a failure: both are things you should know about that need no
  // decision before applying.
  if (result.staleTriage.length) {
    row('warn', 'Triage', `${result.staleTriage.length} rule(s) have entries upstream has invalidated`);
    for (const note of result.staleTriage) block(note);
    console.log();
  }

  const padding = Object.values(result.padding).reduce((a, p) => ({ files: a.files + p.files, segments: a.segments + p.segments }), { files: 0, segments: 0 });
  if (padding.files) {
    const by = Object.entries(result.padding)
      .sort((a, b) => b[1].segments - a[1].segments)
      .map(([category, p]) => `${category} ${n(p.segments)}`)
      .join(', ');
    row('note', 'Accepted', `${n(padding.segments)} blank segment ids added across ${n(padding.files)} files (${by})`);
    row('note', '', 'English side only, pali/html unchanged — the built text is identical');
  }

  if (!result.ok) {
    next('npm run update-data apply', 'once you have read the findings above and they are legitimate upstream changes');
    return 1;
  }

  if (state.phase === 'applied') {
    next('npm run update-data accept', 'a refresh is already applied and waiting on your review — see git diff data/sujato/');
    return 0;
  }

  // Nothing failed and nothing is pending: either there is genuinely nothing new upstream, or the
  // changes are all value-level (rewordings), which is the ordinary case and still worth applying.
  next('npm run update-data apply', 'no structural changes — any reworded text will come in with it');
  return 0;
}

// ── apply ──────────────────────────────────────────────────────────────────────────────────────

// What a failing post run has to say. Names each broken rule and stops there: the anchor itself —
// upstream's line, what the term rules made of it, and the recorded `from` against it, word-diffed
// — is `plan`'s job, and reproducing a worse version of it here would only invite reading the
// worse one.
function reportRuleFailure(result) {
  row('fail', 'Rules', 'data/sujato.post/ was NOT written');
  for (const id of result.deadRules) block(red(`${id}: matched nowhere`));
  for (const b of result.brokenOverrides) block(red(`${b.id} (${b.segment}): ${b.reason}`));
  if (result.brokenOverrides.length) block(dim('→ `npm run update-data` shows each broken anchor against what upstream now says'));
}

// The dictionary import is the one optional step in the pipeline, so it always reports — a step
// that stays silent when it is off is a step nobody remembers exists. Both rows name DPD_DB_PATH
// for the same reason: whichever way it went, the variable that decided it is on screen.
function reportDictionary(result) {
  if (result.skipped) {
    row('note', 'Dictionary', `DPD_DB_PATH not set — keeping ${path.relative(process.cwd(), DICT_PATH)} as checked in`);
    return;
  }
  const change = result.previousEntries === null ? null : result.entries - result.previousEntries;
  const against = result.previousVersion ? `DPD ${result.previousVersion}` : 'the file it replaces';
  const delta = change === null ? '' : change === 0 ? ` (unchanged from ${against})` : ` (${change > 0 ? '+' : '−'}${n(Math.abs(change))} vs ${against})`;
  row('ok', 'Dictionary', `DPD ${result.version} → ${n(result.entries)} headwords${delta}, ${(result.bytes / 1e6).toFixed(1)} MB`);
  row('note', 'Dictionary', `from DPD_DB_PATH=${result.dbPath}`);
  // Scoped to data/pali/, which is a good deal more than the app renders — titles, structural
  // labels and whole files the browse tree never reaches. Said plainly, because the number is
  // large enough to read as alarming next to the one build:corpus prints for the shipped text.
  row(
    'note',
    'Dictionary',
    `${n(result.unresolved)} of ${n(result.words)} words in data/pali/ have no gloss — build:corpus reports what ships`
  );
}

async function apply() {
  const { bilaraRoot, gitInfo } = source();
  banner('apply', sourceMeta(gitInfo));

  if (gitInfo.dirty) {
    row('warn', 'Source', 'SC_DATA_PATH has uncommitted changes — manifest.json will not fully describe what was copied');
  }

  const manifest = runCopy({ bilaraRoot, gitInfo });
  row('ok', 'Copied', `${n(manifest.fileCount)} files into data/{sujato,pali,html}`);

  const result = await runPost({ diff: true });
  if (!result.ok) {
    reportRuleFailure(result);
    next('npm run update-data triage', 'work the queue, then apply again — see docs/retranslation.md');
    return 1;
  }

  row('ok', 'Rules', `${n(result.replacements)} replacement(s) across ${n(result.filesChanged)} file(s) → data/sujato.post/`);
  row('note', 'Diffs', 'data/diff/00-all.diff is upstream → shipped; the per-rule files attribute it');

  reportDictionary(runDictionary());

  console.log();
  console.log(`${PAD}${bold('Review before accepting')}`);
  console.log(`${PAD}${PAD}${green('git diff data/sujato/')}            ${dim('what upstream itself changed')}`);
  console.log(`${PAD}${PAD}${green('git diff data/diff/00-all.diff')}   ${dim('what this app ships differently as a result')}`);
  console.log(`${PAD}${PAD}${green('npm run update-data triage')}       ${dim('what the refresh did to the rules themselves')}`);

  next('npm run update-data accept', 'only once the three diffs above look right — accept re-bases drift detection');
  return 0;
}

// ── accept ─────────────────────────────────────────────────────────────────────────────────────

async function accept() {
  banner('accept');
  const snapshot = await runAccept();
  row('ok', 'Baseline', `${n(snapshot.fileCount)} files recorded in ${path.relative(process.cwd(), SNAPSHOT_PATH)}`);
  row('ok', 'Counts', 'rule footprints re-recorded in retranslation.counts.json');
  console.log();
  reportCounts(snapshot);
  next('npm run build:corpus', 'regenerate web/public/data/ from the accepted text, then commit');
  return 0;
}

// ── the rule-authoring subcommands ─────────────────────────────────────────────────────────────

// `--quiet` drops the frame: build:corpus runs post as a build step, where a banner and a "next
// command" would be answering a question nobody asked. Failures still print in full.
async function post(args = []) {
  const quiet = args.includes('--quiet');
  if (!quiet) banner('post');
  const result = await runPost({ diff: true });

  if (!result.ok) {
    if (quiet) banner('post');
    reportRuleFailure(result);
    next('npm run update-data triage', 'work the queue — see docs/retranslation.md');
    return 1;
  }

  if (quiet) {
    console.log(dim(`${PAD}rules applied — ${n(result.replacements)} replacement(s) across ${n(result.filesChanged)} file(s)`));
    return 0;
  }
  row('ok', 'Rules', `${n(result.replacements)} replacement(s) across ${n(result.filesChanged)} file(s) → data/sujato.post/`);
  row('note', 'Diffs', 'data/diff/00-all.diff is upstream → shipped; the per-rule files attribute it');
  next('npm run update-data counts', 'record the new footprints once the diffs read right');
  return 0;
}

// Standalone, for picking up a new DPD release without a corpus refresh — the two move on their
// own schedules.
// `force` is a positional word for the same reason `prune` is — npm swallows a leading `--`.
async function dictionary(args = []) {
  banner('dictionary');
  const result = runDictionary({ force: args.includes('force') });
  reportDictionary(result);
  if (result.skipped) {
    next('DPD_DB_PATH=/path/to/dpd.db npm run update-data dictionary', 'get dpd.db.tar.xz from the dpd-db releases page');
    return 0;
  }
  next('npm run build:corpus', 'reshard the dictionary from the new file, then commit');
  return 0;
}

async function counts() {
  banner('counts');
  reportCounts(await runCounts());
  done('Footprints recorded in scripts/update-data/retranslation.counts.json — commit it with the rule.');
  return 0;
}

// `prune` is a positional word, not a flag, because `npm run` silently swallows anything starting
// with `--` unless it is preceded by a bare `--`. A flag here would be a command the printed hints
// could tell you to run and that would then quietly do nothing.
async function triage(args) {
  const words = args.filter((a) => !a.startsWith('--'));
  const prune = words.includes('prune');
  const ruleId = words.find((w) => w !== 'prune');
  banner('triage', ruleId ? `${ruleId}${prune ? ' · prune' : ''}` : 'every term rule');
  const code = await runTriage({ ruleId, prune });

  // Triage is where rules get edited, so it has to close the loop back to whatever re-runs them.
  // Which command that is depends on where the pipeline stands: mid-refresh, `apply` re-copies the
  // same upstream commit and re-runs the rules, so it's idempotent and there's no reason to reach
  // past it for `post`.
  if (pipelineState().phase === 'applied') {
    next('npm run update-data apply', 'changed a rule? re-runs them over the refreshed text — then read git diff data/diff/00-all.diff');
  } else {
    next('npm run update-data post', 'changed a rule? re-runs them over the current data/sujato');
  }
  return code;
}

// ── dispatch ───────────────────────────────────────────────────────────────────────────────────

function help() {
  banner('help');
  const line = (cmd, text) => console.log(`${PAD}${green(cmd.padEnd(30))}${dim(text)}`);
  console.log(`${PAD}${bold('A refresh, in order')}`);
  line('npm run update-data', 'plan — what upstream changed, and what it breaks here');
  line('npm run update-data apply', 'copy it in, re-run the rules, leave the tree dirty');
  line('npm run update-data accept', 're-baseline, once you have reviewed that tree');
  console.log(`\n${PAD}${bold('Looking, any time')}`);
  line('npm run update-data triage', 'what the refresh did to the retranslation rules');
  line('  … <rule-id>', 'one rule, every queued case in full');
  line('  … <rule-id> prune', 'drop that rule\'s stale entries — they need no decision');
  console.log(`\n${PAD}${bold('Authoring a rule')}`);
  line('npm run update-data post', 're-run the rules over the current data/sujato');
  line('npm run update-data counts', 're-record footprints without touching the baseline');
  console.log(`\n${PAD}${bold('The dictionary')}`);
  line('npm run update-data dictionary', 'rebuild data/pli2en_dpd.json from a DPD release');
  line('  DPD_DB_PATH=…', 'full path to dpd.db — without it the step is skipped everywhere');
  line('  … force', 'write even when the new file is much smaller than the old');
  console.log();
  return 0;
}

const [command = 'plan', ...args] = process.argv.slice(2);

if (!COMMANDS.includes(command)) {
  console.error(`\n${PAD}${red(`Unknown command: ${command}`)}`);
  console.error(`${PAD}${dim(`Expected one of: ${COMMANDS.join(', ')}`)}\n`);
  process.exit(2);
}

const run = { plan, apply, accept, triage, post, counts, dictionary, help }[command];

try {
  process.exit(await run(args));
} catch (err) {
  console.error(`\n${PAD}${red(err.message)}\n`);
  process.exit(1);
}
