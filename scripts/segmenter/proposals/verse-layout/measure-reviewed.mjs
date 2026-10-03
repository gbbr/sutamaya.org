// Run only in an isolated copy with the patch applied: node scripts/segmenter/proposals/verse-layout/measure-reviewed.mjs <translator>.
// Extract the production parser/layout functions before the CLI's writing stages. The measured
// function is the segmenter's own layoutVerse, and receives no cuts or reviewed distributions.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

fs.mkdirSync('prototype', { recursive: true });
const translator = process.argv[2];
if (!['bodhi', 'thanissaro'].includes(translator)) throw new Error('Expected bodhi or thanissaro');
const source = fs.readFileSync('scripts/segmenter/segment-translations.mjs', 'utf8');
const beforeRun = source.slice(0, source.indexOf('// Running it'));
const parse = source.slice(source.indexOf('const pages ='), source.indexOf('// The words this translator uses'));
const segments = source.slice(source.indexOf('function segmentsOf('), source.indexOf('// Returns the places in `text`'));
const apiPath = path.resolve('scripts/segmenter/.measure-verse.mjs');
fs.writeFileSync(apiPath, `${beforeRun}\n${parse}\nconst decisions = {};\n${segments}\nfor (const [s, ts] of Object.entries(readJson(path.join(OUT, 'learned.json')))) learned.set(idOf(s), ts.map(idOf));\nexport { units, layoutVerse, segmentsOf, spreadVerses };\n`);
const { units, layoutVerse, segmentsOf, spreadVerses } = await import(pathToFileURL(apiPath));
const manifest = JSON.parse(fs.readFileSync(`data/${translator}/review/verse/manifest.json`, 'utf8'));
const records = Array.isArray(manifest.verses) ? manifest.verses : manifest.batches.flatMap(b => b.items);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const norm = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const goldDir = fs.existsSync(`baseline/data/${translator}/sutta`) ? `baseline/data/${translator}/sutta` : `data/${translator}/sutta`;
const gold = new Map(walk(goldDir).filter(f => f.endsWith('.json')).flatMap(f => Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))));
const byKey = new Map();
for (const unit of units) for (const line of unit.body) byKey.set(line.key, unit);
const offsets = new Map(units.map(unit => {
  const chars = [...unit.stream.text.matchAll(/\S/g)];
  return [unit, { text: chars.map(c => c[0]).join(''), at: chars.map(c => c.index) }];
}));
const seen = new Map();
const all = [];
let guardChecked = 0;
for (const verse of records) {
  const first = verse.first ?? verse.keys[0];
  const unit = byKey.get(first);
  const body = unit ? verse.keys.map(key => unit.body.find(line => line.key === key)) : [];
  const expected = verse.keys.map(key => norm(gold.get(key) ?? ''));
  const record = { key: first, keys: verse.keys, expected };
  if (expected.every(s => !s)) { all.push({ ...record, status: 'omitted', exact: true }); continue; }
  if (!unit || body.some(line => !line)) { all.push({ ...record, status: 'no source unit', exact: false }); continue; }
  const flat = offsets.get(unit), needle = expected.join(' ').replace(/\s/g, '');
  // The answer supplies only the whole verse's envelope. Withhold its internal row starts.
  let at = flat.text.indexOf(needle, seen.get(unit) ?? 0);
  if (at < 0) at = flat.text.indexOf(needle);
  if (at < 0) { all.push({ ...record, status: 'source-not-found', exact: false }); continue; }
  seen.set(unit, at + needle.length);
  const start = flat.at[at], end = flat.at[at + needle.length - 1] + 1;
  const proposal = layoutVerse(unit.stream, body, start, end);
  record.start = start;
  record.end = end;
  record.status = proposal.reason ?? 'measured';
  record.proposed = proposal.results ? segmentsOf(proposal.results, unit.stream.text).segText : null;
  record.exact = record.proposed?.every((s, i) => s === expected[i]) ?? false;
  // Source cuts and gold cuts are disclosed separately; they do not feed the inference.
  const blocks = unit.stream.blocks.filter(b => b.at >= start && b.at < end);
  const starts = [start, ...blocks.filter((b, i) => b.at > start && b.kind !== 'spk' && blocks[i - 1]?.kind !== 'spk').map(b => b.at), end];
  record.sourceLines = starts.slice(0, -1).map((s, i) => norm(unit.stream.text.slice(s, starts[i + 1])));
  record.equalCount = record.sourceLines.length === body.length;
  if (!record.exact) {
    let cursor = at;
    const goldStarts = expected.filter(Boolean).map(s => { const result = flat.at[cursor]; cursor += s.replace(/\s/g, '').length; return result; });
    record.cause = proposal.reason ?? (goldStarts.some(s => !starts.includes(s)) ? 'reviewed cut inside source line'
      : !expected[0] ? 'speaker or first-row ownership'
      : expected.filter(Boolean).length < Math.min(record.sourceLines.length, body.length) ? 'reviewed grouping or omissions'
      : record.sourceLines.length > body.length ? 'grouping of excess source lines' : 'gap placement');
  }
  // Test preservation independently from inference by feeding the settled rows to the guard.
  let cursor = start;
  const current = body.map((line, i) => {
    if (!expected[i]) return { key: line.key, start: cursor, end: cursor, empty: true, merged: false };
    const from = cursor;
    const compact = expected[i].replace(/\s/g, '');
    const index = flat.at.indexOf(cursor);
    const finish = flat.at[index + compact.length - 1] + 1;
    cursor = finish;
    while (/\s/.test(unit.stream.text[cursor] ?? '') && cursor < end) cursor++;
    return { key: line.key, start: from, end: cursor, empty: false, merged: false };
  });
  const original = JSON.stringify(current);
  spreadVerses(unit.stream, body, current, {}, {}, new Set(verse.keys));
  if (JSON.stringify(current) !== original) throw new Error(`Guard changed ${first}`);
  guardChecked++;
  all.push(record);
}
const summarize = verses => ({ total: verses.length, exact: verses.filter(v => v.exact).length,
  different: verses.filter(v => v.status === 'measured' && !v.exact).length,
  declined: verses.filter(v => !['measured', 'omitted'].includes(v.status)).length,
  omitted: verses.filter(v => v.status === 'omitted').length });
const summary = { all: summarize(all), translated: summarize(all.filter(v => v.status !== 'omitted')), guardChecked,
  causes: Object.fromEntries([...new Set(all.filter(v => !v.exact).map(v => v.cause ?? v.status))].map(cause => [cause, all.filter(v => !v.exact && (v.cause ?? v.status) === cause).length])) };
fs.writeFileSync(`prototype/measured-${translator}.json`, JSON.stringify(all, null, 2) + '\n');
fs.writeFileSync(`prototype/summary-${translator}.json`, JSON.stringify(summary, null, 2) + '\n');
fs.unlinkSync(apiPath);
console.log(translator, JSON.stringify(summary, null, 2));
