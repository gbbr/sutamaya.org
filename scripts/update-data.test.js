import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireSourceRoot, sourceGitInfo, checkSnapshotInSync, checkCrossCategoryIntegrity, listLocalRelPaths, localPathFor, readKeysSafe } from './lib/dataSync.js';
import { runCheck } from './update-data-check.mjs';
import { runCopy } from './update-data-copy.mjs';
import { runPost, applyReplacements } from './update-data-post.mjs';
import { runSnapshot } from './update-data-snapshot.mjs';

// Everything here runs against throwaway temp-dir fixtures, never the real data/{sujato,pali,html}
// or a real SC_DATA_PATH checkout — check/copy/post/snapshot all accept explicit dataDirs/
// bilaraRoot/snapshotPath/manifestPath overrides for exactly this reason (see each script's
// runXxx export).

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// A miniature stand-in for data/{sujato,pali,html} + a matching sc_bilara_data checkout, covering
// all six tracked categories at their real CATEGORY_SOURCE_PREFIXES locations, starting identical
// (and cross-category-aligned) on both sides — individual tests mutate one side or the other from
// here. dn1's sutta-text and dn's name-index segment ids deliberately line up across
// sujato/pali/html, matching what INTEGRITY_GROUPS expects of the real data.
const FIXTURE_FILES = {
  'sujato/blurb/dn-blurbs_root-en.json': {
    sourceRel: 'root/en/blurb/dn-blurbs_root-en.json',
    content: { 'dn-blurbs:dn1': 'A mendicant teaches immersion.' },
  },
  'sujato/name/dn-name_translation-en-sujato.json': {
    sourceRel: 'translation/en/sujato/name/sutta/dn-name_translation-en-sujato.json',
    content: { 'dn-name:1.dn1': 'The Mendicants Sutta' },
  },
  'sujato/sutta/dn/dn1_translation-en-sujato.json': {
    sourceRel: 'translation/en/sujato/sutta/dn/dn1_translation-en-sujato.json',
    content: { 'dn1:1.1': 'The mendicant practiced immersion.', 'dn1:1.2': 'A water immerser is different.' },
  },
  'sujato/notes/dn/dn1_comment-en-sujato.json': {
    sourceRel: 'comment/en/sujato/sutta/dn/dn1_comment-en-sujato.json',
    content: { 'dn1:1.1': 'Note about Immersion and Mendicants.' },
  },
  'pali/sutta/dn/dn1_root-pli-ms.json': {
    sourceRel: 'root/pli/ms/sutta/dn/dn1_root-pli-ms.json',
    content: { 'dn1:1.1': 'Bhikkhu samādhiṁ bhāveti.', 'dn1:1.2': 'Udake ogāhako añño hoti.' },
  },
  'pali/name/dn-name_root-misc-site.json': {
    sourceRel: 'root/misc/site/name/sutta/dn-name_root-misc-site.json',
    content: { 'dn-name:1.dn1': 'Brahmajālasutta' },
  },
  'html/pli/ms/sutta/dn/dn1_html.json': {
    sourceRel: 'html/pli/ms/sutta/dn/dn1_html.json',
    content: { 'dn1:1.1': "<p>{}</p>", 'dn1:1.2': "<p>{}</p>" },
  },
};

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-data-test-'));
  const dataDirs = { sujato: path.join(root, 'sujato'), pali: path.join(root, 'pali'), html: path.join(root, 'html') };
  const bilaraRoot = path.join(root, 'bilara');
  const snapshotPath = path.join(root, 'snapshot.json');
  const manifestPath = path.join(root, 'manifest.json');

  for (const [relPath, { sourceRel, content }] of Object.entries(FIXTURE_FILES)) {
    const [dirName, ...rest] = relPath.split('/');
    writeJson(path.join(dataDirs[dirName], ...rest), content);
    writeJson(path.join(bilaraRoot, sourceRel), content);
  }

  return { root, dataDirs, bilaraRoot, snapshotPath, manifestPath };
}

describe('applyReplacements', () => {
  it('swaps mendicant/mendicants for bhikkhu/bhikkhus, case-preserved', () => {
    expect(applyReplacements('a mendicant and some mendicants').result).toBe('a bhikkhu and some bhikkhus');
    expect(applyReplacements('Mendicants gathered. A Mendicant spoke.').result).toBe('Bhikkhus gathered. A Bhikkhu spoke.');
  });

  it('swaps each immers* verb/noun form for the matching concentrat* form, case-preserved', () => {
    expect(applyReplacements('to immerse, immersed, immersing, immersion, immersions').result).toBe(
      'to concentrate, concentrated, concentrating, concentration, concentrations',
    );
    expect(applyReplacements('Immersion in the present.').result).toBe('Concentration in the present.');
  });

  it('leaves words merely built on the same stem alone (not an explicit form)', () => {
    // "immerser" (MN40's "water immerser") isn't a listed word form, so it must survive untouched
    // — this is the exact bug an earlier blind "immers" -> "concentrat" substring swap had.
    const { result, count } = applyReplacements('a water immerser dunks in water');
    expect(result).toBe('a water immerser dunks in water');
    expect(count).toBe(0);
  });

  it('does not match a word form embedded in a longer word (word-boundary safe)', () => {
    expect(applyReplacements('reimmersion mendicants-only').count).toBe(1); // only "mendicants" via the hyphen boundary
  });

  it('reports the number of replacements made', () => {
    expect(applyReplacements('a mendicant, some mendicants, and immersion').count).toBe(3);
    expect(applyReplacements('nothing to change here').count).toBe(0);
  });
});

describe('requireSourceRoot / sourceGitInfo', () => {
  const originalEnv = process.env.SC_DATA_PATH;
  let tmpDirs = [];

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SC_DATA_PATH;
    else process.env.SC_DATA_PATH = originalEnv;
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDirs = [];
  });

  function tmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-data-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('throws when SC_DATA_PATH is not set', () => {
    delete process.env.SC_DATA_PATH;
    expect(() => requireSourceRoot()).toThrow(/SC_DATA_PATH is not set/);
  });

  it('throws when SC_DATA_PATH has no sc_bilara_data subdirectory', () => {
    process.env.SC_DATA_PATH = tmpDir();
    expect(() => requireSourceRoot()).toThrow(/has no sc_bilara_data/);
  });

  it('resolves scDataPath/bilaraRoot when sc_bilara_data exists', () => {
    const scDataPath = tmpDir();
    fs.mkdirSync(path.join(scDataPath, 'sc_bilara_data'));
    process.env.SC_DATA_PATH = scDataPath;
    expect(requireSourceRoot()).toEqual({ scDataPath, bilaraRoot: path.join(scDataPath, 'sc_bilara_data') });
  });

  it('sourceGitInfo throws for a non-git directory', () => {
    expect(() => sourceGitInfo(tmpDir())).toThrow(/doesn't look like a git checkout/);
  });

  it('sourceGitInfo reports the current commit and clean/dirty state of a real checkout', () => {
    const dir = tmpDir();
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    const expectedCommit = git('rev-parse', 'HEAD').trim();
    const clean = sourceGitInfo(dir);
    expect(clean.commit).toBe(expectedCommit);
    expect(clean.dirty).toBe(false);
    expect(typeof clean.commitDate).toBe('string');

    fs.writeFileSync(path.join(dir, 'f.txt'), 'y');
    expect(sourceGitInfo(dir).dirty).toBe(true);
  });
});

describe('checkSnapshotInSync', () => {
  let fx;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    fs.rmSync(fx.root, { recursive: true, force: true });
  });

  it('reports ok when data/{sujato,pali,html} matches the snapshot', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    expect(checkSnapshotInSync({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath })).toEqual({ ok: true, issues: [] });
  });

  it('reports drift when a local file changed without the snapshot being regenerated', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    // Simulate: copy+post already happened and got committed, but update-data:snapshot was never
    // run afterward — bilaraRoot/upstream is irrelevant here, this is purely local drift.
    const localPath = path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json');
    const local = readJson(localPath);
    local['dn1:1.3'] = 'A new local verse line.';
    writeJson(localPath, local);

    const result = checkSnapshotInSync({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.startsWith('sujato/sutta/dn/dn1_translation-en-sujato.json'));
    expect(issue).toMatch(/local keys differ from the snapshot \(2 → 3\)/);
  });

  it('reports a file tracked in the snapshot but missing locally', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    fs.rmSync(path.join(fx.dataDirs.sujato, 'name/dn-name_translation-en-sujato.json'));

    const result = checkSnapshotInSync({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.startsWith('sujato/name/dn-name_translation-en-sujato.json'));
    expect(issue).toMatch(/missing locally/);
  });

  it('the real repo: data/{sujato,pali,html} and snapshot.json are in sync', () => {
    // No overrides — this is the one guard that actually protects the repo: if copy/post ran and
    // got committed without a follow-up update-data:snapshot, this fails on the next `npm test`.
    expect(checkSnapshotInSync()).toEqual({ ok: true, issues: [] });
  });

  it('the real repo: pali/html match exactly and sujato is a subset of pali', () => {
    // No overrides — unlike checkSnapshotInSync above (which only catches a per-file drift from
    // snapshot.json), this is what actually protects the repo from a cross-category misalignment:
    // build-corpus.mjs degrades silently (dropped/unstyled segments, not a build failure) when
    // pali/sujato/html disagree — see INTEGRITY_GROUPS in lib/dataSync.js.
    const keysFor = (relPath) => readKeysSafe(localPathFor(relPath));
    expect(checkCrossCategoryIntegrity(listLocalRelPaths(), keysFor)).toEqual([]);
  });
});

describe('checkCrossCategoryIntegrity', () => {
  it('reports nothing when pali/html match exactly and sujato is a subset of pali', () => {
    const keysFor = (relPath) => Object.keys(FIXTURE_FILES[relPath].content);
    expect(checkCrossCategoryIntegrity(Object.keys(FIXTURE_FILES), keysFor)).toEqual([]);
  });

  it('does not flag pali/html having a segment sujato legitimately omits (e.g. a colophon line)', () => {
    const keysFor = (relPath) => {
      if (relPath === 'pali/sutta/dn/dn1_root-pli-ms.json' || relPath === 'html/pli/ms/sutta/dn/dn1_html.json') {
        return ['dn1:1.1', 'dn1:1.2', 'dn1:1.3']; // pali/html carry an extra colophon-style segment
      }
      return Object.keys(FIXTURE_FILES[relPath].content); // sujato still just has 1.1/1.2
    };

    expect(checkCrossCategoryIntegrity(Object.keys(FIXTURE_FILES), keysFor)).toEqual([]);
  });

  it('flags pali and html disagreeing with each other (exact-match group)', () => {
    const keysFor = (relPath) => {
      if (relPath === 'html/pli/ms/sutta/dn/dn1_html.json') return ['dn1:1.1']; // missing dn1:1.2
      return Object.keys(FIXTURE_FILES[relPath].content);
    };

    const issues = checkCrossCategoryIntegrity(Object.keys(FIXTURE_FILES), keysFor);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/pali vs html dn\/dn1/);
    expect(issues[0]).toMatch(/segment ids differ/);
  });

  it('flags sujato having a segment pali lacks (the direction that actually matters)', () => {
    const keysFor = (relPath) => {
      if (relPath === 'sujato/sutta/dn/dn1_translation-en-sujato.json') return ['dn1:1.1', 'dn1:1.2', 'dn1:1.3'];
      return Object.keys(FIXTURE_FILES[relPath].content); // pali/html still only have 1.1/1.2
    };

    const issues = checkCrossCategoryIntegrity(Object.keys(FIXTURE_FILES), keysFor);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/sujato vs pali dn\/dn1: sujato\/sutta has segment ids pali\/sutta doesn't: dn1:1\.3/);
  });

  it('flags a pali file with no html counterpart at all (exact group), but not a sujato file with no pali counterpart when pali is the superset side missing', () => {
    const relPaths = Object.keys(FIXTURE_FILES).filter((p) => p !== 'html/pli/ms/sutta/dn/dn1_html.json');
    const keysFor = (relPath) => Object.keys(FIXTURE_FILES[relPath].content);

    const issues = checkCrossCategoryIntegrity(relPaths, keysFor);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/pali vs html dn\/dn1: present in pali\/sutta but missing from html\/pli\/ms\/sutta/);
  });
});

describe('update-data pipeline (fixture)', () => {
  let fx;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    fs.rmSync(fx.root, { recursive: true, force: true });
  });

  it('check passes against a snapshot taken from matching content, touching nothing', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    const before = readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'));

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result).toMatchObject({ ok: true, issues: [], checked: 7, totalTracked: 7 });
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(before);
  });

  it('check reports a segment-id change upstream, naming the new segment ids', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    const upstream = readJson(sourcePath);
    upstream['dn1:1.3'] = 'A new verse line.';
    writeJson(sourcePath, upstream);

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.localIssues).toEqual([]);
    expect(result.upstreamIssues).toHaveLength(1);
    expect(result.upstreamIssues[0]).toMatch(/sujato\/sutta\/dn\/dn1_translation-en-sujato\.json/);
    expect(result.upstreamIssues[0]).toMatch(/segment ids changed \(2 → 3\)/);
    expect(result.upstreamIssues[0]).toMatch(/new segment ids: dn1:1\.3/);
    // The now-upstream-only dn1:1.3 also breaks alignment with pali/html, which still have 2.
    expect(result.integrityIssues.length).toBeGreaterThan(0);
  });

  it('check folds in local drift even when the upstream side is clean', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    const localPath = path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json');
    const local = readJson(localPath);
    local['dn1:1.3'] = 'A new local verse line.';
    writeJson(localPath, local);

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.upstreamIssues).toEqual([]);
    expect(result.localIssues).toHaveLength(1);
    expect(result.localIssues[0]).toMatch(/local keys differ from the snapshot/);
  });

  it('check reports a missing file, with a relocation hint when a same-named file exists elsewhere', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    const expectedPath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/notes/dn/dn1_comment-en-sujato.json'].sourceRel);
    const relocated = path.join(fx.bilaraRoot, 'somewhere-else', 'dn1_comment-en-sujato.json');
    fs.mkdirSync(path.dirname(relocated), { recursive: true });
    fs.renameSync(expectedPath, relocated);

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    const issue = result.upstreamIssues.find((i) => i.startsWith('sujato/notes/dn/dn1_comment-en-sujato.json'));
    expect(issue).toMatch(/not found/);
    expect(issue).toMatch(new RegExp(`might have moved to: ${relocated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('runs the local cross-category integrity pass by default (no flag needed)', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    // Both local dataDirs and bilaraRoot start aligned (see FIXTURE_FILES/makeFixture), so
    // localIntegrityIssues is always computed (present, not undefined/gated) but empty here.
    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });
    expect(result.localIntegrityIssues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('catches a snapshot taken from an already cross-category-misaligned local state', () => {
    // Simulate a hand-edit: sujato gains a segment locally that pali/html never had, and the
    // snapshot gets regenerated from that already-broken state — so local-vs-snapshot and
    // upstream-vs-snapshot both pass individually (nothing has "drifted" since), and this local
    // integrity pass is the only thing that still catches it.
    const localSujatoPath = path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json');
    const local = readJson(localSujatoPath);
    local['dn1:1.3'] = 'A segment with no Pali counterpart.';
    writeJson(localSujatoPath, local);
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.localIssues).toEqual([]);
    expect(result.localIntegrityIssues.length).toBeGreaterThan(0);
    expect(result.localIntegrityIssues[0]).toMatch(/sujato vs pali dn\/dn1/);
    expect(result.ok).toBe(false);
  });

  it('copy overwrites dataDirs byte-for-byte from bilaraRoot and writes manifest.json', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    fs.writeFileSync(sourcePath, JSON.stringify({ 'dn1:1.1': 'Revised text.' }, null, 2));

    const gitInfo = { commit: 'abc123def456', commitDate: '2026-01-01T00:00:00Z', dirty: false };
    const manifest = runCopy({ bilaraRoot: fx.bilaraRoot, gitInfo, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    expect(fs.readFileSync(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'), 'utf8')).toBe(fs.readFileSync(sourcePath, 'utf8'));
    expect(manifest).toMatchObject({ sourceRepo: 'suttacentral/sc-data', sourceCommit: 'abc123def456', sourceDirty: false, fileCount: 7 });
    expect(readJson(fx.manifestPath)).toEqual(manifest);
  });

  it('copy sets manifest.snapshotCommit to null when there is no prior manifest.json', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    const manifest = runCopy({
      bilaraRoot: fx.bilaraRoot,
      gitInfo: { commit: 'abc123', commitDate: '2026-01-01T00:00:00Z', dirty: false },
      dataDirs: fx.dataDirs,
      snapshotPath: fx.snapshotPath,
      manifestPath: fx.manifestPath,
    });

    expect(manifest.sourceCommit).toBe('abc123');
    expect(manifest.snapshotCommit).toBeNull();
  });

  it('copy carries snapshotCommit forward from the previous manifest.json unchanged', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    writeJson(fx.manifestPath, { sourceCommit: 'old-commit', snapshotCommit: 'old-commit' });

    const manifest = runCopy({
      bilaraRoot: fx.bilaraRoot,
      gitInfo: { commit: 'new-commit', commitDate: '2026-01-01T00:00:00Z', dirty: false },
      dataDirs: fx.dataDirs,
      snapshotPath: fx.snapshotPath,
      manifestPath: fx.manifestPath,
    });

    // A copy with no follow-up snapshot leaves these visibly mismatched in the same file.
    expect(manifest.sourceCommit).toBe('new-commit');
    expect(manifest.snapshotCommit).toBe('old-commit');
  });

  it('snapshot updates manifest.snapshotCommit to match the current sourceCommit', () => {
    writeJson(fx.manifestPath, { sourceCommit: 'new-commit', snapshotCommit: 'old-commit' });

    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    expect(readJson(fx.manifestPath).snapshotCommit).toBe('new-commit');
  });

  it('snapshot is a no-op on manifest.json when one does not exist yet', () => {
    expect(fs.existsSync(fx.manifestPath)).toBe(false);
    expect(() => runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath })).not.toThrow();
    expect(fs.existsSync(fx.manifestPath)).toBe(false);
  });

  it('copy throws instead of silently skipping if a tracked file is missing from bilaraRoot', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    fs.rmSync(path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/name/dn-name_translation-en-sujato.json'].sourceRel));

    expect(() =>
      runCopy({
        bilaraRoot: fx.bilaraRoot,
        gitInfo: { commit: 'x', commitDate: 'x', dirty: false },
        dataDirs: fx.dataDirs,
        snapshotPath: fx.snapshotPath,
        manifestPath: fx.manifestPath,
      }),
    ).toThrow(/sujato\/name\/dn-name_translation-en-sujato\.json/);
  });

  it('post rewrites tracked word forms in data/sujato only, leaving pali/html untouched', () => {
    const { filesChanged, replacements } = runPost({ sujatoDir: fx.dataDirs.sujato });

    expect(filesChanged).toBe(4);
    expect(replacements).toBeGreaterThan(0);
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual({
      'dn1:1.1': 'The bhikkhu practiced concentration.',
      'dn1:1.2': 'A water immerser is different.',
    });
    expect(readJson(path.join(fx.dataDirs.sujato, 'name/dn-name_translation-en-sujato.json'))['dn-name:1.dn1']).toBe('The Bhikkhus Sutta');
    // Pali has no English prose to substitute, so it's byte-for-byte unchanged.
    expect(readJson(path.join(fx.dataDirs.pali, 'sutta/dn/dn1_root-pli-ms.json'))).toEqual(FIXTURE_FILES['pali/sutta/dn/dn1_root-pli-ms.json'].content);
  });

  it('post is idempotent — a second run makes no further changes', () => {
    runPost({ sujatoDir: fx.dataDirs.sujato });
    const after = readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'));

    const second = runPost({ sujatoDir: fx.dataDirs.sujato });

    expect(second).toEqual({ filesChanged: 0, replacements: 0 });
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(after);
  });

  it('the full review workflow (check fails -> copy -> post -> snapshot -> check passes) round-trips', () => {
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    const upstream = readJson(sourcePath);
    upstream['dn1:1.3'] = 'A newly added verse line about mendicants.';
    writeJson(sourcePath, upstream);
    // Keep pali/html aligned with the new segment so the post-copy check is clean, not just the
    // sujato-vs-snapshot piece.
    for (const relPath of ['pali/sutta/dn/dn1_root-pli-ms.json', 'html/pli/ms/sutta/dn/dn1_html.json']) {
      const p = path.join(fx.bilaraRoot, FIXTURE_FILES[relPath].sourceRel);
      const obj = readJson(p);
      obj['dn1:1.3'] = relPath.startsWith('pali') ? 'Navaṁ padaṁ.' : '<p>{}</p>';
      writeJson(p, obj);
    }

    expect(runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath }).ok).toBe(false);

    runCopy({
      bilaraRoot: fx.bilaraRoot,
      gitInfo: { commit: 'deadbeef', commitDate: '2026-01-01T00:00:00Z', dirty: false },
      dataDirs: fx.dataDirs,
      snapshotPath: fx.snapshotPath,
      manifestPath: fx.manifestPath,
    });
    runPost({ sujatoDir: fx.dataDirs.sujato });
    runSnapshot({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });
    expect(result).toMatchObject({ ok: true, checked: 7 });
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))['dn1:1.3']).toBe(
      'A newly added verse line about bhikkhus.',
    );
    // The completed workflow leaves manifest.json's two commit fields caught up with each other.
    const manifest = readJson(fx.manifestPath);
    expect(manifest.snapshotCommit).toBe(manifest.sourceCommit);
    expect(manifest.snapshotCommit).toBe('deadbeef');
  });
});
