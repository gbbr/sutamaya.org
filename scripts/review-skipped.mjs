#!/usr/bin/env node
// Inventory paragraph-local empty runs. Never changes translation or segmenter data.
// prepare: freeze multi-line packets, retaining existing eligible reader marks.
// refresh-context: correct next-English context; check: validate marks; finish: write covered.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const mode = process.argv[2] ?? 'prepare';
assert(['prepare', 'refresh-context', 'check', 'finish'].includes(mode), 'Use prepare, refresh-context, check or finish');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const plain = (s = '') => s.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160);/g, ' ').trim();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  .flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const save = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const coverageRule = 'Own content explicitly rendered; abbreviated or compressed repetitions and doubtful lines stay skipped.';
const excluded = (translator, key) => translator === 'bodhi' ? /^sn45\./.test(key)
  : /^an5\.(?:25[4-9]|26\d|27[01])(?=[:\-])/.test(key);

// Read the actual template around its placeholder, including inherited colophon/uddana roles.
function paragraphs(pali, html) {
  const stack = [], rows = [];
  let paragraph = 0;
  function tags(fragment) {
    for (const match of fragment.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
      const [, close, name, attrs] = match;
      if (close) {
        const index = stack.findLastIndex((t) => t.name === name.toLowerCase());
        if (index >= 0) stack.splice(index);
      } else if (!/\/$/.test(attrs) && !/^(?:br|hr|img|input|meta|link)$/i.test(name)) {
        const classes = /class=['"]([^'"]*)['"]/.exec(attrs)?.[1].split(/\s+/) ?? [];
        stack.push({ name: name.toLowerCase(), classes, paragraph: name === 'p' ? ++paragraph : null });
      }
    }
  }
  for (const key of Object.keys(pali)) {
    const template = html[key];
    assert(typeof template === 'string' && template.includes('{}'), `Missing markup: ${key}`);
    const [before, after] = template.split('{}');
    tags(before);
    const p = stack.findLast((t) => t.name === 'p');
    const excluded = /:0(?:\.|$)/.test(key) || !plain(pali[key]) || stack.some((t) =>
      /^h[1-6]$/.test(t.name) || t.classes.some((c) => c === 'verse-line' || c.startsWith('end') || c.includes('uddana')));
    rows.push({ key, paragraph: p?.paragraph ?? null, eligible: Boolean(p) && !excluded });
    tags(after);
  }
  return rows;
}

function inventory(translator) {
  const base = path.join(root, 'data', translator, 'sutta'), runs = [];
  const sources = {};
  for (const file of walk(base).filter((f) => f.endsWith('.json'))) {
    const rel = path.relative(base, file);
    // These pages are being remapped in other sessions. Do not read or freeze them.
    const keys = Object.keys(read(file));
    if (keys.some((key) => excluded(translator, key))) continue;
    const siblings = {
      own: file,
      pali: path.join(root, 'data/pali/sutta', rel.replace(`_translation-en-${translator}`, '_root-pli-ms')),
      html: path.join(root, 'data/html/pli/ms/sutta', rel.replace(`_translation-en-${translator}`, '_html')),
      sujato: path.join(root, 'data/sujato/sutta', rel.replace(`_translation-en-${translator}`, '_translation-en-sujato')),
    };
    const data = Object.fromEntries(Object.entries(siblings).map(([kind, f]) => {
      const text = fs.readFileSync(f, 'utf8');
      sources[path.relative(root, f)] = sha(text);
      return [kind, JSON.parse(text)];
    }));
    const { own, pali, html, sujato } = data;
    const rows = paragraphs(pali, html);
    for (let i = 0; i < rows.length; i++) {
      const anchor = rows[i];
      if (!anchor.eligible || !plain(own[anchor.key])) continue;
      const empty = [];
      let j = i + 1;
      while (j < rows.length && rows[j].eligible && rows[j].paragraph === anchor.paragraph && !plain(own[rows[j].key])) {
        assert(Object.hasOwn(own, rows[j].key), `Missing translation key: ${rows[j].key}`);
        empty.push(rows[j++].key);
      }
      if (empty.length < 2) continue;
      // Context may itself be verse or a heading, even though judged lines cannot be.
      const next = rows.slice(j).find((r) => plain(own[r.key]));
      const context = (key) => key ? { key, pali: pali[key], sujato: sujato[key] ?? '', english: own[key] } : null;
      runs.push({ id: runs.length + 1, file: path.relative(root, file), paragraph: anchor.paragraph,
        above: context(anchor.key), lines: empty.map(context), below: context(next?.key),
        belowInSameParagraph: next?.paragraph === anchor.paragraph });
    }
  }
  return { translator, ordering: 'Natural file-path order, then Pali JSON insertion order', sources, runs };
}

function packet(runs, translator, batch) {
  const output = [
    `${translator}: skipped-Pali review batch ${batch}`,
    'Read the full English above, each original Pali line, and the next English. Sujato is context only.',
    'covered = this line\'s own content is explicitly rendered by the English above, including complete lists.',
    'skipped = abbreviated or compressed repetition, even if mentioned, or omitted. When in doubt, skipped.',
    'Judge each key independently; a run may be mixed. An ellipsis alone does not decide.',
    'Only runs of two or more empty prose lines in the same paragraph are reviewed; lone lines join automatically.',
    'Write <key> covered|skipped|unsure for every RUN key, then # done. Do not mark context keys.',
  ];
  const show = (label, line) => {
    if (!line) { output.push(`${label}: (none)`); return; }
    output.push(`${label} ${line.key}`, `Pali: ${line.pali}`, `Sujato: ${line.sujato || '(empty)'}`, `Translator: ${line.english || '(empty)'}`);
  };
  for (const run of runs) {
    output.push('', `=== RUN ${run.id}: ${run.lines.map((l) => l.key).join(' ')} ===`, `File: ${run.file}`);
    show('ABOVE', run.above);
    for (const line of run.lines) show('JUDGE', line);
    show(`BELOW${run.belowInSameParagraph ? '' : ' (outside this paragraph)'}`, run.below);
  }
  return `${output.join('\n')}\n`;
}

const outputs = [];
for (const translator of ['bodhi', 'thanissaro']) {
  const directory = path.join(root, 'data', translator, 'review/skipped');
  const current = inventory(translator);
  const judged = current.runs;
  const counts = { runs: judged.length, lines: judged.reduce((n, r) => n + r.lines.length, 0) };
  if (mode === 'prepare' || mode === 'refresh-context') {
    const retained = new Map();
    if (fs.existsSync(directory)) {
      for (const file of fs.readdirSync(directory).filter((f) => /^batch-\d+\.marks$/.test(f))) {
        for (const line of fs.readFileSync(path.join(directory, file), 'utf8').split('\n')) {
          const match = /^(\S+) (covered|skipped|unsure)$/.exec(line);
          if (match) retained.set(match[1], match[2]);
        }
      }
    }
    if (mode === 'refresh-context') {
      const frozen = read(path.join(directory, 'inventory.json'));
      const withoutBelow = (runs) => runs.map(({ below, belowInSameParagraph, ...run }) => run);
      assert.deepEqual(withoutBelow(current.runs), withoutBelow(frozen.runs), `${translator}: judged inputs changed`);
    }
    fs.mkdirSync(directory, { recursive: true });
    save(path.join(directory, 'inventory.json'), current);
    const batches = Math.ceil(judged.length / 50);
    // Retire old batch files when the changed scope needs fewer packets.
    for (const file of fs.readdirSync(directory).filter((f) => /^batch-\d+\.(txt|marks)$/.test(f))) {
      if (Number(file.match(/\d+/)[0]) > batches) fs.unlinkSync(path.join(directory, file));
    }
    for (let i = 0; i < judged.length; i += 50) {
      const batch = String(i / 50 + 1).padStart(3, '0');
      fs.writeFileSync(path.join(directory, `batch-${batch}.txt`), packet(judged.slice(i, i + 50), translator, batch));
      const expected = judged.slice(i, i + 50).flatMap((r) => r.lines.map((l) => l.key));
      const marks = expected.filter((key) => retained.has(key)).map((key) => `${key} ${retained.get(key)}`);
      fs.writeFileSync(path.join(directory, `batch-${batch}.marks`), `${marks.join('\n')}${marks.length ? '\n' : ''}${marks.length === expected.length ? '# done\n' : ''}`);
    }
    save(path.join(directory, 'progress.json'), { status: 'reviewing multi-line runs; lone lines and mechanical marks removed', counts, batches });
  } else {
    const frozen = read(path.join(directory, 'inventory.json'));
    assert.deepEqual(current.runs, frozen.runs, `${translator}: prose inventory changed; reconcile before continuing`);
    const marks = { covered: [], skipped: [], unsure: [] };
    const byKey = new Map();
    let completed = 0;
    for (let i = 0; i < judged.length; i += 50) {
      const batch = String(i / 50 + 1).padStart(3, '0');
      const file = path.join(directory, `batch-${batch}.marks`);
      assert.equal(fs.readFileSync(path.join(directory, `batch-${batch}.txt`), 'utf8'), packet(judged.slice(i, i + 50), translator, batch));
      if (!fs.existsSync(file)) continue;
      const expected = judged.slice(i, i + 50).flatMap((r) => r.lines.map((l) => l.key));
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      const done = lines.at(-1) === '# done';
      if (done) lines.pop();
      if (done) assert.equal(lines.length, expected.length, `Wrong mark count: ${file}`);
      let previous = -1;
      lines.forEach((line, n) => {
        const match = /^(\S+) (covered|skipped|unsure)$/.exec(line);
        const index = match ? expected.indexOf(match[1]) : -1;
        assert(match && index > previous && !byKey.has(match[1]), `Invalid/out-of-order mark: ${file}: ${line}`);
        previous = index;
        byKey.set(match[1], match[2]);
        marks[match[2]].push(match[1]);
      });
      if (done) completed++;
    }
    if (mode === 'finish') {
      assert.equal(completed, Math.ceil(judged.length / 50), `${translator}: unfinished batches`);
      assert.equal(marks.unsure.length, 0, `${translator}: unresolved marks`);
      const input = read(path.join(directory, 'audit-input.json'));
      const audit = read(path.join(directory, 'rule-check.json'));
      assert(audit.complete && audit.rule === coverageRule && audit.input_marks_sha256 === input.marks_sha256,
        `${translator}: covered rule check is incomplete or stale`);
      const audited = new Map();
      const candidates = input.records.filter((r) => r.first_verdict === 'covered');
      assert.equal(audit.records.length, candidates.length, `${translator}: incomplete covered check`);
      audit.records.forEach((record, i) => {
        const expected = candidates[i];
        assert.equal(record.key, expected.key);
        assert.equal(record.first_verdict, expected.first_verdict);
        assert(['covered', 'skipped'].includes(record.verdict) && record.reason, `${translator}: incomplete audit verdict`);
        assert(!audited.has(record.key), `${translator}: duplicate audit key`);
        assert.equal(byKey.get(record.key), record.verdict, `${translator}: reconcile audited mark ${record.key}`);
        const run = judged.find((r) => r.lines.some((l) => l.key === record.key));
        assert.deepEqual(expected.run, run, `${translator}: audit inputs changed`);
        audited.set(record.key, record);
      });
      assert(marks.covered.every((key) => audited.get(key)?.verdict === 'covered'), `${translator}: unaudited covered key`);
      const changed = audit.records.filter((r) => r.verdict === 'skipped').length;
      assert.equal(audit.changed, changed);
      assert.equal(audit.covered_checked, candidates.length);
      // Reconstruct the first pass; only reviewed covered marks may change.
      const original = fs.readdirSync(directory).filter((f) => /^batch-\d+\.marks$/.test(f)).sort()
        .map((f) => fs.readFileSync(path.join(directory, f), 'utf8').replace(/^(\S+) (covered|skipped|unsure)$/gm,
          (line, key) => audited.has(key) ? `${key} ${audited.get(key).first_verdict}` : line)).join('');
      assert.equal(sha(original), input.marks_sha256, `${translator}: unaudited marks changed`);
      // Inventory already establishes Pali membership, empty prose, paragraph and run length.
      outputs.push({ translator, changed, keys: judged.flatMap((r) => r.lines.map((l) => l.key)).filter((key) => byKey.get(key) === 'covered') });
    }
    console.log(JSON.stringify({ translator, completed, judged: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v.length])), unsure: marks.unsure }));
  }
  console.log(JSON.stringify({ translator, counts, batches: Math.ceil(judged.length / 50) }));
}
if (mode === 'finish') {
  // Validate both translators before writing either output. Skipped samples are retired.
  for (const { translator, changed, keys } of outputs) {
    save(path.join(root, 'data', translator, 'covered.json'), keys);
    console.log(JSON.stringify({ translator, covered: keys.length, changed }));
  }
}
