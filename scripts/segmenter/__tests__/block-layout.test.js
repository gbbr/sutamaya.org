import { afterAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-block-layout-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function segment(source, { translator = 'bodhi', rows = [{}], cuts = {} } = {}) {
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('scripts/segmenter/segment-translations.mjs', fs.readFileSync(path.join(ROOT, 'scripts/segmenter/segment-translations.mjs'), 'utf8'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'scripts/lib'), path.join(root, 'scripts/lib'), 'dir');
  const entries = field => Object.fromEntries(rows.map((row, i) => [`fixture:1.${i + 1}`, field(row)]));
  write('data/pali/sutta/fixture_root-pli-ms.json', entries(() => 'Pali'));
  write('data/sujato/sutta/fixture_translation-en-sujato.json', entries(row => row.en ?? ''));
  write('data/html/pli/ms/sutta/fixture_html.json', entries(row => row.html ?? '<p>{}</p>'));
  write(`data/upstream/${translator}/sutta/fixture.html`, translator === 'bodhi'
    ? `<article id="fixture"><header><h1></h1></header>${source}</article>`
    : `<div id="sutta"><h1></h1>${source}</div>`);
  write(`data/${translator}/cuts.json`, cuts);
  write(`data/${translator}/learned.json`, {});
  const result = spawnSync(process.execPath, ['scripts/segmenter/segment-translations.mjs', translator], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain('0 not written');
  return Object.values(JSON.parse(fs.readFileSync(path.join(root, `data/${translator}/sutta/fixture_translation-en-${translator}.json`), 'utf8'))).map(s => s.trim());
}

test.each(['bodhi', 'thanissaro'])('source paragraphs sharing one Pali row stay paragraphs (%s)', translator => {
  expect(segment('<p>First paragraph.</p><p>Second paragraph.</p>', { translator }))
    .toEqual(['<p>First paragraph.</p> <p>Second paragraph.</p>']);
});

test('a source paragraph on its own keeps its plain representation', () => {
  expect(segment('<p>One paragraph.</p>')).toEqual(['One paragraph.']);
});

test.each(['bodhi', 'thanissaro'])('source speaker markup stays with the verse (%s)', translator => {
  const source = translator === 'bodhi'
    ? '<blockquote><p><span class="speaker">The Buddha:</span><br>First line<br>second line.</p></blockquote>'
    : '<div class="verse"><p class="vspk">The Buddha:<span class="fn"><a href="#note1">1</a></span></p><p>First line</p><p>second line.</p></div>';
  expect(segment(source, { translator })).toEqual(['<span class="speaker">The Buddha:</span>\nFirst line\nsecond line.']);
});

test('only the source-marked occurrence is a speaker, including inline prose attributions', () => {
  expect(segment('<p>The king asked: “<span class="speaker">The king asked:</span> Why?”</p>'))
    .toEqual(['The king asked: “<span class="speaker">The king asked:</span> Why?”']);
  expect(segment('<p>Māra:</p><blockquote><p>A verse.</p></blockquote>'))
    .toEqual(['Māra:\nA verse.']);
});

test('a settled cut inside a source speaker retains markup on both pieces', () => {
  expect(segment('<p><span class="speaker">The Blessed One said:</span> A teaching.</p>', {
    rows: [{ en: 'The Blessed' }, { en: 'One said: A teaching.' }],
    cuts: { 'fixture:1.2': { after: 'The Blessed', own: true } },
  })).toEqual(['<span class="speaker">The Blessed</span>', '<span class="speaker">One said:</span> A teaching.']);
});

const openingRows = [
  { html: '<p>{}', en: 'Previous teaching.' },
  { html: '{}</p>', en: 'Or he might say' },
  { html: '<p>{}</p>', en: 'He abstains from games.' },
];

test.each(['bodhi', 'thanissaro'])('a paragraph opening stays with its continuation after a Pali paragraph break (%s)', translator => {
  expect(segment('<p>Previous teaching.</p><p>“Or he might say: ‘He abstains from games.’</p>', { translator, rows: openingRows }))
    .toEqual(['Previous teaching.', '', '“Or he might say: ‘He abstains from games.’']);
});

test('a settled cut keeps its reading across a Pali paragraph break', () => {
  const cuts = { 'fixture:1.3': { after: '“Or he might say:', placed: true } };
  expect(segment('<p>Previous teaching.</p><p>“Or he might say: ‘He abstains from games.’</p>', { rows: openingRows, cuts }))
    .toEqual(['Previous teaching.', '“Or he might say:', '‘He abstains from games.’']);
});

test('a saved start before the lead-in still keeps the previous sentence whole', () => {
  const cuts = { 'fixture:1.2': { after: 'Previous teaching.', placed: true } };
  expect(segment('<p>Previous teaching.</p><p>“Or he might say: ‘He abstains from games.’</p>', { rows: openingRows, cuts }))
    .toEqual(['Previous teaching.', '', '“Or he might say: ‘He abstains from games.’']);
});

test('a Pali line break inside one paragraph keeps its alignment', () => {
  const rows = openingRows.map(row => ({ ...row, html: '{}' }));
  rows[0].html = '<p>{}';
  rows[2].html = '{}</p>';
  expect(segment('<p>Previous teaching.</p><p>“Or he might say: ‘He abstains from games.’</p>', { rows }))
    .toEqual(['Previous teaching.', '“Or he might say:', '‘He abstains from games.’']);
});

test('a quoted sentence keeps the Pali paragraph it translates', () => {
  const rows = openingRows.map(row => ({ ...row }));
  rows[1].en = 'He abstains from games.';
  rows[2].en = 'He also abstains from shows.';
  expect(segment('<p>Previous teaching.</p><p>“He abstains from games. He also abstains from shows.”</p>', { rows }))
    .toEqual(['Previous teaching.', '“He abstains from games.', 'He also abstains from shows.”']);
});

test('a narrative attribution keeps the Pali paragraph it translates', () => {
  const rows = openingRows.map(row => ({ ...row }));
  rows[1].en = 'The Blessed One said';
  expect(segment('<p>Previous teaching.</p><p>The Blessed One said: ‘He abstains from games.’</p>', { rows }))
    .toEqual(['Previous teaching.', 'The Blessed One said:', '‘He abstains from games.’']);
});

test('bullets keep the source items and the prose on either side', () => {
  expect(segment('<p>Opening.</p><ul><li>First item;</li><li>second item.</li></ul><p>Closing.</p>'))
    .toEqual(['<p>Opening.</p> <ul><li>First item;</li> <li>second item.</li></ul> <p>Closing.</p>']);
  expect(segment('<ol><li>First item;</li><li>second item.</li></ol>')).toEqual(['First item; second item.']);
});

test.each(['iblock', 'sq-list'])('recognized lists keep their %s wrapper and surrounding prose', cls => {
  expect(segment(`<p>Opening.</p><div class="${cls} extra"><p>First item;</p><p>second item,</p><p>third item—</p><p>last item.</p></div><p>Closing.</p>`, { translator: 'thanissaro' }))
    .toEqual([`<p>Opening.</p> <div class="${cls}"><p>First item;</p> <p>second item,</p> <p>third item—</p> <p>last item.</p></div> <p>Closing.</p>`]);
});

test.each(['iblock', 'sq-list'])('%s list endings ignore both source note-marker styles', cls => {
  expect(segment(`<p>Opening.</p><div class="${cls}"><p>First item;<span class="fn"><a href="#note1">1</a></span> </p><p><em>second item,</em><a class="footnote-ref" href="#note2">2</a></p><p>last item.</p></div><div class="note"><p id="note1">1. First note.</p><p id="note2">2. Second note.</p></div>`, { translator: 'thanissaro' }))
    .toEqual([`<p>Opening.</p> <div class="${cls}"><p>First item;</p> <p>second item,</p> <p>last item.</p></div>`]);
});

test.each(['iblock', 'sq-list'])('%s requires a list ending on every nonfinal paragraph', cls => {
  expect(segment(`<p>Opening.</p><div class="${cls}"><p>First item;</p><p>A sentence; with internal punctuation.</p><p>Last paragraph.</p></div>`, { translator: 'thanissaro' }))
    .toEqual(['<p>Opening.</p> <p>First item;</p> <p>A sentence; with internal punctuation.</p> <p>Last paragraph.</p>']);
});

test.each(['.', ':', '-', '–', ''])('a prose paragraph ending in %j does not start an indented list', ending => {
  expect(segment(`<p>Opening.</p><div class="iblock"><p>First paragraph${ending}</p><p>Second paragraph.</p></div>`, { translator: 'thanissaro' }))
    .toEqual([`<p>Opening.</p> <p>First paragraph${ending}</p> <p>Second paragraph.</p>`]);
});

test.each(['iblock', 'sq-list'])('one %s paragraph on its own is not a list', cls => {
  const rows = [{ en: 'Opening.' }, { en: 'A quotation;' }];
  const cuts = { 'fixture:1.2': { after: 'Opening.', own: true } };
  expect(segment(`<p>Opening.</p><div class="${cls}"><p>A quotation;</p></div>`, { translator: 'thanissaro', rows, cuts }))
    .toEqual(['Opening.', 'A quotation;']);
});

test.each([
  '<p>First item;</p><div><p>Nested paragraph.</p></div>',
  'Unwrapped prose. <p>First item;</p><p>Last item.</p>',
  '<p>First item;</p><p></p>',
])('a wrapper without a complete sequence of paragraph items stays plain: %s', source => {
  expect(segment(`<p>Opening.</p><div class="iblock">${source}</div>`, { translator: 'thanissaro' }).join(' '))
    .not.toContain('<div');
});

test.each(['block', 'other'])('punctuated paragraphs in %s wrappers keep ordinary paragraph layout', cls => {
  expect(segment(`<p>Opening.</p><div class="${cls}"><p>First item;</p><p>Last item.</p></div>`, { translator: 'thanissaro' }))
    .toEqual(['<p>Opening.</p> <p>First item;</p> <p>Last item.</p>']);
});

test('an indented list keeps its layout when a settled cut splits one source item', () => {
  const rows = ['Opening.', 'First sentence.', 'second part; Third item.', 'Closing.'].map(en => ({ en }));
  const cuts = {
    'fixture:1.2': { after: 'Opening.', own: true },
    'fixture:1.3': { after: 'First sentence.', own: true },
    'fixture:1.4': { after: 'Third item.', own: true },
  };
  expect(segment('<p>Opening.</p><div class="iblock"><p>First sentence. second part;</p><p>Third item.</p></div><p>Closing.</p>', { translator: 'thanissaro', rows, cuts }))
    .toEqual(['Opening.', '<div class="iblock"><p>First sentence.</p></div>', '<div class="iblock"><p>second part;</p> <p>Third item.</p></div>', 'Closing.']);
});

test('verse breaks inside a paragraph stay inside its wrapper', () => {
  expect(segment('<p>First line<br>second line.</p><p>Next paragraph.</p>'))
    .toEqual(['<p>First line\nsecond line.</p> <p>Next paragraph.</p>']);
});

const headingRows = [
  { html: '<h2>{}</h2>', en: 'III.' },
  { html: '<h3>{}</h3>', en: 'Speculations about the Past' },
  { en: 'Teaching.' },
];
const headingCuts = { 'fixture:1.2': { after: 'III.', own: true }, 'fixture:1.3': { after: 'Speculations about the Past', own: true } };

test('one source heading occupies the first of its two Pali heading rows', () => {
  expect(segment('<h2>III. Speculations about the Past</h2><p>Teaching.</p>', { rows: headingRows, cuts: headingCuts }))
    .toEqual(['III. Speculations about the Past', '', 'Teaching.']);
});

test('separate source headings keep their own Pali rows', () => {
  expect(segment('<h2>III.</h2><h3>Speculations about the Past</h3><p>Teaching.</p>', { rows: headingRows, cuts: headingCuts }))
    .toEqual(['III.', 'Speculations about the Past', 'Teaching.']);
});
