#!/usr/bin/env node
// Splits another translator's English, as its source publishes it, into the Pali's segments, the way
// data/sujato is split, so each line of the translation sits on the Pali line it translates.
//
//   node scripts/segment-translations.mjs <bodhi|thanissaro> [--only name,…] [--review name,…]
//                                        [--items <margin>] [--whole] [--recheck key,…] [--places]
//                                        [--answers] [--keep-settled] [--overview]
//                                        [--findings] [--keep-findings]
//
// Reads data/upstream/<translator>/ and writes data/<translator>/, in data/sujato's layout:
//   sutta/…_translation-en-<translator>.json  every Pali key of a document, its English or ""
//   notes/…_comment-en-<translator>.json      the translator's notes; the introduction and "see also"
//                                             sit on the sutta's title line
//   cuts.json                                 what a review settled for a line, kept across runs
//   learned.json                              the translator's words learned for Sujato's
//   report.json                               each text's alignment and how sure it is
//   review/                                   the review pages and the cuts put up for review
//
// The English is only ever cut, never rewritten: a text whose segments, joined, aren't word for word
// the text of its page, read a second way, is reported and not written.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');

const args = process.argv.slice(2);
const translator = args[0];
if (!['bodhi', 'thanissaro'].includes(translator)) {
  console.error('usage: segment-translations.mjs <bodhi|thanissaro> [--only name,…] [--review name,…]');
  process.exit(1);
}
const listArg = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : new Set(args[i + 1].split(','));
};
const only = listArg('--only');
const reviewed = listArg('--review') ?? new Set();
const valueArg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
// --items <margin>: puts the cuts less sure than <margin> up for review, in batches.
const itemsBelow = valueArg('--items') === null ? null : Number(valueArg('--items'));
// --whole: shows each cut up for review with both its lines whole, not 300 characters either side.
const whole = args.includes('--whole');
// --recheck key,…: puts these settled cuts up for review as well.
const recheck = listArg('--recheck') ?? new Set();
// --places: puts up for review the places a moved cut can't mend: a line left with only a sentence's
// opening word or two, and a line left empty whose English is likely next door.
const places = args.includes('--places');
// --answers: keeps the review's answers so far in cuts.json, and clears the batches they answer.
const applyAnswers = args.includes('--answers');
// --keep-settled: with --answers, leaves out an answer for a line a review has settled since.
const keepSettled = args.includes('--keep-settled');
// --overview: writes two pages over every text: review/moves.html, the cuts the review moved, and
// review/empty.html, the lines left empty whose English is likely next door.
const overview = args.includes('--overview');
// --findings: tries the read-through's findings (review/read/*.findings and
// review/closing-lines.findings), and writes review/findings.json: what each group of them changes,
// and whether it passes.
const weighing = args.includes('--findings') || args.includes('--keep-findings');
// --keep-findings: as --findings, and keeps the findings that pass in cuts.json.
const keepFindings = args.includes('--keep-findings');

const UPSTREAM = path.join(DATA, 'upstream', translator);
const OUT = path.join(DATA, translator);
const REVIEW = path.join(OUT, 'review');

// ---------------------------------------------------------------------------------------------
// The Pali side: documents, their keys, Sujato's English and the markup

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

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

// Returns the uids an upstream file's name covers: its own, or each of a span's ("sn15.14-19").
function uidsOf(name) {
  if (docDir.has(name)) return [name];
  const range = /^(.*?)(\d+)-(\d+)$/.exec(name);
  if (!range) return [name];
  const uids = [];
  for (let n = +range[2]; n <= +range[3]; n++) uids.push(range[1] + n);
  return uids;
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

// Returns a link's target as the app reads note links: a SuttaCentral link for a text the app
// holds, else an absolute link to its source.
function fixHref(href) {
  if (href.startsWith('#')) return null;
  const local = href.replace(/^https?:\/\/www\.dhammatalks\.org/, '');
  const [page, hash] = local.split('#');
  const uid = pageUid.get(page);
  if (uid) return `https://suttacentral.net/${uid}${hash ? `#${hash}` : ''}`;
  return local.startsWith('/') ? `https://www.dhammatalks.org${local}` : href;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns an element's inner HTML with its links fixed and every other tag but <i> dropped.
function noteHtml(el) {
  let html = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) html += escapeHtml(node.data);
    else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      // A note's link back to its marker, and a marker's number.
      if (node.matches('a.footnote-back, span.fn, a.footnote-ref')) continue;
      const inner = noteHtml(node);
      if (tag === 'p' || tag === 'div') html += ` ${inner} `;
      else if (tag === 'a') {
        const href = node.getAttribute('href') && fixHref(node.getAttribute('href'));
        html += href ? `<a href='${href}'>${inner}</a>` : inner;
      } else if (tag === 'em' || tag === 'i') html += `<i>${inner}</i>`;
      else html += inner;
    }
  }
  return html.replace(/\s+/g, ' ').trim();
}

// SuttaCentral's SC and PTS numbers.
const REF = 'a.ref';
// A note marker, in either of dhammatalks.org's styles.
const NOTE_MARK = 'span.fn, a.footnote-ref';
// Elements whose text is not the translation's; each parser marks the others it leaves out.
const NOT_TEXT = `${REF}, ${NOTE_MARK}, [data-skip]`;
const skip = (el) => el.setAttribute('data-skip', '');

// Returns an element's text, with the note markers in it and a "\n" for each <br>.
function inlineText(el, acc = { text: '', marks: [] }) {
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

// Returns `text` with its whitespace collapsed, a run holding a newline becoming one, and each mark
// moved to where its offset lands.
function collapse({ text, marks }) {
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
  return { text: trimmed, marks: marks.map((m) => ({ id: m.id, at: Math.min(Math.max(map[m.at] - lead, 0), trimmed.length) })) };
}

// Returns the blocks of an element's text, one per line.
//   kind – the first line's kind; later lines are verse lines ("v")
function blocksOf(el, kind) {
  const { text, marks } = collapse(inlineText(el));
  // A line that is only a speaker's name, as SuttaCentral's "The Blessed One:" before a verse.
  const speakers = new Set([...el.querySelectorAll('span.speaker')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()));
  const blocks = [];
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    if (line) {
      const own = marks.filter((m) => m.at >= offset && m.at <= offset + line.length);
      const lineKind = speakers.has(line) ? 'spk' : i === 0 ? kind : 'v';
      blocks.push({ kind: lineKind, text: line, marks: own.map((m) => ({ id: m.id, at: m.at - offset })) });
    }
    offset += line.length + 1;
  });
  return blocks;
}

// Returns the blocks of an element laid out in lines, as <pre> is, a blank line starting a stanza.
function lineBlocks(el) {
  const { text, marks } = inlineText(el);
  const blocks = [];
  let stanza = true;
  let offset = 0;
  for (const raw of text.split('\n')) {
    const own = marks.filter((m) => m.at >= offset && m.at <= offset + raw.length).map((m) => ({ id: m.id, at: m.at - offset }));
    const line = collapse({ text: raw, marks: own });
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

// Returns whether a paragraph is wholly italic, as a dhammatalks.org introduction's are.
function whollyItalic(el) {
  const all = el.textContent.replace(/\s+/g, '');
  const italic = [...el.querySelectorAll('em, i')].map((e) => e.textContent).join('').replace(/\s+/g, '');
  return all.length > 0 && italic.length >= all.length * 0.9;
}

const newUnit = (uids, title, root) => ({ uids, title, roots: [root], blocks: [], intro: [], seeAlso: [], notes: new Map() });

// Returns the texts of a dhammatalks.org page: one, the page's. A file joining several pages, as
// an2.31.html does, holds each page's <div id="sutta">, read in order as one text.
function parseDhammatalks(document, name) {
  const roots = [...document.querySelectorAll('#sutta')];
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

  function handle(el, verse) {
    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute('class') ?? '';
    if (el.hasAttribute('data-skip')) return;
    if (tag === 'h1') return skip(el);
    // A wrapper, such as MN 10's <div id="MN10">, holds the introduction as well as the text.
    if (tag === 'div' && !cls) return void eachBlock(el, (child) => handle(child, verse));
    if (/\bnote\b/.test(cls) && (tag === 'div' || tag === 'section')) {
      skip(el);
      let note = null;
      for (const part of el.children) {
        if (/notetitle/.test(part.getAttribute('class') ?? '')) continue;
        const html = noteHtml(part);
        if (part.id) unit.notes.set(part.id, (note = { id: part.id, html: html.replace(/^\d+\.\s*/, ''), used: 0 }));
        else if (note) note.html += ` ${html}`;
      }
      return;
    }
    // A note outside the notes' box, as SN 1.20's are, where the box closes before them.
    if (tag === 'p' && /note\d+$|^fn\d+$/.test(el.id)) {
      unit.notes.set(el.id, { id: el.id, html: noteHtml(el).replace(/^\d+\.\s*/, ''), used: 0 });
      return skip(el);
    }
    if (/seealso/.test(cls) || (tag === 'p' && /^\s*See also:/.test(el.textContent))) {
      unit.seeAlso.push(noteHtml(el));
      return skip(el);
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
      if (starred || /\bintro\b/.test(cls) || /iblock/.test(cls) || (tag === 'p' && whollyItalic(el))) {
        unit.intro.push(noteHtml(el));
        return skip(el);
      }
      body = true;
    }
    if (tag === 'div' || tag === 'article') {
      const verseDiv = /verse/.test(cls);
      let first = true;
      eachBlock(el, (child) => {
        handle(child, verseDiv ? (first ? 'first' : 'next') : verse);
        if (child.tagName.toLowerCase() === 'p' && !/vspk/.test(child.getAttribute('class') ?? '')) first = false;
      });
      return;
    }
    if (tag === 'pre') return void unit.blocks.push(...lineBlocks(el));
    if (/^h[2-6]$/.test(tag)) return void unit.blocks.push(...blocksOf(el, 'h'));
    if (tag === 'p' || tag === 'blockquote') {
      const kind = /vspk/.test(cls) ? 'spk' : verse === 'first' ? 'vs' : verse ? 'v' : 'p';
      unit.blocks.push(...blocksOf(el, kind));
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
      if (tag === 'ol' || tag === 'ul') return void eachBlock(el, (li) => unit.blocks.push(...blocksOf(li, 'li')));
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
  if (units.length < 2 || units.every((u) => u.uids.length === 1 && u.uids[0] !== name)) return units;
  const page = newUnit(uidsOf(name), units[0].title, null);
  page.roots = units.flatMap((u) => u.roots);
  page.blocks = units.flatMap((u) => u.blocks);
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
  const { document } = new JSDOM(fs.readFileSync(file, 'utf8')).window;
  if (document.querySelector('#sutta')) return parseDhammatalks(document, name);
  if (document.querySelector('article')) return parseSuttaCentral(document, name);
  return parseAccessToInsight(document, name);
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

// Returns the text a page's blocks make, one stream, with its note marks and the places a segment
// may end: after whitespace, or right after a dash, as Sujato's own lines end, so the segments joined
// with a space, or none after a dash, are the text.
function streamOf(blocks) {
  let text = '';
  const starts = [];
  const marks = [];
  for (const block of blocks) {
    if (text) text += '\n';
    starts.push({ at: text.length, kind: block.kind });
    for (const m of block.marks) marks.push({ id: m.id, at: text.length + m.at });
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
  return { text, marks, cuts: [...cuts.values()].sort((a, b) => a.at - b.at) };
}

// Returns each line's piece of the stream — its span, and whether it's empty or merged into the
// piece of a line above — with how sure each cut is, or null if no alignment fits.
function align(stream, lines) {
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
        if (before[j] > NEG) {
          row[j] = before[j] + emptyScore[i];
          fromK[j] = j;
          fromG[j] = -1;
        }
      }
      let a0 = 0;
      while (a0 < allowed.length && cuts[allowed[a0]].at < lo[i]) a0++;
      let a1 = allowed.length - 1;
      while (a1 >= 0 && cuts[allowed[a1]].at > hi[i]) a1--;

      for (let g = 0; g < MAX_MERGE && g <= i; g++) {
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
          const bLast = g ? a - 1 : 0;
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
    unit.missedNotes = attachCopyNotes(unit);
    units.push(unit);
  }
}
// The text each line's English is written from: the last to cover it.
const writer = new Map();
for (const unit of units) for (const line of unit.body) writer.set(line.key, unit);

// The words this translator uses for Sujato's, learned from the lines a first pass aligns surely:
// a pair seen together often enough, and seldom apart, is taken as one rendering of the other.
// A full run learns them and keeps them in learned.json, which a run with --only reads.
const LEARNED_FILE = path.join(OUT, 'learned.json');
if (!only) {
  const together = new Map();
  const seen = new Map();
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const unit of units) {
    if (!unit.body.length || !unit.stream.text) continue;
    const aligned = align(unit.stream, unit.body);
    aligned?.results.forEach((r, i) => {
      if (r.empty || r.merged || !unit.body[i].en || r.lexical < 1 || (r.margin !== null && r.margin < UNSURE)) return;
      const theirs = new Set(wordsOf(unit.stream.text.slice(r.start, r.end)));
      const his = new Set(wordsOf(unit.body[i].en));
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
//   placed – its place has been reviewed, so it isn't put up as a place again
const CUTS_FILE = path.join(OUT, 'cuts.json');
// Returns the words a settled line starts after, if any.
const anchorOf = (decision) => (typeof decision === 'string' ? decision : decision?.after);
// Batches of cuts up for review: batch-NN.txt to read, batch-NN.json to resolve its marks, and
// batch-NN.answers as the review writes them.
const BATCHES = path.join(REVIEW, 'batches');
const BATCH_SIZE = 250;
const decisions = readJson(CUTS_FILE);
// Answer files: batch-NN.answers, or one per group of answers, batch-NN.answers.1, .2 …
const answered = () => (fs.existsSync(BATCHES) ? fs.readdirSync(BATCHES).filter((f) => /\.answers(\.\d+)?$/.test(f)) : []);
if (applyAnswers) {
  let kept = 0;
  const files = answered();
  for (const batch of new Set(files.map((f) => f.replace(/\.answers(\.\d+)?$/, '')))) {
    const items = readJson(path.join(BATCHES, `${batch}.json`));
    for (const file of files.filter((f) => f.startsWith(`${batch}.answers`))) {
      for (const line of fs.readFileSync(path.join(BATCHES, file), 'utf8').split('\n')) {
        const [key, answer] = line.trim().split(/\s+/);
        const item = items[key];
        const mark = answer === '=' ? item?.current : Number(answer);
        const chosen = item?.candidates[mark - 1];
        if (chosen === undefined) continue;
        // A candidate is the words before a cut, or what choosing it settles, by line.
        const settles = typeof chosen === 'string' ? { [key]: chosen } : chosen;
        if (keepSettled && Object.keys(settles).some((k) => decisions[k] !== undefined)) continue;
        Object.assign(decisions, settles);
        kept++;
      }
      fs.rmSync(path.join(BATCHES, file));
    }
    for (const ext of ['.json', '.txt']) fs.rmSync(path.join(BATCHES, batch + ext), { force: true });
  }
  fs.writeFileSync(CUTS_FILE, `${JSON.stringify(decisions, null, 1)}\n`);
  console.log(`${kept} answers kept in cuts.json`);
} else if ((itemsBelow !== null || places) && answered().length) {
  console.error('Answers are waiting in review/batches: keep them first with --answers.');
  process.exit(1);
}

// The read-through's findings, by line: the words the line should start with, or null for none. A
// line two findings disagree on is left out.
const findings = new Map();
if (weighing) {
  const dir = path.join(REVIEW, 'read');
  const files = [path.join(REVIEW, 'closing-lines.findings')];
  if (fs.existsSync(dir)) files.push(...fs.readdirSync(dir).filter((f) => f.endsWith('.findings')).map((f) => path.join(dir, f)));
  const torn = new Set();
  for (const file of files.filter((f) => fs.existsSync(f))) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^(\S+:\S+) (?:starts: (.+)|none)$/.exec(line.trim());
      if (!m) continue;
      const starts = m[2]?.trim() ?? null;
      if (findings.has(m[1]) && findings.get(m[1]) !== starts) torn.add(m[1]);
      findings.set(m[1], starts);
    }
  }
  for (const key of torn) findings.delete(key);
}

// Moves each cut a review settled to where the text before it ends with the settled words, nearest
// the cut the alignment made, as a formula can repeat them; one that no longer fits the text is
// reported as stale. It goes over the cuts until none moves, since a settled cut can pass where the
// alignment put the next one only once that one has moved. Each line is marked with what the review
// did to the cut above it, for the review page.
//
// Before the cuts, a line the review emptied gives its text to the line above that has some, from
// where the cut below takes it back if the review put it there, and a line it filled, empty or
// joined to the line above, becomes a piece of no length, which the cuts around it give its text.
function applyDecisions(
  results,
  text,
  entry,
  // What's settled for each line: cuts.json's, or those with a group of findings added.
  decided = decisions,
) {
  const aligned = results.map((r) => r.start);
  const holdsText = (r) => !r.empty && !r.merged;
  results.forEach((r, i) => {
    const d = decided[r.key];
    if (!d || typeof d !== 'object') return;
    if (holdsText(r) && (d.empty === 'up' || d.empty === 'down')) {
      const above = results.findLast((o, x) => x < i && holdsText(o));
      const below = results.find((o, x) => x > i && holdsText(o));
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
          const ends = next > end || /[—–]$/.test(before);
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
  // The words each moved cut carried across it, kept on the line that gained them.
  let prev = -1;
  results.forEach((r, i) => {
    if (r.empty || r.merged) return;
    if (r.settled && r.start !== aligned[i] && prev !== -1) {
      const words = text.slice(Math.min(r.start, aligned[i]), Math.max(r.start, aligned[i])).replace(/\s+/g, ' ').trim();
      if (r.start < aligned[i]) r.gainedAbove = words;
      else results[prev].gainedBelow = words;
      r.moved = results[prev].beside = true;
    }
    prev = i;
  });
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

// Returns each line's segment of `text`, whether it ends right after a dash, and the segments
// joined as they are written: a space after each but one ending right after a dash.
function segmentsOf(results, text) {
  const segText = results.map((r) => text.slice(r.start, r.end).replace(/\s+/g, ' ').trim());
  const endsAtDash = results.map((r) => /[—–]$/.test(text.slice(r.start, r.end)));
  const joined = segText.map((s, i) => (s ? `${s}${endsAtDash[i] ? '' : ' '}` : '')).join('').trim();
  return { segText, endsAtDash, joined };
}

// Returns the places in `text`, after `lo` and before `hi`, where a line can start with the words a
// finding quotes: at their first word, taking in an opening quote or bracket the finding leaves out.
function quotedAt(text, words, lo, hi) {
  const re = new RegExp(words.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
  const places = [];
  for (const m of text.slice(lo, hi).matchAll(re)) {
    let at = lo + m.index;
    while (at > lo + 1 && /[“‘"'([]/.test(text[at - 1])) at--;
    if (at > lo && /[\s—–]/.test(text[at - 1])) places.push(at);
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

// Returns a text's findings: those that change its lines, in groups, each tried, and the others. A
// group is the findings whose lines share a neighbour with text; it passes if each of its findings
// takes effect and the text still reads whole. The words a finding quotes are looked for between
// the lines around it that keep their start: those with text and no finding.
//   groups – { text, verdict, findings, lines }: the lines around the group, before and after
//   others – { key, starts, status }: 'already so', or 'not found' where its line can start
function weigh(unit, aligned) {
  const { body, stream, want } = unit;
  const { text } = stream;
  const run = (decided) => {
    const results = aligned.map((r) => ({ ...r }));
    applyDecisions(results, text, {}, decided);
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
        const settles = { after: anchorBefore(text, at), placed: true };
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
    for (let x = lo; x <= hi; x++) {
      const said = body[x].en ? { sujato: body[x].en } : { pali: body[x].pali };
      lines.push({ key: body[x].key, ...said, before: now.segText[x], after: t.segText[x] });
    }
    return { text: unit.name, verdict, findings: group.map(({ key, starts, settles }) => ({ key, starts, settles })), lines };
  });
  return { groups, others };
}

// Returns a review item for the cut between pieces `pi` and `i`: Sujato's English on each side (the
// Pali where he has none) and the translation around the cut, its places to cut numbered, the
// current one starred.
function reviewItem(stream, body, results, pi, i) {
  const { text, cuts } = stream;
  const p = results[pi];
  const r = results[i];
  const lo = whole ? p.start : Math.max(p.start, r.start - 300);
  const hi = whole ? r.end : Math.min(r.end, r.start + 300);
  const candidates = [];
  let current = 0;
  let shown = lo > p.start ? '…' : '';
  let from = lo;
  for (const { at } of cuts) {
    if (at <= p.start || at >= r.end || at < lo || at > hi) continue;
    candidates.push(anchorBefore(text, at));
    if (at === r.start) current = candidates.length;
    shown += `${text.slice(from, at)}[${candidates.length}${at === r.start ? '*' : ''}] `;
    from = at;
  }
  shown += text.slice(from, hi) + (hi < r.end ? '…' : '');
  const side = (ls) => ls.map((l) => l.en || `(Pali) ${l.pali}`).join(' ');
  return {
    key: r.key,
    text: `${r.key}\nS1: ${side(body.slice(pi, i))}\nS2: ${side([body[i]])}\nT: ${shown.replace(/\s*\n\s*/g, ' ¶ ')}`,
    current,
    candidates,
  };
}

// Most characters of a piece that a place's item shows.
const PLACE_SPAN = 600;

// Returns a review item over the stream's text from `lo` to `hi`, with the places it may be cut
// numbered and the current one starred.
//   key          – the item's name
//   s1, s2       – the lines before the cut, and those after it
//   marks        – the places in order: where each stands, and what choosing it settles, by line
//   now          – where the current place stands
//   clippedStart – the text goes on before `lo`
//   clippedEnd   – the text goes on after `hi`
function itemOf(stream, { key, s1, s2, lo, hi, marks, now, clippedStart = false, clippedEnd = false }) {
  const { text } = stream;
  const side = (ls) => ls.map((l) => l.en || `(Pali) ${l.pali}`).join(' ');
  let shown = clippedStart ? '…' : '';
  let from = lo;
  marks.forEach((m, n) => {
    shown += `${text.slice(from, m.at)}[${n + 1}${m.at === now ? '*' : ''}] `;
    from = m.at;
  });
  shown += text.slice(from, hi) + (clippedEnd ? '…' : '');
  return {
    key,
    text: `${key}\nS1: ${side(s1)}\nS2: ${side(s2)}\nT: ${shown.trim().replace(/\s*\n\s*/g, ' ¶ ')}`,
    current: marks.findIndex((m) => m.at === now) + 1,
    candidates: marks.map((m) => m.settles),
  };
}

// Returns the item for a sentence's opening left at the end of piece `pi`, whose sentence goes on in
// piece `i`: the cut between them, which may also leave either line without text.
//   alone – the opening is all of its piece, so its line may go empty
function openerItem(stream, body, results, pi, i, alone) {
  const { text, cuts } = stream;
  const p = results[pi];
  const r = results[i];
  const lo = r.start - p.start <= PLACE_SPAN ? p.start : r.start - PLACE_SPAN;
  const hi = r.end - r.start <= PLACE_SPAN ? r.end : r.start + PLACE_SPAN;
  const marks = [];
  // Before all the text: the opening's line goes empty, and the line below starts where it did.
  if (alone && !results[pi + 1].merged) {
    const starts = p.start ? { after: anchorBefore(text, p.start), placed: true } : { placed: true };
    marks.push({ at: p.start, settles: { [p.key]: { empty: 'down' }, [r.key]: starts } });
  }
  for (const { at } of cuts) {
    if (at <= p.start || at >= r.end || at < lo || at > hi) continue;
    marks.push({ at, settles: { [r.key]: { after: anchorBefore(text, at), placed: true } } });
  }
  // After all the text: the line below has none, its English being inside the line above's.
  if (hi === r.end) marks.push({ at: r.end, settles: { [r.key]: { empty: 'up' } } });
  return itemOf(stream, { key: r.key, s1: body.slice(pi, i), s2: [body[i]], lo, hi, marks, now: r.start, clippedStart: lo > p.start, clippedEnd: hi < r.end });
}

// Returns the item for line `i`, left empty, whose English is likely the end of piece `pi` above it:
// where that piece may be cut to give the line its text.
function tailItem(stream, body, results, pi, i) {
  const { text, cuts } = stream;
  const p = results[pi];
  const { key } = body[i];
  const lo = Math.max(p.start, p.end - PLACE_SPAN);
  const marks = [];
  for (const { at } of cuts) {
    if (at <= p.start || at >= p.end || at < lo) continue;
    marks.push({ at, settles: { [key]: { after: anchorBefore(text, at), own: true } } });
  }
  marks.push({ at: p.end, settles: { [key]: { empty: 'stay' } } });
  return itemOf(stream, { key, s1: body.slice(pi, i), s2: [body[i]], lo, hi: p.end, marks, now: p.end, clippedStart: lo > p.start });
}

// Returns the item for line `i`, left empty, whose English is likely the start of piece `ni` below
// it: where that piece may be cut to give the line its text.
function headItem(stream, body, results, i, ni) {
  const { text, cuts } = stream;
  const next = results[ni];
  const { key } = body[i];
  const hi = Math.min(next.end, next.start + PLACE_SPAN);
  // The filled line starts where the piece below did.
  const starts = next.start ? { after: anchorBefore(text, next.start), own: true } : { own: true };
  const marks = [{ at: next.start, settles: { [key]: { empty: 'stay' } } }];
  for (const { at } of cuts) {
    if (at <= next.start || at >= next.end || at > hi) continue;
    marks.push({ at, settles: { [key]: starts, [next.key]: { after: anchorBefore(text, at), placed: true } } });
  }
  return itemOf(stream, { key, s1: [body[i]], s2: [body[ni]], lo: next.start, hi, marks, now: next.start, clippedEnd: hi < next.end });
}

// What a reviewer reads before a batch of places.
const PLACE_INSTRUCTIONS = `# Reviewing places

Each item is a place where a translation may be cut wrongly between two lines of the Pali: a line
left with only a sentence's opening word or two, or a line left with no English though the
translation has it next door.

    <key>   the item's name
    S1: …   Bhikkhu Sujato's English for the line or lines before the cut, or their Pali
    S2: …   his English for the line after it, or its Pali
    T: …    the other translation's text for those lines: the places it may be cut are numbered
            [1], [2] …, the current one starred [n*]; ¶ is a paragraph or verse-line break

T is cut at one mark: the text before it goes on S1's line, the text after it on S2's. Answer with
the number of the mark where the meaning of S2 begins. Judge by meaning, not wording: the
translations word things differently and sometimes order them differently.

- A mark before all of T gives S1's line none of it. Choose it only when nothing in T is S1's: the
  translator leaves S1 out, or has rendered it earlier.
- A mark after all of T gives S2's line none of it. Choose it when nothing in T is S2's own, or when
  T renders S1 and S2 as one sentence that has no mark where S2 begins.
- A line is never left with only a sentence's opening word or two ("When," "But, Ānanda,") while
  the sentence goes on across the mark: the opening stays with its sentence. If the sentence is
  S2's, choose the mark before the opening. If it is S1's, choose the mark where it ends.
- Words that close S1's line in Sujato stay on S1's line: a lead-in such as "that is," or "namely:",
  and the last of a pair or a list that S1 holds ("It's amazing, lord. It's astounding,").
- A speaker's name ("The Blessed One:") or a heading goes with the words after it.

Answer each item on its own line, in order:

    <key> <n>   the cut belongs at mark n
    <key> =     the starred mark is right
    <key> ?     you can't tell

Work 25 items at a time: read the next 25, answer them, and save those answers with the Write tool
as a new file beside the batch, batch-NN.answers.1 for the first 25, .2 for the next, and so on,
never rewriting an earlier one. If some are there already, carry on after the last answered item.
That way work survives an interruption.
`;

// What a reviewer reads before a batch.
const REVIEW_INSTRUCTIONS = `# Reviewing cuts

Each item is one place where a translation is cut between two lines of the Pali, which the
segmenter is unsure of:

    <key>   the line after the cut
    S1: …   Bhikkhu Sujato's English for the line or lines before the cut, or their Pali
    S2: …   his English for the line after it, or its Pali
    T: …    the other translation around the cut: the places it may be cut are numbered [1], [2] …,
            the current one starred [n*]; ¶ is a paragraph or verse-line break

Find where the meaning of S2 begins in T, and answer with the number of the mark there. Judge by
meaning, not wording: the translations word things differently and sometimes order them
differently. A speaker's name ("The Blessed One:") or a heading goes with the words after it.

Answer each item on its own line, in order:

    <key> <n>   the cut belongs at mark n
    <key> =     the starred cut is right, or no mark is better
    <key> ?     you can't tell

Work 25 items at a time: read the next 25, answer them, and save those answers with the Write tool
as a new file beside the batch, batch-NN.answers.1 for the first 25, .2 for the next, and so on,
never rewriting an earlier one. If some are there already, carry on after the last answered item.
That way work survives an interruption.
`;

const outDocs = new Map();
const report = [];
const reviewUnits = [];
// The texts on the overview pages, each with the rows it shows, and what the pages count.
const moveUnits = [];
const emptyUnits = [];
const tally = { moved: 0, joined: 0, nextDoor: 0, otherEmpty: 0 };
// Share of an empty line's words (Sujato's) that a neighbouring piece holds beyond the lines it
// translates, from which the line's English is likely inside that piece.
const NEXT_DOOR = 0.6;
// A sentence's end: its closing mark and any quotes or brackets after it, not an abbreviation's.
const SENTENCE_END = String.raw`(?<!\b(?:Ven|Mr|Mrs|Dr|St|cf|vs|etc|e\.g|i\.e))[.?!;:…][”’"')\]]*`;
// What the places put up for review count.
const placed = { openings: 0, above: 0, below: 0, later: 0 };
const items = [];
// The findings tried: the groups that change lines, and the findings that change none.
const weighed = [];
const unmoved = [];

for (const unit of units) {
  {
    const { name, lines, body, stream, want } = unit;
    const entry = { file: unit.file, uids: unit.uids.join(' ') };
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
    const { segText, endsAtDash, joined: got } = segmentsOf(results, stream.text);

    // The text check: the segments, joined as they are written — a space after each but one ending
    // right after a dash — are character for character the page's text read the second way.
    const page = want.join(' ');
    if (got !== page) {
      let at = 0;
      while (at < got.length && got[at] === page[at]) at++;
      entry.error = `text differs at character ${at}: "${page.slice(at - 20, at + 20)}" / "${got.slice(at - 20, at + 20)}"`;
      continue;
    }

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
    const titleNotes = unit.oneOfSeveral ? [] : [...unit.notes.values()].filter((nt) => !nt.used).map((nt) => nt.html);

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

    if (itemsBelow !== null) {
      let prev = -1;
      results.forEach((r, i) => {
        if (!segText[i] || r.merged || r.empty) return;
        const unsure = r.margin !== null && r.margin < itemsBelow;
        if (prev !== -1 && (unsure || recheck.has(r.key))) items.push(reviewItem(stream, body, results, prev, i));
        prev = i;
      });
    }

    // Into each document's files.
    for (const line of lines) {
      if (!outDocs.has(line.doc)) {
        const d = loadDoc(line.doc);
        outDocs.set(line.doc, { dir: d.dir, text: Object.fromEntries(Object.keys(d.pali).map((k) => [k, ''])), notes: {} });
      }
    }
    const put = (line, text, notes, endsAtDash) => {
      const out = outDocs.get(line.doc);
      out.text[line.key] = text ? `${text}${endsAtDash ? '' : ' '}` : '';
      if (notes.length) out.notes[line.key] = notes.join(' ');
    };
    const titleLine = lines.find((l) => l.suttaTitle) ?? lines.filter((l) => l.title).at(-1);
    if (titleLine) put(titleLine, unit.title, [[...unit.intro, ...unit.seeAlso, ...titleNotes].map((p) => `<p>${p}</p>`).join('')].filter(Boolean));
    body.forEach((line, i) => put(line, segText[i], segNotes[i], endsAtDash[i]));

    if (reviewed.has(name)) reviewUnits.push({ name, entry, body, segText, segNotes, results, intro: unit.intro });

    const ids = (s) => wordsOf(s).map(idOf);
    // Returns the share of Sujato's words for `en` found in `text`, less the words of `less`.
    const fit = (en, text, less = '') => {
      const left = new Map();
      for (const w of ids(text)) left.set(w, (left.get(w) ?? 0) + 1);
      for (const w of ids(less)) left.set(w, (left.get(w) ?? 0) - 1);
      const want = ids(en);
      let hit = 0;
      for (const w of want) {
        const found = [w, ...(learned.get(w) ?? [])].find((a) => left.get(a) > 0);
        if (found === undefined) continue;
        hit++;
        left.set(found, left.get(found) - 1);
      }
      return want.length ? hit / want.length : 0;
    };
    // Returns the share of line i's words (Sujato's) that piece p holds beyond the lines it
    // translates: its own and those joined to it.
    const share = (i, p) => {
      if (p < 0 || p >= body.length) return 0;
      let held = body[p].en;
      for (let x = p + 1; x < body.length && results[x].merged; x++) held += ` ${body[x].en}`;
      return fit(body[i].en, segText[p], held);
    };
    if (overview) {
      // The cuts the review moved, each with the line before it.
      const moves = new Set();
      let before = -1;
      results.forEach((r, i) => {
        if (!own[i]) return;
        if (r.moved && before !== -1) {
          moves.add(before).add(i);
          tally.moved++;
        }
        before = i;
      });
      // The lines Sujato translates that have no English here, joined to the line above or empty
      // with their words mostly next door, each with the nearest lines that have English.
      const empties = new Set();
      const flags = new Map();
      body.forEach((line, i) => {
        if (own[i] || !line.en) return;
        let above = i - 1;
        while (above >= 0 && !own[above]) above--;
        let below = i + 1;
        while (below < body.length && !own[below]) below++;
        if (results[i].merged) tally.joined++;
        else {
          const up = ids(line.en).length >= 3 ? share(i, above) : 0;
          const down = ids(line.en).length >= 3 ? share(i, below) : 0;
          if (Math.max(up, down) < NEXT_DOOR) {
            tally.otherEmpty++;
            return;
          }
          flags.set(i, up >= down ? 'above' : 'below');
          tally.nextDoor++;
        }
        for (const x of [above, i, below]) if (x >= 0 && x < body.length) empties.add(x);
      });
      const shown = { name, entry, body, segText, segNotes, results, intro: [] };
      if (moves.size) moveUnits.push({ ...shown, rows: [...moves].sort((a, b) => a - b) });
      if (empties.size) emptyUnits.push({ ...shown, rows: [...empties].sort((a, b) => a - b), flags });
    }

    if (places) {
      const { text } = stream;
      const words = (s) => s.split(/\s+/).filter(Boolean).length;
      const ownBefore = (i) => {
        let x = i - 1;
        while (x >= 0 && !own[x]) x--;
        return x;
      };
      const ownAfter = (i) => {
        let x = i + 1;
        while (x < body.length && !own[x]) x++;
        return x;
      };
      // A sentence's opening word or two, ending in a comma or dash, at the end of a piece, where
      // the sentence goes on in the next. Verse lines end at commas and hold a few words by
      // nature, and a piece of nothing else may sit on a line Sujato keeps as short.
      const openings = new Set();
      let before = -1;
      for (let i = 0; i < body.length; i++) {
        if (!own[i]) continue;
        const j = ownAfter(i);
        if (j === body.length) break;
        const r = results[i];
        const ends = [...text.slice(r.start, r.end).matchAll(new RegExp(`${SENTENCE_END}\\s+`, 'g'))];
        const from = ends.length ? r.start + ends.at(-1).index + ends.at(-1)[0].length : r.start;
        const opening = text.slice(from, r.end).trim();
        const alone = from === r.start;
        const opens = !alone || before === -1 || new RegExp(`${SENTENCE_END}$`).test(segText[before]);
        const short = body[i].en && words(body[i].en) < 5;
        before = i;
        if (body[i].verse || !opening || words(opening) > 2 || !/[,—–-]$/.test(opening) || !opens || (alone && short)) continue;
        if (decisions[results[j].key]?.placed) continue;
        openings.add(i);
        items.push(openerItem(stream, body, results, i, j, alone));
        placed.openings++;
      }
      // A line of three words or more in Sujato, left empty, whose words are mostly in the piece
      // above or below it. One beside an opening put up above, or with another of his lines lying
      // empty between it and that piece, waits for a later round.
      body.forEach((line, i) => {
        if (own[i] || results[i].merged || !line.en || decisions[line.key]?.empty || ids(line.en).length < 3) return;
        const above = ownBefore(i);
        const below = ownAfter(i);
        const up = share(i, above);
        const down = share(i, below);
        if (Math.max(up, down) < NEXT_DOOR) return;
        const fromAbove = up >= down;
        let waits = openings.has(above);
        for (let x = fromAbove ? above + 1 : i + 1; x < (fromAbove ? i : below); x++) if (body[x].en && !results[x].merged) waits = true;
        if (waits) {
          placed.later++;
          return;
        }
        items.push(fromAbove ? tailItem(stream, body, results, above, i) : headItem(stream, body, results, i, below));
        placed[fromAbove ? 'above' : 'below']++;
      });
    }
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
  }
}
if (!only) fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
if (itemsBelow !== null || places || reviewUnits.length) fs.mkdirSync(REVIEW, { recursive: true });
if (itemsBelow !== null || places) {
  fs.rmSync(BATCHES, { recursive: true, force: true });
  fs.mkdirSync(BATCHES, { recursive: true });
  for (let b = 0; b * BATCH_SIZE < items.length; b++) {
    const batch = path.join(BATCHES, `batch-${String(b + 1).padStart(2, '0')}`);
    const chunk = items.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    fs.writeFileSync(`${batch}.txt`, `${chunk.map((it) => it.text).join('\n\n')}\n`);
    fs.writeFileSync(`${batch}.json`, `${JSON.stringify(Object.fromEntries(chunk.map((it) => [it.key, { current: it.current, candidates: it.candidates }])))}\n`);
  }
  fs.writeFileSync(path.join(BATCHES, 'INSTRUCTIONS.md'), places ? PLACE_INSTRUCTIONS : REVIEW_INSTRUCTIONS);
  console.log(`${items.length} ${places ? 'places' : 'cuts'} up for review, in ${Math.ceil(items.length / BATCH_SIZE)} batches`);
  if (places) {
    console.log(
      `places: ${placed.openings} openings left at a line's end; ${placed.above} empty lines with their English above, ` +
        `${placed.below} below, ${placed.later} waiting for a later round`,
    );
  }
}
const stale = report.flatMap((r) => r.stale ?? []);
if (stale.length) console.log(`${stale.length} settled cuts no longer fit: ${stale.slice(0, 10).join(' ')}`);
if (weighing) {
  const seen = new Set([...weighed.flatMap((g) => g.findings.map((f) => f.key)), ...unmoved.map((f) => f.key)]);
  const others = [...unmoved, ...[...findings].filter(([key]) => !seen.has(key)).map(([key, starts]) => ({ key, starts, status: 'not weighed' }))];
  fs.mkdirSync(REVIEW, { recursive: true });
  fs.writeFileSync(path.join(REVIEW, 'findings.json'), `${JSON.stringify({ groups: weighed, others }, null, 1)}\n`);
  const verdicts = [...new Set(weighed.map((g) => g.verdict))].map((v) => {
    const gs = weighed.filter((g) => g.verdict === v);
    return `${gs.reduce((a, g) => a + g.findings.length, 0)} in ${gs.length} groups: ${v}`;
  });
  const statuses = [...new Set(others.map((f) => f.status))].map((s) => `${others.filter((f) => f.status === s).length} ${s}`);
  console.log(`findings: ${findings.size} lines; ${[...verdicts, ...statuses].join('; ')}`);
}
if (keepFindings) fs.writeFileSync(CUTS_FILE, `${JSON.stringify(decisions, null, 1)}\n`);
if (reviewUnits.length) fs.writeFileSync(path.join(REVIEW, 'review.html'), reviewPage(reviewUnits));
if (overview) {
  fs.mkdirSync(REVIEW, { recursive: true });
  const moves = reviewPage(moveUnits, {
    title: `Moves: ${translator}`,
    lead: `${tally.moved} cuts the review moved, in ${moveUnits.length} texts, each with the line before it and the line after.`,
  });
  const empty = reviewPage(emptyUnits, {
    title: `Empty lines: ${translator}`,
    lead:
      `Lines Sujato translates that have no English here, in ${emptyUnits.length} texts, each with the nearest lines that have English: ` +
      `${tally.joined} whose English is in the piece above (blue), and ${tally.nextDoor} the script counts as left out ` +
      `whose words are mostly in the English above or below (grey, marked ↑ or ↓). Not shown: ${tally.otherEmpty} ` +
      `left out whose words are not next door.`,
  });
  fs.writeFileSync(path.join(REVIEW, 'moves.html'), moves);
  fs.writeFileSync(path.join(REVIEW, 'empty.html'), empty);
  console.log(`overview: ${tally.moved} moved cuts; ${tally.joined} joined lines, ${tally.nextDoor} empty lines likely next door, ${tally.otherEmpty} others`);
}

const ok = report.filter((r) => !r.error && !r.empty);
const sum = (f) => ok.reduce((a, r) => a + r[f], 0);
console.log(
  `${translator}: ${report.length} texts, ${report.filter((r) => r.empty).length} empty, ${report.filter((r) => r.error).length} not written; ` +
    `${sum('segments')} segments, ${sum('unsure')} unsure cuts, ${sum('joined')} lines joined, ` +
    `${sum('long')} long, ${sum('unmatched')} unmatched; ${ok.filter((r) => !r.unsure && !r.long && !r.unmatched).length} texts clean`,
);
for (const r of report.filter((r) => r.error || r.noteErrors)) console.log(`  ${r.file}: ${r.error ?? ''} ${r.noteErrors?.join(' ') ?? ''}`);

// Returns a line's text for the review page, with the words a moved cut gave it marked.
function markGained(seg, r) {
  const head = r.gainedAbove && seg.startsWith(r.gainedAbove) ? r.gainedAbove.length : 0;
  const tail = r.gainedBelow && seg.endsWith(r.gainedBelow) ? Math.min(r.gainedBelow.length, seg.length - head) : 0;
  const mark = (s) => (s ? `<mark>${escapeHtml(s)}</mark>` : '');
  return mark(seg.slice(0, head)) + escapeHtml(seg.slice(head, seg.length - tail)) + mark(seg.slice(seg.length - tail));
}

// Returns a review page: each text line by line, Pali, Sujato and the translation side by side, or
// only the rows a text lists, with a gap marked between runs of them.
//   title – the page's title
//   lead  – a first paragraph saying what the page shows, which replaces the list of texts and the
//           filter
function reviewPage(units, { title = `Review: ${translator}`, lead = '' } = {}) {
  const rows = (u) => {
    const shown = u.rows ?? u.body.map((line, i) => i);
    return shown
      .map((i, n) => {
        const line = u.body[i];
        const r = u.results[i];
        const cls = [
          r.margin !== null && r.margin < UNSURE ? 'unsure' : '',
          r.merged ? 'merged' : r.empty && line.en ? 'gap' : '',
          u.segText[i].length > 40 && r.lexical < 1 ? 'nomatch' : '',
          line.paraStart ? 'para' : '',
          r.moved ? 'moved' : r.settled ? 'settled' : '',
          r.beside ? 'beside' : '',
        ].join(' ');
        const note = u.segNotes[i].length ? `<div class="note">${u.segNotes[i].join('<br>')}</div>` : '';
        const margin = r.margin === null ? '' : r.margin.toFixed(1);
        const side = u.flags?.get(i);
        const flag = side ? `<div class="note">${side === 'above' ? '↑ Its words are mostly in the English above.' : '↓ Its words are mostly in the English below.'}</div>` : '';
        const skipped = n && i > shown[n - 1] + 1 ? '<tr class="skip"><td colspan="4">⋯</td></tr>\n' : '';
        return `${skipped}<tr class="${cls}"><td class="k">${line.key.slice(line.key.indexOf(':') + 1)}<br><small>${margin}</small></td><td class="pi">${escapeHtml(line.pali)}</td><td>${escapeHtml(line.en)}</td><td>${markGained(u.segText[i], r)}${note}${flag}</td></tr>`;
      })
      .join('\n');
  };
  const count = (u, flag) => u.results.filter((r) => r[flag]).length;
  const sections = units
    .map(
      (u) =>
        `<h2 id="${u.name}">${u.name} <small>${u.entry.segments} segments · ${u.entry.unsure} unsure · ${count(u, 'settled')} settled, ${count(u, 'moved')} of them moved · ${u.entry.joined} joined · ${u.entry.long} long · ${u.entry.unmatched} unmatched</small></h2>` +
        (u.intro.length ? `<details><summary>Introduction</summary>${u.intro.map((p) => `<p>${p}</p>`).join('')}</details>` : '') +
        `<table><thead><tr><th>Line</th><th>Pali</th><th>Sujato</th><th>${translator}</th></tr></thead><tbody>${rows(u)}</tbody></table>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#777;--line:#ddd;--unsure:#fff3cd;--gap:#e9e9e9;--merged:#dfeefb;--nomatch:#f8d7da;--settled:#dff3df;--moved:#8fd498;--mark:#ffe066}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#e8e8e8;--muted:#999;--line:#333;--unsure:#4a3d10;--gap:#2a2a2a;--merged:#15314a;--nomatch:#4a1d22;--settled:#1f3b24;--moved:#2e7a3c;--mark:#7a5c00}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 Georgia,serif;margin:0 auto;max-width:1400px;padding:16px}
table{border-collapse:collapse;width:100%;margin-bottom:48px}td,th{border-top:1px solid var(--line);padding:4px 8px;vertical-align:top;text-align:left}
tr.para td{border-top:2px solid var(--muted)}td.k{white-space:nowrap;color:var(--muted);font:12px ui-monospace,monospace}td.pi{font-style:italic;color:var(--muted)}
tr.unsure td{background:var(--unsure)}tr.gap td{background:var(--gap)}tr.merged td{background:var(--merged)}tr.nomatch td{background:var(--nomatch)}
tr.settled td.k{background:var(--settled)}tr.moved td.k{background:var(--moved);color:var(--fg)}mark{background:var(--mark);color:inherit}
body:has(#changed:checked) tbody tr:not(.moved):not(.beside){display:none}
.note{font-size:12px;color:var(--muted);margin-top:4px}h2 small{font-weight:normal;color:var(--muted);font-size:13px}nav a{margin-right:12px}
tr.skip td{color:var(--muted);text-align:center;padding:0}
</style></head><body>
${lead ? `<p><strong>${lead}</strong></p>` : ''}
<p>Yellow: a cut the script is unsure of (its margin under the line number). Blue: a line whose English is in the piece above, so its Pali joins that piece's. Grey: a line Sujato translates that this translation leaves out. Red: text sharing no words with its line. A thick rule starts a Pali paragraph.</p>
<p>A green line number: the review settled the cut above that line. Darker green: it moved the cut, and the marked words are the ones that changed lines.${lead ? '' : ' <label><input type="checkbox" id="changed"> Only the lines beside a moved cut</label>'}</p>
${lead ? '' : `<nav>${units.map((u) => `<a href="#${u.name}">${u.name}</a>`).join('')}</nav>`}
${sections}
</body></html>`;
}
