#!/usr/bin/env node
// Overwrites data/{sujato,pali,html} byte-for-byte from the sc-data checkout and records which
// commit that was in data/manifest.json. Run update-data-check.mjs first: this trusts that it
// passed, and throws rather than skipping a file missing from its expected source path.
// See data/README.md.
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

// Copies the snapshot's files in from `bilaraRoot` and returns the manifest it wrote. Every path is
// a parameter so a test can point it at fixture trees.
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

  // Carried forward untouched — only accept moves it, so a copy left un-snapshotted shows as a
  // sourceCommit/snapshotCommit mismatch.
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
