import { afterAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-page-parsing-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

// Exercise the production CLI and the independent Python page reader together.
function segment(source) {
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const name of ['segment-translations.mjs', 'check-upstream.py']) {
    write(`scripts/segmenter/${name}`, fs.readFileSync(path.join(ROOT, 'scripts/segmenter', name), 'utf8'));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'scripts/lib'), path.join(root, 'scripts/lib'), 'dir');
  write('data/pali/sutta/fixture_root-pli-ms.json', { 'fixture:0.1': 'Fixture', 'fixture:1.1': 'Teaching.' });
  write('data/sujato/sutta/fixture_translation-en-sujato.json', { 'fixture:0.1': 'Fixture', 'fixture:1.1': 'Canonical teaching.' });
  write('data/html/pli/ms/sutta/fixture_html.json', { 'fixture:0.1': '<h1>{}</h1>', 'fixture:1.1': '<p>{}</p>' });
  write('data/upstream/thanissaro/sutta/fixture.html', `<div id="sutta"><h1>Fixture</h1>${source}</div>`);
  write('data/thanissaro/cuts.json', {});
  write('data/thanissaro/learned.json', {});
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
  };
  expect(run(process.execPath, ['scripts/segmenter/segment-translations.mjs', 'thanissaro']))
    .toContain('0 not written');
  expect(run('python3', ['scripts/segmenter/check-upstream.py', 'thanissaro'])).toContain('0 differ');
  const read = (folder, suffix) => {
    const file = path.join(root, `data/thanissaro/${folder}/fixture_${suffix}-en-thanissaro.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  };
  const notes = read('notes', 'comment');
  return { text: Object.values(read('sutta', 'translation')).join(' ').replace(/\s+/g, ' '),
    notes: Object.values(notes).join(' '), noteOn: notes };
}

test('an asterisk footnote after the text is a note on the line its asterisk closes', () => {
  const result = segment('<p>Canonical teaching.*</p><div class="verse"><p class="vspk">*Alternative reading:</p><p>Another</p><p>teaching.</p></div>');
  expect(result.text.trim()).toBe('Fixture Canonical teaching.');
  expect(result.noteOn['fixture:1.1']).toBe('Alternative reading: Another teaching.');
});

test('mixed italic introductory prose stays in notes while roman terms interrupt it', () => {
  const result = segment('<p><em>This introductory explanation starts in italic, with the Pali word </em>Buddha<em> explained in a further italic sentence that closes the introduction.</em></p><p>Canonical teaching.</p>');
  expect(result.text.trim()).toBe('Fixture Canonical teaching.');
  expect(result.notes).toContain('Buddha');
});

test.each([
  '<i>Alternative translation:</i>',
  '<i>[Because this discourse can also be translated as follows:]</i>',
])('a labelled alternative rendering and its footnote precede See also: %s', heading => {
  const result = segment(`<p>Canonical teaching.</p><p>${heading}</p><p>Another rendering.<span class="fn"><a href="#note1">1</a></span></p><div class="note"><p id="note1">1. Rendering explanation.</p></div><p>See also SN 45:8.</p>`);
  expect(result.text.trim()).toBe('Fixture Canonical teaching.');
  expect(result.notes).toContain('Another rendering.');
  expect(result.notes).toContain('Rendering explanation.');
  expect(result.notes.indexOf('Another rendering.')).toBeLessThan(result.notes.indexOf('See also'));
});

test('a closing note continues outside its box after a nested verse', () => {
  const result = segment('<p>Canonical teaching.<span class="fn"><a href="#note1">1</a></span></p><div class="note"><p id="note1">1. Explanation.</p><div class="verse"><p>Quoted note verse.</p></div></div><p>Continued explanation.</p>');
  expect(result.text.trim()).toBe('Fixture Canonical teaching.');
  expect(result.notes).toContain('Continued explanation.');
});

test('a separately labelled closing note after See also stays in notes', () => {
  const result = segment('<p>Canonical teaching.</p><p>See also SN 45:8.</p><p>Note: Editorial explanation.</p>');
  expect(result.text.trim()).toBe('Fixture Canonical teaching.');
  expect(result.notes).toContain('Note: Editorial explanation.');
});

test('inline Commentary asides and bracketed literal renderings stay in the translation', () => {
  const words = 'Canonical teaching [Commentary: the five hindrances], [The Commentary notes the explanation], [literally: otherness].';
  const result = segment(`<p>${words}</p>`);
  expect(result.text.trim()).toBe(`Fixture ${words}`);
  expect(result.notes).toBe('');
});

test('italic canonical speech after the body starts stays in the translation', () => {
  const result = segment('<p>Canonical teaching.</p><p><i>Spoken canonical verse.</i></p>');
  expect(result.text).toContain('Spoken canonical verse.');
  expect(result.notes).toBe('');
});

test('indented introductions and notes stay outside the translated text', () => {
  const result = segment('<p><em>An introduction.</em></p><div class="iblock"><p>An introductory list.</p></div><p>Canonical teaching.<span class="fn"><a href="#note1">1</a></span></p><div class="note"><p id="note1">1. Explanation.</p><div class="block"><p>A quoted note.</p></div></div>');
  expect(result.text.trim()).toBe('Fixture Canonical teaching.');
  expect(result.notes).toContain('An introductory list.');
  expect(result.notes).toContain('A quoted note.');
  expect(result.notes).not.toContain('<div');
});
