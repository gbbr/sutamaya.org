#!/usr/bin/env node
// Copies every file update-data-check.mjs verified into place, overwriting data/sujato,
// data/pali, and data/html as-is (byte-for-byte — no reformatting) with today's sc-data checkout,
// and records which sc-data commit that was in data/manifest.json. Run update-data-check.mjs
// first; this trusts that it passed and fails loudly rather than skipping if a file that used to
// exist at its expected path (see CATEGORY_SOURCE_PREFIXES in lib/dataSync.js) somehow doesn't
// anymore. See scripts/update-data/README.md.
import fs from 'node:fs';
import {
  requireSourceRoot,
  sourceGitInfo,
  sourcePathFor,
  localPathFor,
  loadSnapshot,
  DATA_DIRS,
  SNAPSHOT_PATH,
  MANIFEST_PATH,
  red,
  green,
  yellow,
} from './lib/dataSync.js';
import path from 'node:path';

// Core logic, callable directly with explicit paths/gitInfo (tests use this to point at fixture
// trees instead of the real data/{sujato,pali,html} — see scripts/update-data.test.js). Returns
// the manifest it wrote instead of just printing, so callers can assert on it.
export function runCopy({ bilaraRoot, gitInfo, dataDirs = DATA_DIRS, snapshotPath = SNAPSHOT_PATH, manifestPath = MANIFEST_PATH }) {
  const snapshot = loadSnapshot(snapshotPath);

  let copied = 0;
  for (const relPath of Object.keys(snapshot.files)) {
    const sourcePath = sourcePathFor(bilaraRoot, relPath);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`${relPath}: expected source at ${sourcePath ?? '(no known category)'} — run update-data-check first.`);
    }
    const destPath = localPathFor(relPath, dataDirs);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    copied += 1;
  }

  // Carried forward, not touched by copy itself — only update-data-snapshot.mjs updates it, so a
  // copy left un-snapshotted shows up as a visible sourceCommit/snapshotCommit mismatch in the
  // same file/diff hunk (see scripts/update-data/README.md).
  const previousSnapshotCommit = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).snapshotCommit ?? null : null;

  const manifest = {
    sourceRepo: 'suttacentral/sc-data',
    sourceCommit: gitInfo.commit,
    sourceCommitDate: gitInfo.commitDate,
    sourceDirty: gitInfo.dirty,
    snapshotCommit: previousSnapshotCommit,
    updatedAt: new Date().toISOString(),
    fileCount: copied,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let scDataPath, bilaraRoot, gitInfo;
  try {
    ({ scDataPath, bilaraRoot } = requireSourceRoot());
    gitInfo = sourceGitInfo(scDataPath);
  } catch (err) {
    console.error(red(err.message));
    process.exit(1);
  }

  if (gitInfo.dirty) {
    console.warn(yellow(`Warning: SC_DATA_PATH (${scDataPath}) has uncommitted local changes — manifest.json's commit won't fully describe what was copied.`));
  }

  let manifest;
  try {
    manifest = runCopy({ bilaraRoot, gitInfo });
  } catch (err) {
    console.error(red(err.message));
    process.exit(1);
  }

  console.log(green(`update-data copy done — ${manifest.fileCount} files copied from ${bilaraRoot} (sc-data @ ${gitInfo.commit.slice(0, 12)}).`));
}
