import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KN_BOOKS, uidDocuments } from '../lib/collections.js';
import { compareSegmentKeys } from '../lib/segmentKeys.js';
import { SUTTA_TEXT_MAX_ENTRIES } from '../../web/src/lib/corpus/cacheConfig';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

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
  let textPaths;

  beforeAll(() => {
    manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'text-shards', 'manifest.json'), 'utf8'));
    textPaths = Object.entries(corpus.suttas).flatMap(([uid, sutta]) => [uid, ...Object.keys(sutta.by ?? {}).map((by) => `${by}/${uid}`)]);
  });

  it('includes every offered translation exactly once, with no duplicates across shards', () => {
    const allUids = manifest.shards.flatMap((s) => s.uids);
    expect(allUids.length).toBe(manifest.totalUids);
    expect(new Set(allUids).size).toBe(allUids.length);
    expect(allUids.sort()).toEqual([...textPaths].sort());
  });

  it('fits the whole canon in the service worker text cache', () => {
    expect(manifest.totalUids).toBeLessThan(SUTTA_TEXT_MAX_ENTRIES);
  });

  it('invalidates completed Sujato-only downloads even when no document changes', () => {
    const digest = (body) => createHash('sha256').update(body).digest('hex').slice(0, 16);
    const legacyVersion = digest([...textPaths].sort().map((textPath) => {
      const body = fs.readFileSync(path.join(dataDir, 'text', `${textPath}.json`));
      return `${textPath}:${digest(body)}`;
    }).join('\n'));
    expect(corpus.dataVersion).not.toBe(legacyVersion);
  });

  it('totalBytes is the sum of each shard entry\'s own byte count', () => {
    expect(manifest.shards.reduce((n, s) => n + s.bytes, 0)).toBe(manifest.totalBytes);
  });

  // The byte comparison checks that offline downloads carry the same complete documents as reads.
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

// The links the build writes into translator notes, over whatever notes the last data refresh
// brought in: a link may only open a sutta the app holds, and land on a line of it.
describe('build-corpus note links (real data)', () => {
  // Each built segment's note, by key.
  const notes = new Map();
  // Each document's segment keys.
  const keysOf = new Map();
  // Every uid the reader opens, with the document holding it.
  let documents;

  beforeAll(() => {
    documents = uidDocuments(Object.keys(corpus.suttas));
    for (const doc of Object.keys(corpus.suttas)) {
      const segs = JSON.parse(fs.readFileSync(path.join(dataDir, 'text', `${doc}.json`), 'utf8'));
      keysOf.set(doc, segs.map((s) => s.key));
      for (const s of segs) if (s.note) notes.set(s.key, s.note);
    }
  });

  // A line the text doesn't show lands on the next one of its sutta (web's segmentAt).
  it('opens only suttas the app holds, at a line each has or a later one of the same sutta', () => {
    const broken = [];
    for (const [key, note] of notes) {
      for (const [, uid, line] of note.matchAll(/<a href="\/read\/([^"?]+)(?:\?at=([^"]+))?">/g)) {
        const doc = documents.get(uid);
        const wanted = `${uid}:${line}`;
        const lands = (k) => k.startsWith(`${uid}:`) && compareSegmentKeys(k, wanted) >= 0;
        if (!doc || (line && !keysOf.get(doc).some(lands))) broken.push(`${key} → ${line ? wanted : uid}`);
      }
    }
    expect(broken).toEqual([]);
  });

  // What catches the source changing how it writes a link, which the build would otherwise quietly
  // reduce to plain text.
  it('makes every suttacentral.net link to a text the app holds one of its own', () => {
    const lost = [];
    for (const file of fs.readdirSync(path.join(ROOT, 'data', 'sujato.post', 'notes'), { recursive: true })) {
      if (!file.endsWith('.json')) continue;
      const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sujato.post', 'notes', file), 'utf8'));
      for (const [key, raw] of Object.entries(source)) {
        if (!notes.has(key)) continue;
        const held = [...raw.matchAll(/href=['"]https?:\/\/suttacentral\.net\/([a-z][a-z0-9.-]*)/g)].filter(([, uid]) => documents.has(uid));
        const made = notes.get(key).match(/<a href="\/read\//g) ?? [];
        if (made.length !== held.length) lost.push(`${key}: ${made.length} of ${held.length}`);
      }
    }
    expect(lost).toEqual([]);
  });
});

// Bodhi's and Ṭhānissaro's texts as the build offers them (data/upstream/README.md's "Building them
// into the app").
describe('build-corpus other translations (real data)', () => {
  // Each translator's built documents, by uid.
  const built = { bodhi: new Map(), thanissaro: new Map() };
  // Every uid the reader opens, with the document holding it.
  let documents;

  // Returns Sujato's built document `doc`.
  const sujato = (doc) => JSON.parse(fs.readFileSync(path.join(dataDir, 'text', `${doc}.json`), 'utf8'));

  beforeAll(() => {
    documents = uidDocuments(Object.keys(corpus.suttas));
    for (const [by, docs] of Object.entries(built)) {
      for (const file of fs.readdirSync(path.join(dataDir, 'text', by))) {
        docs.set(file.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dataDir, 'text', by, file), 'utf8')));
      }
    }
  });

  it('writes a text for exactly the translations the index names', () => {
    for (const [by, docs] of Object.entries(built)) {
      const named = Object.keys(corpus.suttas).filter((uid) => corpus.suttas[uid].by?.[by]);
      expect([...docs.keys()].sort()).toEqual(named.sort());
    }
  });

  it('offers only whole translations: no partial group, no excerpt', () => {
    for (const uid of ['an1.41-50', 'an2.1-10', 'dn21', 'dn26', 'mn54', 'mn91']) expect(built.thanissaro.has(uid)).toBe(false);
    expect(built.bodhi.has('sn12.83-92')).toBe(true);
  });

  it('shows a page standing for several texts whole on each, crediting the same page', () => {
    const sources = ['sn15.14', 'sn15.15', 'sn15.16', 'sn15.17', 'sn15.18', 'sn15.19'].map((uid) => corpus.suttas[uid].by?.thanissaro);
    expect(new Set(sources)).toEqual(new Set(['https://www.dhammatalks.org/suttas/SN/SN15_14.html']));
  });

  it('serializes every source bullet and keeps the reunited DN 1 heading whole', () => {
    for (const [uid, count] of [['dn1', 113], ['dn2', 148]]) {
      const items = built.bodhi.get(uid).flatMap(s => (s.blocks ?? []).filter(([, , kind]) => kind === 'list-item'));
      expect(items).toHaveLength(count);
    }
    const dn1 = built.bodhi.get('dn1');
    expect(dn1.find(s => s.key === 'dn1:1.28.0.1')?.en).toBe('III. Speculations about the Past (Pubbantakappika)');
    expect(dn1.some(s => s.key === 'dn1:1.28.0.2')).toBe(false);
  });

  it('serializes recognized lists as indented ranges and leaves prose plain', () => {
    for (const [uid, count] of [['dn1', 95], ['dn2', 64]]) {
      const items = built.thanissaro.get(uid).flatMap(s => (s.blocks ?? []).filter(([, , kind]) => kind === 'indented-item'));
      expect(items).toHaveLength(count);
    }
    const arts = built.thanissaro.get('dn1').find(s => s.key === 'dn1:1.24.2');
    expect(arts.blocks).toHaveLength(13);
    expect(arts.blocks.every(([, , kind]) => kind === 'indented-item')).toBe(true);
    expect(arts.en).toMatch(/^there will be a lunar eclipse;/);
    for (const uid of ['mn27', 'sn4.24']) {
      expect(built.thanissaro.get(uid).flatMap(s => s.blocks ?? []).every(([, , kind]) =>
        kind === 'paragraph' || kind === 'list-item')).toBe(true);
    }
  });

  it('serializes source speaker labels in verse and prose for both translators', () => {
    for (const [by, buddha, mara] of [['bodhi', 'The Blessed One:', 'Mara:'], ['thanissaro', 'The Buddha:', 'Māra:']]) {
      const labels = built[by].get('sn4.24').flatMap(s => [
        ...(s.speaker ? [s.speaker] : []),
        ...(s.speakers ?? []).map(([from, to]) => s.en.slice(from, to)),
      ]);
      expect(labels).toEqual([buddha, mara, buddha, mara, buddha, mara]);
    }
    const prose = built.bodhi.get('sn4.24').find(s => s.key === 'sn4.24:8.1');
    expect(prose.speaker).toBe('Mara:');
    expect(prose.en).toMatch(/^“Suppose/);
    // A label closing a line names the next line's speaker, as "The Blessed One said:" after MN 13's
    // report does, and one after the quotation mark opening a paragraph keeps the mark.
    const mn13 = built.bodhi.get('mn13');
    expect(mn13.find(s => s.key === 'mn13:5.1').en).toMatch(/taken place\.$/);
    expect(mn13.find(s => s.key === 'mn13:6.1').speaker).toBe('The Blessed One said:');
    expect(built.bodhi.get('an3.15').find(s => s.key === 'an3.15:4.1').speaker).toBe('“The king asked:');
    for (const by of ['bodhi', 'thanissaro']) {
      const inline = [...built[by].values()].flat().filter(s => s.speakers?.length);
      expect(inline.map(s => s.key)).toEqual([]);
    }
    expect(built.thanissaro.get('sn5.9').flatMap(s => [s.speaker, ...(s.speakers ?? []).map(([a, b]) => s.en.slice(a, b))]))
      .not.toContain('*Alternative reading:');
  });

  it('serializes paragraph ranges over plain text for both translators', () => {
    for (const by of ['bodhi', 'thanissaro']) {
      const paragraphs = [...built[by].values()].flat().filter(s => s.blocks?.some(([, , kind]) => kind === 'paragraph'));
      expect(paragraphs.length).toBeGreaterThan(0);
      for (const seg of paragraphs) {
        const ranges = seg.blocks.filter(([, , kind]) => kind === 'paragraph');
        // One paragraph marks his prose on a verse line; otherwise two or more share it.
        if (seg.role !== 'verse') expect(seg.blocks.length).toBeGreaterThan(1);
        expect(seg.en).not.toMatch(/<\/?(?:p|ul|li)>/);
        for (const [from, to] of ranges) {
          expect(from).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThanOrEqual(seg.en.length);
          expect(seg.en.slice(from, to).trim()).not.toBe('');
        }
      }
    }
  });

  it('shows the Pali of every covered line', () => {
    const paliFiles = new Map();
    for (const file of fs.readdirSync(path.join(ROOT, 'data', 'pali', 'sutta'), { recursive: true })) {
      if (file.endsWith('.json')) paliFiles.set(path.basename(file).split('_')[0], path.join(ROOT, 'data', 'pali', 'sutta', file));
    }
    const hidden = [];
    for (const [by, docs] of Object.entries(built)) {
      for (const key of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', by, 'covered.json'), 'utf8'))) {
        const doc = documents.get(key.slice(0, key.indexOf(':')));
        if (!docs.has(doc)) continue;
        const line = JSON.parse(fs.readFileSync(paliFiles.get(doc), 'utf8'))[key].trim();
        if (!docs.get(doc).some((s) => s.pali.includes(line))) hidden.push(`${by} ${key}`);
      }
    }
    expect(hidden).toEqual([]);
  });

  it("opens a link in the same translator's text where he offers it, Sujato's otherwise, at a line that version has", () => {
    const broken = [];
    for (const [by, docs] of Object.entries(built)) {
      for (const segs of docs.values()) {
        const links = segs.flatMap((s) => [
          ...(s.links ?? []).map(([, , to]) => [s.key, to]),
          ...[...(s.note ?? '').matchAll(/<a href="([^"]+)">/g)].map(([, to]) => [s.key, to]),
        ]);
        for (const [key, to] of links) {
          const url = new URL(to, 'https://app.sutamaya.org');
          const uid = url.pathname.replace('/read/', '');
          const doc = documents.get(uid);
          const shown = url.searchParams.get('by');
          const line = url.searchParams.get('at');
          const offered = doc && corpus.suttas[doc].by?.[by];
          const target = !doc ? null : shown ? built[shown].get(doc) : sujato(doc);
          const wanted = `${uid}:${line}`;
          const lands = (s) => s.key.startsWith(`${uid}:`) && compareSegmentKeys(s.key, wanted) >= 0;
          if (!target || (shown ? shown !== by : offered) || (line && !target.some(lands))) broken.push(`${by} ${key} → ${to}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
