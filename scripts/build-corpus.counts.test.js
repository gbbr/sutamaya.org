import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KN_BOOKS } from './lib/collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let corpus;

// Runs the real build against the real data/ (not a synthetic fixture) — this is deliberately an
// integration check, not a unit test: the whole point is to catch a regression in the real
// extracted counts, which a fixture tree couldn't do. Costs ~2s (thousands of source files
// indexed), which is why it's isolated in this file rather than folded into collections.test.js.
beforeAll(() => {
  const result = spawnSync(process.execPath, ['scripts/build-corpus.mjs'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`build-corpus.mjs failed:\n${result.stdout}\n${result.stderr}`);
  corpus = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'public', 'data', 'corpus.json'), 'utf8'));
}, 30000);

function countMatching(prefixPattern) {
  return Object.keys(corpus.suttas).filter((id) => prefixPattern.test(id)).length;
}

// DN/MN/SN/AN are complete in this dataset per CLAUDE.md's data pipeline notes — their sutta
// counts are fixed canon facts, not something that grows over time the way KN's book list does.
// A change here means the browse-tree/flattening logic regressed, not that new suttas appeared.
// Matched by uid prefix directly against the flat `suttas` map (not via the nested chapter/
// category tree, whose shape these counts shouldn't depend on) — `\d` right after the two-letter
// prefix is what tells e.g. real "sn1.2" apart from Sutta Nipāta's "snp1.1".
describe('build-corpus sutta counts (real data)', () => {
  it('DN has a fixed 34 suttas', () => {
    expect(countMatching(/^dn\d/)).toBe(34);
  });

  it('MN has a fixed 152 suttas', () => {
    expect(countMatching(/^mn\d/)).toBe(152);
  });

  it('SN has a fixed 1819 suttas', () => {
    expect(countMatching(/^sn\d/)).toBe(1819);
  });

  it('AN has a fixed 1408 suttas', () => {
    expect(countMatching(/^an\d/)).toBe(1408);
  });

  // KN itself is deliberately NOT checked as a whole — only some of its 20 books are populated
  // in this dataset by design (see CLAUDE.md), so its total is expected to grow as more are
  // added. Each *currently populated* book's own count is still fixed, though.
  const KN_EXPECTED_COUNTS = { snp: 73, dhp: 26, ud: 80, iti: 112, thag: 264, thig: 73 };

  it('KN_BOOKS matches exactly the books this test has expectations for', () => {
    // Guards against this test silently going stale: if a book is added to/removed from
    // KN_BOOKS without updating KN_EXPECTED_COUNTS above, fail loudly here instead of the new
    // book just never being checked.
    expect(KN_BOOKS.map((b) => b.id).sort()).toEqual(Object.keys(KN_EXPECTED_COUNTS).sort());
  });

  for (const book of KN_BOOKS) {
    it(`KN book "${book.id}" has a fixed ${KN_EXPECTED_COUNTS[book.id]} suttas`, () => {
      const row = corpus.nikayas.find((n) => n.id === 'kn').chapters.find((c) => c.id === book.id);
      expect(row.count).toBe(KN_EXPECTED_COUNTS[book.id]);
    });
  }
});
