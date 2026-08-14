#!/usr/bin/env node
// Verifies a checked-out sc-data repo (SC_DATA_PATH) is safe to copy from before
// update-sujato-copy.mjs overwrites data/sujato with it: every file we currently track must
// still exist at its expected path (see CATEGORY_SOURCE_PREFIXES in lib/sujatoSync.js), with the
// exact same set of segment ids it had when scripts/update-sujato/snapshot.json was taken — only
// the translated values are allowed to differ. See scripts/update-sujato/README.md.
import fs from 'node:fs';
import path from 'node:path';
import {
  requireSourceRoot,
  sourcePathFor,
  buildBasenameIndex,
  loadSnapshot,
  keysHash,
  checkSnapshotInSync,
  SUJATO_DIR,
  SNAPSHOT_PATH,
  MANIFEST_PATH,
  red,
  green,
  yellow,
  bold,
  blue,
} from './lib/sujatoSync.js';

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

// Core logic, callable directly with an explicit bilaraRoot/sujatoDir/snapshotPath (tests use
// this to point at a fixture tree instead of the real data/sujato — see
// scripts/update-sujato.test.js). Returns a result object instead of printing/exiting so callers
// (the CLI entry point below, or a test) decide what to do with it.
export function runCheck({ bilaraRoot, sujatoDir = SUJATO_DIR, snapshotPath = SNAPSHOT_PATH }) {
  const snapshot = loadSnapshot(snapshotPath);

  // Built lazily on the first missing file — a full-tree scan, so not worth doing unless
  // something has actually gone missing from its expected path.
  let basenameIndex = null;
  function possibleRelocations(relPath) {
    if (!basenameIndex) basenameIndex = buildBasenameIndex(bilaraRoot);
    return basenameIndex.get(path.basename(relPath)) || [];
  }

  // Independent of bilaraRoot entirely — verifies data/sujato/ itself still matches
  // snapshot.json, catching a copy that got committed without a follow-up update-sujato:snapshot.
  // Kept separate from upstreamIssues below (rather than one merged list) since they're different
  // questions with different fixes: local drift means "run update-sujato:snapshot", an upstream
  // issue means "review what changed in SC_DATA_PATH".
  const localIssues = checkSnapshotInSync({ sujatoDir, snapshotPath }).issues;
  const upstreamIssues = [];
  let checked = 0;

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

    if (keys.length !== expected.keyCount || keysHash(keys) !== expected.keysHash) {
      const localPath = path.join(sujatoDir, relPath);
      const oldKeys = fs.existsSync(localPath) ? Object.keys(JSON.parse(fs.readFileSync(localPath, 'utf8'))) : [];
      upstreamIssues.push(`${relPath}: segment ids changed (${oldKeys.length} → ${keys.length}) — ${describeSetDiff(oldKeys, keys)}`);
      continue;
    }

    checked += 1;
  }

  const issues = [...localIssues, ...upstreamIssues];
  return { ok: issues.length === 0, issues, localIssues, upstreamIssues, checked, totalTracked: Object.keys(snapshot.files).length };
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
    console.error(bold(red(`update-sujato check FAILED — ${result.issues.length} of ${result.totalTracked} tracked file(s) have a problem:`)));

    if (result.localIssues.length) {
      console.error(bold(red(`\nLocal drift — data/sujato/ vs snapshot.json (${result.localIssues.length}):`)));
      console.error(red(`  did a previous update-sujato:copy forget to run update-sujato:snapshot afterward?`));
      for (const issue of result.localIssues) console.error(red(`- ${issue}`));

      if (fs.existsSync(MANIFEST_PATH)) {
        const { sourceCommit, snapshotCommit } = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        console.error(`\ndata/sujato/manifest.json:\n\tsourceCommit   = ${sourceCommit ?? '(none)'}\n\tsnapshotCommit = ${snapshotCommit ?? '(none)'}`);
      }
    }

    if (result.upstreamIssues.length) {
      console.error(bold(yellow(`\nUpstream changes — ${bilaraRoot} vs snapshot.json (${result.upstreamIssues.length}):`)));
      for (const issue of result.upstreamIssues) console.error(yellow(`- ${issue}`));
    }

    console.error(
      `\nReview the files, copy them over using ${blue('update-sujato:copy')}, test the post-processing using ${blue('update-sujato:post')} ` +
        `and if all looks well regenerate the snapshot using ${blue('update-sujato:snapshot')}.`,
    );
    process.exit(1);
  }

  console.log(green(`update-sujato check OK — ${result.checked} tracked files verified against ${bilaraRoot}.`));
}
