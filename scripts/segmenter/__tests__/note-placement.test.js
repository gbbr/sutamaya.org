import { afterAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-note-placement-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function segment(source, rows, cuts = {}, translator = 'bodhi') {
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
  write('data/pali/sutta/fixture_root-pli-ms.json', entries(row => row.pali ?? 'passage.'));
  write('data/sujato/sutta/fixture_translation-en-sujato.json', entries(row => row.en ?? ''));
  write('data/html/pli/ms/sutta/fixture_html.json', entries((row, i) => `${i === 0 || row.paraStart ? '<p>' : ''}${row.verse ? '<span class="verse-line">{}</span>' : '{}'}${i === rows.length - 1 ? '</p>' : ''}`));
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

test.each(['bodhi', 'thanissaro'])('a whole-sutta note stays whole on the first Pali row (%s)', translator => {
  const note = 'This sutta is identical with the preceding one except that it omits the simile.';
  const body = rows(6);
  body[4].en = 'identical with the preceding one';
  body[5].en = 'except that it omits the simile';
  expect(segment(`<p><span class="pe">${note}</span></p>`, body, {}, translator))
    .toEqual([note, '', '', '', '', '']);
});

test('a passage note follows the complete printed question, before omitted verse rows', () => {
  const note = 'As in AN8.46, including the verses.';
  const body = [{ en: 'What eight?', pali: 'Katamāni aṭṭha?' }, ...rows(5).map(row => ({ ...row, verse: true }))];
  body[5].en = 'As in AN8.46 including the verses';
  expect(segment(`<p>What eight?</p><p><span class="pe">${note}</span></p>`, body))
    .toEqual(['What eight?', note, '', '', '', '']);
});

test('a plain parenthetical editorial note needs no pe markup', () => {
  expect(segment('<p>(Identical with the preceding sutta, but without the verses.)</p>', rows(4)))
    .toEqual(['(Identical with the preceding sutta, but without the verses.)', '', '', '']);
});

test('page references and ellipses remain part of the whole note', () => {
  const note = '… The rest is identical with the preceding sutta. [61–62] …';
  expect(segment(`<p>Earlier teaching.</p><p>… <span class="pe">The rest is identical with the preceding sutta.</span> [61–62] …</p>`,
    [{ en: 'Earlier teaching.' }, ...rows(4)]))
    .toEqual(['Earlier teaching.', note, '', '', '']);
});

test('a later printed passage survives gathering the note above it', () => {
  const note = 'As above down to:';
  const body = [...rows(4), { en: 'The final answer is peace.' }];
  body[3].en = note;
  expect(segment(`<p><span class="pe">${note}</span></p><p>The final answer is peace.</p>`, body))
    .toEqual([note, '', '', '', 'The final answer is peace.']);
});

test('inline notes after a complete question introduce the next passage', () => {
  const body = [{ en: 'What four?', pali: 'Katamāni cattāri?' }, ...rows(4), { en: 'These are the four.' }];
  body[3].en = 'as above';
  expect(segment('<p>What four?… <span class="pe">as above</span> … These are the four.</p>', body))
    .toEqual(['What four?…', 'as above …', '', '', '', 'These are the four.']);
});

test('inline list abbreviations retain their settled position', () => {
  const cuts = { 'fixture:1.2': { after: 'The first item …', own: true }, 'fixture:1.4': { after: 'as above …', own: true } };
  expect(segment('<p>The first item … <span class="pe">as above</span> … and the last item.</p>',
    [{ en: 'first item' }, { en: 'as above' }, {}, { en: 'last item' }], cuts))
    .toEqual(['The first item …', 'as above …', '', 'and the last item.']);
});

test.each(['The first item …', 'I then went to them …', 'When he is corrected, he prevaricates …'])(
  'annotation markup alone does not move a partial sentence or list abbreviation: %s', prefix => {
    const body = [{ en: prefix, pali: 'Pāṇātipātī hoti …pe…' }, {}, { en: 'as above' }, { en: 'the last item' }];
    const source = `${prefix} as above … the last item.`;
    expect(segment(`<p>${prefix} <span class="pe">as above</span> … the last item.</p>`, body))
      .toEqual(segment(`<p>${source}</p>`, body));
  });

test('a note keeps ownership on an already-started abbreviated Pali passage', () => {
  const body = [{ en: 'First quality. All as in the preceding sutta.', pali: 'paṭhamo dhammo …pe…' }, {}, { en: 'Last quality.' }];
  const cuts = { 'fixture:1.3': { after: 'All as in the preceding sutta.', own: true } };
  expect(segment('<p>First quality.</p><p><span class="pe">All as in the preceding sutta.</span></p><p>Last quality.</p>', body, cuts))
    .toEqual(['<p>First quality.</p> <p>All as in the preceding sutta.</p>', '', 'Last quality.']);
});

test('ordinary prose mentioning identity is translation, not a passage note', () => {
  const cuts = { 'fixture:1.3': { after: 'The question was asked.', own: true } };
  expect(segment('<p>The question was asked.</p><p>The soul is the same as the body.</p>',
    [{ en: 'question asked' }, {}, { en: 'soul same body' }], cuts))
    .toEqual(['The question was asked.', '', 'The soul is the same as the body.']);
});

test('a reviewed placement overrides the automatic first-row proposal', () => {
  const note = 'The rest is identical with the preceding sutta.';
  const cuts = { 'fixture:1.2': { empty: 'up' }, 'fixture:1.3': { after: 'Earlier teaching.', own: true } };
  expect(segment(`<p>Earlier teaching.</p><p><span class="pe">${note}</span></p>`,
    [{ en: 'Earlier teaching.' }, {}, { en: note }, {}], cuts))
    .toEqual(['Earlier teaching.', '', note, '']);
});

test('a Pali sentence tail that Sujato leaves blank stays with the printed sentence', () => {
  const body = [
    { en: 'I should train: I will know my own mind.', pali: 'sacittapariyāyakusalo bhavissāmī—' },
    { pali: 'evañhi sikkhitabbaṁ.' },
    { paraStart: true, pali: 'Kathañca kusalo hoti?', en: 'How is one skilled?' },
    {},
    { en: 'as in AN1.1 down to' },
    { en: 'The final answer is peace.' },
  ];
  expect(segment('<p>I should train: I will know my own mind. … [97–98] … <span class="pe">as in AN1.1 down to:</span> … The final answer is peace.</p>', body))
    .toEqual(['I should train: I will know my own mind.', '', '… [97–98] … as in AN1.1 down to: …', '', '', 'The final answer is peace.']);
});

test('a leading ellipsis joins a whole passage reference after a complete question', () => {
  const body = [{ pali: 'Kiṁ maññasi?', en: 'What do you think?' }, {}, { en: 'all as in §32' }, { en: 'The final answer is peace.' }];
  expect(segment('<p>What do you think? … <span class="pe">all as in §32</span> … The final answer is peace.</p>', body))
    .toEqual(['What do you think?', '… all as in §32 …', '', 'The final answer is peace.']);
});

test('an ambiguous inline abbreviation does not displace an independently aligned ellipsis', () => {
  const body = [{ en: 'What four?', pali: 'Katame cattāro?' }, {}, { en: '…' }, { en: 'as above' }, { en: 'These are the four.' }];
  expect(segment('<p>What four? … <span class="pe">as above</span> … These are the four.</p>', body))
    .toEqual(segment('<p>What four? … as above … These are the four.</p>', body));
});
