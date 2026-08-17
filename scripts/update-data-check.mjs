#!/usr/bin/env node
// Verifies a checked-out sc-data repo (SC_DATA_PATH) is safe to copy from before
// update-data-copy.mjs overwrites data/{sujato,pali,html} with it: every file we currently track
// must still exist at its expected path (see CATEGORY_SOURCE_PREFIXES in lib/dataSync.js), with
// the exact same set of segment ids it had when scripts/update-data/snapshot.json was taken —
// only the translated/structural values are allowed to differ. It also cross-checks that a
// sutta's Pali root text, Sujato translation, and HTML structure stay aligned with each other
// (pali/html exactly, sujato as a subset of pali — see INTEGRITY_GROUPS in lib/dataSync.js), both
// upstream and against the local data/{sujato,pali,html} trees — the local pass is what catches a
// snapshot taken from an already-misaligned local state, which would otherwise pass every other
// check here. See scripts/update-data/README.md.
import fs from 'node:fs';
import path from 'node:path';
import {
  requireSourceRoot,
  sourcePathFor,
  localPathFor,
  buildBasenameIndex,
  loadSnapshot,
  keysHash,
  checkSnapshotInSync,
  checkCrossCategoryIntegrity,
  listLocalRelPaths,
  readKeysSafe,
  DATA_DIRS,
  SNAPSHOT_PATH,
  MANIFEST_PATH,
  red,
  green,
  yellow,
  bold,
  blue,
} from './lib/dataSync.js';
import { RULES_DIR, RETRANSLATION_PATH, loadRules, loadSidecar, isTermRule, isSegmentRule, segmentsOf, scopeOf, formsMatch, applyTermRules, buildSegmentIndex } from './lib/retranslation.js';

function describeSetDiff(oldKeys, newKeys) {
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);
  const removed = oldKeys.filter((k) => !newSet.has(k));
  const added = newKeys.filter((k) => !oldSet.has(k));
  const MAX = 10;
  const fmt = (arr) => arr.slice(0, MAX).join(', ') + (arr.length > MAX ? `, … (${arr.length} total)` : '');
  const parts = [];
  if (removed.length) parts.push(`missing segment ids: ${fmt(removed)}`);
  if (added.length) parts.push(`new segment ids: ${fmt(added)}`);
  return parts.join('; ');
}

// Every term rule that finds no match anywhere in `sujatoUpstreamByRelPath` (restricted to its own
// scope), and every segment rule whose `from` no longer anchors — resolved against upstream (via
// bilaraRoot), before anything is copied, so a broken rule surfaces at the same point a structural
// problem would rather than only after `update-data:post` runs against already-copied-in local data.
// Segment rules resolve their file via the *local* segment index (data/sujato is expected to still
// have every override's segment at its current relPath — a renamed/relocated file is what the
// structural upstreamIssues pass above already catches).
//
// An override's `from` is post-processed text, not upstream's own: overrides run last, over the term
// rules' output (see retranslation.md's "Segment override"), so the term rules are applied to the
// upstream segment here before comparing. Comparing against raw upstream instead would fail every
// override whose line contains a term any rule rewrites, which is most of them — an override usually
// exists *because* a term rule got that line wrong.
function checkRuleAnchors(rules, sujatoUpstreamByRelPath, localSegmentIndex, rulesDir) {
  const issues = [];
  const sidecars = new Map(rules.filter(isTermRule).map((rule) => [rule.id, loadSidecar(rule.id, rulesDir)]));

  for (const rule of rules.filter(isTermRule)) {
    const scope = new Set(scopeOf(rule));
    let matched = false;
    for (const [relPath, obj] of sujatoUpstreamByRelPath) {
      if (!scope.has(relPath.split('/').slice(0, 2).join('/'))) continue;
      for (const value of Object.values(obj)) {
        if (typeof value === 'string' && formsMatch(rule, value)) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) issues.push(`${rule.id}: matches nowhere upstream — the term may be gone. Dead rule, not just drifted.`);
  }

  for (const rule of rules.filter(isSegmentRule)) {
    // Each named segment is checked on its own, so an override covering a repeated line reports the
    // one repeat that drifted rather than the whole rule.
    for (const segment of segmentsOf(rule)) {
      const relPath = localSegmentIndex.get(segment);
      if (!relPath) {
        issues.push(`${rule.id} (${segment}): segment not found in local data/sujato — can't verify against upstream.`);
        continue;
      }
      const upstreamObj = sujatoUpstreamByRelPath.get(relPath);
      if (!upstreamObj) continue; // relPath wasn't read this run (not in snapshot.files) — nothing to compare
      const upstreamNow = upstreamObj[segment];
      const anchorNow =
        typeof upstreamNow === 'string'
          ? applyTermRules(upstreamNow, { treeName: 'sujato/sutta', segmentId: segment, rules, sidecars }).result
          : upstreamNow;
      if (anchorNow !== rule.from) {
        issues.push(
          `${rule.id} (${segment}): rule's "from" no longer matches verbatim.\n` +
            `    from (recorded):  ${rule.from}\n` +
            `    upstream (now):   ${upstreamNow ?? '(segment removed upstream)'}\n` +
            (anchorNow !== upstreamNow ? `    after term rules: ${anchorNow}\n` : '') +
            `    to (this app's):  ${rule.to}`,
        );
      }
    }
  }

  return issues;
}

// Core logic, callable directly with an explicit bilaraRoot/dataDirs/snapshotPath (tests use this
// to point at fixture trees instead of the real data/{sujato,pali,html} — see
// scripts/update-data.test.js). Returns a result object instead of printing/exiting so callers
// (the CLI entry point below, or a test) decide what to do with it.
export async function runCheck({ bilaraRoot, dataDirs = DATA_DIRS, snapshotPath = SNAPSHOT_PATH, rulesDir = RULES_DIR, retranslationPath = RETRANSLATION_PATH }) {
  const snapshot = loadSnapshot(snapshotPath);

  // Built lazily on the first missing file — a full-tree scan, so not worth doing unless
  // something has actually gone missing from its expected path.
  let basenameIndex = null;
  function possibleRelocations(relPath) {
    if (!basenameIndex) basenameIndex = buildBasenameIndex(bilaraRoot);
    return basenameIndex.get(path.basename(relPath)) || [];
  }

  // Independent of bilaraRoot entirely — verifies data/{sujato,pali,html} itself still matches
  // snapshot.json, catching a copy that got committed without a follow-up update-data:snapshot.
  // Kept separate from upstreamIssues below (rather than one merged list) since they're different
  // questions with different fixes: local drift means "run update-data:snapshot", an upstream
  // issue means "review what changed in SC_DATA_PATH".
  const localIssues = checkSnapshotInSync({ dataDirs, snapshotPath }).issues;
  const upstreamIssues = [];
  let checked = 0;

  // Reused below for the upstream integrity cross-check, so every tracked file is only read once.
  const upstreamKeysByRelPath = new Map();
  // Full parsed content (not just keys), but only for sujato/* categories — pali/html have no
  // translatable prose, so rules never touch them and there's no reason to hold their content in
  // memory here. Feeds checkRuleAnchors below.
  const sujatoUpstreamByRelPath = new Map();

  for (const [relPath, expected] of Object.entries(snapshot.files)) {
    const sourcePath = sourcePathFor(bilaraRoot, relPath);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const where = sourcePath ?? '(no known category)';
      const relocations = possibleRelocations(relPath);
      const hint = relocations.length > 0 ? ` — might have moved to: ${relocations.join(', ')}` : '';
      upstreamIssues.push(`${relPath}: expected at ${where}, not found${hint} (renamed or removed upstream?)`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    } catch (err) {
      upstreamIssues.push(`${relPath}: failed to parse ${sourcePath}: ${err.message}`);
      continue;
    }
    const keys = Object.keys(parsed);
    if (relPath.startsWith('sujato/')) sujatoUpstreamByRelPath.set(relPath, parsed);

    upstreamKeysByRelPath.set(relPath, keys);

    if (keys.length !== expected.keyCount || keysHash(keys) !== expected.keysHash) {
      const localPath = localPathFor(relPath, dataDirs);
      const oldKeys = fs.existsSync(localPath) ? Object.keys(JSON.parse(fs.readFileSync(localPath, 'utf8'))) : [];
      upstreamIssues.push(`${relPath}: segment ids changed (${oldKeys.length} → ${keys.length}) — ${describeSetDiff(oldKeys, keys)}`);
      continue;
    }

    checked += 1;
  }

  const integrityIssues = checkCrossCategoryIntegrity(Object.keys(snapshot.files), (relPath) => upstreamKeysByRelPath.get(relPath) ?? null);

  // Cheap (a few hundred ms even over the full corpus) and catches something upstreamIssues/
  // localIssues together can't: a snapshot taken from an already cross-category-misaligned local
  // state, which matches itself and matches upstream just fine on a per-file basis.
  const localIntegrityIssues = checkCrossCategoryIntegrity(listLocalRelPaths(dataDirs), (relPath) => readKeysSafe(localPathFor(relPath, dataDirs)));

  // Independent of every check above — a retranslation rule can be perfectly fine structurally
  // (segment ids untouched, cross-category alignment intact) while still being dead or stale, so
  // this runs regardless of whether anything else failed. sujatoDir defaults from dataDirs.sujato
  // rather than importing SUJATO_DIR directly, so a fixture dataDirs override (tests) is honored.
  const rules = await loadRules(retranslationPath);
  const localSegmentIndex = buildSegmentIndex(dataDirs.sujato);
  const ruleIssues = checkRuleAnchors(rules, sujatoUpstreamByRelPath, localSegmentIndex, rulesDir);

  const issues = [...localIssues, ...upstreamIssues, ...integrityIssues, ...localIntegrityIssues, ...ruleIssues];
  return {
    ok: issues.length === 0,
    issues,
    localIssues,
    upstreamIssues,
    integrityIssues,
    localIntegrityIssues,
    ruleIssues,
    checked,
    totalTracked: Object.keys(snapshot.files).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bilaraRoot;
  try {
    ({ bilaraRoot } = requireSourceRoot());
  } catch (err) {
    console.error(red(err.message));
    process.exit(1);
  }

  const result = await runCheck({ bilaraRoot });

  if (!result.ok) {
    console.error(bold(red(`update-data check FAILED — ${result.issues.length} problem(s) found (${result.totalTracked} tracked files):`)));

    if (result.localIssues.length) {
      console.error(bold(red(`\nLocal drift — data/{sujato,pali,html} vs snapshot.json (${result.localIssues.length}):`)));
      console.error(red(`  did a previous update-data:copy forget to run update-data:snapshot afterward?`));
      for (const issue of result.localIssues) console.error(red(`- ${issue}`));

      if (fs.existsSync(MANIFEST_PATH)) {
        const { sourceCommit, snapshotCommit } = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        console.error(`\ndata/manifest.json:\n\tsourceCommit   = ${sourceCommit ?? '(none)'}\n\tsnapshotCommit = ${snapshotCommit ?? '(none)'}`);
      }
    }

    if (result.upstreamIssues.length) {
      console.error(bold(yellow(`\nUpstream changes — ${bilaraRoot} vs snapshot.json (${result.upstreamIssues.length}):`)));
      for (const issue of result.upstreamIssues) console.error(yellow(`- ${issue}`));
    }

    if (result.integrityIssues.length) {
      console.error(bold(yellow(`\nUpstream cross-category integrity — Pali/Sujato/HTML segment ids don't line up (${result.integrityIssues.length}):`)));
      for (const issue of result.integrityIssues) console.error(yellow(`- ${issue}`));
    }

    if (result.localIntegrityIssues.length) {
      console.error(bold(red(`\nLocal cross-category integrity — data/{sujato,pali,html} segment ids don't line up (${result.localIntegrityIssues.length}):`)));
      for (const issue of result.localIntegrityIssues) console.error(red(`- ${issue}`));
    }

    if (result.ruleIssues.length) {
      console.error(bold(yellow(`\nRetranslation rules — broken against upstream (${result.ruleIssues.length}):`)));
      for (const issue of result.ruleIssues) console.error(yellow(`- ${issue}`));
      console.error(`  see scripts/update-data/retranslation.md's "Reconciling an upstream change".`);
    }

    console.error(
      `\nReview the files, copy them over using ${blue('update-data:copy')}, test the post-processing using ${blue('update-data:post')} ` +
        `and if all looks well regenerate the snapshot using ${blue('update-data:snapshot')}.`,
    );
    process.exit(1);
  }

  console.log(
    green(
      `update-data check OK — ${result.checked} tracked files verified against ${bilaraRoot}, cross-category segment ids consistent (upstream and local).`,
    ),
  );
}
