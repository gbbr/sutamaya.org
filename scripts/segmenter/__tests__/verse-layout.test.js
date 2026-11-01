import { afterAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-verse-layout-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

// Each case runs the actual CLI against a small, independent corpus. No prototype imports,
// review answers, or real translation files supply the automatic layouts.
function segment(source, rows, { cuts = {}, translator = 'bodhi' } = {}) {
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('scripts/segmenter/segment-translations.mjs', fs.readFileSync(path.join(ROOT, 'scripts/segmenter/segment-translations.mjs'), 'utf8'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'scripts/lib'), path.join(root, 'scripts/lib'), 'dir');
  const keys = rows.map((row, i) => row.key ?? `fixture:1.${i + 1}`);
  const entries = fn => Object.fromEntries(rows.map((row, i) => [keys[i], fn(row, i)]));
  write('data/pali/sutta/fixture_root-pli-ms.json', entries(row => row.pali ?? 'verse'));
  write('data/sujato/sutta/fixture_translation-en-sujato.json', entries(row => row.en ?? ''));
  write('data/html/pli/ms/sutta/fixture_html.json', entries((row, i) => `${i === 0 || row.paraStart ? '<p>' : ''}${row.verse === false ? '{}' : '<span class="verse-line">{}</span>'}${i === rows.length - 1 ? '</p>' : ''}`));
  write(`data/upstream/${translator}/sutta/fixture.html`, `<article id="fixture"><header><h1></h1></header>${source}</article>`);
  write(`data/${translator}/cuts.json`, cuts);
  write(`data/${translator}/learned.json`, {});
  const result = spawnSync(process.execPath, ['scripts/segmenter/segment-translations.mjs', translator, '--only', 'fixture'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain('0 not written');
  const text = JSON.parse(fs.readFileSync(path.join(root, `data/${translator}/sutta/fixture_translation-en-${translator}.json`), 'utf8'));
  return keys.map(key => text[key].trim());
}

const rows = n => Array.from({ length: n }, () => ({}));
const verse = lines => `<blockquote><p>${lines.join('<br>')}</p></blockquote>`;
const plain = pieces => pieces.map(s => s.replace(/\s+/g, ' ').trim());

test.each(['bodhi', 'thanissaro'])('one whole source line per Pali row at equal counts (%s)', translator => {
  const lines = ['banana orchard', 'mango harvest', 'apple vineyard', 'pear garden'];
  const body = rows(4);
  body[0].en = lines.join(' '); // Lexical scoring must not gather everything on this row.
  expect(segment(verse(lines), body, { translator })).toEqual(lines);
});

test('excess source lines occupy every row and remain whole and in order', () => {
  const lines = ['one word', 'two words', 'three words', 'four words', 'five words', 'six words'];
  const pieces = segment(verse(lines), rows(4));
  expect(pieces.filter(Boolean)).toHaveLength(4);
  expect(pieces.flatMap(s => s.split('\n'))).toEqual(lines);
});

test('fewer source lines stay separate and occupy the first row', () => {
  const lines = ['banana orchard', 'mango harvest'];
  const body = rows(4);
  body[3].en = lines.join(' ');
  const pieces = segment(verse(lines), body);
  expect(pieces[0]).toBeTruthy();
  expect(pieces.filter(Boolean)).toEqual(lines);
});

test('a speaker label stays attached to the first line of speech', () => {
  expect(segment(verse(['<span class="speaker">The Buddha:</span>', 'first line', 'second line']), rows(2)))
    .toEqual(['<span class="speaker">The Buddha:</span>\nfirst line', 'second line']);
});

test('paragraph boundaries separate verses, including integer Pali keys', () => {
  const body = rows(4).map((row, i) => ({ ...row, key: `fixture:${i + 1}`, paraStart: i === 2 }));
  expect(segment(verse(['a first', 'a second']) + verse(['b first', 'b second']), body))
    .toEqual(['a first', 'a second', 'b first', 'b second']);
});

test('a settled grouping overrides the equal-count rule', () => {
  const lines = ['first line', 'second line', 'third line', 'fourth line'];
  const cuts = {
    'fixture:1.2': { empty: 'up' },
    'fixture:1.3': { after: 'first line\nsecond line', own: true },
    'fixture:1.4': { after: 'third line', own: true },
  };
  expect(plain(segment(verse(lines), rows(4), { cuts })))
    .toEqual(['first line second line', '', 'third line', 'fourth line']);
});

test('prose does not acquire invented source line breaks', () => {
  const pieces = segment('<p>First whole sentence. Second whole sentence.</p>', rows(4));
  expect(pieces.every(s => !s.includes('\n'))).toBe(true);
  expect(plain(pieces).filter(Boolean).join(' ')).toBe('First whole sentence. Second whole sentence.');
});

test('settled cuts inside source lines remain authoritative', () => {
  const cuts = { 'fixture:1.2': { after: 'first', own: true }, 'fixture:1.3': { after: 'whole line', own: true } };
  expect(plain(segment(verse(['first whole line', 'second whole line']), rows(3), { cuts })))
    .toEqual(['first', 'whole line', 'second whole line']);
});
