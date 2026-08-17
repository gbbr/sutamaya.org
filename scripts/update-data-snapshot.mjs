#!/usr/bin/env node
// Regenerates scripts/update-data/snapshot.json from the current data/{sujato,pali,html} — i.e.
// resets the baseline update-data-check.mjs compares a prospective sc-data checkout against. Also
// regenerates data/sujato.post/ (via update-data-post.mjs) and records each term rule's current
// match count in scripts/update-data/retranslation.counts.json — the same "this is now the new
// normal" act, just for rule footprints instead of segment ids (see retranslation.md's anchors
// table: an open rule's count is its own anchor, since it has no allow/deny queue to check).
//
// MANUAL, DELIBERATE USE ONLY — not part of `npm run update-data` (see package.json), and never
// run automatically by check/copy/post. Run it only after `update-data:check` has reported
// segment-id changes, you've reviewed them by hand and confirmed they're legitimate upstream
// revisions (not a renamed file or a bad match), and copied them in. Regenerating the snapshot
// without that review defeats its whole purpose: it's what makes the *next* check detect changes,
// not this one.
import fs from 'node:fs';
import path from 'node:path';
import { listLocalRelPaths, localPathFor, keysHash, DATA_DIRS, SNAPSHOT_PATH, MANIFEST_PATH, green, yellow } from './lib/dataSync.js';
import { SUJATO_DIR, RULES_DIR, RETRANSLATION_PATH, COUNTS_PATH } from './lib/retranslation.js';
import { runPost } from './update-data-post.mjs';

// Core logic, callable directly with explicit paths (tests use this to point at fixture trees
// instead of the real data/{sujato,pali,html} — see scripts/update-data.test.js).
export async function runSnapshot({
  dataDirs = DATA_DIRS,
  snapshotPath = SNAPSHOT_PATH,
  manifestPath = MANIFEST_PATH,
  sujatoDir = dataDirs.sujato ?? SUJATO_DIR,
  postDir = path.join(path.dirname(sujatoDir), 'sujato.post'), // sibling of sujatoDir — SUJATO_POST_DIR for the real repo
  rulesDir = RULES_DIR,
  retranslationPath = RETRANSLATION_PATH,
  countsPath = COUNTS_PATH,
} = {}) {
  const relPaths = listLocalRelPaths(dataDirs);
  const files = {};
  for (const relPath of relPaths) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(localPathFor(relPath, dataDirs), 'utf8')));
    files[relPath] = { keyCount: keys.length, keysHash: keysHash(keys) };
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    note: 'Baseline snapshot of data/{sujato,pali,html}, used by update-data-check.mjs to verify a prospective sc-data checkout has not renamed files or changed segment ids before copying. Regenerated only manually (npm run update-data:snapshot), after reviewing a check failure by hand — never automatically.',
    fileCount: relPaths.length,
    files,
  };

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');

  // Mark manifest.json's provenance as caught up with this snapshot — see
  // scripts/update-data-copy.mjs's comment on why sourceCommit/snapshotCommit live together there
  // rather than in snapshot.json.
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.snapshotCommit = manifest.sourceCommit;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // Re-runs post against the (now-baselined) data/sujato — cheap, and keeps data/sujato.post/
  // fresh at exactly the moment the baseline changes. ruleCounts is populated even when a rule is
  // currently broken (post returns it regardless of `ok`), so a snapshot taken mid-repair still
  // records honest current counts rather than silently keeping stale ones.
  const postResult = await runPost({ sujatoDir, postDir, rulesDir, retranslationPath });
  const counts = {
    generatedAt: new Date().toISOString(),
    note: 'Each term rule\'s current match count across data/sujato — its anchor when it has no allow/deny queue of its own to check (an open rule with an empty deny list). Regenerated only by update-data:snapshot, alongside snapshot.json.',
    rules: postResult.ruleCounts,
  };
  fs.mkdirSync(path.dirname(countsPath), { recursive: true });
  fs.writeFileSync(countsPath, JSON.stringify(counts, null, 2) + '\n');

  return { ...snapshot, ruleCounts: postResult.ruleCounts, postOk: postResult.ok };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = await runSnapshot();
  console.log(green(`update-data snapshot regenerated — ${snapshot.fileCount} files recorded at ${path.relative(process.cwd(), SNAPSHOT_PATH)}.`));
  if (!snapshot.postOk) {
    console.log(yellow(`update-data:post currently fails (dead rule or broken segment override) — counts recorded anyway; see ${path.relative(process.cwd(), COUNTS_PATH)} and run update-data:post to see why.`));
  } else {
    console.log(green(`Rule counts recorded at ${path.relative(process.cwd(), COUNTS_PATH)}.`));
  }
}
