import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KN_BOOKS } from './lib/collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// A disposable output directory, the build wiping and rewriting whatever CORPUS_OUT names.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-corpus-'));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

let corpus;

// Runs the real build against the real data/, the counts below being about what this dataset
// actually contains. Costs a couple of seconds, which is why it sits in its own file.
beforeAll(() => {
  const result = spawnSync(process.execPath, ['scripts/build-corpus.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CORPUS_OUT: dataDir },
  });
  if (result.status !== 0) throw new Error(`build-corpus.mjs failed:\n${result.stdout}\n${result.stderr}`);
  corpus = JSON.parse(fs.readFileSync(path.join(dataDir, 'corpus.json'), 'utf8'));
}, 30000);

function countMatching(prefixPattern) {
  return Object.keys(corpus.suttas).filter((id) => prefixPattern.test(id)).length;
}

// DN, MN, SN and AN are complete here, so their counts are fixed and a change means the tree
// logic regressed. Counted over the flat `suttas` map rather than the nested tree; the `\d` after
// the prefix is what tells "sn1.2" from Sutta Nipāta's "snp1.1".
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

  // Per book, KN carrying only some of its 20 and its total being free to grow.
  const KN_EXPECTED_COUNTS = { snp: 73, dhp: 26, ud: 80, iti: 112, thag: 264, thig: 73 };

  it('KN_BOOKS matches exactly the books this test has expectations for', () => {
    // Fails when a book joins or leaves KN_BOOKS, rather than letting it go unchecked.
    expect(KN_BOOKS.map((b) => b.id).sort()).toEqual(Object.keys(KN_EXPECTED_COUNTS).sort());
  });

  for (const book of KN_BOOKS) {
    it(`KN book "${book.id}" has a fixed ${KN_EXPECTED_COUNTS[book.id]} suttas`, () => {
      const row = corpus.nikayas.find((n) => n.id === 'kn').chapters.find((c) => c.id === book.id);
      expect(row.count).toBe(KN_EXPECTED_COUNTS[book.id]);
    });
  }
});

// The shard files themselves, which flushShard builds by concatenating already-serialized JSON
// rather than re-stringifying — so nothing else would catch a bad separator or an unescaped uid.
describe('build-corpus text shards (real data)', () => {
  let manifest;

  beforeAll(() => {
    manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'text-shards', 'manifest.json'), 'utf8'));
  });

  it('accounts for every sutta in corpus.json exactly once, with no duplicates across shards', () => {
    const allUids = manifest.shards.flatMap((s) => s.uids);
    expect(allUids.length).toBe(manifest.totalUids);
    expect(new Set(allUids).size).toBe(allUids.length);
    expect(allUids.sort()).toEqual(Object.keys(corpus.suttas).sort());
  });

  it('totalBytes is the sum of each shard entry\'s own byte count', () => {
    expect(manifest.shards.reduce((n, s) => n + s.bytes, 0)).toBe(manifest.totalBytes);
  });

  // Reads every shard plus all 4000-odd per-uid files, the heaviest read in the suite.
  it('every shard file is valid JSON, its byte length matches its manifest entry, its keys match the manifest\'s uid list, and each uid\'s content matches that uid\'s own text/{uid}.json byte-for-byte', () => {
    for (const shard of manifest.shards) {
      const raw = fs.readFileSync(path.join(dataDir, shard.file), 'utf8');
      expect(Buffer.byteLength(raw)).toBe(shard.bytes);
      const bundle = JSON.parse(raw);
      expect(Object.keys(bundle).sort()).toEqual([...shard.uids].sort());
      for (const uid of shard.uids) {
        const individual = fs.readFileSync(path.join(dataDir, 'text', `${uid}.json`), 'utf8');
        expect(JSON.stringify(bundle[uid])).toBe(individual);
      }
    }
  }, 30_000);
});
