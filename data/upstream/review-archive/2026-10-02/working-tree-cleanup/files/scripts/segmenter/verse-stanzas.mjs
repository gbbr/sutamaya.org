#!/usr/bin/env node
// Puts up the verse round: each stanza of a translation line by line with its Pali, Sujato's English
// and the translation's text, for Opus to cut by the Pali (data/upstream/README.md's "Reviewing new
// and revised texts"), and the check of what the round changes.
//
// Run from the repository's root:
//
//   node scripts/segmenter/verse-stanzas.mjs <translator> put <folder> [<text>…]
//       writes the stanzas of the texts named, as their files in data/<translator>/sutta/ are
//       named, or of every text, to review/<folder>/, 50 stanzas to a batch; neighbouring stanzas
//       of a text are shown together, with the line before and after them
//   node scripts/segmenter/verse-stanzas.mjs <translator> check <path> [<seed>]
//       writes 50 of the passing groups in review/findings.json to <path>, each line with its
//       Pali, for Opus to judge
import fs from 'node:fs';
import path from 'node:path';
import { buildBodySegments, stripHtmlTags } from '../lib/collections.js';

const DATA = path.join(import.meta.dirname, '..', '..', 'data');
const [translator, command, target, ...rest] = process.argv.slice(2);
if (!['bodhi', 'thanissaro'].includes(translator) || !['put', 'check'].includes(command) || !target) {
  console.error('usage: verse-stanzas.mjs <bodhi|thanissaro> put <folder> [<text>…] | check <path> [<seed>]');
  process.exit(1);
}
const REVIEW = path.join(DATA, translator, 'review');
// Stanzas to a batch.
const BATCH = 50;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}
const docOf = (file) => path.basename(file).split('_')[0];
const index = (dir) => new Map(walk(dir).map((f) => [docOf(f), f]));
const load = (file) => (file && fs.existsSync(file) ? new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) : new Map());
const plain = (text) => stripHtmlTags((text || '').replace(/<j>/g, '')).replace(/\s+/g, ' ').trim();
const suttaOf = (key) => key.slice(0, key.indexOf(':'));
const isTitle = (key) => /^0(\.|$)/.test(key.slice(key.indexOf(':') + 1));

// Returns a text's stanzas, each a list of its lines: the Pali's verse paragraphs, by its markup, of
// two lines or more, in the suttas the translation covers, where the translation has text.
function stanzasOf(doc, file, pali, sujato, html) {
  const own = load(file), paliMap = load(pali.get(doc)), sujMap = load(sujato.get(doc)), htmlMap = load(html.get(doc));
  const covered = new Set([...own].filter(([k, v]) => !isTitle(k) && plain(v)).map(([k]) => suttaOf(k)));
  const everything = new Map([...paliMap.keys()].map((k) => [k, 'x']));
  const roles = new Map(buildBodySegments(paliMap, everything, htmlMap, new Map()).map((s) => [s.key, s.role]));
  const keys = [...paliMap.keys()];
  const line = (k) => k && { key: k, pali: (paliMap.get(k) || '').trim(), sujato: plain(sujMap.get(k)), text: plain(own.get(k)) };
  // Each line's paragraph: a new one opens at a block's opening tag and after its closing one.
  let paragraph = 0;
  const groups = new Map();
  for (const k of keys) {
    const template = htmlMap.get(k) || '';
    if (!template || /<(p|h\d|li|blockquote|dd|dt|tr|td)\b/.test(template)) paragraph++;
    if (roles.get(k) === 'verse' && covered.has(suttaOf(k))) {
      if (!groups.has(paragraph)) groups.set(paragraph, []);
      groups.get(paragraph).push(k);
    }
    if (/<\/(p|h\d|li|dd|dt|td)>/.test(template)) paragraph++;
  }
  return [...groups.values()]
    .filter((ks) => ks.length > 1 && ks.some((k) => plain(own.get(k))))
    .map((ks) => ({ doc, lines: ks.map(line), before: line(keys[keys.indexOf(ks[0]) - 1]), after: line(keys[keys.indexOf(ks.at(-1)) + 1]) }));
}

const row = (l, context) => `${context ? '(context) ' : ''}${l.key} | P: ${l.pali} | S: ${l.sujato || '(none)'} | T: ${l.text || '(none)'}`;

if (command === 'put') {
  const out = path.join(REVIEW, target);
  if (fs.existsSync(path.join(out, 'batch-001.txt'))) {
    console.error(`${out} already holds a round; name a new folder`);
    process.exit(1);
  }
  const pali = index(path.join(DATA, 'pali', 'sutta'));
  const sujato = index(path.join(DATA, 'sujato', 'sutta'));
  const html = index(path.join(DATA, 'html', 'pli', 'ms', 'sutta'));
  const files = walk(path.join(DATA, translator, 'sutta')).filter((f) => !rest.length || rest.includes(docOf(f)));
  const stretches = [];
  for (const f of files) {
    for (const st of stanzasOf(docOf(f), f, pali, sujato, html)) {
      const last = stretches.at(-1);
      if (last && last.doc === st.doc && last.stanzas.at(-1).after?.key === st.lines[0].key) last.stanzas.push(st);
      else stretches.push({ doc: st.doc, stanzas: [st] });
    }
  }
  fs.mkdirSync(out, { recursive: true });
  let batch = 0, count = 0, items = [];
  const flush = () => {
    if (!items.length) return;
    const name = `batch-${String(++batch).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(out, name), `${items.join('\n\n')}\n`);
    console.log(`${name}: ${count} stanzas in ${items.length} stretches`);
    count = 0;
    items = [];
  };
  for (const s of stretches) {
    const lines = [];
    if (s.stanzas[0].before) lines.push(row(s.stanzas[0].before, true));
    for (const st of s.stanzas) for (const l of st.lines) lines.push(row(l, false));
    if (s.stanzas.at(-1).after) lines.push(row(s.stanzas.at(-1).after, true));
    items.push(`## ${items.length + 1} ${s.doc}\n${lines.join('\n')}`);
    count += s.stanzas.length;
    if (count >= BATCH) flush();
  }
  flush();
  if (!batch) console.log('no stanzas');
} else {
  const report = JSON.parse(fs.readFileSync(path.join(REVIEW, 'findings.json'), 'utf8'));
  const pool = report.groups.filter((g) => g.verdict === 'passes');
  const pali = new Map();
  for (const f of walk(path.join(DATA, 'pali', 'sutta'))) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) pali.set(k, v.trim());
  let seed = Number(rest[0] ?? 1);
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const picked = [];
  while (pool.length && picked.length < 50) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  const name = translator === 'bodhi' ? 'Bodhi' : 'Ṭhānissaro';
  const items = picked.map((g, i) => [
    `## ${i + 1} (${name}, ${g.text})`,
    ...g.lines.map((l) => `${l.key} | P: ${pali.get(l.key) ?? ''} | S: ${l.sujato ?? '(none)'}\n    Before: ${l.before || '(none)'}\n    After:  ${l.after || '(none)'}`),
  ].join('\n'));
  fs.writeFileSync(target, `${items.join('\n\n')}\n`);
  console.log(`${picked.length} of ${picked.length + pool.length} passing groups written to ${target}`);
}
