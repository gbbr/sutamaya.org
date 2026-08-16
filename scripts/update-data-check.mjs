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
  DATA_DIRS,
  SNAPSHOT_PATH,
  MANIFEST_PATH,
  red,
  green,
  yellow,
  bold,
  blue,
} from './lib/dataSync.js';

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

function readKeysSafe(filePath) {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

// Core logic, callable directly with an explicit bilaraRoot/dataDirs/snapshotPath (tests use this
// to point at fixture trees instead of the real data/{sujato,pali,html} — see
// scripts/update-data.test.js). Returns a result object instead of printing/exiting so callers
// (the CLI entry point below, or a test) decide what to do with it.
export function runCheck({ bilaraRoot, dataDirs = DATA_DIRS, snapshotPath = SNAPSHOT_PATH }) {
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

  for (const [relPath, expected] of Object.entries(snapshot.files)) {
    const sourcePath = sourcePathFor(bilaraRoot, relPath);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const where = sourcePath ?? '(no known category)';
      const relocations = possibleRelocations(relPath);
      const hint = relocations.length > 0 ? ` — might have moved to: ${relocations.join(', ')}` : '';
      upstreamIssues.push(`${relPath}: expected at ${where}, not found${hint} (renamed or removed upstream?)`);
      continue;
    }

    let keys;
    try {
      keys = Object.keys(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
    } catch (err) {
      upstreamIssues.push(`${relPath}: failed to parse ${sourcePath}: ${err.message}`);
      continue;
    }

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

  const issues = [...localIssues, ...upstreamIssues, ...integrityIssues, ...localIntegrityIssues];
  return {
    ok: issues.length === 0,
    issues,
    localIssues,
    upstreamIssues,
    integrityIssues,
    localIntegrityIssues,
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

  const result = runCheck({ bilaraRoot });

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
