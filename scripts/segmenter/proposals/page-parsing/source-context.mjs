import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const out = import.meta.dirname;
const scan = JSON.parse(fs.readFileSync(path.join(out, 'scan.json'), 'utf8'));
const docs = new Map();
const norm = s => s.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const results = [];
for (const c of scan.candidates) {
  const sources = [];
  for (const file of c.sources) {
    const local = path.join(out, 'evidence', `${c.translator}-${file.replaceAll('/', '_')}`);
    if (!docs.has(local)) {
      const doc = new JSDOM(fs.readFileSync(local, 'utf8')).window.document;
      for (const marker of doc.querySelectorAll('.ref, .fn, .footnote-ref, .footnote-back')) marker.remove();
      docs.set(local, doc);
    }
    const doc = docs.get(local);
    let needle = norm(c.english).split(' ').slice(0, 8).join(' ');
    let matches = [...doc.querySelectorAll('p')].filter(p => norm(p.textContent).includes(needle));
    if (!matches.length) {
      needle = norm(c.english).split(' ').slice(0, 3).join(' ');
      matches = [...doc.querySelectorAll('p, h2, h3')].filter(p => norm(p.textContent).includes(needle));
    }
    sources.push({ file, needle, matches: matches.map(p => ({
      html: p.outerHTML,
      text: p.textContent.replace(/\s+/g, ' ').trim(),
      ancestors: [...function* () { for (let e = p; e; e = e.parentElement) yield `${e.tagName}${e.id ? '#' + e.id : ''}${e.className ? '.' + String(e.className).replaceAll(' ', '.') : ''}`; }()],
    })) });
  }
  results.push({ number: c.number, translator: c.translator, key: c.key, sources });
}
fs.writeFileSync(path.join(out, 'source-contexts.json'), JSON.stringify(results, null, 2) + '\n');
for (const r of results) {
  const matches = r.sources.flatMap(s => s.matches);
  process.stdout.write(`${r.number} ${r.translator} ${r.key}: ${matches.length} paragraph matches; ${matches.map(m => m.ancestors.slice(0, 3).join(' < ')).join('; ')}\n`);
}
