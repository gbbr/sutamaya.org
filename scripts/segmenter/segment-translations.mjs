#!/usr/bin/env node
// Splits another translator's English, as its source publishes it, into the Pali's segments, the way
// data/sujato is split, so each line of the translation sits on the Pali line it translates.
//
//   node scripts/segmenter/segment-translations.mjs <bodhi|thanissaro> [--only name,…]
//                                                  [--findings] [--keep-findings]
//
// Reads data/upstream/<translator>/, with the references.json and page-layouts.json beside its
// output, and writes data/<translator>/, in data/sujato's layout:
//   sutta/…_translation-en-<translator>.json  every Pali key of a document, its English or ""
//   notes/…_comment-en-<translator>.json      the translator's notes; the introduction and "see also"
//                                             sit on the sutta's title line, or its first line
//                                             where it has none
//   cuts.json                                 what a review settled for a line, kept across runs
//   learned.json                              the translator's words learned for Sujato's
//   report.json                               each text's alignment and how sure it is
//   review/findings.json                      with --findings, what a round's findings change
//
// The English is only ever cut, never rewritten: a text whose segments, joined, aren't word for word
// the text of its page, read a second way, is reported and not written. A line is written with a
// little markup over its words:
//   "\n"                     – where a verse line of the translator's starts inside it
//   <p>, <ul><li>            – his paragraphs sharing a Pali line, and his bulleted list items
//   <div class="…"><p>       – his iblock/sq-list items recognized by their paragraph endings
//   <span class="heading">   – round a heading of his inside it, which no Pali heading line holds, or
//                              a sutta's title no title line holds, at the start of its text
//   <span class="speaker">   – his source-marked speaker label, including one inline before prose
//   <a href>                 – a reference in his text to another sutta, which takes the app's form
//                              ("as in 3:2" becomes "as in AN3.2"), from references.json

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { formatRef } from '../lib/collections.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DATA = path.join(ROOT, 'data');

const args = process.argv.slice(2);
const translator = args[0];
if (!['bodhi', 'thanissaro'].includes(translator)) {
  console.error('usage: segment-translations.mjs <bodhi|thanissaro> [--only name,…] [--findings] [--keep-findings]');
  process.exit(1);
}
const listArg = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : new Set(args[i + 1].split(','));
};
const only = listArg('--only');
// --findings: tries a round's findings (review/*/*.findings), and writes review/findings.json: what
// each group of them changes, whether it passes, and the lines readers disagree on, with what each
// proposed.
const weighing = args.includes('--findings') || args.includes('--keep-findings');
// --keep-findings: as --findings, and keeps the findings that pass in cuts.json.
const keepFindings = args.includes('--keep-findings');

const UPSTREAM = path.join(DATA, 'upstream', translator);
const OUT = path.join(DATA, translator);
const REVIEW = path.join(OUT, 'review');

// ---------------------------------------------------------------------------------------------
// The Pali side: documents, their keys, Sujato's English and the markup

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
// The pages given whole to each app text they cover (data/upstream/README.md's "Segmenting").
const wholePages = readJson(path.join(OUT, 'page-layouts.json')).wholePages ?? {};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// The folder under sutta/ that holds each Pali document, "sn/sn22" for "sn22.57".
const docDir = new Map();
for (const file of walk(path.join(DATA, 'pali/sutta'))) {
  const m = /^(.*)_root-pli-ms\.json$/.exec(path.basename(file));
  if (m) docDir.set(m[1], path.relative(path.join(DATA, 'pali/sutta'), path.dirname(file)));
}

// The document holding each uid: its own, or the batch it's in ("an1.47" is in "an1.41-50").
const uidDoc = new Map();
for (const doc of docDir.keys()) uidDoc.set(doc, doc);
for (const doc of docDir.keys()) {
  const range = /^(.*?)(\d+)-(\d+)$/.exec(doc);
  if (range) for (let n = +range[2]; n <= +range[3]; n++) if (!uidDoc.has(range[1] + n)) uidDoc.set(range[1] + n, doc);
}

const docs = new Map();
function loadDoc(doc) {
  if (!docs.has(doc)) {
    const dir = docDir.get(doc);
    docs.set(doc, {
      dir,
      pali: readJson(path.join(DATA, 'pali/sutta', dir, `${doc}_root-pli-ms.json`)),
      en: readJson(path.join(DATA, 'sujato/sutta', dir, `${doc}_translation-en-sujato.json`)),
      html: readJson(path.join(DATA, 'html/pli/ms/sutta', dir, `${doc}_html.json`)),
    });
  }
  return docs.get(doc);
}

// Returns the uids an upstream file's name covers: its own, or each of a span's ("sn15.14-19"), or
// of several spans' ("an1.21-30,39-40").
function uidsOf(name) {
  if (docDir.has(name)) return [name];
  const [first, ...more] = name.split(',');
  const range = /^(.*?)(\d+)-(\d+)$/.exec(first);
  if (!range) return [name];
  const uids = [];
  for (const span of [`${range[2]}-${range[3]}`, ...more]) {
    const [from, to = from] = span.split('-');
    for (let n = +from; n <= +to; n++) uids.push(range[1] + n);
  }
  const covered = new Set(uids);
  return [...new Set(uids.map((uid) => {
    const doc = uidDoc.get(uid);
    const grouped = /^(.*?)(\d+)-(\d+)$/.exec(doc ?? '');
    if (!grouped || !Object.keys(loadDoc(doc).pali).every((key) => key.startsWith(`${doc}:`))) return uid;
    for (let n = +grouped[2]; n <= +grouped[3]; n++) if (!covered.has(grouped[1] + n)) return uid;
    return doc;
  }))];
}

// Returns the Pali lines of the uids `uids`, in order, each with what the alignment reads from it.
function targetsFor(uids) {
  const lines = [];
  const seen = new Set();
  for (const uid of uids) {
    const doc = uidDoc.get(uid);
    if (!doc) continue;
    const d = loadDoc(doc);
    for (const key of Object.keys(d.pali)) {
      if (seen.has(key)) continue;
      const lineUid = key.slice(0, key.indexOf(':'));
      if (doc !== uid && lineUid !== uid) continue;
      seen.add(key);
      const segId = key.slice(key.indexOf(':') + 1);
      const tpl = d.html[key] ?? '';
      const opening = tpl.slice(0, tpl.indexOf('{}'));
      lines.push({
        key,
        doc,
        pali: d.pali[key].trim(),
        en: (d.en[key] ?? '').trim(),
        title: segId === '0' || segId.startsWith('0.'),
        suttaTitle: /<h1/.test(opening),
        heading: /<h[2-6]/.test(opening),
        verse: /verse-line/.test(tpl),
        paraStart: /<(p|li|h\d|blockquote)\b/.test(opening),
      });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The translator's side: each upstream page read into blocks of text

// Links from dhammatalks.org pages to the texts they hold, so a note's links open in the app.
const sources = readJson(path.join(UPSTREAM, 'sources.json')).files ?? {};
const pageUid = new Map();
for (const [file, urls] of Object.entries(sources)) {
  const name = path.basename(file, '.html');
  for (const url of [urls].flat()) pageUid.set(url.replace(/^https?:\/\/www\.dhammatalks\.org/, ''), uidsOf(name)[0]);
}

// The Dhammapada's chapter for each of its endnotes, by the note's id, from the chapters' links to them.
const noteChapter = new Map();
for (const file of Object.keys(sources).filter((f) => f.startsWith('sutta/kn/dhp/'))) {
  const html = fs.readFileSync(path.join(UPSTREAM, file), 'utf8');
  for (const [, id] of html.matchAll(/endnotes\.html#(dhp-note\d+)/g)) noteChapter.set(id, uidsOf(path.basename(file, '.html'))[0]);
}
// A note no chapter links to belongs to the chapter of the note before it.
if (fs.existsSync(path.join(UPSTREAM, 'notes/kn/dhp/endnotes.html'))) {
  let chapter;
  for (const [, id] of fs.readFileSync(path.join(UPSTREAM, 'notes/kn/dhp/endnotes.html'), 'utf8').matchAll(/\bid="(dhp-note\d+)"/g)) {
    chapter = noteChapter.get(id) ?? chapter;
    if (chapter) noteChapter.set(id, chapter);
  }
}

// Returns a link's target as the app reads note links: a SuttaCentral link for a text the app
// holds, else an absolute link to its source.
function fixHref(href) {
  if (href.startsWith('#')) return null;
  const local = href.replace(/^https?:\/\/www\.dhammatalks\.org/, '');
  const [page, hash] = local.split('#');
  // A link to one of the Dhammapada's endnotes opens the chapter that note belongs to.
  const uid = page.endsWith('/endnotes.html') && noteChapter.has(hash) ? noteChapter.get(hash) : pageUid.get(page);
  if (uid) return `https://suttacentral.net/${uid}${hash ? `#${hash}` : ''}`;
  return local.startsWith('/') ? `https://www.dhammatalks.org${local}` : href;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns an element's inner HTML with its links fixed and every other tag but <i> dropped.
function noteHtml(el) {
  const inner = (el) => {
    let html = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) html += escapeHtml(node.data);
      else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        // A note's link back to its marker, and a marker's number.
        if (node.matches('a.footnote-back, span.fn, a.footnote-ref')) continue;
        const within = inner(node);
        if (tag === 'p' || tag === 'div') html += ` ${within} `;
        else if (tag === 'a') {
          const href = node.getAttribute('href') && fixHref(node.getAttribute('href'));
          html += href ? `<a href='${href}'>${within}</a>` : within;
        } else if (tag === 'em' || tag === 'i') html += `<i>${within}</i>`;
        else html += within;
      }
    }
    return html;
  };
  return inner(el).replace(/\s+/g, ' ').trim();
}

// Returns a note's HTML without its number, inside any tag it opens with.
const unnumbered = (html) => html.replace(/^((?:<[^>]+>\s*)*)\d+\.\s*/, '$1');

// SuttaCentral's SC and PTS numbers.
const REF = 'a.ref';
// A note marker, in either of dhammatalks.org's styles.
const NOTE_MARK = 'span.fn, a.footnote-ref';
// Elements whose text is not the translation's; each parser marks the others it leaves out.
const NOT_TEXT = `${REF}, ${NOTE_MARK}, [data-skip]`;
const skip = (el) => el.setAttribute('data-skip', '');

// inlineText returns an element's text with note offsets, speaker ranges and a "\n" for each <br>.
function inlineText(el, acc = { text: '', marks: [], speakers: [] }) {
  const start = acc.text.length;
  for (const node of el.childNodes) {
    if (node.nodeType === 3) acc.text += node.data;
    else if (node.nodeType === 1) {
      if (node.matches(REF)) continue;
      if (node.matches(NOTE_MARK)) {
        const href = (node.matches('a') ? node : node.querySelector('a'))?.getAttribute('href') ?? '';
        acc.marks.push({ at: acc.text.length, id: href.replace(/^#/, '') });
        continue;
      }
      if (node.tagName.toLowerCase() === 'br') acc.text += '\n';
      else inlineText(node, acc);
    }
  }
  if (el.matches('span.speaker, p.vspk')) {
    acc.speakers.push([start, acc.text.length]);
  }
  return acc;
}

const INLINE = new Set(['a', 'abbr', 'b', 'br', 'cite', 'em', 'i', 'mark', 'q', 'small', 'span', 'strong', 'sub', 'sup', 'u']);

// Calls `block` with each block-level child of `el`, and with each run of text and inline elements
// between them, wrapped in a <p> the way a browser boxes them.
function eachBlock(el, block) {
  let run = [];
  const flush = () => {
    if (run.some((node) => node.textContent.trim())) {
      const p = el.ownerDocument.createElement('p');
      for (const node of run) p.append(node.cloneNode(true));
      block(p);
    }
    run = [];
  };
  for (const node of el.childNodes) {
    if (node.nodeType === 3 || (node.nodeType === 1 && INLINE.has(node.tagName.toLowerCase()))) run.push(node);
    else if (node.nodeType === 1) {
      flush();
      block(node);
    }
  }
  flush();
}

// collapse returns whitespace-normalized text, preserving newlines and moving note and speaker offsets.
function collapse({ text, marks, speakers = [] }) {
  let out = '';
  const map = new Int32Array(text.length + 1);
  for (let i = 0; i < text.length; ) {
    map[i] = out.length;
    if (/\s/.test(text[i])) {
      let j = i;
      let newline = false;
      while (j < text.length && /\s/.test(text[j])) {
        newline ||= text[j] === '\n';
        map[j++] = out.length;
      }
      out += newline ? '\n' : ' ';
      i = j;
    } else out += text[i++];
  }
  map[text.length] = out.length;
  const lead = out.length - out.trimStart().length;
  const trimmed = out.trim();
  const at = offset => Math.min(Math.max(map[offset] - lead, 0), trimmed.length);
  return {
    text: trimmed, marks: marks.map((m) => ({ id: m.id, at: at(m.at) })),
    speakers: speakers.map(([from, to]) => [at(from), at(to)]),
  };
}

// Returns the blocks of an element's text, one per line.
//   kind – the first line's kind; later lines are verse lines ("v")
function blocksOf(el, kind) {
  const { text, marks, speakers } = collapse(inlineText(el));
  // The passage notes printed in the text, each with its extent.
  const notes = [];
  const annotations = [...el.querySelectorAll('span.pe, span.add')];
  // A passage note some pages print without its span.
  if (/^\(?\s*(?:Identical\b|These .*suttas\b|Here follows\b|To be (?:elaborated|completed)\b|The (?:verses|rest|remainder|sequel|first .*paragraphs)\b)/i.test(text)) annotations.push(el);
  let noteFrom = 0;
  for (const span of annotations) {
    const words = collapse(inlineText(span)).text;
    if (!/\b(?:identical|as (?:in|above)|parallel to|same (?:for|except|ten|series|is)|rest|remainder|sequel|entire|complete|elaborated|verse is attached)\b/i.test(words)) continue;
    if (/^Each (?:sutta|of the following)/i.test(words)) continue;
    const at = text.indexOf(words, noteFrom);
    if (at < 0) continue;
    noteFrom = at + words.length;
    const furniture = /^[\s.…\d\[\](),:–—-]*$/;
    const prefix = text.slice(0, at), suffix = text.slice(at + words.length);
    let start = at, end = at + words.length;
    if (furniture.test(prefix)) start = 0;
    // A page reference between ellipses, which goes with the note.
    else {
      const pagePrefix = /\s*…\s*\[[\d–—-]+\]\s*…\s*$/.exec(prefix);
      if (pagePrefix) start = pagePrefix.index;
      else if (!/^(?:all )?as above$/i.test(words)) {
        const opening = /\s+…\s*$/.exec(prefix);
        if (opening && /\?[”’"')\]]*$/.test(prefix.slice(0, opening.index))) start = opening.index;
      }
    }
    const trailing = /^[\s.…\d\[\](),:–—-]*/.exec(suffix)[0];
    end += trailing.length;
    notes.push({ start, end, standalone: furniture.test(prefix) && furniture.test(suffix),
      before: text.slice(0, start).replace(/[\s…]+$/, ''), words });
  }
  // A line that is only a speaker's name, as SuttaCentral's "The Blessed One:" before a verse.
  const speakerLines = new Set([...el.querySelectorAll('span.speaker')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()));
  const blocks = [];
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    if (line) {
      const own = marks.filter((m) => m.at >= offset && m.at <= offset + line.length);
      const lineKind = speakerLines.has(line) ? 'spk' : i === 0 ? kind : 'v';
      blocks.push({ kind: lineKind, text: line, marks: own.map((m) => ({ id: m.id, at: m.at - offset })),
        speakers: speakers.map(([from, to]) => [Math.max(from, offset) - offset, Math.min(to, offset + line.length) - offset])
          .filter(([from, to]) => to > from),
        notes: notes.filter(n => n.start >= offset && n.start < offset + line.length)
          .map(n => ({ ...n, start: n.start - offset, end: n.end - offset })) });
    }
    offset += line.length + 1;
  });
  return blocks;
}

// Returns the blocks of an element laid out in lines, as <pre> is, a blank line starting a stanza.
function lineBlocks(el) {
  const { text, marks, speakers } = inlineText(el);
  const blocks = [];
  let stanza = true;
  let offset = 0;
  for (const raw of text.split('\n')) {
    const own = marks.filter((m) => m.at >= offset && m.at <= offset + raw.length).map((m) => ({ id: m.id, at: m.at - offset }));
    const line = collapse({ text: raw, marks: own,
      speakers: speakers.map(([from, to]) => [Math.max(from, offset) - offset, Math.min(to, offset + raw.length) - offset])
        .filter(([from, to]) => to > from) });
    if (!line.text) stanza = true;
    else {
      blocks.push({ kind: stanza ? 'vs' : 'v', ...line });
      stanza = false;
    }
    offset += raw.length + 1;
  }
  return blocks;
}

// Returns a page's title, the text before any <br> of its heading, without SuttaCentral's number.
function titleOf(el) {
  if (!el) return '';
  const { text } = collapse(inlineText(el));
  return text.split('\n')[0].replace(/^[\d.–-]+\s+/, '');
}

// Returns whether at least `share` of a paragraph's text is inside `tags`: wholly italic, as a
// dhammatalks.org introduction is, or wholly bold, as a heading it styles as a "See also" is.
function wholly(el, tags, share) {
  const all = el.textContent.replace(/\s+/g, '');
  const within = [...el.querySelectorAll(tags)].map((e) => e.textContent).join('').replace(/\s+/g, '');
  return all.length > 0 && within.length >= all.length * share;
}

// Returns whether a paragraph is italic, as introductions are, allowing roman Pali terms inside it
// when it begins and ends in italics.
function italicIntroduction(el) {
  if (wholly(el, 'em, i', 0.9)) return true;
  const content = [...el.childNodes].filter((node) => node.textContent.trim());
  const italic = (node) => node.nodeType === 1 && /^(em|i)$/i.test(node.tagName);
  return content.length > 0 && italic(content[0]) && italic(content.at(-1))
    && wholly(el, 'em, i', 0.85);
}

const newUnit = (uids, title, root) => ({ uids, title, titles: [], roots: [root], blocks: [], intro: [], seeAlso: [], notes: new Map() });

// listIndent returns the source class of a list recognized by its paragraph endings.
function listIndent(el) {
  const cls = ['iblock', 'sq-list'].find(c => el.classList.contains(c));
  if (el.tagName.toLowerCase() !== 'div' || !cls) return null;
  const items = [...el.childNodes].filter(node => node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim()));
  if (items.length < 2 || !items.every(item => item.nodeType === 1 && item.matches('p'))) return null;
  const texts = items.map(item => inlineText(item).text.trim());
  return texts.every(Boolean) && texts.slice(0, -1).every(text => /[;,—]$/.test(text)) ? cls : null;
}

// The note id of a page's footnote keyed by an asterisk.
const ASTERISK_NOTE = 'asterisk-note';

// asteriskNote makes a page's footnote keyed by an asterisk, as SN 5.9's alternative reading is, a
// note box, and each asterisk closing a word of its text that note's marker.
function asteriskNote(page) {
  const label = [...page.querySelectorAll('p')].find((p) => /^\s*\*\p{L}/u.test(p.textContent));
  if (!label) return;
  const document = page.ownerDocument;
  const footnote = label.parentElement.matches('div.verse') ? label.parentElement : label;
  const box = document.createElement('div');
  box.className = 'note';
  footnote.replaceWith(box);
  box.append(...(footnote === label ? [label] : footnote.childNodes));
  label.id = ASTERISK_NOTE;
  const textNodes = (el) => {
    const walker = document.createTreeWalker(el, document.defaultView.NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  };
  const opening = textNodes(label).find((node) => node.data.trim());
  opening.data = opening.data.replace(/^\s*\*/, '');
  for (const node of textNodes(page)) {
    if (box.contains(node) || !/\S\*/.test(node.data)) continue;
    node.replaceWith(...node.data.split(/(?<=\S)\*/).flatMap((part, i) => {
      if (!i) return [part];
      const marker = document.createElement('span');
      marker.className = 'fn';
      marker.append(document.createElement('a'));
      marker.firstChild.setAttribute('href', `#${ASTERISK_NOTE}`);
      return [marker, part];
    }));
  }
}

// Returns the texts of a dhammatalks.org page: one, the page's. A file joining several pages, as
// an2.31.html does, holds each page's <div id="sutta">, read in order as one text.
function parseDhammatalks(document, name) {
  const roots = [...document.querySelectorAll('#sutta')];
  for (const page of roots) asteriskNote(page);
  const root = roots[0];
  // A page holding several suttas, each under its own <h1>, as dhammatalks.org's SN 25 does, saved
  // once for each: only the section of the sutta the file is named for is its text.
  const headings = [...root.querySelectorAll('h1')];
  const own = headings.length > 1 ? headings.find((h) => h.id.toLowerCase() === name.toLowerCase()) : undefined;
  if (own) {
    for (const el of root.querySelectorAll('p, div, pre, blockquote, h1, h2, h3, h4, h5, h6, ol, ul, section')) {
      if (el === own || el.contains(own) || el.querySelector('h1') || el.closest('.note')) continue;
      if (headings.filter((h) => h.compareDocumentPosition(el) & 4).at(-1) !== own) skip(el);
    }
  }
  const unit = newUnit(uidsOf(name), titleOf(own ?? headings[0]), root);
  unit.roots = roots;
  unit.oneOfSeveral = !!own;
  const starred = [...root.querySelectorAll('p.stars')].some((p) => !p.hasAttribute('data-skip'));
  let body = false;
  let continuingNote = null;


  function handle(el, verse, indent = null) {
    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute('class') ?? '';
    if (el.hasAttribute('data-skip')) return;
    if (tag === 'h1') {
      continuingNote = null;
      // A later page's title opens its text.
      if (!root.contains(el) && /\p{L}/u.test(titleOf(el))) unit.titles.push({ title: titleOf(el), block: unit.blocks.length });
      return skip(el);
    }
    // A wrapper, such as MN 10's <div id="MN10">, holds the introduction as well as the text.
    if (tag === 'div' && !cls) return void eachBlock(el, (child) => handle(child, verse, indent));
    if (/\bnote\b/.test(cls) && (tag === 'div' || tag === 'section')) {
      skip(el);
      let note = null;
      for (const part of el.children) {
        if (/notetitle/.test(part.getAttribute('class') ?? '')) continue;
        const html = noteHtml(part);
        if (part.id) unit.notes.set(part.id, (note = { id: part.id, html: unnumbered(html), used: 0 }));
        else if (note) note.html += ` ${html}`;
        // What the box holds before its first note is a note no marker points to.
        else if (html) unit.notes.set(`box${unit.notes.size}`, (note = { id: `box${unit.notes.size}`, html, used: 0 }));
      }
      // A closing note holding a verse runs on past its box, as Ud 7.8's does.
      continuingNote = body && el.querySelector('.verse') ? note : null;
      return;
    }
    // A note outside the notes' box, as SN 1.20's are, where the box closes before them.
    if (tag === 'p' && /note\d+$|^fn\d+$/.test(el.id)) {
      unit.notes.set(el.id, { id: el.id, html: unnumbered(noteHtml(el)), used: 0 });
      return skip(el);
    }
    if (/seealso|\bsee\s+also\b/.test(cls) || (tag === 'p' && /^\s*See also\b/.test(el.textContent))) {
      continuingNote = null;
      // A heading styled as a "See also", wholly bold, as DN 1's are.
      if (wholly(el, 'strong, b', 1)) {
        body = true;
        return void unit.blocks.push(...blocksOf(el, 'h'));
      }
      unit.seeAlso.push(noteHtml(el));
      return skip(el);
    }
    // A labelled alternative rendering goes to the notes with every paragraph after it.
    const alternative = tag === 'p' && italicIntroduction(el)
      && (/^\s*Alternative translation:\s*$/i.test(el.textContent)
        || /^\s*\[.*\b(?:discourse|sutta)\b.*\btranslated as follows:\]\s*$/i.test(el.textContent));
    if (body && alternative) {
      const id = `alternative${unit.notes.size}`;
      unit.notes.set(id, (continuingNote = { id, html: noteHtml(el), used: 0, beforeSeeAlso: true }));
      return skip(el);
    }
    // A "Note:" after the text, outside the notes' box, as AN 9.42's closing remarks are.
    if (body && (tag === 'p' || tag === 'div') && /^\s*Note:\s/.test(el.textContent)) {
      const id = `editorial${unit.notes.size}`;
      unit.notes.set(id, (continuingNote = { id, html: noteHtml(el), used: 0 }));
      return skip(el);
    }
    if (continuingNote) {
      if (/^h[2-6]$/.test(tag) || /\bstars\b/.test(cls)) continuingNote = null;
      else {
        continuingNote.html += ` ${noteHtml(el)}`;
        return skip(el);
      }
    }
    if (/\bstars\b/.test(cls)) {
      body = true;
      return skip(el);
    }
    // The Dhammapada's verse numbers, which link to its endnotes: a marker after the verses.
    const endnote = /suttaCite/.test(cls) && el.querySelector('a[href*="endnotes.html#"]');
    if (endnote && unit.blocks.length) {
      const id = endnote.getAttribute('href').split('#')[1];
      const last = unit.blocks.at(-1);
      last.marks.push({ id, at: last.text.length });
      if (dhpEndnotes().has(id)) unit.notes.set(id, { ...dhpEndnotes().get(id), used: 0 });
    }
    if (/suttaCite|verse_stars|notetitle/.test(cls)) return skip(el);
    if (!body) {
      if (starred || /\bintro\b/.test(cls) || /iblock/.test(cls) || (tag === 'p' && italicIntroduction(el))) {
        unit.intro.push(noteHtml(el));
        return skip(el);
      }
      body = true;
    }
    if (tag === 'div' || tag === 'article') {
      const verseDiv = /verse/.test(cls);
      const layout = listIndent(el) ?? indent;
      let first = true;
      eachBlock(el, (child) => {
        handle(child, verseDiv ? (first ? 'first' : 'next') : verse, layout);
        if (child.tagName.toLowerCase() === 'p' && !/vspk/.test(child.getAttribute('class') ?? '')) first = false;
      });
      return;
    }
    if (tag === 'pre') return void unit.blocks.push(...lineBlocks(el));
    if (/^h[2-6]$/.test(tag)) return void unit.blocks.push(...blocksOf(el, 'h'));
    if (tag === 'p' || tag === 'blockquote') {
      const kind = /vspk/.test(cls) ? 'spk' : verse === 'first' ? 'vs' : verse ? 'v' : 'p';
      unit.blocks.push(...blocksOf(el, kind).map(b => ({ ...b, ...(indent && { indent }) })));
    }
  }
  for (const page of roots) eachBlock(page, (child) => handle(child, null));
  return [unit];
}

// Returns the Dhammapada's endnotes, which its chapters link to, by id.
let endnotes = null;
function dhpEndnotes() {
  if (!endnotes) {
    endnotes = new Map();
    const file = path.join(UPSTREAM, 'notes/kn/dhp/endnotes.html');
    if (fs.existsSync(file)) {
      let note = null;
      const { document } = new JSDOM(fs.readFileSync(file, 'utf8')).window;
      for (const p of document.querySelectorAll('p')) {
        if (p.id) endnotes.set(p.id, (note = { id: p.id, html: noteHtml(p) }));
        else if (note) note.html += ` ${noteHtml(p)}`;
      }
    }
  }
  return endnotes;
}

// Adds to a text the notes an Access to Insight copy of it holds, as DN 1's: each goes where the
// words before its marker are found in the text, and the rest are listed.
function attachCopyNotes(unit) {
  const file = path.join(UPSTREAM, 'notes', path.dirname(path.relative(path.join(UPSTREAM, 'sutta'), path.join(UPSTREAM, unit.file))), `${unit.name}.html`);
  if (!fs.existsSync(file)) return [];
  const { document } = new JSDOM(fs.readFileSync(file, 'utf8')).window;
  for (const dt of document.querySelectorAll('.notes dt')) {
    const id = dt.querySelector('a')?.id;
    const dd = dt.nextElementSibling;
    if (id && dd) unit.notes.set(id, { id, html: noteHtml(dd), used: 0 });
  }
  // The copy's words up to each marker.
  const markers = [];
  let words = [];
  const walkText = (el) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) words.push(...wordsOf(node.data));
      else if (node.nodeType === 1 && node.matches('a.noteTag')) markers.push({ id: node.getAttribute('href').split('#')[1], before: words.slice(-8) });
      else if (node.nodeType === 1 && !node.matches('.notes, script, style')) walkText(node);
    }
  };
  walkText(document.querySelector('.chapter') ?? document.body);
  // The text's words, with where each ends.
  const text = unit.stream.text;
  const found = [...text.matchAll(WORD_RE)].map((m) => ({ norm: normWord(m[0]), end: m.index + m[0].length })).filter((w) => w.norm);
  const missed = [];
  let from = 0;
  for (const { id, before } of markers) {
    let at = -1;
    for (let len = before.length; len >= 3 && at === -1; len--) {
      const anchor = before.slice(-len);
      for (let i = from; i + anchor.length <= found.length && at === -1; i++) {
        if (anchor.every((w, x) => found[i + x].norm === w)) at = i + anchor.length - 1;
      }
    }
    if (at === -1) missed.push(id);
    else {
      unit.stream.marks.push({ id, at: found[at].end });
      from = at + 1;
    }
  }
  unit.stream.marks.sort((a, b) => a.at - b.at);
  return missed;
}

// Returns the texts of a SuttaCentral page: one per <article>, or one for the page where its
// articles share a Pali document whose keys don't tell them apart ("sn45.146-148").
function parseSuttaCentral(document, name) {
  const articles = [...document.querySelectorAll('article')];
  const units = articles.map((article) => {
    const own = articles.length > 1 && uidDoc.has(article.id) && targetsFor([article.id]).length;
    const header = article.querySelector('header h1');
    const unit = newUnit(own ? [article.id] : uidsOf(name), titleOf(header), article);
    function handle(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'header' || tag === 'footer') return skip(el);
      if (tag === 'section' || tag === 'div') return void eachBlock(el, handle);
      if (tag === 'blockquote') return void eachBlock(el, (p) => unit.blocks.push(...blocksOf(p, 'vs')));
      if (tag === 'ol' || tag === 'ul') {
        return void eachBlock(el, (li) => unit.blocks.push(...blocksOf(li, 'li').map((b) => ({ ...b, bullet: tag === 'ul' }))));
      }
      if (/^h[1-6]$/.test(tag)) {
        // The older copies number each sutta in an <h2> instead of a header.
        if (!header && !unit.title && !unit.blocks.length) {
          unit.title = titleOf(el);
          return skip(el);
        }
        return void unit.blocks.push(...blocksOf(el, 'h'));
      }
      unit.blocks.push(...blocksOf(el, 'p'));
    }
    eachBlock(article, handle);
    return unit;
  });
  if (units.length < 2 || units.every((u) => u.uids.length === 1 && u.uids[0] !== name)) {
    // The title of a page of several suttas, above them all, is the first one's where it has only a
    // number.
    const pageTitle = [...document.querySelectorAll('h1')].find((h) => !h.closest('article'));
    if (pageTitle && units.length > 1 && !/\p{L}/u.test(units[0].title)) units[0].title = titleOf(pageTitle);
    return units;
  }
  const page = newUnit(uidsOf(name), units[0].title, null);
  page.roots = units.flatMap((u) => u.roots);
  page.blocks = units.flatMap((u) => u.blocks);
  // The later suttas' titles, each by the block its text starts with; a heading of numbers alone is
  // SuttaCentral's numbering, not a title.
  let first = units[0].blocks.length;
  for (const u of units.slice(1)) {
    if (/\p{L}/u.test(u.title)) page.titles.push({ title: u.title, block: first });
    first += u.blocks.length;
  }
  return [page];
}

// Returns the text of an Access to Insight page.
function parseAccessToInsight(document, name) {
  const root = document.querySelector('.chapter');
  const unit = newUnit(uidsOf(name), titleOf(document.querySelector('h1')), root);
  function handle(el) {
    const tag = el.tagName.toLowerCase();
    if (/freeverse/.test(el.getAttribute('class') ?? '') || tag === 'pre') return void unit.blocks.push(...lineBlocks(el));
    if (tag === 'div' || tag === 'blockquote') return void eachBlock(el, handle);
    unit.blocks.push(...blocksOf(el, /^h[2-6]$/.test(tag) ? 'h' : 'p'));
  }
  eachBlock(root, handle);
  return [unit];
}

function parsePage(file) {
  const name = path.basename(file, '.html');
  const source = fs.readFileSync(file, 'utf8');
  const parse = () => {
    // A fresh document each time, since parsing marks the page's furniture in it.
    const { document } = new JSDOM(source).window;
    if (document.querySelector('#sutta')) return parseDhammatalks(document, name);
    if (document.querySelector('article')) return parseSuttaCentral(document, name);
    return parseAccessToInsight(document, name);
  };
  const replicas = wholePages[path.relative(UPSTREAM, file)];
  if (!replicas) return parse();
  const expected = uidsOf(name);
  if (!Array.isArray(replicas) || replicas.length < 2 || new Set(replicas).size !== replicas.length
    || replicas.length !== expected.length || expected.some((uid) => !replicas.includes(uid))) {
    throw new Error(`Whole-page layout must name every text of ${name} exactly once`);
  }
  return replicas.map((uid) => {
    const units = parse();
    if (units.length !== 1 || !targetsFor([uid]).length) {
      throw new Error(`Whole-page layout needs one source passage and Pali for ${uid}`);
    }
    return { ...units[0], uids: [uid], wholePage: true };
  });
}

// Returns the words of a text's pages read the second way: all their text, less what the parser
// left out on purpose. It shares nothing with the blocks but the elements marked as not the text.
function pageWords(roots) {
  return roots.flatMap((root) => {
    const clone = root.cloneNode(true);
    for (const el of clone.querySelectorAll(NOT_TEXT)) el.remove();
    for (const el of clone.querySelectorAll('br')) el.replaceWith(' ');
    for (const el of clone.querySelectorAll('p, li, div, h2, h3, h4, h5, h6, pre, blockquote')) el.append(' ');
    return clone.textContent.split(/\s+/).filter(Boolean);
  });
}

// ---------------------------------------------------------------------------------------------
// Words: what two translations of one Pali line share

const STOP = new Set(
  ('a an the and or but if of to in on at by for with from as is are was were be been being am this that these those ' +
    'it its he she they them his her hers their theirs there here then than so such not no nor do does did done doing ' +
    'have has had having i me my mine we us our you your yours who whom whose which what when where why how all any both ' +
    'each more most other some own same very can will just should would could may might must shall also into upon about ' +
    'over under again once up down out off only too one ones thus now o oh let'
  ).split(' '),
);

// Returns a word reduced to a crude stem, the same way for every translation.
function stem(w) {
  if (w.length > 4) {
    if (w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.endsWith('ness')) w = w.slice(0, -4);
    else if (w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.endsWith('ly')) w = w.slice(0, -2);
    else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

// The terms the three translators render differently, each group read as one word.
const SYNONYMS = [
  'bhikkhu mendicant monk',
  'bhikkhuni nun',
  'bhagava buddha blessed',
  'bhante sir lord',
  'sankhara choice formation fabrication volitional',
  'nibbana extinguishment extinguished quenching quenched unbinding unbound',
  'dukkha suffering stress stressful suffer',
  'adinava drawback danger',
  'assada gratification allure',
  'pajanati understand discern',
  'samadhi immersion concentration composure',
  'jhana absorption',
  'samana ascetic contemplative recluse',
  'brahmana brahmin brahman',
  'deva god deity devata',
  'asava defilement taint effluent fermentation',
  'tathagata realized',
  'dhamma teaching dharma',
  'vinaya training discipline',
  'arahant perfected arahat worthy',
  'nibbida disillusionment revulsion disenchantment disillusioned disenchanted',
  'viraga dispassion fading dispassionate',
  'upadana grasping clinging sustenance grasp cling',
  'samudaya origin origination originate arising',
  'nirodha cessation cease ending',
  'ahara fuel nutriment food',
  'kamma deed action karma',
  'raga greed lust passion',
  'dosa hate hatred aversion',
  'sila ethics ethical virtue virtuous',
  'saddha faith conviction',
  'appamada diligent diligence heedful heedfulness',
  'dhatu element property',
  'ayatana field base media medium',
  'bodhi awakening enlightenment',
  'mano mind intellect',
  'viriya energy persistence',
  'sukha bliss happiness pleasure',
  'domanassa sadness displeasure distress',
  'kusala skillful wholesome',
  'akusala unskillful unwholesome',
  'bhava existence becoming',
  'sampajanna awareness alertness comprehension',
  'anicca impermanent inconstant impermanence inconstancy',
  'vimutti freedom freed release released liberation liberated',
  'panna wisdom discernment',
  'puthujjana ordinary worldling',
];
const CANON = new Map();
for (const group of SYNONYMS) {
  const [head, ...rest] = group.split(' ');
  for (const w of [head, ...rest]) CANON.set(stem(w), head);
}

// The form each word is compared by, or null for one too common to tell lines apart.
const normCache = new Map();
function normWord(raw) {
  let norm = normCache.get(raw);
  if (norm === undefined) {
    const w = raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, '');
    norm = w.length < 2 || STOP.has(w) ? null : (CANON.get(stem(w)) ?? stem(w));
    normCache.set(raw, norm);
  }
  return norm;
}

// Each compared form's number, so a line's reference is a map of small integers.
const wordIds = new Map();
const idOf = (w) => {
  let id = wordIds.get(w);
  if (id === undefined) wordIds.set(w, (id = wordIds.size));
  return id;
};

const WORD_RE = /[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu;
const wordsOf = (text) => (text.match(WORD_RE) ?? []).map(normWord).filter(Boolean);

// The dictionary, read for what each Pali word means: its headwords, and the words of its meanings.
const dictionary = new Map();
for (const { entry, definition } of readJson(path.join(DATA, 'pli2en_dpd.json')).entries ?? []) {
  const key = entry.toLowerCase();
  const had = dictionary.get(key) ?? { lemmas: new Set(), meanings: new Set() };
  for (const def of definition) {
    const lemma = normWord(def.slice(0, def.indexOf(':')).replace(/\s*\d+$/, ''));
    if (lemma) had.lemmas.add(idOf(lemma));
    for (const b of def.matchAll(/<b>(.*?)<\/b>/g)) for (const w of wordsOf(b[1])) had.meanings.add(idOf(w));
  }
  dictionary.set(key, had);
}

// Weight of a word the Pali's dictionary meanings share, against one Sujato's English shares.
const GLOSS_WEIGHT = 0.4;

// The words of the opening a line like "Sāvatthinidānaṁ" stands for, which Ṭhānissaro writes out.
const NIDANA = wordsOf('heard occasion Blessed staying near Jeta Grove Anāthapiṇḍika monastery park addressed monks responded lord said').map(idOf);

// Returns what a Pali line is expected to say, word → weight: 1 for Sujato's words and the Pali's
// headwords, GLOSS_WEIGHT for the words of its dictionary meanings.
function referenceOf(line) {
  const ref = new Map();
  const paliWords = line.pali.toLowerCase().match(WORD_RE) ?? [];
  for (const w of paliWords) for (const id of dictionary.get(w)?.meanings ?? []) ref.set(id, GLOSS_WEIGHT);
  for (const w of paliWords) {
    for (const id of dictionary.get(w)?.lemmas ?? []) ref.set(id, 1);
    const norm = normWord(w);
    if (norm) ref.set(idOf(norm), 1);
  }
  for (const w of wordsOf(line.en)) {
    const id = idOf(w);
    for (const t of learned.get(id) ?? []) ref.set(t, Math.max(ref.get(t) ?? 0, LEARNED_WEIGHT));
    ref.set(id, 1);
  }
  if (/nidān/.test(line.pali)) for (const id of NIDANA) ref.set(id, 1);
  return ref;
}

// The translator's words learned as renderings of Sujato's: his word's number → theirs.
const learned = new Map();
// Weight of a learned rendering of one of Sujato's words.
const LEARNED_WEIGHT = 0.7;
// Least times a pair must be seen together, and least Dice coefficient, to be learned.
const LEARN_MIN = 5;
const LEARN_DICE = 0.3;

// ---------------------------------------------------------------------------------------------
// The alignment

// Score for a segment ending at a cut of each strength.
//   3   – a paragraph, heading or verse's start
//   2   – a verse line's start, or a sentence's end
//   1.5 – after a semicolon, colon or ellipsis
//   1.2 – after a dash
//   1   – after a comma
const CUT_SCORE = { 3: 1.2, 2: 0.8, 1.5: 0.5, 1.2: 0.4, 1: 0.25 };
// Score for a paragraph break of the translation falling where the Pali's does.
const PARAGRAPH_MATCH = 1.0;
// Score for a line break of the translation falling where a Pali verse line starts.
const VERSE_MATCH = 0.5;
// Cost of a paragraph break of the translation falling inside a prose segment.
const PARAGRAPH_INSIDE = 0.4;
// Weight of a segment's length against the length its Pali and Sujato's English lead one to expect.
const LENGTH_WEIGHT = 0.6;
// Cost of each unit of what a line's English is expected to hold that its piece lacks.
const RECALL = 0.5;
// Cost of each unit of a piece's words that its line doesn't expect.
const PRECISION = 0.5;
// Most lines one piece of the translation may cover, where it can't be cut between them.
const MAX_MERGE = 3;
// Cost of each further line a piece covers.
const MERGE_COST = 0.3;
// Score margin below which a cut is flagged as unsure.
const UNSURE = 1.0;
// Texts longer than this, in characters, are aligned sentence by sentence first.
const COARSE_ABOVE = 12000;

const NEG = -1e30;
// The marks a review may start a line right after with no space between, as none breaks a word.
const JOINS = /[—–….?!:;,]/;

// Returns the text a page's blocks make, one stream, with its note marks and the places a segment
// may end: after whitespace, or right after a dash or an ellipsis with no space after it, as Sujato's
// own lines end, so the segments joined with a space, or none after those, are the text.
function streamOf(blocks) {
  let text = '';
  const starts = [];
  const marks = [];
  const notes = [];
  const speakers = [];
  for (const block of blocks) {
    if (text) text += '\n';
    starts.push({ at: text.length, kind: block.kind, ...(block.bullet && { bullet: true }), ...(block.indent && { indent: block.indent }) });
    for (const m of block.marks) marks.push({ id: m.id, at: text.length + m.at });
    for (const n of block.notes ?? []) notes.push({ ...n, start: text.length + n.start, end: text.length + n.end });
    for (const [from, to] of block.speakers ?? []) speakers.push([text.length + from, text.length + to]);
    text += block.text;
  }

  const cuts = new Map();
  const add = (at, strength, info) => {
    const had = cuts.get(at);
    if (!had) cuts.set(at, { at, strength, ...info });
    else {
      had.strength = Math.max(had.strength, strength);
      Object.assign(had, info);
    }
  };
  add(0, 3, {});
  for (const [i, s] of starts.entries()) {
    if (i === 0) continue;
    // A speaker's name belongs with the words after it, never ending a segment.
    if (starts[i - 1].kind === 'spk') continue;
    const verseLine = s.kind === 'v';
    add(s.at, verseLine ? 2 : 3, { block: true, paragraph: !verseLine, heading: s.kind === 'h', afterHeading: starts[i - 1].kind === 'h' });
  }
  for (const m of text.matchAll(/([.?!]|…)[’”'")\]]* +/g)) {
    // "Ven. Pāla" is no sentence's end.
    if (m[1] === '.' && /\b(?:Ven|Vens|Mr|Mrs|Dr|St|cf|vs|vv|v|ff|pp|p|e\.g|i\.e|etc)\.$/i.test(text.slice(Math.max(0, m.index - 5), m.index + 1))) continue;
    add(m.index + m[0].length, m[1] === '…' ? 1.5 : 2, {});
  }
  for (const m of text.matchAll(/[;:][’”'")\]]* +/g)) add(m.index + m[0].length, 1.5, {});
  for (const m of text.matchAll(/[—–] +/g)) add(m.index + m[0].length, 1.2, {});
  for (const m of text.matchAll(/,[’”'")\]]* +/g)) add(m.index + m[0].length, 1, {});
  // Speech opening after a comma or a dash starts a line as a sentence does.
  for (const cut of cuts.values()) if (cut.strength < 2 && /^[“‘]/.test(text.slice(cut.at))) cut.strength = 2;
  // An opening quote after a word, and a dash with no space after it, as weakly as a spaced dash.
  for (const m of text.matchAll(/\s+(?=[“‘])/g)) add(m.index + m[0].length, 1.2, {});
  for (const m of text.matchAll(/[—–](?=[^\s—–])/g)) add(m.index + 1, 1.2, {});
  add(text.length, 3, {});
  for (const note of notes) {
    while (note.start < note.end && /\s/.test(text[note.start])) note.start++;
    while (note.end < text.length && /\s/.test(text[note.end])) note.end++;
  }
  return { text, marks, notes, speakers, blocks: starts, cuts: [...cuts.values()].sort((a, b) => a.at - b.at) };
}

// Returns each line's piece of the stream — its span, and whether it's empty or merged into the
// piece of a line above — with how sure each cut is, or null if no alignment fits.
function align(stream, lines, { verseLayout = false, verseGapCost = VERSE_MATCH } = {}) {
  const { text, cuts } = stream;
  const n = lines.length;
  const m = cuts.length;

  // The stream's words: where each starts, its number, and its weight.
  const tokAt = [];
  const tokId = [];
  for (const w of text.matchAll(WORD_RE)) {
    const norm = normWord(w[0]);
    tokAt.push(w.index);
    tokId.push(norm ? idOf(norm) : -1);
  }
  const T = tokAt.length;
  const tokenAfter = (pos) => {
    let lo = 0;
    let hi = T;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tokAt[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const tokenAt = Int32Array.from(cuts, (c) => tokenAfter(c.at));

  // A word's weight: the fewer the lines that expect it, the more it tells them apart. A word no
  // line expects weighs nothing.
  const refs = lines.map(referenceOf);
  const df = new Map();
  for (const ref of refs) for (const id of ref.keys()) df.set(id, (df.get(id) ?? 0) + 1);
  const weightOf = (id) => (df.has(id) ? Math.log(1 + n / df.get(id)) : 0);
  const tokWeight = Float64Array.from(tokId, weightOf);
  const earn = (i, t) => (tokWeight[t] ? (refs[i].get(tokId[t]) ?? 0) * tokWeight[t] : 0);

  // Where each word stands in the stream, and each line's words there: token, earning pairs.
  const postings = new Map();
  tokId.forEach((id, t) => {
    if (!tokWeight[t]) return;
    if (!postings.has(id)) postings.set(id, []);
    postings.get(id).push(t);
  });
  const matches = refs.map((ref) => {
    const pairs = [];
    for (const [id, r] of ref) for (const t of postings.get(id) ?? []) pairs.push(t, r * tokWeight[t]);
    return pairs;
  });
  const weighed = [];
  tokWeight.forEach((w, t) => w && weighed.push(t, w));

  // What each line's English is expected to hold, the weight of Sujato's words, and to measure:
  // Sujato's length where he has English, else the Pali's.
  const content = lines.map((l) => [...new Set(wordsOf(l.en).map(idOf))].reduce((s, id) => s + weightOf(id), 0));
  const emptyScore = content.map((c) => -RECALL * c);
  const rawExpect = lines.map((l) => (l.en ? l.en.length : l.pali.length * 0.6));
  const totalExpect = rawExpect.reduce((a, b) => a + b, 0) || 1;

  // Paragraph breaks before each cut, to count those falling inside a segment.
  const parasBefore = new Int32Array(m + 1);
  for (let j = 0; j < m; j++) parasBefore[j + 1] = parasBefore[j] + (j > 0 && cuts[j].paragraph ? 1 : 0);

  function cutValue(j, first, last) {
    if (j === m - 1) return 0;
    const cut = cuts[j];
    const next = lines[last + 1];
    let s = CUT_SCORE[cut.strength] ?? 0;
    if (next?.paraStart && cut.paragraph) s += PARAGRAPH_MATCH;
    if (next?.verse && cut.block) s += VERSE_MATCH;
    if (next?.heading && cut.heading) s += 2;
    // The translator's heading is the Pali's, or else belongs with the text after it.
    if (cut.afterHeading) s += lines[first].heading ? 2 : -3;
    return s;
  }

  // Returns the score of the text between cuts k and j as the English of lines first…last.
  //   lexical – what its words earn on those lines
  //   weight  – what its words weigh in all
  //   want    – what the lines' English is expected to hold
  //   exp     – how long the lines' English is expected to be
  function pieceScore(first, last, k, j, lexical, weight, want, exp) {
    const len = cuts[j].at - cuts[k].at;
    let s = lexical - RECALL * Math.max(0, want - lexical) - PRECISION * Math.max(0, weight - lexical);
    s -= LENGTH_WEIGHT * Math.abs(Math.log((len + 30) / (exp + 30))) + MERGE_COST * (last - first);
    if (!lines[first].verse || !lines[last].verse) s -= PARAGRAPH_INSIDE * (parasBefore[j] - parasBefore[k + 1]);
    return s;
  }

  // Returns what the words between cuts k and j earn on lines first…last, and weigh in all.
  function measure(first, last, k, j) {
    let lexical = 0;
    let weight = 0;
    for (let t = tokenAt[k]; t < tokenAt[j]; t++) {
      weight += tokWeight[t];
      let e = 0;
      for (let i = first; i <= last; i++) e = Math.max(e, earn(i, t));
      lexical += e;
    }
    return { lexical, weight };
  }

  const sumOver = (arr, first, last) => {
    let s = 0;
    for (let i = first; i <= last; i++) s += arr[i];
    return s;
  };

  // The dynamic programme: over the cuts `allowed`, each line's piece ending between lo[i] and hi[i].
  function solve(allowed, lo, hi, expect, spanScale) {
    const A = allowed.length;
    // Sums, before each allowed cut, of values given per token as token, value pairs.
    const bin = new Int32Array(T);
    for (let a = 0, t = 0; a < A; a++) while (t < T && t < tokenAt[allowed[a]]) bin[t++] = a;
    const prefix = (pairs) => {
      const sums = new Float64Array(A);
      for (let p = 0; p < pairs.length; p += 2) sums[bin[pairs[p]]] += pairs[p + 1];
      for (let a = 1; a < A; a++) sums[a] += sums[a - 1];
      return sums;
    };
    const W = prefix(weighed);

    const rows = [new Float64Array(m).fill(NEG)];
    rows[0][0] = 0;
    const backK = [];
    const backG = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(m).fill(NEG);
      const fromK = new Int32Array(m).fill(-1);
      const fromG = new Int8Array(m).fill(-2);
      const before = rows[i];
      for (const j of allowed) {
        // Verse starts on its first Pali row. Only fewer source lines can leave rows empty.
        if (before[j] > NEG && (!verseLayout || (i > 0 && m - 1 < n))) {
          row[j] = before[j] + emptyScore[i] - (verseLayout ? verseGapCost : 0);
          fromK[j] = j;
          fromG[j] = -1;
        }
      }
      let a0 = 0;
      while (a0 < allowed.length && cuts[allowed[a0]].at < lo[i]) a0++;
      let a1 = allowed.length - 1;
      while (a1 >= 0 && cuts[allowed[a1]].at > hi[i]) a1--;

      for (let g = 0; g < (verseLayout ? 1 : MAX_MERGE) && g <= i; g++) {
        const first = i - g;
        const base = rows[first];
        const exp = sumOver(expect, first, i);
        const want = sumOver(content, first, i);
        const maxSpan = Math.max(600, exp * 5 + 300) * spanScale;
        // What each word earns on these lines: on several, the most any of them gives it.
        let pairs = matches[i];
        if (g) {
          const best = new Map();
          for (let x = first; x <= i; x++) {
            const mx = matches[x];
            for (let p = 0; p < mx.length; p += 2) if ((best.get(mx[p]) ?? 0) < mx[p + 1]) best.set(mx[p], mx[p + 1]);
          }
          pairs = [...best].flat();
        }
        const G = prefix(pairs);
        for (let a = Math.max(a0, 1); a <= a1; a++) {
          const j = allowed[a];
          const end = cuts[j].at;
          const cv = cutValue(j, first, i);
          // A piece covers several lines only where there's no place to cut it between them.
          const bLast = g || (verseLayout && m - 1 <= n) ? a - 1 : 0;
          for (let b = a - 1; b >= bLast; b--) {
            const k = allowed[b];
            if (cuts[k].at < end - maxSpan) break;
            if (base[k] <= NEG) continue;
            const s = base[k] + cv + pieceScore(first, i, k, j, G[a] - G[b], W[a] - W[b], want, exp);
            if (s > row[j]) {
              row[j] = s;
              fromK[j] = k;
              fromG[j] = g;
            }
          }
        }
      }
      rows.push(row);
      backK.push(fromK);
      backG.push(fromG);
    }

    let j = m - 1;
    if (rows[n][j] <= NEG) return null;
    const pieces = new Array(n);
    for (let i = n - 1; i >= 0; ) {
      const g = backG[i][j];
      const k = backK[i][j];
      if (g === -1) {
        pieces[i] = { k: j, j, first: i, last: i, empty: true };
        i--;
        continue;
      }
      const first = i - g;
      for (let x = first; x <= i; x++) pieces[x] = { k, j, first, last: i, merged: x !== first };
      j = k;
      i = first - 1;
    }
    return j === 0 ? pieces : null;
  }

  // Every cut over the whole text; a long one sentence by sentence first, then every cut within a
  // narrow band around where that put each line.
  const every = cuts.map((_, j) => j);
  const sentences = every.filter((j) => cuts[j].strength >= 2);
  const zero = new Float64Array(n);
  const end = new Float64Array(n).fill(text.length);
  const evaluate = (pieces, expect) => evaluateWith({ lines, cuts, content, measure, pieceScore, cutValue, sumOver }, pieces, expect);
  const run = (ratio, spanScale) => {
    const expect = rawExpect.map((e) => e * ratio);
    if (text.length > COARSE_ABOVE) {
      const coarse = solve(sentences, zero, end, expect, spanScale);
      if (coarse) {
        const at = coarse.map((p) => cuts[p.j].at);
        const width = expect.map((e) => (800 + 2 * e) * spanScale);
        const fine = solve(every, at.map((a, i) => a - width[i]), at.map((a, i) => a + width[i]), expect, spanScale);
        if (fine) return { pieces: fine, expect };
      }
    }
    return { pieces: solve(every, zero, end, expect, spanScale), expect };
  };
  // How much longer this translation runs than Sujato's, measured on the lines it translates, which
  // an abbreviated or partial translation makes far fewer than all.
  const clampRatio = (r) => Math.min(3, Math.max(0.3, r));
  let ratio = clampRatio(text.length / totalExpect);
  let { pieces, expect } = run(ratio, 1);
  if (!pieces) return null;
  let covered = 0;
  pieces.forEach((p, i) => {
    if (!p.empty) covered += rawExpect[i];
  });
  const measured = clampRatio(text.length / (covered || totalExpect));
  if (Math.abs(Math.log(measured / ratio)) > 0.2) {
    const again = run(measured, 1);
    if (again.pieces) ({ pieces, expect } = again), (ratio = measured);
  }
  let results = evaluate(pieces, expect);
  // A cut that scores below another place for it: a line's English longer than a piece may run,
  // as where Ṭhānissaro writes out what Sujato abbreviates. Again with longer pieces allowed.
  if (results.some((r) => r.margin !== null && r.margin < 0)) {
    const wide = run(ratio, 4);
    if (wide.pieces) results = evaluate(wide.pieces, wide.expect);
  }
  return { results, ratio };
}

function layoutVerse(stream, lines, start, end) {
  const { text, blocks } = stream;
  const before = blocks.findLast((b) => b.at <= start);
  if (!before || text.slice(before.at, start).trim()) return { reason: 'starts inside a source line' };
  const after = blocks.find((b) => b.at >= end);
  if (!after && text.slice(end).trim()) return { reason: 'ends inside a source line' };
  if (after && text.slice(end, after.at).trim()) return { reason: 'ends inside a source line' };
  const own = blocks.filter((b) => b.at >= start && b.at < end).map((b) => ({ ...b, at: b.at - start }));
  if (!own.length || own[0].at) own.unshift({ at: 0, kind: before.kind });
  // A speaker label stays attached to the first line of the speech.
  const cuts = [
    { at: 0, strength: 3 },
    ...own.filter((b, i) => i && b.kind !== 'spk' && own[i - 1].kind !== 'spk')
      .map((b) => ({ at: b.at, strength: b.kind === 'v' ? 2 : 3, block: true, paragraph: b.kind !== 'v' })),
    { at: end - start, strength: 3 },
  ];
  // A verse rendered as prose has no source line breaks to spread.
  if (cuts.length === 2) return { reason: 'no source line breaks' };
  // One source line on each Pali row where the counts are equal.
  if (cuts.length - 1 === lines.length) return { results: lines.map((line, i) => ({
    key: line.key, start: start + cuts[i].at, end: start + cuts[i + 1].at,
    empty: false, merged: false, lexical: 0, margin: null,
  })) };
  const aligned = align({ text: text.slice(start, end), blocks: own, cuts }, lines, { verseLayout: true });
  if (!aligned) return { reason: 'no verse layout' };
  return { results: aligned.results.map((r) => ({ ...r, start: r.start + start, end: r.end + start })) };
}

// Spreads each verse's lines over its Pali rows, within the bounds the alignment gives it; a layout
// a review settled is kept, and one that differs from it is reported in `verseLayouts`.
function spreadVerses(stream, body, results, entry, decided = decisions) {
  for (let i = 0; i < body.length; i++) {
    if (!body[i].verse) continue;
    let end = i + 1;
    while (end < body.length && body[end].verse && !body[end].paraStart && body[end].doc === body[i].doc) end++;
    const lines = body.slice(i, end);
    const current = results.slice(i, end);
    const active = current.filter((r) => !r.empty && !r.merged && r.end > r.start);
    if (!active.length || lines.length === 1) { i = end - 1; continue; }
    const proposal = layoutVerse(stream, lines, active[0].start, active.at(-1).end);
    const record = { key: lines[0].key };
    if (proposal.reason) record.status = proposal.reason;
    else {
      const now = segmentsOf(current, stream.text).segText;
      const next = segmentsOf(proposal.results, stream.text).segText;
      if (now.every((s, x) => s === next[x])) record.status = 'same';
      else {
        const first = decided[current[0].key];
        const settled = current.slice(1).some((r) => decided[r.key] !== undefined) || !!(first?.empty || first?.own);
        record.status = settled ? 'reviewed layout kept' : 'spread';
        record.lines = lines.map((l, x) => ({ key: l.key, before: now[x], proposed: next[x] }));
        if (!settled) proposal.results.forEach((r, x) => { results[i + x] = r; });
      }
    }
    (entry.verseLayouts ??= []).push(record);
    i = end - 1;
  }
}

// Moves each note standing for a whole passage onto the passage's first Pali row, unless a review
// settled it, and records each placement in `notePlacements`.
function placePassageNotes(stream, body, results, entry, decided = decisions) {
  const { text } = stream;
  const meaningful = s => /\p{L}/u.test(s);
  for (const note of stream.notes ?? []) {
    const touched = results.map((r, i) => ({ r, i })).filter(({ r }) => !r.empty && !r.merged && r.start < note.end && r.end > note.start);
    if (!touched.length) continue;
    const first = touched[0].i, last = touched.at(-1).i;
    let before = results.findLastIndex((r, i) => i <= first && !r.empty && !r.merged && r.start < note.start
      && meaningful(text.slice(r.start, Math.min(r.end, note.start))));
    // A note continuing the printed text or abbreviated row it follows stays with it.
    if (before === first) continue;
    if (before >= 0 && first === before + 1 && touched.length > 1 && /pe[.…]/.test(body[before].pali)) continue;
    // A note after an unfinished sentence or a list item abbreviates within it, and keeps its place.
    const closed = /[.?!][”’"')\]]*$/.test(note.before);
    const questionNext = before >= 0 && /[.?][”’"')\]]*$/.test(body[before].pali)
      && body.slice(before + 1, before + 3).some(line => /\?/.test(line.pali));
    const passage = /\b(?:down to|including the verses|complete as)\b/i.test(note.words);
    if (!note.standalone && !closed && !questionNext && !passage) continue;
    // "As above" after an ellipsis that already abbreviates the passage keeps its place.
    if (!note.standalone && /^(?:all )?as above$/i.test(note.words) && results.slice(before + 1, first).some(r =>
      !r.empty && !r.merged && r.end <= note.start && !meaningful(text.slice(r.start, r.end)))) continue;
    let target = before + 1;
    if (before >= 0) {
      // A sentence may render the tail of its Pali paragraph on its opening row.
      const source = new Set(wordsOf(text.slice(results[before].start, note.start)));
      const own = new Set(wordsOf(body[before].en));
      while (target <= first && !body[target].paraStart && body[target].doc === body[before].doc) {
        if (/\?/.test(body[target].pali)) break;
        const extra = wordsOf(body[target].en).filter(w => !own.has(w));
        const closing = !body[target].en && !body[target].verse
          && /[—–]$/.test(body[target - 1].pali) && closed;
        if (target === first && !closing) break;
        if (!closing && (!extra.length || !extra.every(w => source.has(w)))) break;
        wordsOf(body[target].en).forEach(w => own.add(w));
        target++;
      }
      // An abbreviated Pali dialogue can begin on the row already holding its printed question.
      const precedingClosed = /[.?!][”’"')\]]*[.…\s]*$/.test(text.slice(results[before].start, note.start));
      if (first > before + 1 && /pe[.…]/.test(body[before].pali) && (closed
        || (precedingClosed && /^(?:All )?as (?:above|in)\b/i.test(note.words)))) target = before;
    }
    if (target > last + 1 || target >= body.length || body[target].doc !== body[first].doc) continue;
    const record = { source: note.words, key: body[first].key, proposed: body[target].key };
    if (target === first && touched.length === 1) {
      record.status = 'same';
      (entry.notePlacements ??= []).push(record);
      continue;
    }
    // A placement a review settled is kept.
    const settled = results.slice(Math.min(target, first), Math.max(target, last) + 1).some(r => decided[r.key] !== undefined);
    if (settled) { record.status = 'reviewed placement kept'; }
    else {
      const start = note.start, end = note.end;
      const original = results.map(r => ({ ...r }));
      const joined = segmentsOf(original, text).joined;
      // The note's own span moves; the text on either side stays.
      for (let i = Math.min(target, first); i <= Math.max(target, last); i++) {
        const r = results[i];
        if (i === target) {
          r.start = target === before ? r.start : start;
          r.end = end;
          r.empty = r.merged = false;
          r.margin = null;
        } else if (i !== before && r.end <= end) {
          r.start = r.end = end;
          r.empty = true;
          r.merged = false;
          r.margin = null;
        } else if (r.end > end && r.start < end) r.start = end;
      }
      if (before >= 0 && before !== target) results[before].end = start;
      record.status = target === first && touched.length === 1 ? 'same' : 'placed';
      if (segmentsOf(results, text).joined !== joined) {
        original.forEach((r, i) => { results[i] = r; });
        record.status = 'passage boundary unclear';
      }
    }
    (entry.notePlacements ??= []).push(record);
  }
}

// joinParagraphOpenings keeps an unfinished quoted lead-in with its paragraph across a Pali paragraph break.
function joinParagraphOpenings(stream, body, results, entry, decided = decisions) {
  const { text, blocks } = stream;
  for (let i = 1; i < body.length; i++) {
    if (!body[i].paraStart || body[i - 1].paraStart || body[i].verse || body[i - 1].verse
      || body[i].heading || body[i - 1].heading || body[i].doc !== body[i - 1].doc
      || body[i].key.split(':')[0] !== body[i - 1].key.split(':')[0]) continue;
    const above = results[i - 1], next = results[i];
    if (above.empty || above.merged || next.empty || next.merged || above.end !== next.start || next.end <= next.start) continue;
    const block = blocks.findLast(b => b.at <= next.start);
    if (block?.kind !== 'p' || block.at < above.start || block.at >= next.start) continue;
    const words = text.slice(block.at, next.start).trim();
    if (!/^[“‘"'].*:$/.test(words) || /[.!?…]/.test(words)) continue;
    const record = { key: above.key, next: next.key, words };
    if (decided[above.key]?.own || decided[next.key] !== undefined) record.status = 'reviewed cut kept';
    else {
      above.end = next.start = block.at;
      above.empty = !text.slice(above.start, above.end).trim();
      above.margin = next.margin = null;
      record.status = 'joined';
    }
    (entry.paragraphOpenings ??= []).push(record);
  }
}

// joinHeardOpenings keeps Ṭhānissaro's unfinished hearing formula with its prose continuation.
function joinHeardOpenings(stream, body, results, entry) {
  if (translator !== 'thanissaro') return;
  const { text, blocks } = stream;
  for (let i = 0; i + 1 < body.length; i++) {
    const line = body[i], below = body[i + 1];
    if (!/^Evaṁ me sutaṁ(?:—|\s*…)$/.test(line.pali) || line.verse || below.verse
      || line.heading || below.heading || line.doc !== below.doc
      || line.key.split(':')[0] !== below.key.split(':')[0]) continue;
    const first = results[i], next = results[i + 1];
    if (first.empty || first.merged || next.empty || next.merged
      || first.end !== next.start || next.end <= next.start) continue;
    const block = blocks.findLast(b => b.at < first.end);
    if (block?.kind !== 'p' || block.at < first.start
      || text.slice(block.at, first.end).trim() !== 'I have heard that'
      || blocks.some(b => b.at >= next.start && b.at < next.end)) continue;
    first.end = next.start = next.end;
    first.lexical += next.lexical;
    next.merged = true;
    first.margin = next.margin = null;
    (entry.heardOpenings ??= []).push({ key: first.key, next: next.key });
  }
}

// Returns each line's segment of the stream, from `pieces`, with how sure each cut is: how much less
// the best other place for it between its two pieces scores.
function evaluateWith({ lines, cuts, content, measure, pieceScore, cutValue, sumOver }, pieces, expect) {
  const n = lines.length;
  const scoreOf = (p, k, j) => {
    const { lexical, weight } = measure(p.first, p.last, k, j);
    return pieceScore(p.first, p.last, k, j, lexical, weight, sumOver(content, p.first, p.last), sumOver(expect, p.first, p.last));
  };
  const results = lines.map((line, i) => {
    const p = pieces[i];
    const own = !p.empty && !p.merged;
    return {
      key: line.key,
      start: own ? cuts[p.k].at : cuts[p.j].at,
      end: cuts[p.j].at,
      empty: !!p.empty,
      merged: !!p.merged,
      lexical: own ? measure(p.first, p.last, p.k, p.j).lexical : 0,
      margin: null,
    };
  });
  let prev = null;
  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    if (p.empty || p.merged) continue;
    if (prev) {
      const score = (at) => scoreOf(prev, prev.k, at) + scoreOf(p, at, p.j) + cutValue(at, prev.first, prev.last);
      const here = score(prev.j);
      let best = -Infinity;
      // A piece covering several lines holds no cut, so the cut beside one can't move.
      if (prev.first === prev.last && p.first === p.last) {
        for (let alt = prev.k + 1; alt < p.j; alt++) if (alt !== prev.j) best = Math.max(best, score(alt));
      }
      results[i].margin = best === -Infinity ? null : here - best;
    }
    prev = p;
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// Running it

const pages = walk(path.join(UPSTREAM, 'sutta')).filter((f) => f.endsWith('.html'));
// dhammatalks.org's pages are read last, so where an older copy covers the same line they win.
const fromDhammatalks = (f) => /dhammatalks/.test(String(sources[path.relative(UPSTREAM, f)] ?? ''));
pages.sort((a, b) => fromDhammatalks(a) - fromDhammatalks(b) || a.localeCompare(b));

// Every text, parsed once: its blocks and notes, its Pali lines, and its page's words read the
// second way.
const units = [];
for (const file of pages) {
  const name = path.basename(file, '.html');
  if (only && !only.has(name)) continue;
  for (const unit of parsePage(file)) {
    unit.name = name;
    unit.file = path.relative(UPSTREAM, file);
    unit.want = pageWords(unit.roots);
    unit.roots = null;
    unit.lines = targetsFor(unit.uids);
    unit.body = unit.lines.filter((l) => !l.title);
    unit.stream = streamOf(unit.blocks);
    unit.titles = unit.titles.filter((t) => unit.stream.blocks[t.block]).map((t) => ({ title: t.title, at: unit.stream.blocks[t.block].at }));
    unit.missedNotes = attachCopyNotes(unit);
    units.push(unit);
  }
}
// The text each line's English is written from: the last to cover it.
const writer = new Map();
for (const unit of units) for (const line of unit.body) writer.set(line.key, unit);
// An older copy's sutta a dhammatalks.org page also has is left out whole.
for (let i = units.length - 1; i >= 0; i--) {
  if (units[i].body.length && units[i].body.every((l) => writer.get(l.key) !== units[i])) units.splice(i, 1);
}

// The words this translator uses for Sujato's, learned from the lines a first pass aligns surely:
// a pair seen together often enough, and seldom apart, is taken as one rendering of the other.
// A full run learns them and keeps them in learned.json, which a run with --only reads.
const LEARNED_FILE = path.join(OUT, 'learned.json');
if (!only) {
  const together = new Map();
  const seen = new Map();
  const learnedPages = new Set();
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const unit of units) {
    // A page given whole to several texts is learned from once.
    if (unit.wholePage && learnedPages.has(unit.file)) continue;
    if (unit.wholePage) learnedPages.add(unit.file);
    const body = unit.wholePage ? targetsFor(uidsOf(unit.name)).filter((line) => !line.title) : unit.body;
    if (!body.length || !unit.stream.text) continue;
    const aligned = align(unit.stream, body);
    aligned?.results.forEach((r, i) => {
      if (r.empty || r.merged || !body[i].en || r.lexical < 1 || (r.margin !== null && r.margin < UNSURE)) return;
      const theirs = new Set(wordsOf(unit.stream.text.slice(r.start, r.end)));
      const his = new Set(wordsOf(body[i].en));
      for (const t of theirs) count(seen, `t ${t}`);
      for (const s of his) count(seen, `s ${s}`);
      for (const t of theirs) for (const s of his) if (t !== s) count(together, `${s} ${t}`);
    });
  }
  const table = {};
  for (const [pair, n] of together) {
    if (n < LEARN_MIN) continue;
    const [s, t] = pair.split(' ');
    const dice = (2 * n) / (seen.get(`t ${t}`) + seen.get(`s ${s}`));
    if (dice >= LEARN_DICE) (table[s] ??= []).push(t);
  }
  fs.writeFileSync(LEARNED_FILE, `${JSON.stringify(table, null, 1)}\n`);
}
for (const [s, ts] of Object.entries(readJson(LEARNED_FILE))) learned.set(idOf(s), ts.map(idOf));

// What a review has settled, by line: the words that end the line before it, or
//   after  – those words
//   empty  – the line holds no text: 'up', its English is inside the line above's; 'down', its text
//            is the line below's; 'stay', the translation leaves it out
//   own    – the alignment leaves the line empty, and the review gave it text
//   placed – a review settled where the line starts
const CUTS_FILE = path.join(OUT, 'cuts.json');
// Returns the words a settled line starts after, if any.
const anchorOf = (decision) => (typeof decision === 'string' ? decision : decision?.after);
const decisions = readJson(CUTS_FILE);

// The read-throughs' findings, by line: the words the line should start with, or null for none. A
// line two readers disagree on is left out, unless a fix made by hand, in review/hand/, settles it.
const findings = new Map();
// The lines readers disagree on that no fix by hand settles: { key, starts: each reader's finding }.
const disputed = [];
// Returns whether two findings for a line agree: both empty it, or both quote the same words as far as the shorter goes.
const agree = (a, b) => {
  if (a === null || b === null) return a === b;
  const [x, y] = [a, b].map((s) => s.toLowerCase().match(WORD_RE) ?? []);
  return x.slice(0, y.length).join(' ') === y.slice(0, x.length).join(' ');
};
if (weighing) {
  const HAND = path.join(REVIEW, 'hand');
  const files = fs.globSync(path.join(REVIEW, '*', '*.findings'));
  const torn = new Set();
  const byHand = new Map();
  // Each line's findings, one a reader.
  const proposals = new Map();
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^(\S+:\S+) (?:starts: (.+)|none)$/.exec(line.trim());
      if (!m) continue;
      const starts = m[2]?.trim() ?? null;
      if (path.dirname(file) === HAND) {
        byHand.set(m[1], starts);
        continue;
      }
      proposals.set(m[1], [...(proposals.get(m[1]) ?? []), starts]);
      if (findings.has(m[1]) && !agree(findings.get(m[1]), starts)) torn.add(m[1]);
      // Of two findings that agree, the longer quote is kept.
      if (!findings.has(m[1]) || (starts?.length ?? 0) > (findings.get(m[1])?.length ?? 0)) findings.set(m[1], starts);
    }
  }
  for (const key of torn) findings.delete(key);
  for (const [key, starts] of byHand) findings.set(key, starts);
  for (const key of torn) if (!byHand.has(key)) disputed.push({ key, starts: [...new Set(proposals.get(key))] });
}

// Moves each cut a review settled to where the text before it ends with the settled words, nearest
// the cut the alignment made, as a formula can repeat them; one that no longer fits the text is
// reported as stale. It goes over the cuts until none moves, since a settled cut can pass where the
// alignment put the next one only once that one has moved.
//
// Before the cuts, a line the review emptied gives its text to the line above that has some, from
// where the cut below takes it back if the review put it there, or, with none above, to the line
// below that has some or that the review fills; and a line it filled, empty or
// joined to the line above, becomes a piece of no length, which the cuts around it give its text.
function applyDecisions(
  results,
  text,
  entry,
  // What's settled for each line: cuts.json's, or those with a group of findings added.
  decided = decisions,
) {
  const holdsText = (r) => !r.empty && !r.merged;
  results.forEach((r, i) => {
    const d = decided[r.key];
    if (!d || typeof d !== 'object') return;
    if (holdsText(r) && (d.empty === 'up' || d.empty === 'down')) {
      const above = results.findLast((o, x) => x < i && holdsText(o));
      const below = results.find((o, x) => x > i && (holdsText(o) || decided[o.key]?.own));
      if (above) {
        above.end = r.end;
        r.start = r.end;
      } else if (below) {
        below.start = r.start;
        r.end = r.start;
      } else return;
      if (d.empty === 'up') r.merged = true;
      else r.empty = true;
      r.margin = null;
    } else if (!holdsText(r) && d.own) {
      r.filled = { empty: r.empty, merged: r.merged };
      r.empty = r.merged = false;
    }
  });
  let moving = true;
  let unplaced = [];
  for (let pass = 0; moving && pass <= results.length; pass++) {
    moving = false;
    unplaced = [];
    let prev = -1;
    results.forEach((r, i) => {
      if (r.empty || r.merged) return;
      const before = anchorOf(decided[r.key]);
      if (before !== undefined && prev !== -1) {
        const p = results[prev];
        let at = -1;
        for (let from = text.indexOf(before, Math.max(0, p.start - before.length)); from !== -1 && from < r.end; from = text.indexOf(before, from + 1)) {
          const end = from + before.length;
          const next = end + (/^\s+/.exec(text.slice(end, end + 4))?.[0].length ?? 0);
          const ends = next > end || JOINS.test(before.at(-1));
          if (ends && next > p.start && next < r.end && (at === -1 || Math.abs(next - r.start) < Math.abs(at - r.start))) at = next;
        }
        if (at === -1) unplaced.push(r.key);
        else {
          if (r.start !== at) moving = true;
          p.end = at;
          r.start = at;
          r.margin = null;
          r.settled = true;
        }
      }
      prev = i;
    });
  }
  if (unplaced.length) (entry.stale ??= []).push(...unplaced);
  // A filled line the cuts gave no text is as the alignment left it.
  for (const r of results) if (r.filled && r.end <= r.start) Object.assign(r, r.filled);
}

// Returns the words before `at` that a settled cut is kept as: the last 40 characters, lengthened
// until they occur only once in the text, so the cut can't come back at another occurrence.
function anchorBefore(text, at) {
  let from = Math.max(0, at - 40);
  let anchor = text.slice(from, at).trimEnd();
  while (from > 0 && text.indexOf(anchor) !== text.lastIndexOf(anchor)) {
    from = Math.max(0, from - 40);
    anchor = text.slice(from, at).trimEnd();
  }
  return anchor;
}

// Returns each line's segment of `text`, whether it ends with no space after it, and the segments
// joined as they are written: a space after each but those.
function segmentsOf(results, text) {
  const segText = results.map((r) => text.slice(r.start, r.end).replace(/\s+/g, ' ').trim());
  const endsJoined = results.map((r) => r.end < text.length && JOINS.test(text[r.end - 1]));
  const joined = segText.map((s, i) => (s ? `${s}${endsJoined[i] ? '' : ' '}` : '')).join('').trim();
  return { segText, endsJoined, joined };
}

// Returns the places in `text`, after `lo` and before `hi`, where a line can start with the words a
// finding quotes: at their first word, taking in an opening quote or bracket the finding leaves out.
// The text's start is a place when `lo` is too.
function quotedAt(text, words, lo, hi) {
  const re = new RegExp(words.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
  const places = [];
  for (const m of text.slice(lo, hi).matchAll(re)) {
    let at = lo + m.index;
    while (at > lo && /[“‘"'([]/.test(text[at - 1])) at--;
    if (at === 0 || (at > lo && (/\s/.test(text[at - 1]) || JOINS.test(text[at - 1])))) places.push(at);
  }
  return places;
}

// Returns a place for each finding, or null for one left out: the places rise from one finding to
// the next, as a text's lines start in its order, and lie nearest their lines in all.
function rising(
  // Each finding in line order: { places, near }, near being where its line starts now.
  found,
  // What leaving a finding out costs: more than any distance.
  leftOut,
) {
  // The cheapest choices so far, by the place the last finding took.
  let best = new Map([[-1, { cost: 0, chosen: [] }]]);
  for (const { places, near } of found) {
    const next = new Map();
    const keep = (last, cost, chosen) => {
      if (!next.has(last) || cost < next.get(last).cost) next.set(last, { cost, chosen });
    };
    for (const [last, { cost, chosen }] of best) {
      keep(last, cost + leftOut, [...chosen, null]);
      for (const p of places) if (p > last) keep(p, cost + Math.abs(p - near), [...chosen, p]);
    }
    best = next;
  }
  return [...best.values()].reduce((a, b) => (b.cost < a.cost ? b : a)).chosen;
}

// References in each line's English to another sutta, by line, from the reviewers' list: the
// words that cite the sutta, and its ID. A reference citing no sutta by number, or more than one,
// is left as it is.
const CITE = /(?:\b(?:DN|MN|SN|AN|Sn|Snp|Dhp|Ud|Iti|Thag|Thig|Kp|Khp|Sutta)\s+)?(?<![§\d:.—–-])\b\d+(?:[:.]\d+)*(?:[-–]\d+)?/g;
const cites = new Map();
for (const ref of [readJson(path.join(OUT, 'references.json'))].flat()) {
  const found = (ref.source ?? ref.where) === 'text' && ref.target ? (ref.words.match(CITE) ?? []) : [];
  // A bare number cites nothing for certain: a citation has a colon or a collection's name.
  if (found.length === 1 && /[:A-Za-z]/.test(found[0])) cites.set(ref.key, [...(cites.get(ref.key) ?? []), { cite: found[0], target: ref.target }]);
}

// Returns each line's piece of the stream as it is written out: as aligned, except that a heading
// of the translator's split over consecutive Pali heading lines goes whole on the first of them.
function headingPresentation(stream, body, results) {
  const shown = results.map((r) => ({ ...r }));
  stream.blocks.forEach((block, b) => {
    if (block.kind !== 'h') return;
    const end = stream.blocks[b + 1]?.at ?? stream.text.length;
    const rows = shown.map((r, i) => ({ r, i })).filter(({ r }) =>
      !r.empty && !r.merged && r.end > block.at && r.start < end && stream.text.slice(Math.max(r.start, block.at), Math.min(r.end, end)).trim());
    if (rows.length < 2 || rows.some(({ r, i }) => !body[i].heading
      || stream.text.slice(r.start, block.at).trim() || stream.text.slice(end, r.end).trim())) return;
    const first = rows[0], last = rows.at(-1);
    if (body.slice(first.i, last.i + 1).some((line) => !line.heading || line.doc !== body[first.i].doc)) return;
    first.r.end = last.r.end;
    for (const { r } of rows.slice(1)) r.start = r.end;
  });
  return shown;
}

// Returns a line's English as it is written out, its segment with the translator's own layout
// marked inside it:
//   verse lines – each that starts inside it on a line of its own
//   paragraphs  – each in <p>, where two or more of his share the line, or one shares a Pali verse
//                 line with his verse
//   list items  – each of a bulleted list in <li>, the list in <ul>
//   indents     – each recognized iblock/sq-list item in <p>, inside its source div class
//   headings    – each of his in <span class="heading">, unless the line is all a Pali heading's
//   speakers    – each source-marked label in <span class="speaker">
//   references  – each to another sutta in the app's form, linking to it
function presented(
  stream,
  r,
  line,
  // The references to other suttas the line holds.
  cited = [],
  // The titles that open a sutta's text, each by where that text starts in the stream.
  titles = [],
) {
  const { text, blocks, speakers } = stream;
  const bounds = [r.start, ...blocks.filter((b) => b.at > r.start && b.at < r.end).map((b) => b.at), r.end];
  const pieces = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    let words = text.slice(bounds[k], bounds[k + 1]);
    for (const [from, to] of speakers.toReversed()) {
      let a = Math.max(from, bounds[k]), b = Math.min(to, bounds[k + 1]);
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (a < b) {
        a -= bounds[k];
        b -= bounds[k];
        words = `${words.slice(0, a)}<span class="speaker">${words.slice(a, b)}</span>${words.slice(b)}`;
      }
    }
    words = words.replace(/\s+/g, ' ').trim();
    if (words) pieces.push({ ...blocks.findLast((b) => b.at <= bounds[k]), words, at: bounds[k] });
  }
  const headingLine = line.heading && pieces.every((p) => p.kind === 'h');
  const prose = pieces.filter((p) => p.kind === 'p').length;
  const paragraphs = prose > 1 || (prose > 0 && line.verse && pieces.some((p) => p.kind === 'v' || p.kind === 'vs'));
  let paragraph = false;
  let out = pieces
    .map((p, k) => {
      let words = p.kind === 'h' && !headingLine ? `<span class="heading">${p.words}</span>` : p.words;
      if (p.kind === 'p' && (paragraphs || p.indent)) {
        words = `<p>${words}`;
        paragraph = true;
      }
      if (paragraph && pieces[k + 1]?.kind !== 'v') {
        words += '</p>';
        paragraph = false;
      }
      if (p.bullet) {
        words = `<li>${words}</li>`;
        if (!pieces[k - 1]?.bullet) words = `<ul>${words}`;
        if (!pieces[k + 1]?.bullet) words += '</ul>';
      }
      if (p.indent) {
        if (pieces[k - 1]?.indent !== p.indent) words = `<div class="${p.indent}">${words}`;
        if (pieces[k + 1]?.indent !== p.indent) words += '</div>';
      }
      for (const t of titles) if (t.at === p.at) words = `<span class="heading">${t.title}</span> ${words}`;
      return k === 0 ? words : `${p.kind === 'v' || p.kind === 'vs' ? '\n' : ' '}${words}`;
    })
    .join('');
  for (const { cite, target } of cited) {
    const at = new RegExp(`(?<![\\w:.])${cite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w|[:.]\\d)`, 'g');
    if ((out.match(at) ?? []).length === 1) out = out.replace(at, `<a href="https://suttacentral.net/${target}">${formatRef(target)}</a>`);
  }
  return out;
}

// Returns a text's findings: those that change its lines, in groups, each tried, and the others. A
// group is the findings whose lines share a neighbour with text; it passes if each of its findings
// takes effect and the text still reads whole. The words a finding quotes are looked for between
// the lines around it that keep their start: those with text and no finding.
//   groups – { text, verdict, findings, lines }: the lines around the group, each with its Pali,
//            Sujato's English and the translation before and after, as it is written
//   others – { key, starts, status }: 'already so', or 'not found' where its line can start
function weigh(unit, aligned) {
  const { body, stream, want } = unit;
  const { text } = stream;
  const run = (decided) => {
    const results = aligned.map((r) => ({ ...r }));
    applyDecisions(results, text, {}, decided);
    placePassageNotes(stream, body, results, {}, decided);
    spreadVerses(stream, body, results, {}, decided);
    joinParagraphOpenings(stream, body, results, {}, decided);
    joinHeardOpenings(stream, body, results, {});
    return { results, ...segmentsOf(results, text) };
  };
  const holds = (t, x) => !!t.segText[x] && !t.results[x].empty && !t.results[x].merged;
  const now = run(decisions);
  // Returns the nearest line with text from line x, a step at a time.
  const near = (x, step) => {
    do x += step;
    while (x >= 0 && x < body.length && !holds(now, x));
    return Math.min(Math.max(x, -1), body.length);
  };
  const others = [];
  const moves = [];
  // The findings saying where a line starts, since the last line that keeps its start.
  let pending = [];
  let from = 0;
  const place = (to) => {
    const chosen = rising(pending.map((m) => ({ places: quotedAt(text, m.starts, from, to), near: now.results[m.i].start })), text.length);
    pending.forEach((m, x) => {
      const at = chosen[x];
      if (holds(now, m.i) && at === now.results[m.i].start) others.push({ key: m.key, starts: m.starts, status: 'already so' });
      else if (at === null) others.push({ key: m.key, starts: m.starts, status: 'not found' });
      else {
        // A line starting the text has no words before it to settle it after.
        const settles = at ? { after: anchorBefore(text, at), placed: true } : { placed: true };
        if (aligned[m.i].empty || aligned[m.i].merged) settles.own = true;
        moves.push({ ...m, at, settles });
      }
    });
    pending = [];
  };
  body.forEach((line, i) => {
    const starts = writer.get(line.key) === unit ? findings.get(line.key) : undefined;
    if (starts === undefined) {
      if (!holds(now, i)) return;
      place(now.results[i].start);
      from = now.results[i].start;
    } else if (starts !== null) pending.push({ key: line.key, starts, i });
    else if (holds(now, i)) moves.push({ key: line.key, starts, i, settles: { empty: 'up' } });
    else others.push({ key: line.key, starts, status: 'already so' });
  });
  place(text.length);
  moves.sort((a, b) => a.i - b.i);
  // A line emptied whose text the next line takes gives it down.
  for (const m of moves) {
    const below = moves.find((o) => o.i === near(m.i, 1));
    if (m.starts === null && below?.at <= now.results[m.i].start) m.settles.empty = 'down';
  }

  const spans = [];
  for (const m of moves) {
    const [lo, hi] = [Math.max(near(m.i, -1), 0), Math.min(near(m.i, 1), body.length - 1)];
    if (spans.length && lo <= spans.at(-1).hi) {
      spans.at(-1).hi = Math.max(spans.at(-1).hi, hi);
      spans.at(-1).moves.push(m);
    } else spans.push({ lo, hi, moves: [m] });
  }
  const groups = spans.map(({ lo, hi, moves: group }) => {
    const decided = { ...decisions };
    for (const m of group) decided[m.key] = m.settles;
    const t = run(decided);
    const took = group.every((m) => (m.starts === null ? !holds(t, m.i) : holds(t, m.i) && t.results[m.i].start === m.at));
    const verdict = t.joined !== want.join(' ') ? 'breaks the text' : took ? 'passes' : 'takes no effect';
    const lines = [];
    const shown = (run, x) => (run.segText[x] ? presented(stream, run.results[x], body[x]) : '');
    for (let x = lo; x <= hi; x++) {
      const { key, pali, en: sujato, verse } = body[x];
      lines.push({ key, pali, sujato, ...(verse && { verse }), before: shown(now, x), after: shown(t, x) });
    }
    return { text: unit.name, verdict, findings: group.map(({ key, starts, settles }) => ({ key, starts, settles })), lines };
  });
  return { groups, others };
}

const outDocs = new Map();
const report = [];
const COVERED_FILE = path.join(OUT, 'covered.json');
const covered = new Set(fs.existsSync(COVERED_FILE) ? readJson(COVERED_FILE) : []);
// The findings tried: the groups that change lines, and the findings that change none.
const weighed = [];
const unmoved = [];

for (const unit of units) {
  {
    const { name, lines, body, stream, want } = unit;
    const entry = { file: unit.file, uids: unit.uids.join(' ') };
    if (unit.wholePage) entry.wholePage = true;
    if (unit.missedNotes.length) entry.noteErrors = unit.missedNotes.map((id) => `unplaced ${id}`);
    report.push(entry);
    // A page with no text: the book gives the sutta only as "the same as the last".
    if (!stream.text && !want.length) {
      entry.empty = true;
      continue;
    }
    if (!body.length || !stream.text) {
      entry.error = body.length ? 'no text' : 'no Pali lines';
      continue;
    }
    const aligned = align(stream, body);
    if (!aligned) {
      entry.error = 'no alignment';
      continue;
    }
    const { results } = aligned;
    if (weighing) {
      const { groups, others } = weigh(unit, results);
      weighed.push(...groups);
      unmoved.push(...others);
      if (keepFindings) for (const g of groups) if (g.verdict === 'passes') for (const f of g.findings) decisions[f.key] = f.settles;
    }
    applyDecisions(results, stream.text, entry);
    placePassageNotes(stream, body, results, entry);
    spreadVerses(stream, body, results, entry);
    joinParagraphOpenings(stream, body, results, entry);
    joinHeardOpenings(stream, body, results, entry);
    const { segText, endsJoined, joined: got } = segmentsOf(results, stream.text);

    // The text check: the segments, joined as they are written — a space after each but one with no
    // space after it — are character for character the page's text read the second way.
    const page = want.join(' ');
    if (got !== page) {
      let at = 0;
      while (at < got.length && got[at] === page[at]) at++;
      entry.error = `text differs at character ${at}: "${page.slice(at - 20, at + 20)}" / "${got.slice(at - 20, at + 20)}"`;
      continue;
    }
    for (const opening of entry.heardOpenings ?? []) covered.add(opening.next);

    // Each note goes to the segment its marker is in; a marker ends the words before it. A marker
    // naming no note takes the unused one numbered the same, as SN 38.12's, whose note is SN 38.8's.
    const segNotes = results.map(() => []);
    for (const mark of stream.marks) {
      let i = results.findIndex((r) => r.end > r.start && r.start < mark.at && mark.at <= r.end);
      if (i === -1) i = results.findLastIndex((r) => r.end > r.start && r.start <= mark.at);
      const number = /note\d+$/.exec(mark.id)?.[0];
      const note = unit.notes.get(mark.id) ?? [...unit.notes.values()].find((nt) => !nt.used && number && nt.id?.endsWith(number));
      if (note && i !== -1) {
        segNotes[i].push(note.html);
        note.used++;
      } else entry.noteErrors = [...(entry.noteErrors ?? []), mark.id];
    }
    // Notes whose marker is in the title or the introduction go with them, on the title line; on a
    // page of several suttas, the unused ones are the others'.
    const unusedNotes = unit.oneOfSeveral ? [] : [...unit.notes.values()].filter((nt) => !nt.used);
    const titleNotes = unusedNotes.filter((nt) => !nt.beforeSeeAlso).map((nt) => nt.html);
    const beforeSeeAlso = unusedNotes.filter((nt) => nt.beforeSeeAlso).map((nt) => nt.html);

    // What the Pali shows: each line Sujato translates either has English here or its Pali joins a
    // neighbour's; a piece carrying two or more such lines besides its own is longer than his.
    const own = results.map((r, i) => !!segText[i] && !r.merged && !r.empty);
    let carried = 0;
    let long = 0;
    let joined = 0;
    for (let i = 0; i < body.length; i++) {
      if (own[i]) {
        if (carried >= 2) long++;
        carried = 0;
      } else if (body[i].en) {
        joined++;
        carried++;
      }
    }
    if (carried >= 2) long++;
    Object.assign(entry, {
      lines: body.length,
      segments: own.filter(Boolean).length,
      unsure: results.filter((r) => r.margin !== null && r.margin < UNSURE).length,
      unsureKeys: results.filter((r) => r.margin !== null && r.margin < UNSURE).map((r) => `${r.key}@${r.margin.toFixed(2)}`),
      joined,
      merged: results.filter((r, i) => r.merged && body[i].en).length,
      elided: results.filter((r, i) => r.empty && body[i].en).length,
      long,
      unmatched: results.filter((r, i) => segText[i].length > 40 && r.lexical < 1).length,
      ratio: Number(aligned.ratio.toFixed(2)),
    });

    // Into each document's files.
    for (const line of lines) {
      if (!outDocs.has(line.doc)) {
        const d = loadDoc(line.doc);
        outDocs.set(line.doc, { dir: d.dir, text: Object.fromEntries(Object.keys(d.pali).map((k) => [k, ''])), notes: {} });
      }
    }
    const put = (line, text, notes, endsJoined) => {
      const out = outDocs.get(line.doc);
      out.text[line.key] = text ? `${text}${endsJoined ? '' : ' '}` : '';
      if (notes.length) out.notes[line.key] = notes.join(' ');
    };
    // The title line: one of those the text opens with, as a later sutta's are another's.
    const head = lines.slice(0, Math.max(0, lines.findIndex((l) => !l.title)));
    const titleLine = head.find((l) => l.suttaTitle) ?? head.at(-1);
    const titleParts = [...unit.intro, ...beforeSeeAlso, ...unit.seeAlso, ...titleNotes];
    if (titleLine) put(titleLine, unit.title, [titleParts.map((p) => `<p>${p}</p>`).join('')].filter(Boolean));
    // With none, its notes go with the first line that has text.
    else if (titleParts.length) segNotes[Math.max(0, segText.findIndex(Boolean))].unshift(...titleParts);
    // The titles no title line holds open their sutta's text as headings: a page's later suttas',
    // and a sutta's own where the Pali has no title line for it.
    const titles = titleLine || !unit.title ? unit.titles : [{ title: unit.title, at: 0 }, ...unit.titles];
    // Each reference to another sutta goes with the line that holds its words: its own, or the
    // nearest that does, where a review moved them.
    const cited = new Map();
    const byDistance = (i) => segText.map((_, x) => x).sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b);
    body.forEach((line, i) => {
      for (const c of cites.get(line.key) ?? []) {
        const x = byDistance(i).find((x) => segText[x]?.includes(c.cite));
        if (x !== undefined) cited.set(x, [...(cited.get(x) ?? []), c]);
      }
    });
    const shown = headingPresentation(stream, body, results);
    body.forEach((line, i) => put(line, segText[i] && presented(stream, shown[i], line, cited.get(i), titles), segNotes[i], endsJoined[i]));
  }
}

for (const [doc, out] of outDocs) {
  const textFile = path.join(OUT, 'sutta', out.dir, `${doc}_translation-en-${translator}.json`);
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, `${JSON.stringify(out.text, null, 2)}\n`);
  if (Object.keys(out.notes).length) {
    const notes = Object.fromEntries(Object.keys(out.text).map((k) => [k, out.notes[k] ?? '']));
    const notesFile = path.join(OUT, 'notes', out.dir, `${doc}_comment-en-${translator}.json`);
    fs.mkdirSync(path.dirname(notesFile), { recursive: true });
    fs.writeFileSync(notesFile, `${JSON.stringify(notes, null, 2)}\n`);
  } else if (!only) fs.rmSync(path.join(OUT, 'notes', out.dir, `${doc}_comment-en-${translator}.json`), { force: true });
}
if (!only) fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
if (report.some(entry => !entry.error && entry.heardOpenings?.length)) {
  fs.writeFileSync(COVERED_FILE, `${JSON.stringify([...covered], null, 2)}\n`);
}
const stale = report.flatMap((r) => r.stale ?? []);
if (stale.length) console.log(`${stale.length} settled cuts no longer fit: ${stale.slice(0, 10).join(' ')}`);
if (weighing) {
  const seen = new Set([...weighed.flatMap((g) => g.findings.map((f) => f.key)), ...unmoved.map((f) => f.key)]);
  const others = [...unmoved, ...[...findings].filter(([key]) => !seen.has(key)).map(([key, starts]) => ({ key, starts, status: 'not weighed' }))];
  fs.mkdirSync(REVIEW, { recursive: true });
  fs.writeFileSync(path.join(REVIEW, 'findings.json'), `${JSON.stringify({ groups: weighed, others, disputed }, null, 1)}\n`);
  const verdicts = [...new Set(weighed.map((g) => g.verdict))].map((v) => {
    const gs = weighed.filter((g) => g.verdict === v);
    return `${gs.reduce((a, g) => a + g.findings.length, 0)} in ${gs.length} groups: ${v}`;
  });
  const statuses = [...new Set(others.map((f) => f.status))].map((s) => `${others.filter((f) => f.status === s).length} ${s}`);
  console.log(`findings: ${findings.size} lines; ${[...verdicts, ...statuses, `${disputed.length} disputed`].join('; ')}`);
}
if (keepFindings) fs.writeFileSync(CUTS_FILE, `${JSON.stringify(decisions, null, 1)}\n`);

const ok = report.filter((r) => !r.error && !r.empty);
const sum = (f) => ok.reduce((a, r) => a + r[f], 0);
console.log(
  `${translator}: ${report.length} texts, ${report.filter((r) => r.empty).length} empty, ${report.filter((r) => r.error).length} not written; ` +
    `${sum('segments')} segments, ${sum('unsure')} unsure cuts, ${sum('joined')} lines joined, ` +
    `${sum('long')} long, ${sum('unmatched')} unmatched; ${ok.filter((r) => !r.unsure && !r.long && !r.unmatched).length} texts clean`,
);
for (const r of report.filter((r) => r.error || r.noteErrors)) console.log(`  ${r.file}: ${r.error ?? ''} ${r.noteErrors?.join(' ') ?? ''}`);
