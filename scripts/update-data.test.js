import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireSourceRoot, sourceGitInfo, checkSnapshotInSync, checkCrossCategoryIntegrity, listLocalRelPaths, localPathFor, readKeysSafe } from './lib/dataSync.js';
import { runCheck } from './update-data-check.mjs';
import { runCopy } from './update-data-copy.mjs';
import { runPost } from './update-data-post.mjs';
import { runSnapshot } from './update-data-snapshot.mjs';
import { applyRuleToChunks, applyTermRules, applySegmentOverride, isPermitted, chunksToString, loadRules, loadSidecar, isTermRule, isSegmentRule, segmentsOf, RETRANSLATION_PATH } from './lib/retranslation.js';

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
  // Passed to every runSnapshot below, because its own default is the *real*
  // scripts/update-data/retranslation.counts.json — a fixture snapshot that doesn't override it
  // rewrites the repo's rule baseline with two fixture-scale numbers, and green tests are the only
  // sign of it.
  const countsPath = path.join(root, 'retranslation.counts.json');
  const postDir = path.join(root, 'sujato.post');
  const rulesDir = path.join(root, 'rules');
  // Every pipeline test here runs against its own rules file, never the shipped
  // scripts/update-data/retranslation.mjs: two global rules whose terms FIXTURE_FILES contains,
  // which is all runPost/runCheck/runSnapshot need to exercise. Defaulting to the real file instead
  // would tie this five-file fixture to whatever segments the shipped rules happen to name — a
  // segment override anchored on mn10:0.2 has nothing to resolve against here, and would fail every
  // test in this block the day someone adds one. Tests needing a different rule set (a dead rule, a
  // broken override, a same-segment collision) write their own via writeRulesFixture below.
  const retranslationPath = writeRulesFixture(
    root,
    `[
      { id: 'mendicant-bhikkhu', why: 'fixture', mode: 'deny', forms: [['mendicant', 'bhikkhu'], ['mendicants', 'bhikkhus']] },
      { id: 'immersion-concentration', why: 'fixture', mode: 'deny', forms: [['immersion', 'concentration']] },
    ]`,
  );

  for (const [relPath, { sourceRel, content }] of Object.entries(FIXTURE_FILES)) {
    const [dirName, ...rest] = relPath.split('/');
    writeJson(path.join(dataDirs[dirName], ...rest), content);
    writeJson(path.join(bilaraRoot, sourceRel), content);
  }

  return { root, dataDirs, bilaraRoot, snapshotPath, manifestPath, countsPath, postDir, rulesDir, retranslationPath };
}

// Writes a throwaway retranslation.mjs exporting `rules` (an array literal source string, e.g.
// "[{ id: 'x', ... }]") — for tests that need a rule set other than the two real global rules.
function writeRulesFixture(root, rulesSource) {
  const retranslationPath = path.join(root, 'retranslation.mjs');
  fs.writeFileSync(retranslationPath, `export const RULES = ${rulesSource};\n`);
  return retranslationPath;
}

// A minimal open (deny) rule shaped like the real mendicant-bhikkhu/immersion-concentration rules
// — used to test the engine's own mechanics directly, independent of the shipped rules file.
const BHIKKHU_RULE = {
  id: 'test-mendicant-bhikkhu',
  mode: 'deny',
  forms: [
    ['mendicant', 'bhikkhu'],
    ['mendicants', 'bhikkhus'],
  ],
};
const CONCENTRATE_RULE = {
  id: 'test-immersion-concentration',
  mode: 'deny',
  forms: [['immersion', 'concentration']],
};

describe('applyRuleToChunks / applyTermRules — the retranslation engine', () => {
  const apply = (text, rule) => chunksToString(applyRuleToChunks([{ text, locked: false }], rule).chunks);
  const count = (text, rule) => applyRuleToChunks([{ text, locked: false }], rule).count;

  it('swaps mendicant/mendicants for bhikkhu/bhikkhus, case-preserved', () => {
    expect(apply('a mendicant and some mendicants', BHIKKHU_RULE)).toBe('a bhikkhu and some bhikkhus');
    expect(apply('Mendicants gathered. A Mendicant spoke.', BHIKKHU_RULE)).toBe('Bhikkhus gathered. A Bhikkhu spoke.');
  });

  it('leaves words merely built on the same stem alone (not a listed form)', () => {
    // "immerser" (MN40's "water immerser") isn't a listed word form, so it must survive untouched
    // — this is the exact bug a blind "immers" -> "concentrat" substring swap would have.
    const result = apply('a water immerser dunks in water', CONCENTRATE_RULE);
    expect(result).toBe('a water immerser dunks in water');
    expect(count('a water immerser dunks in water', CONCENTRATE_RULE)).toBe(0);
  });

  it('does not match a word form embedded in a longer word (word-boundary safe)', () => {
    expect(count('reimmersion mendicants-only', BHIKKHU_RULE)).toBe(1); // only "mendicants" via the hyphen boundary
  });

  it('reports the number of replacements made', () => {
    expect(count('a mendicant, some mendicants, and more', BHIKKHU_RULE)).toBe(2);
    expect(count('nothing to change here', BHIKKHU_RULE)).toBe(0);
  });

  it('longest-first: a longer form is not shadowed by a shorter one starting the same way', () => {
    const rule = { id: 'test-aware', mode: 'deny', forms: [['aware', 'understanding'], ['situational awareness', 'insight']] };
    expect(apply('with situational awareness and mindfulness', rule)).toBe('with insight and mindfulness');
  });

  it('locks matched spans so a later rule in the same pass cannot re-touch them', () => {
    // The dn22:1.9 case from retranslation.md: "keen, aware, and mindful" — a rule turning
    // "aware" into "understanding" must not let a later rule (turning "mindful" into "aware")
    // then have its own output re-caught by the first rule.
    const awareRule = { id: 'test-aware-understanding', mode: 'deny', forms: [['aware', 'understanding']] };
    const mindfulRule = { id: 'test-mindful-aware', mode: 'deny', forms: [['mindful', 'aware']] };
    const sidecars = new Map(); // both open with no deny entries — always permitted
    const { result } = applyTermRules('keen, aware, and mindful', {
      treeName: 'sujato/sutta',
      segmentId: 'dn22:1.9',
      rules: [awareRule, mindfulRule],
      sidecars,
    });
    expect(result).toBe('keen, understanding, and aware');

    // Same result in the opposite array order — locking, not ordering, is what makes this safe.
    const reversed = applyTermRules('keen, aware, and mindful', {
      treeName: 'sujato/sutta',
      segmentId: 'dn22:1.9',
      rules: [mindfulRule, awareRule],
      sidecars,
    });
    expect(reversed.result).toBe('keen, understanding, and aware');
  });

  it('array order decides a same-word collision between two rules', () => {
    const toX = { id: 'to-x', mode: 'deny', forms: [['aware', 'x']] };
    const toY = { id: 'to-y', mode: 'deny', forms: [['aware', 'y']] };
    const sidecars = new Map();
    expect(applyTermRules('aware', { treeName: 'sujato/sutta', segmentId: 's:1', rules: [toX, toY], sidecars }).result).toBe('x');
    expect(applyTermRules('aware', { treeName: 'sujato/sutta', segmentId: 's:1', rules: [toY, toX], sidecars }).result).toBe('y');
  });

  it('a closed (allow) rule only touches segments on its allow list', () => {
    const rule = { id: 'test-closed', mode: 'allow', forms: [['aware', 'understanding']] };
    const sidecars = new Map([[rule.id, { reviewedAt: null, allow: ['s:1'], deny: {} }]]);
    expect(applyTermRules('aware of it', { treeName: 'sujato/sutta', segmentId: 's:1', rules: [rule], sidecars }).result).toBe('understanding of it');
    expect(applyTermRules('aware of it', { treeName: 'sujato/sutta', segmentId: 's:2', rules: [rule], sidecars }).result).toBe('aware of it');
  });

  it('an open (deny) rule touches every segment except denied ones', () => {
    const rule = { id: 'test-open', mode: 'deny', forms: [['aware', 'understanding']] };
    const sidecars = new Map([[rule.id, { reviewedAt: null, allow: [], deny: { 's:2': 'plain English' } }]]);
    expect(applyTermRules('aware', { treeName: 'sujato/sutta', segmentId: 's:1', rules: [rule], sidecars }).result).toBe('understanding');
    expect(applyTermRules('aware', { treeName: 'sujato/sutta', segmentId: 's:2', rules: [rule], sidecars }).result).toBe('aware');
  });

  it('a rule is skipped outside its scope', () => {
    const rule = { id: 'test-scoped', mode: 'deny', scope: ['sujato/sutta'], forms: [['aware', 'understanding']] };
    const sidecars = new Map();
    expect(applyTermRules('aware', { treeName: 'sujato/blurb', segmentId: 's:1', rules: [rule], sidecars }).result).toBe('aware');
    expect(applyTermRules('aware', { treeName: 'sujato/sutta', segmentId: 's:1', rules: [rule], sidecars }).result).toBe('understanding');
  });
});

// One worked example per shipped rule, run through the real retranslation.mjs and the real
// sidecars in scripts/update-data/rules/ (no data/ is read — these are the segment's actual
// upstream words, pinned here). Editing a rule's forms, or dropping a segment from its list, breaks
// the example that covers it, which is the point: a list edit is otherwise invisible.
describe('the shipped rules, one example each', () => {
  const EXAMPLES = [
    ['mendicant-bhikkhu', 'dn1:1.1', 'sujato/sutta', 'a mendicant and some mendicants', 'a bhikkhu and some bhikkhus'],
    ['immersion-concentration', 'dn1:1.1', 'sujato/sutta', 'they enter that immersion', 'they enter that concentration'],
    ['sati-aware', 'sn9.1:3.1', 'sujato/sutta', 'Give up discontent; be mindful;', 'Give up discontent; be aware;'],
    // "mindfully" needs more than the word swapped, hence the phrase.
    ['sati-aware', 'an6.29:11.3', 'sujato/sutta', 'a mendicant goes out mindfully, returns mindfully', 'a bhikkhu goes out with awareness, returns with awareness'],
    // Denied: caṅkamati, with no sati in the Pali at all.
    ['sati-aware', 'dn25:6.2', 'sujato/sutta', 'he walked mindfully in the open air', 'he walked mindfully in the open air'],
    // The dn22:1.9 collision from retranslation.md, through the rules as shipped: sati-aware
    // produces the very word sampajanna-understanding consumes, and locking keeps them apart.
    ['sampajanna-understanding', 'sn54.10:5.5', 'sujato/sutta', 'keen, aware, and mindful', 'keen, understanding, and aware'],
    // Denied: plain-English "aware", introducing a perception rather than rendering sampajañña.
    ['sampajanna-understanding', 'an1.451:1.1', 'sujato/sutta', 'aware that ‘consciousness is infinite’', 'aware that ‘consciousness is infinite’'],
    // Out of scope: sujato/notes keeps Sujato's own gloss of citta.
    ['sampajanna-understanding', 'dn22:1.11', 'sujato/notes', '“Mind” (citta) is simple awareness.', '“Mind” (citta) is simple awareness.'],
    ['samudaya-arising', 'sn56.11:4.3', 'sujato/sutta', 'the noble truth of the origin of suffering', 'the noble truth of the arising of suffering'],
    // Denied: aggañña, how the world began.
    ['samudaya-arising', 'dn24:2.14.1', 'sujato/sutta', 'I understand the origin of the world.', 'I understand the origin of the world.'],
    // samudaya's verb form and vaya in one line.
    ['vaya-passing-away', 'sn52.1:3.1', 'sujato/sutta', 'observing the liability to originate, to vanish, and to originate and vanish', 'observing the liability to arise, to pass away, and to arise and pass away'],
    // Denied: antaradhāyati, a being leaving a scene.
    ['vaya-passing-away', 'sn4.10:6.1', 'sujato/sutta', 'miserable and sad, vanished right there.', 'miserable and sad, vanished right there.'],
    ['atthangama-disappearing', 'sn53.1-12:1.8', 'sujato/sutta', 'the disappearance of former happiness and sadness', 'the disappearing of former happiness and sadness'],
    // Denied: antaradhāna, the true teaching being lost.
    ['atthangama-disappearing', 'an1.114:1.1', 'sujato/sutta', 'the decline and disappearance of the true teaching', 'the decline and disappearance of the true teaching'],
    ['udayabbaya-arising-passing-away', 'sn22.89:11.2', 'sujato/sutta', 'observing rise and fall in the five grasping aggregates', 'observing arising and passing away in the five grasping aggregates'],
    // Denied: uppādavaya, and used verbally — the noun phrase would not fit.
    ['udayabbaya-arising-passing-away', 'sn1.11:5.4', 'sujato/sutta', 'their nature is to rise and fall;', 'their nature is to rise and fall;'],
  ];

  it('rewrites each rule’s example, and leaves its excluded example alone', async () => {
    const rules = await loadRules(RETRANSLATION_PATH);
    const sidecars = new Map(rules.filter(isTermRule).map((rule) => [rule.id, loadSidecar(rule.id)]));
    for (const [ruleId, segmentId, treeName, input, expected] of EXAMPLES) {
      expect(rules.some((r) => r.id === ruleId), `no such rule: ${ruleId}`).toBe(true);
      const { result } = applyTermRules(input, { treeName, segmentId, rules, sidecars });
      expect(result, `${ruleId} @ ${segmentId}`).toBe(expected);
    }
  });

  it('covers every shipped term rule', async () => {
    const rules = await loadRules(RETRANSLATION_PATH);
    const covered = new Set(EXAMPLES.map(([id]) => id));
    for (const rule of rules.filter(isTermRule)) {
      expect(covered.has(rule.id), `term rule ${rule.id} has no example above`).toBe(true);
    }
  });

  it('anchors each segment override on text its own from/to describes', async () => {
    const rules = await loadRules(RETRANSLATION_PATH);
    const overrides = rules.filter(isSegmentRule);
    expect(overrides.length).toBeGreaterThan(0);
    for (const rule of overrides) {
      expect(segmentsOf(rule).length, `${rule.id} names no segment`).toBeGreaterThan(0);
      expect(applySegmentOverride(rule.from, rule).result, rule.id).toBe(rule.to);
      // An override is a rewrite, and it has to be anchored on post-processed text: if `from`
      // still contains a form the term rules rewrite, the anchor can never match what post
      // produces.
      expect(rule.from, rule.id).not.toBe(rule.to);
      const { result: reprocessed } = applyTermRules(rule.from, {
        treeName: 'sujato/sutta',
        segmentId: segmentsOf(rule)[0],
        rules,
        sidecars: new Map(rules.filter(isTermRule).map((r) => [r.id, loadSidecar(r.id)])),
      });
      expect(reprocessed, `${rule.id}'s from is not post-processed text`).toBe(rule.from);
    }
  });
});

describe('isPermitted', () => {
  it('allow mode: only segments in the allow list', () => {
    const rule = { mode: 'allow' };
    expect(isPermitted(rule, { allow: ['a'], deny: {} }, 'a')).toBe(true);
    expect(isPermitted(rule, { allow: ['a'], deny: {} }, 'b')).toBe(false);
  });

  it('deny mode: every segment except ones in the deny map', () => {
    const rule = { mode: 'deny' };
    expect(isPermitted(rule, { allow: [], deny: {} }, 'a')).toBe(true);
    expect(isPermitted(rule, { allow: [], deny: { a: 'reason' } }, 'a')).toBe(false);
  });
});

describe('segmentsOf', () => {
  it('reads either spelling, and rejects a rule that uses both', async () => {
    expect(segmentsOf({ segment: 'dn1:1.1' })).toEqual(['dn1:1.1']);
    expect(segmentsOf({ segments: ['dn1:1.1', 'dn1:1.2'] })).toEqual(['dn1:1.1', 'dn1:1.2']);
    expect(segmentsOf({})).toEqual([]);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-data-segments-'));
    const both = writeRulesFixture(root, `[{ id: 'x', kind: 'segment', why: 't', segment: 'a:1', segments: ['a:1'], from: 'a', to: 'b' }]`);
    await expect(loadRules(both)).rejects.toThrow(/sets both segment and segments/);
    const neither = writeRulesFixture(path.join(root), `[{ id: 'x', kind: 'segment', why: 't', from: 'a', to: 'b' }]`);
    await expect(loadRules(neither)).rejects.toThrow(/needs segment \(or segments\)/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('post applies an override to every segment it names', async () => {
    const fx = makeFixture();
    const retranslationPath = writeRulesFixture(
      fx.root,
      `[{ id: 'both-lines', kind: 'segment', why: 'test', segments: ['dn1:1.1', 'dn1:1.2'], from: 'Shared line.', to: 'Rewritten.' }]`,
    );
    const file = path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json');
    writeJson(file, { 'dn1:1.1': 'Shared line.', 'dn1:1.2': 'Shared line.' });

    const result = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

    expect(result.ok).toBe(true);
    expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual({
      'dn1:1.1': 'Rewritten.',
      'dn1:1.2': 'Rewritten.',
    });

    // One repeat drifting is reported as that segment, not as the whole rule.
    writeJson(file, { 'dn1:1.1': 'Shared line.', 'dn1:1.2': 'Upstream reworded this one.' });
    const drifted = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });
    expect(drifted.ok).toBe(false);
    expect(drifted.brokenOverrides).toHaveLength(1);
    expect(drifted.brokenOverrides[0]).toMatchObject({ id: 'both-lines', segment: 'dn1:1.2' });
    fs.rmSync(fx.root, { recursive: true, force: true });
  });
});

describe('applySegmentOverride', () => {
  const rule = { segment: 'dn22:1.9', from: 'old text', to: 'new text' };

  it('applies when the current value matches "from" verbatim', () => {
    expect(applySegmentOverride('old text', rule)).toEqual({ result: 'new text', applied: true });
  });

  it('refuses (does not apply) when "from" no longer matches — the broken-anchor case', () => {
    expect(applySegmentOverride('different text', rule)).toEqual({ result: 'different text', applied: false });
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

  it('reports ok when data/{sujato,pali,html} matches the snapshot', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    expect(checkSnapshotInSync({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath })).toEqual({ ok: true, issues: [] });
  });

  it('reports drift when a local file changed without the snapshot being regenerated', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

  it('reports a file tracked in the snapshot but missing locally', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

  it('check passes against a snapshot taken from matching content, touching nothing', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const before = readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'));

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result).toMatchObject({ ok: true, issues: [], checked: 7, totalTracked: 7 });
    // check never mutates data/sujato — that's post's job, and only into sujato.post/.
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(before);
  });

  it('check reports a segment-id change upstream, naming the new segment ids', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    const upstream = readJson(sourcePath);
    upstream['dn1:1.3'] = 'A new verse line.';
    writeJson(sourcePath, upstream);

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.localIssues).toEqual([]);
    expect(result.upstreamIssues).toHaveLength(1);
    expect(result.upstreamIssues[0]).toMatch(/sujato\/sutta\/dn\/dn1_translation-en-sujato\.json/);
    expect(result.upstreamIssues[0]).toMatch(/segment ids changed \(2 → 3\)/);
    expect(result.upstreamIssues[0]).toMatch(/new segment ids: dn1:1\.3/);
    // The now-upstream-only dn1:1.3 also breaks alignment with pali/html, which still have 2.
    expect(result.integrityIssues.length).toBeGreaterThan(0);
  });

  it('check folds in local drift even when the upstream side is clean', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const localPath = path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json');
    const local = readJson(localPath);
    local['dn1:1.3'] = 'A new local verse line.';
    writeJson(localPath, local);

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.upstreamIssues).toEqual([]);
    expect(result.localIssues).toHaveLength(1);
    expect(result.localIssues[0]).toMatch(/local keys differ from the snapshot/);
  });

  it('check reports a missing file, with a relocation hint when a same-named file exists elsewhere', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const expectedPath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/notes/dn/dn1_comment-en-sujato.json'].sourceRel);
    const relocated = path.join(fx.bilaraRoot, 'somewhere-else', 'dn1_comment-en-sujato.json');
    fs.mkdirSync(path.dirname(relocated), { recursive: true });
    fs.renameSync(expectedPath, relocated);

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    const issue = result.upstreamIssues.find((i) => i.startsWith('sujato/notes/dn/dn1_comment-en-sujato.json'));
    expect(issue).toMatch(/not found/);
    expect(issue).toMatch(new RegExp(`might have moved to: ${relocated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('runs the local cross-category integrity pass by default (no flag needed)', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    // Both local dataDirs and bilaraRoot start aligned (see FIXTURE_FILES/makeFixture), so
    // localIntegrityIssues is always computed (present, not undefined/gated) but empty here.
    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });
    expect(result.localIntegrityIssues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('catches a snapshot taken from an already cross-category-misaligned local state', async () => {
    // Simulate a hand-edit: sujato gains a segment locally that pali/html never had, and the
    // snapshot gets regenerated from that already-broken state — so local-vs-snapshot and
    // upstream-vs-snapshot both pass individually (nothing has "drifted" since), and this local
    // integrity pass is the only thing that still catches it.
    const localSujatoPath = path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json');
    const local = readJson(localSujatoPath);
    local['dn1:1.3'] = 'A segment with no Pali counterpart.';
    writeJson(localSujatoPath, local);
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.localIssues).toEqual([]);
    expect(result.localIntegrityIssues.length).toBeGreaterThan(0);
    expect(result.localIntegrityIssues[0]).toMatch(/sujato vs pali dn\/dn1/);
    expect(result.ok).toBe(false);
  });

  it('copy overwrites dataDirs byte-for-byte from bilaraRoot and writes manifest.json', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    fs.writeFileSync(sourcePath, JSON.stringify({ 'dn1:1.1': 'Revised text.' }, null, 2));

    const gitInfo = { commit: 'abc123def456', commitDate: '2026-01-01T00:00:00Z', dirty: false };
    const manifest = runCopy({ bilaraRoot: fx.bilaraRoot, gitInfo, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    expect(fs.readFileSync(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'), 'utf8')).toBe(fs.readFileSync(sourcePath, 'utf8'));
    expect(manifest).toMatchObject({ sourceRepo: 'suttacentral/sc-data', sourceCommit: 'abc123def456', sourceDirty: false, fileCount: 7 });
    expect(readJson(fx.manifestPath)).toEqual(manifest);
  });

  it('copy sets manifest.snapshotCommit to null when there is no prior manifest.json', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

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

  it('copy carries snapshotCommit forward from the previous manifest.json unchanged', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

  it('snapshot updates manifest.snapshotCommit to match the current sourceCommit', async () => {
    writeJson(fx.manifestPath, { sourceCommit: 'new-commit', snapshotCommit: 'old-commit' });

    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    expect(readJson(fx.manifestPath).snapshotCommit).toBe('new-commit');
  });

  it('snapshot is a no-op on manifest.json when one does not exist yet', async () => {
    expect(fs.existsSync(fx.manifestPath)).toBe(false);
    await expect(runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir })).resolves.not.toThrow();
    expect(fs.existsSync(fx.manifestPath)).toBe(false);
  });

  it('copy throws instead of silently skipping if a tracked file is missing from bilaraRoot', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

  it('post rewrites tracked word forms into sujato.post/, leaving data/sujato itself pristine', async () => {
    const { ok, filesChanged, replacements } = await runPost({ retranslationPath: fx.retranslationPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });

    expect(ok).toBe(true);
    expect(filesChanged).toBe(4);
    expect(replacements).toBeGreaterThan(0);
    expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual({
      'dn1:1.1': 'The bhikkhu practiced concentration.',
      'dn1:1.2': 'A water immerser is different.',
    });
    expect(readJson(path.join(fx.postDir, 'name/dn-name_translation-en-sujato.json'))['dn-name:1.dn1']).toBe('The Bhikkhus Sutta');
    // data/sujato itself is untouched — post only ever writes postDir.
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(
      FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].content,
    );
    // pali has no English prose to substitute, and post never reads/writes it anyway.
    expect(readJson(path.join(fx.dataDirs.pali, 'sutta/dn/dn1_root-pli-ms.json'))).toEqual(FIXTURE_FILES['pali/sutta/dn/dn1_root-pli-ms.json'].content);
  });

  it('post is idempotent — re-running against the same pristine input gives byte-identical output', async () => {
    await runPost({ retranslationPath: fx.retranslationPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });
    const after = readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'));

    const second = await runPost({ retranslationPath: fx.retranslationPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });

    expect(second.ok).toBe(true);
    expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(after);
  });

  it('post hard-fails (and does not write postDir) when a term rule matches nowhere', async () => {
    const retranslationPath = writeRulesFixture(
      fx.root,
      `[{ id: 'dead-rule', why: 'test', mode: 'deny', forms: [['nonexistentword', 'x']] }]`,
    );
    fs.rmSync(fx.postDir, { recursive: true, force: true });

    const result = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

    expect(result.ok).toBe(false);
    expect(result.deadRules).toEqual(['dead-rule']);
    expect(fs.existsSync(fx.postDir)).toBe(false);
  });

  it('post hard-fails when a segment override\'s "from" no longer matches verbatim', async () => {
    const retranslationPath = writeRulesFixture(
      fx.root,
      `[{ id: 'stale-override', kind: 'segment', why: 'test', segment: 'dn1:1.1', from: 'text that is not actually there', to: 'replacement' }]`,
    );
    fs.rmSync(fx.postDir, { recursive: true, force: true });

    const result = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

    expect(result.ok).toBe(false);
    expect(result.brokenOverrides).toHaveLength(1);
    expect(result.brokenOverrides[0]).toMatchObject({ id: 'stale-override', segment: 'dn1:1.1' });
    expect(fs.existsSync(fx.postDir)).toBe(false);
  });

  it('post applies a segment override after term rules, against their output', async () => {
    const retranslationPath = writeRulesFixture(
      fx.root,
      `[
        { id: 'mendicant-bhikkhu', why: 'test', mode: 'deny', forms: [['mendicant', 'bhikkhu']] },
        { id: 'gloss', kind: 'segment', why: 'test', segment: 'dn1:1.1', from: 'The bhikkhu practiced immersion.', to: 'The bhikkhu practiced deep immersion.' },
      ]`,
    );

    const result = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

    expect(result.ok).toBe(true);
    expect(result.brokenOverrides).toEqual([]);
    expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))['dn1:1.1']).toBe('The bhikkhu practiced deep immersion.');
  });

  it('snapshot records each term rule\'s current match count in retranslation.counts.json', async () => {
    const countsPath = path.join(fx.root, 'retranslation.counts.json');

    await runSnapshot({
      retranslationPath: fx.retranslationPath,
      dataDirs: fx.dataDirs,
      snapshotPath: fx.snapshotPath,
      manifestPath: fx.manifestPath,
      sujatoDir: fx.dataDirs.sujato,
      postDir: fx.postDir,
      rulesDir: fx.rulesDir,
      countsPath,
    });

    const counts = readJson(countsPath);
    // FIXTURE_FILES contains "mendicant"(s) 4 times (blurb, name, sutta, notes) and "immersion" 3
    // times (blurb, sutta, notes) — see FIXTURE_FILES above.
    expect(counts.rules['mendicant-bhikkhu']).toBe(4);
    expect(counts.rules['immersion-concentration']).toBe(3);
  });

  describe('check: retranslation rule anchors', () => {
    it('flags a term rule that matches nowhere upstream', async () => {
      const retranslationPath = writeRulesFixture(fx.root, `[{ id: 'dead-rule', why: 'test', mode: 'deny', forms: [['nonexistentword', 'x']] }]`);
      await runSnapshot({ countsPath: fx.countsPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

      const result = await runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir, retranslationPath });

      expect(result.ok).toBe(false);
      expect(result.ruleIssues).toHaveLength(1);
      expect(result.ruleIssues[0]).toMatch(/dead-rule: matches nowhere upstream/);
    });

    it('reports a broken segment override as a three-way (from / upstream now / to) issue', async () => {
      const retranslationPath = writeRulesFixture(
        fx.root,
        `[{ id: 'stale-override', kind: 'segment', why: 'test', segment: 'dn1:1.1', from: 'The mendicant practiced immersion.', to: 'Rewritten.' }]`,
      );
      await runSnapshot({ countsPath: fx.countsPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });
      // Upstream reworded the segment the override was anchored to.
      const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
      const upstream = readJson(sourcePath);
      upstream['dn1:1.1'] = 'The mendicant practiced something else entirely.';
      writeJson(sourcePath, upstream);

      const result = await runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir, retranslationPath });

      expect(result.ok).toBe(false);
      expect(result.ruleIssues).toHaveLength(1);
      expect(result.ruleIssues[0]).toMatch(/stale-override \(dn1:1\.1\)/);
      expect(result.ruleIssues[0]).toMatch(/from \(recorded\):\s+The mendicant practiced immersion\./);
      expect(result.ruleIssues[0]).toMatch(/upstream \(now\):\s+The mendicant practiced something else entirely\./);
      expect(result.ruleIssues[0]).toMatch(/to \(this app's\):\s+Rewritten\./);
    });

    it('anchors an override on post-processed text, not upstream’s own words', async () => {
      // dn1:1.1 is "The mendicant practiced immersion." upstream, which the term rule turns into
      // "The bhikkhu practiced immersion." — and that, not upstream's wording, is what an override
      // has to match, since overrides run last, over the term rules' output.
      const rules = (from) => `[
        { id: 'term', why: 'test', mode: 'deny', forms: [['mendicant', 'bhikkhu']] },
        { id: 'override', kind: 'segment', why: 'test', segment: 'dn1:1.1', from: ${JSON.stringify(from)}, to: 'Rewritten.' },
      ]`;

      const good = writeRulesFixture(fx.root, rules('The bhikkhu practiced immersion.'));
      await runSnapshot({ countsPath: fx.countsPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath: good });
      expect((await runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir, retranslationPath: good })).ruleIssues).toEqual([]);
      // And post agrees — the override lands, so check and post read `from` the same way.
      const applied = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath: good });
      expect(applied.ok).toBe(true);
      expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))['dn1:1.1']).toBe('Rewritten.');

      // Anchored on upstream's own wording instead, the override can never fire, and check says so.
      const staleRoot = path.join(fx.root, 'stale');
      fs.mkdirSync(staleRoot, { recursive: true });
      const stale = writeRulesFixture(staleRoot, rules('The mendicant practiced immersion.'));
      const result = await runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir, retranslationPath: stale });
      expect(result.ruleIssues).toHaveLength(1);
      expect(result.ruleIssues[0]).toMatch(/after term rules:\s+The bhikkhu practiced immersion\./);
    });

    it('passes when every rule still matches upstream and no segment override is stale', async () => {
      // Default (real) rules file — FIXTURE_FILES contains both "mendicant" and "immersion".
      await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });

      const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir });

      expect(result.ruleIssues).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  it('the full review workflow (check fails -> copy -> post -> snapshot -> check passes) round-trips', async () => {
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

    expect((await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath })).ok).toBe(false);

    runCopy({
      bilaraRoot: fx.bilaraRoot,
      gitInfo: { commit: 'deadbeef', commitDate: '2026-01-01T00:00:00Z', dirty: false },
      dataDirs: fx.dataDirs,
      snapshotPath: fx.snapshotPath,
      manifestPath: fx.manifestPath,
    });
    await runPost({ retranslationPath: fx.retranslationPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    await runSnapshot({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });
    expect(result).toMatchObject({ ok: true, checked: 7 });
    // The new segment now exists in data/sujato verbatim (copy doesn't run post)...
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))['dn1:1.3']).toBe(
      'A newly added verse line about mendicants.',
    );
    // ...and rewritten only in sujato.post/, which is what the corpus build actually reads.
    expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))['dn1:1.3']).toBe(
      'A newly added verse line about bhikkhus.',
    );
    // The completed workflow leaves manifest.json's two commit fields caught up with each other.
    const manifest = readJson(fx.manifestPath);
    expect(manifest.snapshotCommit).toBe(manifest.sourceCommit);
    expect(manifest.snapshotCommit).toBe('deadbeef');
  });
});
