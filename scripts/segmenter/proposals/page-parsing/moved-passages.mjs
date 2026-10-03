import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.argv[2] ?? '/private/tmp/sutamaya-page-parsing';
const out = import.meta.dirname;
const specs = [
  ['sn1.8', 'sutta/sn/sn1/sn1.8.html', 'marked introduction'],
  ['ud7.8', 'sutta/kn/ud/vagga7/ud7.8.html', 'closing note continuation'],
  ['an3.47', 'sutta/an/an3/an3.47.html', 'alternative rendering'],
  ['an9.42', 'sutta/an/an9/an9.42.html', 'closing editorial note'],
  ['sn35.82', 'sutta/sn/sn35/sn35.82.html', 'alternative rendering'],
  ['sn48.8', 'sutta/sn/sn48/sn48.8.html', 'closing references'],
  ['an8.54', 'sutta/an/an8/an8.54.html', 'explicit inline commentary'],
  ['sn47.8', 'sutta/sn/sn47/sn47.8.html', 'explicit inline commentary'],
  ['sn20.7', 'sutta/sn/sn20/sn20.7.html', 'explicit inline commentary'],
];
const text = e => {
  const copy = e.cloneNode ? e.cloneNode(true) : e;
  for (const marker of copy.querySelectorAll?.('.fn, .footnote-ref, .ref') ?? []) marker.remove();
  return copy.textContent.replace(/\s+/g, ' ').trim();
};
const rows = [];
for (const [uid, source, cause] of specs) {
  const original = fs.readFileSync(path.join(root, 'data/upstream/thanissaro', source), 'utf8');
  const doc = new JSDOM(original).window.document;
  const paragraphs = [...doc.querySelectorAll('#sutta p')];
  let selected;
  if (uid === 'sn1.8') selected = [paragraphs[0]];
  else if (uid === 'ud7.8') selected = [...doc.querySelector('.note').parentElement.children].filter(e => e.tagName === 'P' && doc.querySelector('.note').compareDocumentPosition(e) & 4);
  else if (uid === 'an9.42') selected = [...doc.querySelectorAll('.dblock.smallcaps p')];
  else if (uid === 'sn48.8') selected = paragraphs.filter(p => !p.closest('.note') && /^See also\b/.test(text(p)));
  else if (cause === 'alternative rendering') {
    const start = paragraphs.findIndex(p => /Alternative translation:|translated as follows:\]/.test(text(p)));
    if (start < 0) throw new Error(`Missing alternative header: ${uid}`);
    selected = paragraphs.slice(start).filter(p => !p.closest('.note') && !/^See also\b/.test(text(p)));
  } else {
    const matches = [...doc.querySelector('#sutta').textContent.matchAll(/\[(?:The Commentary\b|Commentary:)[^\]]+\]/g)];
    selected = matches.map(m => ({ textContent: m[0], outerHTML: m[0] }));
  }
  if (!selected.length) throw new Error(`No passages: ${uid}`);
  const passages = selected.map((e, i) => ({ paragraph: i + 1, text: text(e), html: e.outerHTML }));
  rows.push({ translator: 'thanissaro', uid, source, cause, passages });
  const evidence = path.join(out, 'evidence', `thanissaro-${source.replaceAll('/', '_')}`);
  if (!fs.existsSync(evidence)) fs.writeFileSync(evidence, original);
}
fs.writeFileSync(path.join(out, 'moved-passages.json'), JSON.stringify(rows, null, 2) + '\n');
const lines = ['# Every newly moved commentary passage', '', 'Original page wording and paragraph order are preserved below. This lists all new movements made by the patch, including the three explicitly attributed inline asides; it does not list notes already extracted before this proposal.', ''];
for (const row of rows) {
  lines.push(`## ${row.uid}: ${row.cause}`, '', `Source: ${row.source}`, '');
  for (const p of row.passages) lines.push(p.text, '');
}
lines.push('# done');
fs.writeFileSync(path.join(out, 'moved-passages.md'), lines.join('\n') + '\n');
console.log(`${rows.length} texts; ${rows.reduce((n, r) => n + r.passages.length, 0)} separately recorded paragraphs/asides`);
