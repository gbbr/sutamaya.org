// The regression guard for full-text search: scripts/search-golden.json run against the real
// corpus, exactly as the reader's keystroke runs it.
//
// It builds the corpus into a temporary directory (the same integration approach as
// scripts/build-corpus.counts.test.js, and for the same reason — a fixture tree cannot catch a
// ranking regression) and then calls the shipped search, blobs and all.
//
// Two groups. Most queries must put an expected sutta in the top `topN` and fail the suite if they
// stop doing so. The rest are **pending**: the golden file's own `known_gap` entries, which measure
// the query-expansion table, plus UNMET below, which the ranking as specified does not reach. Those
// are reported rather than asserted one by one — but every pending query that *is* reached today is
// asserted, so one slipping back still fails.
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTextIndex, searchCorpusAndText, type TextIndex, type SearchMap } from './text';
import type { Corpus } from '../types';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// Golden queries this implementation does not answer, and why. Each is a sutta the query set names
// on aboutness rather than on words: the expected sutta either doesn't contain the query's words at
// all, or contains them too few times to outrank the suttas that dwell on them.
const UNMET: Record<string, string> = {
  'noble eightfold path': 'SN 45.8 is the analysis of it; ~700 suttas name it more often',
  'poisoned arrow': 'MN 63 says "an arrow thickly smeared with poison" and ranks 7th',
  'seven factors of awakening': 'SN 46.1 and SN 46.5 are short; the suttas that list the factors win',
  'five hindrances': 'SN 46.55 never writes "five"; MN 39 and DN 2 are outranked',
  'four jhanas': 'a mixed query — "four" is English, "jhanas" Pali, and neither side has both',
  sotapanna: 'SN 55.1 contains neither sotāpanna nor "stream-enterer"',
  metta: 'SNP 1.8 and AN 11.15 are short; ~40 suttas say mettā more often',
};

interface GoldenQuery {
  q: string;
  expect: string[];
  known_gap?: string;
}
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'search-golden.json'), 'utf8')) as {
  topN: number;
  queries: GoldenQuery[];
};

let corpus: Corpus;
let index: TextIndex;

beforeAll(() => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'search-golden-'));
  const result = spawnSync(process.execPath, ['scripts/build-corpus.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CORPUS_OUT: out },
  });
  if (result.status !== 0) throw new Error(`build-corpus.mjs failed:\n${result.stdout}\n${result.stderr}`);
  corpus = JSON.parse(fs.readFileSync(path.join(out, 'corpus.json'), 'utf8'));
  const search = path.join(out, 'search');
  const read = (name: string) => fs.readFileSync(path.join(search, `${name}.${corpus.searchVersion}.txt`), 'utf8');
  const map = JSON.parse(fs.readFileSync(path.join(search, `map.${corpus.searchVersion}.json`), 'utf8')) as SearchMap;
  index = buildTextIndex(read('en'), read('pa'), map);
  fs.rmSync(out, { recursive: true, force: true });
}, 60000);

// A hit opens its `matchedId` where the query named one sutta of a batched document.
function topUids(query: string): string[] {
  return searchCorpusAndText(corpus, query, {}, [], {}, index)
    .slice(0, golden.topN)
    .map((h) => h.matchedId ?? h.id);
}

function found(entry: GoldenQuery): { ok: boolean; top: string[] } {
  const top = topUids(entry.q);
  return { ok: entry.expect.some((uid) => top.includes(uid)), top };
}

function why(entry: GoldenQuery, top: string[]): string {
  return `expected one of ${entry.expect.join(', ')} in the top ${golden.topN}, got ${top.join(', ') || 'nothing'}`;
}

// Pending queries the expansion table already answers.
const REACHED = ['the fire sermon'];

const pending = golden.queries.filter((e) => e.known_gap || e.q in UNMET);
const answered = golden.queries.filter((e) => !pending.includes(e));

describe('golden query set', () => {
  it.each(answered.map((e) => [e.q, e] as const))('finds %s', (_q, entry) => {
    const { ok, top } = found(entry);
    expect(ok, why(entry, top)).toBe(true);
  });
});

describe('golden query set — pending', () => {
  it('reports which pending queries are answered, and holds the ones that are', () => {
    const reached: string[] = [];
    const missing: string[] = [];
    for (const entry of pending) {
      const { ok } = found(entry);
      (ok ? reached : missing).push(entry.q);
    }
    console.log(
      `pending: ${reached.length} of ${pending.length} reached — ${reached.join(', ') || 'none'}` +
        `\n  still open: ${missing.join(', ') || 'none'}`
    );
    // The list is what the expansion table has earned so far; adding to it is the point, losing
    // one is a regression.
    expect(reached).toEqual(expect.arrayContaining(REACHED));
  });
});
