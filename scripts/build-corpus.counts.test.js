import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KN_BOOKS } from './lib/collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Somewhere disposable, via CORPUS_OUT (see build-corpus.mjs), because the build deletes and
// rewrites its whole output directory: running the tests has no business wiping the
// web/public/data a dev server is serving, or racing whatever else is writing there.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-corpus-'));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

let corpus;

// Runs the real build against the real data/ (not a synthetic fixture) — this is deliberately an
// integration check, not a unit test: the whole point is to catch a regression in the real
// extracted counts, which a fixture tree couldn't do. Costs ~2s (thousands of source files
// indexed), which is why it's isolated in this file rather than folded into collections.test.js.
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

// web/src/lib/offline.test.ts covers the shard-download logic itself against fakes, but not
// whether build-corpus.mjs's shard files are actually well-formed — in particular, each shard's
// body is hand-built by string-concatenating already-serialized per-uid JSON (see flushShard())
// rather than going through JSON.stringify() again, which is fast but has no safety net against a
// malformed separator/comma or a uid needing escaping. These tests catch that against the real
// build output instead.
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

  // The one check on the whole update-data index → build-corpus path. A CIPS refresh moves these
  // numbers, so they're floors rather than exact counts; what would break them is the index
  // failing to reach corpus.json at all, or its citations ceasing to resolve to uids.
  it('carries the topic index into corpus.json, worded as this app words it', () => {
    const indexed = Object.values(corpus.suttas).filter((s) => s.topics?.length);
    expect(indexed.length).toBeGreaterThan(3000);
    expect(corpus.suttas['an7.64'].topics).toContain('anger (kodha)');
    // The reworded terms and their CIPS wording travel together, or search loses one of the two.
    expect(corpus.topicAliases['composure (samādhi)']).toBe('concentration (samādhi)');
    const labels = new Set(indexed.flatMap((s) => s.topics));
    expect([...labels].filter((l) => /\bconcentration\b|\bmonks?\b|\bmendicants?\b/i.test(l))).toEqual([]);
  });

  it('totalBytes is the sum of each shard entry\'s own byte count', () => {
    expect(manifest.shards.reduce((n, s) => n + s.bytes, 0)).toBe(manifest.totalBytes);
  });

  // Reads every shard plus all 4000-odd per-uid files — the heaviest read in the suite, and well
  // past the default 5s timeout whenever the machine is busy.
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
