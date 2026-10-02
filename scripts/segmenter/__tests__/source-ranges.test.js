import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-source-ranges-'));

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

beforeAll(() => {
  fs.mkdirSync(path.join(scratch, 'scripts/segmenter'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'data/thanissaro/review'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts/segmenter/segment-translations.mjs'), path.join(scratch, 'scripts/segmenter/segment-translations.mjs'));
  for (const relative of ['node_modules', 'scripts/lib', 'data/pali', 'data/sujato', 'data/html', 'data/upstream']) {
    fs.symlinkSync(path.join(ROOT, relative), path.join(scratch, relative), 'dir');
  }
  for (const relative of ['cuts.json', 'learned.json', 'review/references.json']) {
    fs.copyFileSync(path.join(ROOT, 'data/thanissaro', relative), path.join(scratch, 'data/thanissaro', relative));
  }
  const result = spawnSync(process.execPath, [
    'scripts/segmenter/segment-translations.mjs', 'thanissaro', '--only',
    'sn45.56-62,sn56.102-113,an1.31-40',
  ], { cwd: scratch, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  expect(result.stdout).toContain('0 not written');
}, 30000);

function text(collection, chapter, uid) {
  return JSON.parse(fs.readFileSync(path.join(scratch, `data/thanissaro/sutta/${collection}/${chapter}/${uid}_translation-en-thanissaro.json`), 'utf8'));
}

describe('source ranges spanning grouped Pali documents', () => {
  it('places each rebirth comparison on its corresponding human or deva document', () => {
    expect(text('sn', 'sn56', 'sn56.104')['sn56.104:1.1']).toContain('hungry ghosts');
    expect(text('sn', 'sn56', 'sn56.104')['sn56.104:1.1']).not.toContain('among devas');
    expect(text('sn', 'sn56', 'sn56.105-107')['sn56.105-107:1.1']).toContain('from the human realm, are reborn among devas');
    expect(text('sn', 'sn56', 'sn56.108-110')['sn56.108-110:1.1']).toContain('from the deva realm, are reborn among devas');
    expect(text('sn', 'sn56', 'sn56.111-113')['sn56.111-113:1.1']).toContain('from the deva realm, are reborn among human beings');
  });

  it('keeps the dawn and five accomplishment variants before appropriate attention', () => {
    const grouped = text('sn', 'sn45', 'sn45.57-61');
    expect(grouped['sn45.57-61:1.1']).toContain('dawnrise');
    for (const [key, words] of Object.entries({
      '1.2': 'virtue-consummation', '1.3': 'desire-consummation', '1.4': 'self-consummation',
      '1.5': 'view-consummation', '1.6': 'heedfulness-consummation',
    })) expect(grouped[`sn45.57-61:${key}`]).toContain(words);
    expect(text('sn', 'sn45', 'sn45.62')['sn45.62:1.1'].trim()).toBe('appropriate attention.');
  });

  it('preserves separately keyed discourses inside an AN batch document', () => {
    const batch = text('an', 'an1', 'an1.31-40');
    for (let n = 31; n <= 40; n++) expect(batch[`an1.${n}:1.1`]).toBeTruthy();
    expect(Object.keys(batch).some(key => key.startsWith('an1.31-40:'))).toBe(false);
  });
});
