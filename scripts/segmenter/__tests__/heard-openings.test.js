import { afterAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBodySegments } from '../../lib/collections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-heard-openings-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const formula = 'I have heard that';
const location = 'on one occasion the Blessed One was staying near Sāvatthī in Jeta’s Grove.';
const action = 'Then a monk approached the Blessed One.';
const rows = [
  { pali: 'Evaṁ me sutaṁ—', en: 'Thus have I heard.' },
  { pali: 'ekaṁ samayaṁ bhagavā sāvatthiyaṁ viharati jetavane.', en: location },
  { pali: 'Atha kho aññataro bhikkhu yena bhagavā tenupasaṅkami.', en: action },
];
const cuts = {
  'fixture:1.1': { placed: true, own: true },
  'fixture:1.2': { after: formula, placed: true, own: true },
  'fixture:1.3': { after: location, placed: true, own: true },
};

function segment(source = `<p>${formula} ${location} ${action}</p>`, options = {}) {
  const translator = options.translator ?? 'thanissaro';
  const body = options.rows ?? rows;
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('scripts/segmenter/segment-translations.mjs', fs.readFileSync(path.join(ROOT, 'scripts/segmenter/segment-translations.mjs'), 'utf8'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'scripts/lib'), path.join(root, 'scripts/lib'), 'dir');
  const entries = fn => Object.fromEntries(body.map((row, i) => [row.key ?? `fixture:1.${i + 1}`, fn(row, i)]));
  const pali = entries(row => row.pali), en = entries(row => row.en ?? '');
  const html = entries((row, i) => `${i === 0 || row.paraStart ? '<p>' : ''}{}${i === body.length - 1 ? '</p>' : ''}`);
  write('data/pali/sutta/fixture_root-pli-ms.json', pali);
  write('data/sujato/sutta/fixture_translation-en-sujato.json', en);
  write('data/html/pli/ms/sutta/fixture_html.json', html);
  write(`data/upstream/${translator}/sutta/fixture.html`, `<article id="fixture"><header><h1></h1></header>${source}</article>`);
  write(`data/${translator}/cuts.json`, options.cuts ?? cuts);
  write(`data/${translator}/learned.json`, {});
  write(`data/${translator}/covered.json`, []);
  const result = spawnSync(process.execPath, ['scripts/segmenter/segment-translations.mjs', translator, '--only', 'fixture'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain('0 not written');
  const text = JSON.parse(fs.readFileSync(path.join(root, `data/${translator}/sutta/fixture_translation-en-${translator}.json`), 'utf8'));
  const covered = JSON.parse(fs.readFileSync(path.join(root, `data/${translator}/covered.json`), 'utf8'));
  const segments = buildBodySegments(new Map(Object.entries(pali)), new Map(Object.entries(text)),
    new Map(Object.entries(html)), new Map(), () => null, new Set(covered));
  return { text: Object.values(text).map(s => s.trim()), covered, segments };
}

test('the hearing formula joins its continuation despite a saved split, leaving later prose in place', () => {
  const result = segment();
  expect(result.text).toEqual([`${formula} ${location}`, '', action]);
  expect(result.covered).toEqual(['fixture:1.2']);
  expect(result.segments[0].pali).toBe(`${rows[0].pali} ${rows[1].pali}`);
});

test('an unreviewed opening also occupies the hearing line', () => {
  expect(segment(undefined, { cuts: {} }).text).toEqual([`${formula} ${location}`, '', action]);
});

test('the emptied continuation stays visible before another blank line, without revealing repetition', () => {
  const body = [rows[0], rows[1], { pali: '…pe…' }, rows[2]];
  const result = segment(undefined, { rows: body, cuts: {
    ...cuts,
    'fixture:1.3': { empty: 'up' },
    'fixture:1.4': { after: location, placed: true, own: true },
  } });
  expect(result.text).toEqual([`${formula} ${location}`, '', '', action]);
  expect(result.segments.map(s => [s.key, s.pali])).toEqual([
    ['fixture:1.1', `${rows[0].pali} ${rows[1].pali}`],
    ['fixture:1.4', rows[2].pali],
  ]);
});

test('a source heading before the formula stays with the whole opening', () => {
  const result = segment(`<h2>[ I ]</h2><p>${formula} ${location} ${action}</p>`);
  expect(result.text).toEqual([`<span class="heading">[ I ]</span> ${formula} ${location}`, '', action]);
});

test('a Pali paragraph break keeps the same source sentence whole and its Pali visible', () => {
  const result = segment(undefined, { rows: [rows[0], { ...rows[1], paraStart: true }, rows[2]] });
  expect(result.text).toEqual([`${formula} ${location}`, '', action]);
  expect(result.segments[0].pali).toBe(`${rows[0].pali} ${rows[1].pali}`);
});

test('an abbreviated opening Pali and a different continuation wording still join', () => {
  const once = 'once the Blessed One was staying near Rājagaha.';
  expect(segment(`<p>${formula} ${once} ${action}</p>`, {
    rows: [{ ...rows[0], pali: 'Evaṁ me sutaṁ …' }, { ...rows[1], pali: 'rājagahe veḷuvane.', en: once }, rows[2]],
    cuts: { ...cuts, 'fixture:1.3': { after: once, placed: true, own: true } },
  }).text).toEqual([`${formula} ${once}`, '', action]);
});

test('Bodhi and a complete hearing sentence keep their separate alignments', () => {
  expect(segment(undefined, { translator: 'bodhi' }).text).toEqual([formula, location, action]);
  const complete = 'Thus have I heard.';
  expect(segment(`<p>${complete} ${location} ${action}</p>`, {
    cuts: { ...cuts, 'fixture:1.2': { after: complete, placed: true, own: true } },
  }).text).toEqual([complete, location, action]);
});

test('an opening already whole keeps its text and alignment', () => {
  expect(segment(undefined, { cuts: { ...cuts, 'fixture:1.2': { empty: 'up' } } }).text)
    .toEqual([`${formula} ${location}`, '', action]);
});

test.each(['other Pali', 'source paragraph', 'other sutta'])(
  'the join stops at its evidence boundary: %s', boundary => {
    const body = rows.map(row => ({ ...row }));
    let source;
    let decided = cuts;
    if (boundary === 'other Pali') body[0].pali = 'Sutaṁ metaṁ, bhante.';
    if (boundary === 'source paragraph') source = `<p>${formula}</p><p>${location} ${action}</p>`;
    if (boundary === 'other sutta') {
      body[1].key = 'other:1.1';
      body[2].key = 'other:1.2';
      decided = { 'fixture:1.1': cuts['fixture:1.1'], 'other:1.1': cuts['fixture:1.2'], 'other:1.2': cuts['fixture:1.3'] };
    }
    expect(segment(source, { rows: body, cuts: decided }).text).toEqual([formula, location, action]);
  });
