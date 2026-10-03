import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.argv[2] ?? '/private/tmp/sutamaya-page-parsing';
const out = import.meta.dirname;
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (p.endsWith('.html')) files.push(p);
  }
}
walk(path.join(root, 'data/upstream/thanissaro/sutta'));
const tails = [], intros = [];
for (const file of files) {
  const doc = new JSDOM(fs.readFileSync(file, 'utf8')).window.document;
  const text = el => el.textContent.replace(/\s+/g, ' ').trim();
  for (const note of doc.querySelectorAll('#sutta div.note, #sutta section.note')) {
    let next = note.nextElementSibling;
    const after = [];
    while (next) {
      after.push({ tag: next.tagName, class: next.className, id: next.id,
                   text: text(next).slice(0, 350) });
      next = next.nextElementSibling;
    }
    if (after.some(p => p.text && !/seealso/.test(p.class))) {
      tails.push({ file: path.relative(root, file), after });
    }
  }
  for (const sutta of doc.querySelectorAll('#sutta')) {
    for (const p of sutta.querySelectorAll('p')) {
      if (p.closest('.note, .verse')) continue;
      if (!text(p)) continue;
      const all = p.textContent.replace(/\s+/g, '');
      const italic = [...p.querySelectorAll('em, i')].map(e => e.textContent).join('').replace(/\s+/g, '');
      const share = italic.length / all.length;
      if (share >= 0.7 && share < 0.9) {
        intros.push({ file: path.relative(root, file), share, text: text(p), html: p.outerHTML });
      }
      // Inspect only the initial ordinary paragraph: later prose may legitimately use italics.
      break;
    }
  }
}
fs.writeFileSync(path.join(out, 'page-inventory.json'), JSON.stringify({ tails, intros }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ tails, introCandidates: intros.map(i => ({ file: i.file, share: i.share, text: i.text.slice(0, 240) })) }, null, 2) + '\n');
