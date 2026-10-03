#!/usr/bin/env node
/** Inventories remaining targeted Pali work without changing alignments. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { roleFor, stripHtmlTags } from '../lib/collections.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'data/upstream/pali-review-inventory');
const ARCHIVE = 'data/upstream/review-archive/2026-10-02';
const TRANSLATORS = ['bodhi', 'thanissaro'];
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const relative = (file) => path.relative(ROOT, file);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const plain = (value = '') => stripHtmlTags(value).replace(/\s+/g, ' ').trim();
const words = (value) => plain(value).toLowerCase().match(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu) ?? [];
const title = (key) => /^0(?:\.|$)/.test(key.split(':')[1]);
const hasPali = (value) => Boolean(plain(value));
const isBody = (key, pali, markup) => !title(key) && hasPali(pali[key]) && !/class=['"](?:end\w*|uddana(?:-intro)?)['"]/.test(markup[key] ?? '');
const rootRecord = read(path.join(ROOT, 'data/upstream/codex-sn-an-kn-review.json'));
const changedPali = new Set(execFileSync('git', ['diff', '--name-only', rootRecord.baseCommit, '--', 'data/pali'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean));
const changedEnglish = new Set(execFileSync('git', ['diff', '--name-only', rootRecord.completedCommit, '--', 'data/bodhi/sutta', 'data/thanissaro/sutta'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
fs.mkdirSync(OUT, { recursive: true });

/** Writes each checkpoint atomically so an interrupted run retains complete JSON. */
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

/** Returns all saved files under a directory in deterministic order. */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort();
}

/** Returns whether a saved start still agrees with the current English boundary. */
function matches(start, text) {
  if (start === null) return !plain(text);
  const expected = words(start), actual = words(text);
  return expected.length > 0 && expected.every((word, i) => word === actual[i]);
}

/** Returns verse roles without paragraph-length filtering or English-emptiness inference. */
function verseKeys(keys, markup) {
  let gatha = false, uddana = false;
  const found = new Set();
  for (const key of keys) {
    const template = markup[key] ?? '';
    if (/<blockquote class=['"](?:gatha|uddanagatha|vagguddanagatha)['"]>/.test(template)) gatha = true;
    if (/<blockquote class=['"](?:uddanagatha|vagguddanagatha)['"]>/.test(template)) uddana = true;
    const role = roleFor(template)?.role;
    if (!title(key) && !uddana && (role === 'verse' || (!role && gatha))) found.add(key);
    if (/<\/blockquote>/.test(template)) gatha = uddana = false;
  }
  return found;
}

/** Returns recovered proposals with file and line provenance. */
function proposals(translator) {
  return walk(path.join(ROOT, ARCHIVE, `source/${translator}/hand`)).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
    const match = /^(\S+:\S+) (?:starts: (.+)|none)$/.exec(line.trim());
    return match ? [{ key: match[1], starts: match[2]?.trim() ?? null, file: relative(file), line: i + 1 }] : [];
  }));
}

/** Collects explicit Pali evidence and unresolved source/coverage requirements. */
function evidence(translator) {
  const review = path.join(ROOT, 'data', translator, 'review');
  const judgmentsPath = path.join(review, 'codex-read/judgments.json');
  const judgments = read(judgmentsPath);
  const groups = read(path.join(review, 'codex-read/initial-groups.json'));
  const auditReaders = walk(path.join(review, 'audit5')).filter((p) => /reader.*\.json$/.test(p));
  const audits = [];
  for (const file of auditReaders) {
    const reader = read(file);
    const batches = Array.isArray(reader.batches) ? reader.batches : Object.entries(reader.batches).map(([batch, item]) => ({ batch, ...item }));
    for (const batch of batches) {
      const id = String(batch.batch ?? batch.number ?? batch.id).padStart(3, '0');
      const packetPath = path.join(review, `audit5/batch-${id}.pali.txt`);
      if (!fs.existsSync(packetPath)) throw new Error(`Cannot resolve completed audit batch: ${file}: ${JSON.stringify(batch)}`);
      const data = fs.readFileSync(packetPath, 'utf8');
      const recorded = batch.input_sha256 ?? batch.inputSha256 ?? batch.sha256;
      const committed = execFileSync('git', ['show', `${rootRecord.completedCommit}:${relative(packetPath)}`], { cwd: ROOT });
      const hash = recorded ?? sha(committed);
      if (sha(data) !== hash || sha(data) !== sha(committed)) throw new Error(`Audit input hash mismatch: ${packetPath}`);
      let parsedRows = 0;
      for (const line of data.split('\n')) {
        const match = /^(\S+:\S+) \| .*? \| T: (.*?) \| Pali: (.*)$/.exec(line);
        if (match) { parsedRows++; audits.push({ key: match[1], english: match[2] === '(none)' ? '' : plain(match[2]), pali: plain(match[3]), evidence: `${relative(file)}; ${relative(packetPath)}` }); }
      }
      if (parsedRows !== batch.rows_read) throw new Error(`Audit row coverage mismatch: ${packetPath}`);
    }
  }
  const anchors = [];
  for (const file of walk(path.join(review, 'hand')).filter((p) => path.basename(p).startsWith('codex-') && p.endsWith('.findings'))) {
    for (const [i, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
      const match = /^(\S+:\S+) (?:starts: (.+)|none)$/.exec(line.trim());
      if (match) anchors.push({ key: match[1], starts: match[2]?.trim() ?? null, evidence: `${relative(file)}:${i + 1}` });
    }
  }
  const coverage = [];
  const issues = [];
  const exceptions = judgments.exceptions.decisions;
  for (const item of exceptions) {
    for (const keys of item.explicitGroupRequirements ?? []) coverage.push({ keys, evidence: relative(judgmentsPath), reason: item.rationale });
    if (item.status === 'grouped') coverage.push({ keys: Object.keys(item.resolvedStarts ?? {}), evidence: relative(judgmentsPath), reason: item.rationale });
    if (item.remaining?.length && !/already semantically correct/.test(item.remaining.join(' '))) {
      const keys = (item.reported ?? []).map((r) => r.key);
      issues.push({ keys, document: item.text, kind: /historical/.test(item.action ?? '') ? 'historical-uncertainty' : 'correspondence', evidence: relative(judgmentsPath), reason: item.remaining.join(' ') });
    }
    if (/requires.*(?:correspondence|source)/.test(item.status ?? '')) {
      issues.push({ keys: item.reportedKeys ?? [], kind: 'correspondence', evidence: relative(judgmentsPath), reason: item.rationale });
    }
  }
  for (const file of auditReaders) {
    const reader = read(file);
    for (const item of [...(reader.correspondence_concerns ?? []), ...(reader.concerns ?? []), ...(reader.coverage_and_source_variant_concerns ?? [])]) {
      const docs = (item.texts ?? (item.text ? [item.text] : [])).flatMap((doc) => doc.split('/'));
      const reason = item.rationale ?? item.reason ?? item.note ?? item.kind;
      if (!docs.length && item.keys?.length) coverage.push({ keys: item.keys, evidence: relative(file), reason });
      for (const document of docs) {
        coverage.push({ document, keys: item.keys ?? [], evidence: relative(file), reason });
        if (/variant|conflict|numbering/.test(item.kind)) issues.push({ document, keys: item.keys ?? [], kind: 'edition-variant', evidence: relative(file), reason });
      }
    }
  }
  const rangeFile = path.join(review, 'codex-read/source-ranges.json');
  const ranges = read(rangeFile);
  if (translator === 'bodhi') {
    for (const pair of [...ranges.primary_cases, ...ranges.other_same_range_plus_terminal_duplicate_pairs]) {
      for (const document of pair.source_ids) issues.push({ document, kind: 'source-mapping', evidence: relative(rangeFile), reason: pair.necessary_remedy });
    }
    for (const document of ['an8.17', 'an8.18']) issues.push({ document, kind: 'edition-variant', evidence: 'data/upstream/codex-sn-an-kn-review.json#remainingCorrespondence', reason: 'Source list variant differs from the current MS Pali; explicit coverage remains.' });
    for (const item of read(path.join(review, 'codex-read/followup-rounds.json')).filter((i) => /coverage|expansion/.test(i.reason))) issues.push({ keys: [item.key], document: item.text, kind: 'edition-variant', evidence: relative(path.join(review, 'codex-read/followup-rounds.json')), reason: item.reason });
  } else {
    for (const item of ranges.pages) {
      if (/requires/.test(item.status)) for (const document of item.targetDocuments) issues.push({ document, kind: 'source-mapping', evidence: relative(rangeFile), reason: item.note });
      else for (const point of item.correspondence ?? []) if (point.note || point.meaning?.includes('sharing')) coverage.push({ keys: [point.key], evidence: relative(rangeFile), reason: point.note ?? point.meaning });
    }
    const followups = read(path.join(review, 'codex-read/followup-rounds.json'));
    for (const item of followups.filter((i) => /noncontiguous/.test(i.reason))) issues.push({ document: item.text, kind: 'correspondence', evidence: relative(path.join(review, 'codex-read/followup-rounds.json')), reason: item.reason });
    issues.push({ keys: ['dhp51:4'], kind: 'saved-followup', evidence: `${ARCHIVE}/scratch.zip#source/scratch/followups.txt`, reason: 'Recovered unfinished verse follow-up; skip if a later Pali judgment already resolves its current boundary.' });
  }
  for (const item of rootRecord.translators[translator].inactiveHistoricalFindings) issues.push({ keys: [item.key], kind: 'historical-uncertainty', evidence: 'data/upstream/codex-sn-an-kn-review.json', reason: 'Historical not-found directive; current Pali correctness is not certified by the failed quote.' });
  for (const item of rootRecord.translators[translator].remainingAutomaticUnsureCuts) issues.push({ keys: item.keys.map((key) => key.split('@')[0]), kind: 'automatic-uncertainty', evidence: 'data/upstream/codex-sn-an-kn-review.json', reason: 'Historical automatic uncertainty remains recorded.' });
  const files = [path.join(ROOT, 'data/upstream/codex-sn-an-kn-review.json'), path.join(ROOT, 'scripts/lib/collections.js'), path.join(ROOT, `data/${translator}/report.json`), path.join(ROOT, `data/${translator}/cuts.json`), ...walk(path.join(ROOT, `data/upstream/${translator}`)), judgmentsPath, path.join(review, 'codex-read/initial-groups.json'), path.join(review, 'codex-read/followup-rounds.json'), path.join(ROOT, ARCHIVE, 'scratch.zip'), rangeFile, ...auditReaders, ...walk(path.join(review, 'audit5')).filter((p) => /\.pali\.txt$/.test(p)), ...walk(path.join(review, 'hand')).filter((p) => path.basename(p).startsWith('codex-'))];
  const inputHashes = Object.fromEntries(files.map((p) => [relative(p), sha(fs.readFileSync(p))]));
  return { audits, anchors, judgments, groups, coverage, issues, inputHashes, hash: sha(JSON.stringify(inputHashes) + JSON.stringify({ issues, coverage })) };
}

const progressFile = path.join(OUT, 'progress.json');
let progress = fs.existsSync(progressFile) ? read(progressFile) : { stages: {} };
progress.date = new Date().toISOString().slice(0, 10);
progress.authorizedScope = 'Inventory only: targeted SN/AN/KN verse, recovered candidates and recorded problems; complete-scope evidence gaps; no new semantic reads, alignment changes, pilot or commits.';
progress.baselineCommit = head;
progress.status = 'in progress';
delete progress.checkpointFiles;
progress.checkpointDirectory = 'data/upstream/pali-review-inventory/documents/';
progress.completedDocuments = 0;
progress.stages.discoverEvidence = 'complete';
progress.stages.scanCorpus = 'in progress';
progress.resume = 'Run node scripts/segmenter/inventory-pali-review.mjs. Matching document checkpoints are reused; final outputs are rebuilt from them.';
save(progressFile, progress);
const allDocs = [], candidateResults = [], checkpoints = [];
const evidenceHashes = {};
let reused = 0, scanned = 0;
for (const translator of TRANSLATORS) {
  const ev = evidence(translator);
  Object.assign(evidenceHashes, ev.inputHashes);
  for (const file of walk(path.join(ROOT, ARCHIVE, `source/${translator}/hand`))) evidenceHashes[relative(file)] = sha(fs.readFileSync(file));
  const pending = proposals(translator);
  const base = path.join(ROOT, 'data', translator, 'sutta');
  for (const file of walk(base).filter((p) => p.endsWith('.json'))) {
    const rel = path.relative(base, file), document = path.basename(file).split('_')[0];
    const paliFile = path.join(ROOT, 'data/pali/sutta', rel.replace(`_translation-en-${translator}`, '_root-pli-ms'));
    const htmlFile = path.join(ROOT, 'data/html/pli/ms/sutta', rel.replace(`_translation-en-${translator}`, '_html'));
    const inputHashes = Object.fromEntries([file, paliFile, htmlFile].map((p) => [relative(p), sha(fs.readFileSync(p))]));
    const fingerprint = sha(JSON.stringify(inputHashes) + ev.hash + JSON.stringify(pending) + sha(fs.readFileSync(import.meta.filename)));
    const checkpoint = path.join(OUT, `documents/${translator}/${document}.json`);
    let result;
    if (fs.existsSync(checkpoint) && read(checkpoint).fingerprint === fingerprint) { result = read(checkpoint); reused++; }
    else {
      const own = read(file), pali = read(paliFile), markup = read(htmlFile), keys = Object.keys(pali);
      const coveredUids = new Set(keys.filter((k) => !title(k) && plain(own[k])).map((k) => k.split(':')[0]));
      const body = keys.filter((k) => coveredUids.has(k.split(':')[0]) && isBody(k, pali, markup));
      const roles = verseKeys(keys, markup);
      const verses = ['sn', 'an', 'kn'].includes(rel.split(path.sep)[0]) ? body.filter((k) => roles.has(k)) : [];
      const proof = new Map();
      const addProof = (key, ref) => proof.set(key, [...(proof.get(key) ?? []), ref]);
      for (const item of ev.audits) if (keyIn(item.key, pali) && plain(pali[item.key]) === item.pali && plain(own[item.key]) === item.english) addProof(item.key, item.evidence);
      if (!changedPali.has(relative(paliFile))) {
        if (!changedEnglish.has(relative(file))) for (const item of ev.anchors) if (keyIn(item.key, pali) && matches(item.starts, own[item.key] ?? '')) addProof(item.key, item.evidence);
        for (const group of ev.judgments.groups) {
          if (!group.reviewedPaliSpan || !keyIn(group.reviewedPaliSpan[0], pali)) continue;
          const frozen = ev.groups[group.id - 1];
          if (!frozen || !['better', 'same'].includes(group.verdict)) continue;
          const allowed = new Set(span(keys, ...group.reviewedPaliSpan));
          for (const line of frozen.lines) if (allowed.has(line.key) && plain(own[line.key]) === plain(line.after)) addProof(line.key, `data/${translator}/review/codex-read/judgments.json#group-${group.id}`);
        }
      }
      const candidates = pending.filter((p) => keyIn(p.key, pali)).map((p) => {
        const agrees = matches(p.starts, own[p.key] ?? '');
        const evidence = proof.get(p.key) ?? [];
        const disposition = evidence.length ? (agrees ? 'already-matches-reviewed-boundary' : 'superseded-by-reviewed-boundary') : (agrees ? 'matches-current-but-needs-Pali-evidence' : 'pending-direct-Pali-judgment');
        return { ...p, currentMatches: agrees, disposition, evidence };
      });
      const needs = new Map(), coverage = new Map();
      const add = (map, key, reason) => { if (keyIn(key, pali) && !title(key) && hasPali(pali[key])) map.set(key, [...(map.get(key) ?? []), reason]); };
      const affectedKeys = (item) => item.keys?.length ? item.keys : item.document === document ? body : body.filter((key) => key.split(':')[0] === item.document);
      for (const key of verses.filter((k) => !proof.has(k))) add(needs, key, { kind: 'unreviewed-verse', evidence: relative(htmlFile) });
      for (const candidate of candidates.filter((p) => !p.evidence.length)) add(needs, candidate.key, { kind: 'pending-recovered-candidate', evidence: `${candidate.file}:${candidate.line}` });
      for (const item of ev.issues) {
        const affected = affectedKeys(item);
        for (const key of affected) {
          if ((/uncertainty/.test(item.kind) || item.kind === 'saved-followup') && proof.has(key)) continue;
          add(needs, key, item);
        }
      }
      for (const item of ev.coverage) {
        const affected = affectedKeys(item);
        for (const key of affected) add(coverage, key, item);
      }
      const targetKeys = keys.filter((k) => needs.has(k));
      const context = new Set();
      for (const key of targetKeys) {
        const at = keys.indexOf(key), uid = key.split(':')[0];
        for (let i = Math.max(0, at - 2); i <= Math.min(keys.length - 1, at + 2); i++) if (!title(keys[i]) && keys[i].split(':')[0] === uid && hasPali(pali[keys[i]])) context.add(keys[i]);
      }
      result = { translator, document, collection: rel.split(path.sep)[0], fingerprint, inputHashes, counts: { bodyRows: body.length, englishRows: body.filter((k) => plain(own[k])).length, verseRows: verses.length, verseRowsWithCurrentPaliEvidence: verses.filter((k) => proof.has(k)).length, unreviewedVerseRows: verses.filter((k) => !proof.has(k)).length, targetedReviewRows: targetKeys.length, rowsIncludingTwoLineContext: context.size, coverageRecordRows: coverage.size }, verseKeys: verses, reviewedKeys: [...proof].map(([key, evidence]) => ({ key, evidence })), reviewRows: [...needs].map(([key, reasons]) => ({ key, reasons })), contextKeys: keys.filter((k) => context.has(k)), coverageRows: [...coverage].map(([key, reasons]) => ({ key, reasons })), candidates };
      save(checkpoint, result); scanned++;
    }
    checkpoints.push(relative(checkpoint)); allDocs.push(result); candidateResults.push(...result.candidates.map((c) => ({ translator, document, ...c })));
    progress.lastCompletedDocument = `${translator}/${document}`;
    progress.completedDocuments = checkpoints.length;
    save(progressFile, progress);
  }
  console.log(`${translator}: ${allDocs.filter((d) => d.translator === translator).length} document checkpoints complete`);
}

/** Returns whether an exact line key exists in a Pali document. */
function keyIn(key, pali) { return Object.hasOwn(pali, key); }
/** Returns the inclusive Pali-key span named by a local judgment. */
function span(keys, first, last) { const a = keys.indexOf(first), b = keys.indexOf(last); return a >= 0 && b >= a ? keys.slice(a, b + 1) : []; }

const missing = TRANSLATORS.flatMap((translator) => proposals(translator).filter((p) => !candidateResults.some((c) => c.translator === translator && c.file === p.file && c.line === p.line)).map((p) => ({ translator, ...p, disposition: 'missing-current-key-needs-source-triage' })));
candidateResults.push(...missing);
const metrics = {};
for (const translator of TRANSLATORS) {
  const docs = allDocs.filter((d) => d.translator === translator);
  const summary = {};
  for (const name of Object.keys(docs[0].counts)) summary[name] = docs.reduce((n, d) => n + d.counts[name], 0);
  summary.documents = docs.length;
  summary.targetDocuments = docs.filter((d) => d.counts.targetedReviewRows).length;
  summary.collections = Object.fromEntries(['sn', 'an', 'kn', 'mn', 'dn'].map((collection) => [collection, Object.fromEntries(Object.keys(docs[0].counts).map((name) => [name, docs.filter((d) => d.collection === collection).reduce((n, d) => n + d.counts[name], 0)]))]));
  summary.candidateDispositions = candidateResults.filter((c) => c.translator === translator).reduce((out, c) => ({ ...out, [c.disposition]: (out[c.disposition] ?? 0) + 1 }), {});
  metrics[translator] = summary;
}
const queue = allDocs.filter((d) => d.counts.targetedReviewRows || d.counts.coverageRecordRows).map(({ verseKeys, reviewedKeys, candidates, ...d }) => d);
const ledger = allDocs.map((d) => {
  const pali = read(path.join(ROOT, Object.keys(d.inputHashes).find((p) => p.startsWith('data/pali/'))));
  const own = read(path.join(ROOT, Object.keys(d.inputHashes).find((p) => p.startsWith(`data/${d.translator}/`))));
  const markup = read(path.join(ROOT, Object.keys(d.inputHashes).find((p) => p.startsWith('data/html/'))));
  const keys = Object.keys(pali), englishKeys = Object.keys(own).filter((k) => plain(own[k]));
  const translatedUids = new Set(englishKeys.filter((k) => !title(k)).map((k) => k.split(':')[0]));
  const bodyKeys = keys.filter((k) => isBody(k, pali, markup) && translatedUids.has(k.split(':')[0]));
  const evidenceKeys = new Set(d.reviewedKeys.map((r) => r.key));
  return {
    translator: d.translator, document: d.document, collection: d.collection, inputHashes: d.inputHashes,
    paliKeys: keys, englishSegmentKeys: englishKeys, bodyKeys,
    bodyKeysOutsideTranslatedSuttas: keys.filter((k) => isBody(k, pali, markup) && !translatedUids.has(k.split(':')[0])),
    currentPaliEvidence: d.reviewedKeys.map((r) => ({ ...r, kinds: [...new Set(r.evidence.map((ref) => ref.includes('/audit5/') ? 'direct-Pali-audit-row' : 'local-Pali-boundary-judgment'))] })),
    historicalProxyEvidence: ['mn', 'dn'].includes(d.collection) ? 'data/upstream/mn-dn-review.json#completedPass (historical English-proxy reads; not credited as current Pali verification)' : null,
    counts: { paliRows: keys.length, englishSegments: englishKeys.length, bodyRows: bodyKeys.length, bodyRowsWithInventoriedPaliEvidence: bodyKeys.filter((k) => evidenceKeys.has(k)).length, bodyRowsWithoutInventoriedPaliEvidence: bodyKeys.filter((k) => !evidenceKeys.has(k)).length },
  };
});
const coverageScope = Object.fromEntries(TRANSLATORS.map((t) => [t, Object.fromEntries(Object.keys(ledger[0].counts).map((name) => [name, ledger.filter((d) => d.translator === t).reduce((n, d) => n + d.counts[name], 0)]))]));
const manifest = { ...evidenceHashes, ...Object.assign({}, ...allDocs.map((d) => d.inputHashes)) };
for (const file of ['scripts/segmenter/inventory-pali-review.mjs', 'scripts/segmenter/check-pali-inventory.mjs', 'data/upstream/mn-dn-review.json']) manifest[file] = sha(fs.readFileSync(path.join(ROOT, file)));
save(path.join(OUT, 'inputs.json'), { baselineCommit: head, hashes: manifest });
save(path.join(OUT, 'coverage-ledger.json'), {
  baselineCommit: head,
  scope: 'Every Pali key and nonempty English segment in current Bodhi/Thanissaro translation JSON files. Sujato is excluded from this inventory; final inclusion needs a separate explicit scope decision.',
  defaults: { directPaliReview: 'Not established by inventoried evidence unless currentPaliEvidence names the key; a credited key proves a local judgment or audit-row read, not complete verified correspondence.', independentVerification: 'Not established by this inventory for any key; reconcile additional historical evidence before commissioning further reads.', correspondence: 'Reviewed exact English-span/Pali-key coverage is not established by this inventory; dispositions remain unrecorded.', bodyKeysOutsideTranslatedSuttas: 'No English body in this inner sutta; retained for future coverage/omission/source-ownership disposition, outside targeted verse denominator.', otherPaliKeys: 'Headings, closing/summary material or blank Pali; outside targeted body denominator, still require final coverage disposition.' },
  documents: ledger,
});
const tsv = ['translator\tdocument\tPali_key\treasons'];
for (const d of queue) for (const r of d.reviewRows) tsv.push([d.translator, d.document, r.key, [...new Set(r.reasons.map((reason) => reason.kind))].join(',')].join('\t'));
fs.writeFileSync(path.join(OUT, 'passages.tsv.tmp'), `${tsv.join('\n')}\n`);
fs.renameSync(path.join(OUT, 'passages.tsv.tmp'), path.join(OUT, 'passages.tsv'));
save(path.join(OUT, 'candidates.json'), candidateResults);
save(path.join(OUT, 'queue.json'), { baselineCommit: head, kind: 'inventory only; no new judgments or corrections', documents: queue, missingCandidateKeys: missing });
const summary = { date: new Date().toISOString().slice(0, 10), baselineCommit: head, status: 'computed; validation pending', metrics, coverageScope, freshAuditBudget: { bodhi: 2500, thanissaro: 2500, status: 'planned, not selected; not included in queued rows' }, reusedCheckpoints: reused, newlyScannedDocuments: scanned, limits: ['Counts are translator–Pali rows, not unique Pali across translators or independent errors.', 'Earlier English-proxy reads are not credited as direct-Pali completion.', 'Matching a saved start alone does not close a candidate.', 'Credited local judgments and audit-row reads do not establish whole-document independent verification.', 'Coverage/source work can remain after a boundary is judged.', 'Two-line context is a minimum packet budget; complete stanza or source context may require more.', 'Scope is targeted verse and recorded issues; most ordinary prose is outside this new-review queue.', 'Absence of inventoried evidence is an evidence gap, not proof that a passage was never read.', 'Inherited snapshots without explicit current Pali evidence remain conservative pending work.'] };
save(path.join(OUT, 'summary.json'), summary);
progress.stages = { discoverEvidence: 'complete', scanCorpus: 'complete', reconcileCandidates: 'complete', deduplicateQueue: 'complete', validateInventory: 'pending' };
progress.status = 'computed; validation pending';
save(progressFile, progress);
execFileSync(process.execPath, [path.join(ROOT, 'scripts/segmenter/check-pali-inventory.mjs')], { cwd: ROOT, stdio: 'inherit' });
summary.status = 'complete; mechanically validated inventory, no semantic review';
save(path.join(OUT, 'summary.json'), summary);
progress.stages.validateInventory = 'complete';
progress.status = summary.status;
save(progressFile, progress);
console.log(JSON.stringify({ metrics: Object.fromEntries(Object.entries(metrics).map(([t, m]) => [t, { ...m, collections: undefined }])), missingCandidateKeys: missing.length, reusedCheckpoints: reused, newlyScannedDocuments: scanned }, null, 2));
