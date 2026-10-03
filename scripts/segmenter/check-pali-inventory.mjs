#!/usr/bin/env node
/** Checks the saved inventory against its inputs without performing semantic review. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildBodySegments, stripHtmlTags } from '../lib/collections.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'data/upstream/pali-review-inventory');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const load = (file) => read(path.relative(ROOT, path.join(OUT, file)));
const plain = (text = '') => stripHtmlTags(text).replace(/\s+/g, ' ').trim();
const title = (key) => /^0(?:\.|$)/.test(key.split(':')[1]);
const unique = (keys) => assert.equal(new Set(keys).size, keys.length, 'Duplicate keys');
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(ROOT, path.join(dir, e.name))]);
const manifest = load('inputs.json');
for (const [file, hash] of Object.entries(manifest.hashes)) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex'), hash, `Stale inventory input: ${file}`);
}
const ledger = load('coverage-ledger.json'), queue = load('queue.json'), summary = load('summary.json'), candidates = load('candidates.json');
const id = (d) => `${d.translator}/${d.document}`;
unique(ledger.documents.map(id));
unique(queue.documents.map(id));
unique(candidates.map((c) => `${c.translator}/${c.file}:${c.line}`));
for (const translator of ['bodhi', 'thanissaro']) {
  const currentFiles = walk(path.join(ROOT, 'data', translator, 'sutta')).filter((file) => file.endsWith('.json')).sort();
  const inventoriedFiles = ledger.documents.filter((d) => d.translator === translator).map((d) => Object.keys(d.inputHashes).find((file) => file.startsWith(`data/${translator}/`))).sort();
  assert.deepEqual(inventoriedFiles, currentFiles, `Changed document population: ${translator}`);
}
const queued = new Map(queue.documents.map((d) => [id(d), d]));
const totals = {};
let verseRows = 0, targetRows = 0, coverageRows = 0;
const tsv = ['translator\tdocument\tPali_key\treasons'];
for (const d of ledger.documents) {
  const ownPath = Object.keys(d.inputHashes).find((p) => p.startsWith(`data/${d.translator}/`));
  const paliPath = Object.keys(d.inputHashes).find((p) => p.startsWith('data/pali/'));
  const htmlPath = Object.keys(d.inputHashes).find((p) => p.startsWith('data/html/'));
  for (const [file, hash] of Object.entries(d.inputHashes)) assert.equal(manifest.hashes[file], hash);
  const own = read(ownPath), pali = read(paliPath), html = read(htmlPath), keys = Object.keys(pali);
  assert.deepEqual(d.paliKeys, keys);
  assert.deepEqual(d.englishSegmentKeys, Object.keys(own).filter((k) => plain(own[k])));
  const uids = new Set(keys.filter((k) => !title(k) && plain(own[k])).map((k) => k.split(':')[0]));
  const body = keys.filter((k) => !title(k) && plain(pali[k]) && !/class=['"](?:end\w*|uddana(?:-intro)?)['"]/.test(html[k] ?? ''));
  assert.deepEqual(d.bodyKeys, body.filter((k) => uids.has(k.split(':')[0])));
  assert.deepEqual(d.bodyKeysOutsideTranslatedSuttas, body.filter((k) => !uids.has(k.split(':')[0])));
  unique(d.currentPaliEvidence.map((r) => r.key));
  const proof = new Set(d.currentPaliEvidence.map((r) => r.key));
  for (const r of d.currentPaliEvidence) {
    assert(Object.hasOwn(pali, r.key));
    assert(r.evidence.length && r.kinds.length);
  }
  const pm = new Map(Object.entries(pali));
  const verses = ['sn', 'an', 'kn'].includes(d.collection) ? buildBodySegments(pm, new Map(keys.map((k) => [k, 'x'])), new Map(Object.entries(html)), new Map()).filter((s) => s.role === 'verse' && d.bodyKeys.includes(s.key)).map((s) => s.key) : [];
  verseRows += verses.length;
  const q = queued.get(id(d));
  const counts = {
    bodyRows: d.bodyKeys.length, englishRows: d.bodyKeys.filter((k) => plain(own[k])).length,
    verseRows: verses.length, verseRowsWithCurrentPaliEvidence: verses.filter((k) => proof.has(k)).length,
    unreviewedVerseRows: verses.filter((k) => !proof.has(k)).length,
    targetedReviewRows: q?.reviewRows.length ?? 0, rowsIncludingTwoLineContext: q?.contextKeys.length ?? 0,
    coverageRecordRows: q?.coverageRows.length ?? 0,
  };
  assert.deepEqual(d.counts, { paliRows: keys.length, englishSegments: d.englishSegmentKeys.length, bodyRows: d.bodyKeys.length, bodyRowsWithInventoriedPaliEvidence: d.bodyKeys.filter((k) => proof.has(k)).length, bodyRowsWithoutInventoriedPaliEvidence: d.bodyKeys.filter((k) => !proof.has(k)).length });
  const total = totals[d.translator] ??= {};
  for (const [name, n] of Object.entries(counts)) total[name] = (total[name] ?? 0) + n;
  if (!q) { assert.equal(counts.unreviewedVerseRows, 0); continue; }
  assert.deepEqual(q.inputHashes, d.inputHashes);
  assert.deepEqual(q.counts, counts);
  unique(q.reviewRows.map((r) => r.key)); unique(q.coverageRows.map((r) => r.key)); unique(q.contextKeys);
  for (const r of [...q.reviewRows, ...q.coverageRows]) assert(Object.hasOwn(pali, r.key) && plain(pali[r.key]) && !title(r.key) && r.reasons.length);
  for (const key of q.contextKeys) assert(Object.hasOwn(pali, key));
  for (const r of q.reviewRows) {
    assert(q.contextKeys.includes(r.key));
    tsv.push([d.translator, d.document, r.key, [...new Set(r.reasons.map((reason) => reason.kind))].join(',')].join('\t'));
  }
  for (const key of verses.filter((k) => !proof.has(k))) assert(q.reviewRows.some((r) => r.key === key && r.reasons.some((reason) => reason.kind === 'unreviewed-verse')));
  targetRows += q.reviewRows.length;
  coverageRows += q.coverageRows.length;
  queued.delete(id(d));
}
assert.equal(queued.size, 0, 'Queue references missing documents');
for (const file of Object.keys(manifest.hashes).filter((p) => /\/audit5\/reader.*\.json$/.test(p))) {
  const reader = read(file), translator = file.split('/')[1];
  const concerns = [...(reader.concerns ?? []), ...(reader.correspondence_concerns ?? []), ...(reader.coverage_and_source_variant_concerns ?? [])];
  for (const item of concerns) {
    const documents = (item.texts ?? (item.text ? [item.text] : [])).flatMap((name) => name.split('/'));
    const expected = [];
    for (const d of ledger.documents.filter((doc) => doc.translator === translator)) {
      const keys = item.keys?.length ? item.keys.filter((key) => d.paliKeys.includes(key)) : documents.flatMap((name) => name === d.document ? d.bodyKeys : d.bodyKeys.filter((key) => key.split(':')[0] === name));
      for (const key of keys) expected.push({ d, key });
    }
    assert(expected.length, `Unmapped audit concern: ${file}: ${JSON.stringify(item)}`);
    for (const { d, key } of expected) assert(queue.documents.find((doc) => id(doc) === id(d))?.coverageRows.some((r) => r.key === key && r.reasons.some((reason) => reason.evidence === file)), `Missing audit coverage concern: ${file}: ${key}`);
  }
}
assert.equal(fs.readFileSync(path.join(OUT, 'passages.tsv'), 'utf8'), `${tsv.join('\n')}\n`);
for (const [translator, values] of Object.entries(totals)) {
  for (const [name, n] of Object.entries(values)) assert.equal(summary.metrics[translator][name], n, `${translator}/${name}`);
  assert.equal(summary.metrics[translator].documents, ledger.documents.filter((d) => d.translator === translator).length);
  for (const [name, n] of Object.entries(summary.coverageScope[translator])) assert.equal(n, ledger.documents.filter((d) => d.translator === translator).reduce((sum, d) => sum + d.counts[name], 0));
}
const proposalHashes = Object.keys(manifest.hashes).filter((file) => /review-archive\/.*\/source\/(?:bodhi|thanissaro)\/hand\//.test(file));
const expectedCandidates = proposalHashes.flatMap((file) => fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').flatMap((line, i) => /^(\S+:\S+) (?:starts: .+|none)$/.test(line.trim()) ? [`${file}:${i + 1}`] : []));
assert.deepEqual(candidates.map((c) => `${c.file}:${c.line}`).sort(), expectedCandidates.sort());
for (const c of candidates) {
  if (c.disposition === 'missing-current-key-needs-source-triage') continue;
  const d = ledger.documents.find((doc) => doc.translator === c.translator && doc.document === c.document);
  assert(d?.paliKeys.includes(c.key));
  if (!c.evidence.length) assert(queue.documents.find((doc) => id(doc) === id(d))?.reviewRows.some((r) => r.key === c.key));
  else assert(d.currentPaliEvidence.some((r) => r.key === c.key));
}
const result = { baselineCommit: manifest.baselineCommit, status: 'passed; mechanical inventory checks only', checkedDocuments: ledger.documents.length, checkedInputHashes: Object.keys(manifest.hashes).length, checkedTargetRows: targetRows, checkedKnownCoverageRows: coverageRows, verseRowsVerifiedAgainstExistingClassifier: verseRows, recoveredCandidates: candidates.length, candidatesWithLaterPaliEvidence: candidates.filter((c) => c.evidence?.length).length, pendingCandidates: candidates.filter((c) => !c.evidence?.length).length };
fs.writeFileSync(path.join(OUT, 'validation.json.tmp'), `${JSON.stringify(result, null, 2)}\n`);
fs.renameSync(path.join(OUT, 'validation.json.tmp'), path.join(OUT, 'validation.json'));
console.log(JSON.stringify(result));

if (process.argv.includes('--resume-check')) {
  const reports = ['inputs.json', 'coverage-ledger.json', 'queue.json', 'candidates.json', 'passages.tsv', 'validation.json'];
  const hashes = Object.fromEntries(reports.map((file) => [file, digest(path.join(OUT, file))]));
  const d = ledger.documents[0];
  const checkpoint = path.join(OUT, 'documents', d.translator, `${d.document}.json`);
  const cacheHash = digest(checkpoint);
  const backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sutamaya-inventory-resume-')), 'checkpoint.json');
  fs.renameSync(checkpoint, backup);
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/segmenter/inventory-pali-review.mjs')], { cwd: ROOT, stdio: 'pipe' });
    const resumed = load('summary.json');
    assert.equal(resumed.reusedCheckpoints, ledger.documents.length - 1);
    assert.equal(resumed.newlyScannedDocuments, 1);
    assert.equal(digest(checkpoint), cacheHash);
    for (const [file, hash] of Object.entries(hashes)) assert.equal(digest(path.join(OUT, file)), hash, `Changed reproducible report after resume: ${file}`);
    const receipt = { baselineCommit: manifest.baselineCommit, status: 'passed', missingCheckpoint: `${d.translator}/${d.document}`, reusedCheckpoints: resumed.reusedCheckpoints, rebuiltCheckpoints: resumed.newlyScannedDocuments, restoredCheckpointBytesMatch: true, identicalReportHashes: hashes, scope: 'Inventory resume and deterministic reports only; no alignment or semantic-review claim.' };
    fs.writeFileSync(path.join(OUT, 'resume-check.json.tmp'), `${JSON.stringify(receipt, null, 2)}\n`);
    fs.renameSync(path.join(OUT, 'resume-check.json.tmp'), path.join(OUT, 'resume-check.json'));
    console.log(JSON.stringify({ resumeCheck: 'passed', reusedCheckpoints: resumed.reusedCheckpoints, rebuiltCheckpoints: resumed.newlyScannedDocuments }));
  } finally {
    if (!fs.existsSync(checkpoint)) fs.renameSync(backup, checkpoint);
  }
}
