import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireSourceRoot, sourceGitInfo } from './lib/sujatoSync.js';
import { runCheck } from './update-sujato-check.mjs';
import { runCopy } from './update-sujato-copy.mjs';
import { runPost, applyReplacements } from './update-sujato-post.mjs';
import { runSnapshot } from './update-sujato-snapshot.mjs';

// Everything here runs against throwaway temp-dir fixtures, never the real data/sujato or a real
// SC_DATA_PATH checkout — check/copy/post/snapshot all accept explicit sujatoDir/bilaraRoot/
// snapshotPath/manifestPath overrides for exactly this reason (see each script's runXxx export).

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// A miniature stand-in for data/sujato + a matching sc_bilara_data checkout, covering all four
// tracked categories (blurb/name/sutta/notes) at their real CATEGORY_SOURCE_PREFIXES locations,
// starting identical on both sides — individual tests mutate one side or the other from here.
const FIXTURE_FILES = {
  'blurb/dn-blurbs_root-en.json': {
    sourceRel: 'root/en/blurb/dn-blurbs_root-en.json',
    content: { 'dn-blurbs:dn1': 'A mendicant teaches immersion.' },
  },
  'name/dn-name_translation-en-sujato.json': {
    sourceRel: 'translation/en/sujato/name/sutta/dn-name_translation-en-sujato.json',
    content: { 'dn-name:1.dn1': 'The Mendicants Sutta' },
  },
  'sutta/dn/dn1_translation-en-sujato.json': {
    sourceRel: 'translation/en/sujato/sutta/dn/dn1_translation-en-sujato.json',
    content: { 'dn1:1.1': 'The mendicant practiced immersion.', 'dn1:1.2': 'A water immerser is different.' },
  },
  'notes/dn/dn1_comment-en-sujato.json': {
    sourceRel: 'comment/en/sujato/sutta/dn/dn1_comment-en-sujato.json',
    content: { 'dn1:1.1': 'Note about Immersion and Mendicants.' },
  },
};

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-sujato-test-'));
  const sujatoDir = path.join(root, 'sujato');
  const bilaraRoot = path.join(root, 'bilara');
  const snapshotPath = path.join(root, 'snapshot.json');
  const manifestPath = path.join(sujatoDir, 'manifest.json');

  for (const [relPath, { sourceRel, content }] of Object.entries(FIXTURE_FILES)) {
    writeJson(path.join(sujatoDir, relPath), content);
    writeJson(path.join(bilaraRoot, sourceRel), content);
  }

  return { root, sujatoDir, bilaraRoot, snapshotPath, manifestPath };
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

describe('update-sujato pipeline (fixture)', () => {
  let fx;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    fs.rmSync(fx.root, { recursive: true, force: true });
  });

  it('check passes against a snapshot taken from matching content, touching nothing', () => {
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    const before = readJson(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'));

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });

    expect(result).toMatchObject({ ok: true, issues: [], checked: 4, totalTracked: 4 });
    expect(readJson(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(before);
  });

  it('check reports a segment-id change upstream, naming the new segment ids', () => {
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    const upstream = readJson(sourcePath);
    upstream['dn1:1.3'] = 'A new verse line.';
    writeJson(sourcePath, upstream);

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/sutta\/dn\/dn1_translation-en-sujato\.json/);
    expect(result.issues[0]).toMatch(/segment ids changed \(2 → 3\)/);
    expect(result.issues[0]).toMatch(/new segment ids: dn1:1\.3/);
  });

  it('check reports a missing file, with a relocation hint when a same-named file exists elsewhere', () => {
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    const expectedPath = path.join(fx.bilaraRoot, FIXTURE_FILES['notes/dn/dn1_comment-en-sujato.json'].sourceRel);
    const relocated = path.join(fx.bilaraRoot, 'somewhere-else', 'dn1_comment-en-sujato.json');
    fs.mkdirSync(path.dirname(relocated), { recursive: true });
    fs.renameSync(expectedPath, relocated);

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.startsWith('notes/dn/dn1_comment-en-sujato.json'));
    expect(issue).toMatch(/not found/);
    expect(issue).toMatch(new RegExp(`might have moved to: ${relocated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('copy overwrites sujatoDir byte-for-byte from bilaraRoot and writes manifest.json', () => {
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    fs.writeFileSync(sourcePath, JSON.stringify({ 'dn1:1.1': 'Revised text.' }, null, 2));

    const gitInfo = { commit: 'abc123def456', commitDate: '2026-01-01T00:00:00Z', dirty: false };
    const manifest = runCopy({ bilaraRoot: fx.bilaraRoot, gitInfo, sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    expect(fs.readFileSync(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'), 'utf8')).toBe(fs.readFileSync(sourcePath, 'utf8'));
    expect(manifest).toMatchObject({ sourceRepo: 'suttacentral/sc-data', sourceCommit: 'abc123def456', sourceDirty: false, fileCount: 4 });
    expect(readJson(fx.manifestPath)).toEqual(manifest);
  });

  it('copy throws instead of silently skipping if a tracked file is missing from bilaraRoot', () => {
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    fs.rmSync(path.join(fx.bilaraRoot, FIXTURE_FILES['name/dn-name_translation-en-sujato.json'].sourceRel));

    expect(() =>
      runCopy({
        bilaraRoot: fx.bilaraRoot,
        gitInfo: { commit: 'x', commitDate: 'x', dirty: false },
        sujatoDir: fx.sujatoDir,
        snapshotPath: fx.snapshotPath,
        manifestPath: fx.manifestPath,
      }),
    ).toThrow(/name\/dn-name_translation-en-sujato\.json/);
  });

  it('post rewrites tracked word forms across all four categories but leaves manifest.json alone', () => {
    writeJson(fx.manifestPath, { note: 'a mendicant should not change here' });

    const { filesChanged, replacements } = runPost({ sujatoDir: fx.sujatoDir });

    expect(filesChanged).toBe(4);
    expect(replacements).toBeGreaterThan(0);
    expect(readJson(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual({
      'dn1:1.1': 'The bhikkhu practiced concentration.',
      'dn1:1.2': 'A water immerser is different.',
    });
    expect(readJson(path.join(fx.sujatoDir, 'name/dn-name_translation-en-sujato.json'))['dn-name:1.dn1']).toBe('The Bhikkhus Sutta');
    expect(readJson(fx.manifestPath).note).toBe('a mendicant should not change here');
  });

  it('post is idempotent — a second run makes no further changes', () => {
    runPost({ sujatoDir: fx.sujatoDir });
    const after = readJson(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'));

    const second = runPost({ sujatoDir: fx.sujatoDir });

    expect(second).toEqual({ filesChanged: 0, replacements: 0 });
    expect(readJson(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(after);
  });

  it('the full review workflow (check fails -> copy -> post -> snapshot -> check passes) round-trips', () => {
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    const upstream = readJson(sourcePath);
    upstream['dn1:1.3'] = 'A newly added verse line about mendicants.';
    writeJson(sourcePath, upstream);

    expect(runCheck({ bilaraRoot: fx.bilaraRoot, sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath }).ok).toBe(false);

    runCopy({
      bilaraRoot: fx.bilaraRoot,
      gitInfo: { commit: 'deadbeef', commitDate: '2026-01-01T00:00:00Z', dirty: false },
      sujatoDir: fx.sujatoDir,
      snapshotPath: fx.snapshotPath,
      manifestPath: fx.manifestPath,
    });
    runPost({ sujatoDir: fx.sujatoDir });
    runSnapshot({ sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });

    const result = runCheck({ bilaraRoot: fx.bilaraRoot, sujatoDir: fx.sujatoDir, snapshotPath: fx.snapshotPath });
    expect(result).toMatchObject({ ok: true, checked: 4 });
    expect(readJson(path.join(fx.sujatoDir, 'sutta/dn/dn1_translation-en-sujato.json'))['dn1:1.3']).toBe(
      'A newly added verse line about bhikkhus.',
    );
  });
});
