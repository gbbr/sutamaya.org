import { afterAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-whole-pages-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function fixture({ whole = true, replicas = ['fixture1', 'fixture2'] } = {}) {
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  for (const name of ['segment-translations.mjs', 'check-upstream.py']) {
    write(`scripts/segmenter/${name}`, fs.readFileSync(path.join(ROOT, 'scripts/segmenter', name), 'utf8'));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'scripts/lib'), path.join(root, 'scripts/lib'), 'dir');
  for (const uid of ['fixture1', 'fixture2']) {
    const rows = { [`${uid}:0.1`]: 'Shared title', [`${uid}:1.1`]: 'First teaching.', [`${uid}:1.2`]: 'Final teaching.' };
    write(`data/pali/sutta/${uid}_root-pli-ms.json`, rows);
    write(`data/sujato/sutta/${uid}_translation-en-sujato.json`, rows);
    write(`data/html/pli/ms/sutta/${uid}_html.json`, {
      [`${uid}:0.1`]: '<h1>{}</h1>', [`${uid}:1.1`]: '<p>{}</p>', [`${uid}:1.2`]: '<p>{}</p>',
    });
  }
  write('data/upstream/thanissaro/sutta/fixture1-2.html', '<div id="sutta"><h1>Shared title</h1><p><i>Shared introduction.</i></p><p>First teaching.</p><p>Final teaching.</p><div class="note"><p id="note1">1. Shared explanation.</p></div></div>');
  write('data/thanissaro/cuts.json', {});
  write('data/thanissaro/learned.json', {});
  if (whole) write('data/thanissaro/page-layouts.json', { wholePages: { 'sutta/fixture1-2.html': replicas } });
  const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 10000 });
  const result = run(process.execPath, ['scripts/segmenter/segment-translations.mjs', 'thanissaro']);
  const check = () => run('python3', ['scripts/segmenter/check-upstream.py', 'thanissaro']);
  const textPath = uid => `data/thanissaro/sutta/${uid}_translation-en-thanissaro.json`;
  return { read, write, result, check, textPath };
}

const plain = rows => Object.values(rows).join(' ').replace(/\s+/g, ' ').trim();

test('each reviewed whole-page replica has the complete text, notes and its own Pali keys', () => {
  const f = fixture();
  expect(f.result.status, f.result.stdout + f.result.stderr).toBe(0);
  for (const uid of ['fixture1', 'fixture2']) {
    const text = f.read(f.textPath(uid));
    expect(Object.keys(text).every(key => key.startsWith(`${uid}:`))).toBe(true);
    expect(plain(text)).toBe('Shared title First teaching. Final teaching.');
    expect(plain(f.read(`data/thanissaro/notes/${uid}_comment-en-thanissaro.json`)))
      .toContain('Shared introduction.');
  }
  expect(f.check().status).toBe(0);
});

test('the independent word check rejects a passage missing from just one replica', () => {
  const f = fixture();
  const text = f.read(f.textPath('fixture2'));
  text['fixture2:1.2'] = '';
  f.write(f.textPath('fixture2'), text);
  const result = f.check();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('fixture1-2.html [fixture2]');
});

test('the independent word check rejects a changed word order in one replica', () => {
  const f = fixture();
  const text = f.read(f.textPath('fixture2'));
  [text['fixture2:1.1'], text['fixture2:1.2']] = [text['fixture2:1.2'], text['fixture2:1.1']];
  f.write(f.textPath('fixture2'), text);
  expect(f.check().status).toBe(1);
});

test('a missing expected report entry fails even when the other replica is complete', () => {
  const f = fixture();
  f.write('data/thanissaro/report.json', f.read('data/thanissaro/report.json').filter(row => row.uids !== 'fixture2'));
  const result = f.check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('every expected text');
});

test('ordinary range pages keep one shared source stream without a whole-page decision', () => {
  const f = fixture({ whole: false });
  expect(f.result.status).toBe(0);
  const texts = ['fixture1', 'fixture2'].map(uid => f.read(f.textPath(uid)));
  expect(plain(Object.assign({}, ...texts))).toBe('Shared title First teaching. Final teaching.');
  expect(f.check().status).toBe(0);
});

test('a whole-page policy cannot silently omit part of its source range', () => {
  const f = fixture({ replicas: ['fixture1'] });
  expect(f.result.status).toBe(1);
  expect(f.result.stderr).toContain('every text');
});
