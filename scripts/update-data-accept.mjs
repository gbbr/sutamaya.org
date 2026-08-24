#!/usr/bin/env node
// Accepts the current data/{sujato,pali,html} as the new normal: regenerates
// scripts/update-data/snapshot.json from it — i.e. resets the baseline update-data-check.mjs
// compares a prospective sc-data checkout against. Named for the act rather than the artifact
// because the act is a decision — see the MANUAL, DELIBERATE USE warning below. Also
// regenerates data/sujato.post/ and records each term rule's current match count, by delegating to
// update-data-counts.mjs — the same "this is now the new normal" act, just for rule footprints
// instead of segment ids.
//
// Recording counts is also right after editing a *rule*, where rebaselining the segment-id snapshot
// would be wrong; that is why the counts half is its own command (npm run update-data counts) and
// this file calls it rather than reimplementing it.
//
// MANUAL, DELIBERATE USE ONLY — not part of `npm run update-data` (see package.json), and never
// run automatically by check/copy/post. Run it only after `update-data plan` has reported
// segment-id changes, you've reviewed them by hand and confirmed they're legitimate upstream
// revisions (not a renamed file or a bad match), and copied them in. Regenerating the snapshot
// without that review defeats its whole purpose: it's what makes the *next* check detect changes,
// not this one.
import fs from 'node:fs';
import path from 'node:path';
import { listLocalRelPaths, localPathFor, keysHash, DATA_DIRS, SNAPSHOT_PATH, MANIFEST_PATH, green } from './lib/dataSync.js';
import { SUJATO_DIR, RULES_DIR, RETRANSLATION_PATH, COUNTS_PATH } from './lib/retranslation.js';
import { runCounts, reportCounts } from './update-data-counts.mjs';

// Core logic, callable directly with explicit paths (tests use this to point at fixture trees
// instead of the real data/{sujato,pali,html} — see scripts/update-data.test.js).
export async function runAccept({
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
    note: 'Baseline snapshot of data/{sujato,pali,html}, used by update-data-check.mjs to verify a prospective sc-data checkout has not renamed files or changed segment ids before copying. Regenerated only manually (npm run update-data accept), after reviewing a check failure by hand — never automatically.',
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
  // fresh at exactly the moment the baseline changes. Rule counts are the same "this is now the
  // new normal" act as the snapshot itself, so they're recorded here too, through the very command
  // that records them on their own after a rule edit (update-data counts).
  const countsResult = await runCounts({ sujatoDir, postDir, rulesDir, retranslationPath, countsPath });

  return { ...snapshot, ...countsResult };
}
