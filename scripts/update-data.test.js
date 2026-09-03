import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireSourceRoot, sourceGitInfo, checkSnapshotInSync, checkCrossCategoryIntegrity, listLocalRelPaths, localPathFor, readKeysSafe } from './lib/dataSync.js';
import { runCheck } from './update-data-check.mjs';
import { runCopy } from './update-data-copy.mjs';
import { runPost } from './update-data-post.mjs';
import { runAccept } from './update-data-accept.mjs';
import { applyRuleToChunks, applyTermRules, applySegmentOverride, applyBlurbOpener, isPermitted, chunksToString, loadRules, loadSidecar, isTermRule, isSegmentRule, isBlurbRule, segmentsOf, scopeOf, RETRANSLATION_PATH } from './lib/retranslation.js';

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
  // Passed to every runAccept below, because its own default is the *real*
  // scripts/update-data/retranslation.counts.json — a fixture snapshot that doesn't override it
  // rewrites the repo's rule baseline with two fixture-scale numbers, and green tests are the only
  // sign of it.
  const countsPath = path.join(root, 'retranslation.counts.json');
  const postDir = path.join(root, 'sujato.post');
  const rulesDir = path.join(root, 'rules');
  // Every pipeline test here runs against its own rules file, never the shipped
  // scripts/update-data/retranslation.mjs: two global rules whose terms FIXTURE_FILES contains,
  // which is all runPost/runCheck/runAccept need to exercise. Defaulting to the real file instead
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
    // — this is the exact bug a blind "immers" -> "compos" substring swap would have.
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

  it('cases a multi-word replacement the way the text it replaces is cased', () => {
    // Lowercase and Sentence case both come out of the single-word behaviour; Title Case is what a
    // multi-word form needs, since capitalizing only the first letter would leave a heading reading
    // "The Longer Discourse on Establishment of mindfulness".
    const rule = { id: 'test-title', mode: 'deny', forms: [['mindfulness meditation', 'the establishment of mindfulness']] };
    expect(apply('develop mindfulness meditation', rule)).toBe('develop the establishment of mindfulness');
    expect(apply('Mindfulness meditation leads on.', rule)).toBe('The establishment of mindfulness leads on.');
    expect(apply('Mindfulness Meditation', rule)).toBe('The Establishment of Mindfulness');
    // A form carrying its own leading preposition keeps that word's case, so the article after it
    // stays lowercase where a title would have capitalized a leading one.
    const onRule = { id: 'test-title-on', mode: 'deny', forms: [['on mindfulness meditation', 'on the establishment of mindfulness']] };
    expect(apply('The Longer Discourse on Mindfulness Meditation', onRule)).toBe('The Longer Discourse on the Establishment of Mindfulness');
  });

  it('locks matched spans so a later rule in the same pass cannot re-touch them', () => {
    // The chained-rewrite case from docs/retranslation.md: "keen, aware, and mindful" — a rule
    // turning "aware" into "understanding" must not let a later rule (turning "mindful" into
    // "aware") then have its own output re-caught by the first rule.
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

  it('never touches sujato/notes, whatever a rule asks for', () => {
    const rule = { id: 'test-notes', mode: 'deny', forms: [['mindful', 'aware']] };
    const sidecars = new Map();
    const run = (treeName) => applyTermRules('be mindful', { treeName, segmentId: 's:1', rules: [rule], sidecars }).result;
    expect(run('sujato/sutta')).toBe('be aware');
    expect(run('sujato/notes')).toBe('be mindful');
    // And a rule that names notes explicitly is a load-time error, so the policy can't be
    // half-undone by one rule opting back in.
    expect(scopeOf(rule)).not.toContain('sujato/notes');
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
    ['immersion-concentration', 'dn1:1.1', 'sujato/sutta', 'they enter that immersion', 'they enter that composure'],
    // The plural, in the one list that carries it. jhāna and samādhi meet in this line, each
    // taking the word the other never matches.
    ['immersion-concentration', 'dn1:1.2', 'sujato/sutta', 'the absorptions, liberations, immersions, and attainments', 'the jhānas, liberations, composures, and attainments'],
    // The article goes with the noun it agrees with — here it is dropped, since "a composure of
    // the heart" isn't English where "an immersion of the heart" was.
    ['immersion-concentration', 'dn1:1.31.1', 'sujato/sutta', 'experiences an immersion of the heart', 'experiences composure of the heart'],
    // The participle slot, which takes "composed" rather than the noun — matching Bhikkhu Sujato's
    // own "resolute and composed" for pahitattā samāhitā at dn20:5.4.
    ['immersion-concentration', 'dn2:77.6', 'sujato/sutta', 'When their mind has become immersed in samādhi like this', 'When their mind has become composed in samādhi like this'],
    // The finite verb and the gerund, which take "collect" instead: the corpus already spends
    // "compose"/"composes" on writing verses (dn21, mn56, an4.231).
    ['immersion-concentration', 'mn122:7.2', 'sujato/sutta', 'they should still, settle, unify, and immerse their mind in samādhi internally. ', 'they should still, settle, unify, and collect their mind in samādhi internally. '],
    ['immersion-concentration', 'mn62:28.3', 'sujato/sutta', '‘I’ll breathe in immersing the mind in samādhi.’', '‘I’ll breathe in collecting the mind in samādhi.’'],
    // Denied: literal immersion in water, udakorohaka.
    //
    // A denied example reads the *shipped* sidecar, so it's the only specific guard that this
    // exclusion still exists — update-data triage reports a stale entry but never a deleted one,
    // and a rule that quietly starts rewriting an excluded segment would otherwise show up only as
    // a ±1 drift in retranslation.counts.json. Worth keeping, which is why it matters that the
    // segment is chosen for a sense upstream can't reword away: literal water is literal water,
    // where a phrasing call ("immerse on the gratification") is one refresh away from changing and
    // failing this test for a reason that has nothing to do with the code.
    ['immersion-concentration', 'mn40:5.4', 'sujato/sutta', 'just because you immerse yourself in water', 'just because you immerse yourself in water'],
    // One per slot "absorption" occupies: the noun, the verb Bhikkhu Sujato builds out of
    // jhāyati, and a Title Case heading (where the single-word form takes Sentence case).
    ['jhana-pali', 'an9.36:1.2', 'sujato/sutta', 'The second absorption is also a basis for ending the defilements. ', 'The second jhāna is also a basis for ending the defilements. '],
    ['jhana-pali', 'thag16.7:2.4', 'sujato/sutta', 'practices absorption without grasping. ', 'practices jhāna without grasping. '],
    ['jhana-pali', 'dn28:19.0', 'sujato/sutta', '1.16. The Four Absorptions ', '1.16. The Four Jhānas '],
    // His expansion of a bare jhāyanti. The longer form claims the phrase whole, so the reader
    // gets "practice jhāna" rather than "practice jhāna meditation".
    ['jhana-pali', 'an6.46:2.3', 'sujato/sutta', 'Why do they practice absorption meditation? In what way do they practice absorption meditation?', 'Why do they practice jhāna? In what way do they practice jhāna?'],
    // The blurb gloss, which keeping the Pali would otherwise turn into "jhāna (jhāna)". The form
    // carries the following word, since a form has to end on a word boundary and ")" is not one.
    ['jhana-pali', 'sn-blurbs:sn53', 'sujato/blurb', 'discourses on the topic of absorption meditation (<i lang=\'pi\' translate=\'no\'>jhāna</i>), which however merely apply the standard repetition series to the formula for the four absorptions.', 'discourses on the topic of jhāna, which however merely apply the standard repetition series to the formula for the four jhānas.'],
    // Left alone: "absorb"/"absorbed" is untouched, so the dye simile survives and the four verse
    // lines that are jhāna keep the wording Bhikkhu Sujato already gives them.
    ['jhana-pali', 'mn56:18.5', 'sujato/sutta', 'Just as a clean cloth rid of stains would properly absorb dye, ', 'Just as a clean cloth rid of stains would properly absorb dye, '],
    ['jhana-pali', 'thag1.41:1.3', 'sujato/sutta', 'But in the mountain cleft he is absorbed in jhāna—', 'But in the mountain cleft he is absorbed in jhāna—'],
    ['patisambhida-analytical-knowledge', 'an7.38:1.1', 'sujato/sutta', 'will soon realize the four kinds of textual analysis', 'will soon realize the four kinds of analytical knowledge'],
    // The heading slot: four of the term's occurrences are Title Case sutta names.
    ['patisambhida-analytical-knowledge', 'an4.172:0.3', 'sujato/sutta', 'Sāriputta’s Attainment of Textual Analysis', 'Sāriputta’s Attainment of Analytical Knowledge'],
    // Untouched, like every note: Bhikkhu Sujato's own gloss keeps his own wording.
    ['patisambhida-analytical-knowledge', 'mn43:1.3', 'sujato/notes', 'foremost in the methods of textual analysis', 'foremost in the methods of textual analysis'],
    // The four-paṭisambhidā list is rebuilt whole, since "the Dhamma" can't stand as a bare item
    // beside "meaning"; the attha–dhamma pair is a plain swap of the noun in two word orders.
    ['dhamma-the-dhamma', 'an5.86:1.3', 'sujato/sutta', 'of meaning, text, definition, and eloquence', 'of meaning, of the Dhamma, of definition, and of eloquence'],
    ['dhamma-the-dhamma', 'an4.186:4.9', 'sujato/sutta', 'understands the meaning and the text of', 'understands the meaning and the Dhamma of'],
    ['dhamma-the-dhamma', 'dhp363:3', 'sujato/sutta', 'explains the text and its meaning,', 'explains the Dhamma and its meaning,'],
    // Not listed: peyyāla chapter headings are "text" as ordinary English, not dhamma.
    ['dhamma-the-dhamma', 'sn12.82:1.8', 'sujato/sutta', '(All the abbreviated texts should be told in full.)', '(All the abbreviated texts should be told in full.)'],
    // One example per grammatical slot ātāpī occupies. The adjective is the satipaṭṭhāna formula's
    // first word; the abstract noun ātappa is Bhikkhu Sujato's "keenness"; the adverb is his
    // "keenly"; and the article travels with the adjective, or SN 1.23 reads "a ardent bhikkhu".
    // ātāpī and sampajāna stand side by side in the satipaṭṭhāna formula, each taking its own rule.
    ['atapi-ardent', 'sn36.7:5.1', 'sujato/sutta', 'keen, aware, and mindful', 'ardent, attentive, and mindful'],
    ['atapi-ardent', 'an10.14:2.3', 'sujato/sutta', 'incline toward keenness, commitment', 'incline toward ardor, commitment'],
    ['atapi-ardent', 'mn125:2.5', 'sujato/sutta', 'a mendicant who meditates diligently, keenly', 'a bhikkhu who meditates diligently, ardently'],
    ['atapi-ardent', 'sn1.23:2.3', 'sujato/sutta', 'a keen and alert mendicant—', 'an ardent and alert bhikkhu—'],
    // Denied: tibbagārava, "keen respect" for the Saṅgha — an intensity word, nothing of ātāpī.
    ['atapi-ardent', 'sn1.49:7.2', 'sujato/sutta', 'with keen respect for the Saṅgha?', 'with keen respect for the Saṅgha?'],
    // The plural form absorbs "kinds of", which the singular has no reason to.
    ['satipatthana-establishment-of-mindfulness', 'sn52.1:1.4', 'sujato/sutta', 'missed out on these four kinds of mindfulness meditation', 'missed out on these four establishments of mindfulness'],
    // The preposition form, so the title's article stays lowercase.
    ['satipatthana-establishment-of-mindfulness', 'dn22:0.2', 'sujato/sutta', 'The Longer Discourse on Mindfulness Meditation', 'The Longer Discourse on the Establishment of Mindfulness'],
    // No rule reaches a note, so MN 10's — which argues for the very rendering this one reverses —
    // stays word for word as Bhikkhu Sujato wrote it.
    ['satipatthana-establishment-of-mindfulness', 'mn10:1.1', 'sujato/notes', 'i.e. “mindfulness meditation” or simply “meditation”', 'i.e. “mindfulness meditation” or simply “meditation”'],
    // The adjective sampajāna, which Bhikkhu Sujato leaves as bare "aware".
    ['sampajanna-attentive', 'sn47.2:2.1', 'sujato/sutta', 'a mendicant should live mindful and aware', 'a bhikkhu should live mindful and attentive'],
    // Its negation, which the bare adjective form cannot reach across the word boundary.
    ['sampajanna-attentive', 'an5.210:1.1', 'sujato/sutta', 'falling asleep unmindful and unaware', 'falling asleep unmindful and inattentive'],
    // The noun sampajañña.
    ['sampajanna-attentive', 'an10.61:2.12', 'sujato/sutta', 'Lack of mindfulness and situational awareness.', 'Lack of mindfulness and attentiveness.'],
    // The same noun where he drops "situational".
    ['sampajanna-attentive', 'an4.41:1.5', 'sujato/sutta', 'leads to mindfulness and awareness', 'leads to mindfulness and attentiveness'],
    // sampajānakārī, the -kārī compound, which keeps its verb and takes the adverb.
    ['sampajanna-attentive', 'sn47.2:3.2', 'sujato/sutta', 'a mendicant acts with situational awareness when going out', 'a bhikkhu acts attentively when going out'],
    // Denied: iti before a quoted perception, the formless attainments' "aware that …".
    ['sampajanna-attentive', 'an1.450:1.1', 'sujato/sutta', 'aware that ‘space is infinite’', 'aware that ‘space is infinite’'],
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
    // One example per grammatical slot. Aññathā-bhāva reads a different way in each, so a single
    // pair of forms would put a gerund where a noun belongs, or a second participle in a list of
    // adjectives.
    ['viparinama-annathatta-change-unstable', 'sn22.1:9.5', 'sujato/sutta', 'But that form of theirs decays and perishes, ', 'But that form of theirs changes and becomes otherwise, '],
    ['viparinama-annathatta-change-unstable', 'an10.29:3.5', 'sujato/sutta', 'But even the gods of sublime luminosity decay and perish. ', 'But even the gods of sublime luminosity change and become otherwise. '],
    // Bare infinitive: the finite plural form covers it, since "become" is already its shape.
    ['viparinama-annathatta-change-unstable', 'mn87:24.5', 'sujato/sutta', 'If she were to decay and perish, would sorrow arise in you?', 'If she were to change and become otherwise, would sorrow arise in you?'],
    // Nominal (vipariṇāmaññathābhāvā), the one slot the gerund cannot stand in.
    ['viparinama-annathatta-change-unstable', 'sn21.2:2.2', 'sujato/sutta', 'anything in the world whose decay and perishing would give rise to sorrow', 'anything in the world whose change and alteration would give rise to sorrow'],
    // Adjectival (vipariṇāmī aññathābhāvī), SN 25's formula — one form covering both words.
    ['viparinama-annathatta-change-unstable', 'sn35.93:1.4', 'sujato/sutta', 'The eye is impermanent, decaying, and perishing. ', 'The eye is impermanent, changing, and becoming otherwise. '],
    // Left alone: jarā, and pārijuñña. The rule has no bare "decaying"/"decay" form precisely so
    // that these — and every other homonym — need no deny list to survive it.
    ['viparinama-annathatta-change-unstable', 'sn5.4:5.2', 'sujato/sutta', 'decaying and frail. ', 'decaying and frail. '],
    ['viparinama-annathatta-change-unstable', 'mn82:30.1', 'sujato/sutta', 'And what is decay due to old age? ', 'And what is decay due to old age? '],
    // The compound noun, which the doublet rule above cannot reach: two forms, one per aggregate
    // Bhikkhu Sujato names after the preposition. mn138:20.5 carries both the ablative
    // rūpavipariṇāmaññathābhāvā and rūpavipariṇāmānuparivatti, which he collapses into this one
    // phrase, so the single rewrite covers the pair.
    ['viparinama-anuparivatti-changing', 'mn138:20.5', 'sujato/sutta', 'and consciousness latches on to the perishing of form. ', 'and consciousness latches on to the changing of form. '],
    ['viparinama-anuparivatti-changing', 'sn22.7:9.3', 'sujato/sutta', 'consciousness doesn’t latch on to the perishing of consciousness. ', 'consciousness doesn’t latch on to the changing of consciousness. '],
    // Left alone: vipariṇāmavirāganirodha, MN 137's own compound and a separate decision. The two
    // forms name an aggregate precisely so a bare "perishing" can never take this line.
    ['viparinama-anuparivatti-changing', 'mn137:11.2', 'sujato/sutta', 'the impermanence of sights—their perishing, fading away, and cessation— ', 'the impermanence of sights—their perishing, fading away, and cessation— '],
    // One per slot paritassati occupies: the predicative adjective, the noun, a title (where the
    // single-word form takes Sentence case, not Title Case), and the plural noun whose verb has to
    // travel with it into the singular. The last of those also carries
    // viparinama-anuparivatti-changing's rewrite in the same line — the two rules meet in this one
    // sentence, each taking a word the other never matches.
    ['paritassati-agitated', 'sn22.45:1.19', 'sujato/sutta', 'Being content, they’re not anxious. ', 'Being content, they’re not agitated. '],
    ['paritassati-agitated', 'sn22.7:2.1', 'sujato/sutta', 'And how does grasping lead to anxiety?', 'And how does grasping lead to agitation?'],
    ['paritassati-agitated', 'sn22.7:0.3', 'sujato/sutta', 'Anxiety Because of Grasping ', 'Agitation Because of Grasping '],
    ['paritassati-agitated', 'mn138:20.6', 'sujato/sutta', 'Anxieties occupy the mind, born of latching on to the perishing of form, ', 'Agitation occupies the mind, born of latching on to the changing of form, '],
    // Denied: utrasta, a terrified mind, and ubbigga — the second being the word this rule writes,
    // for a term it deliberately does not claim.
    ['paritassati-agitated', 'sn2.17:2.1', 'sujato/sutta', '“This mind is always anxious, ', '“This mind is always anxious, '],
    ['paritassati-agitated', 'thag16.8:22.4', 'sujato/sutta', 'my mind was anxious. ', 'my mind was anxious. '],
    // Denied: plain English in a blurb, which has no Pali to check it against — "anxious to know"
    // is eagerness.
    ['paritassati-agitated', 'an-blurbs:an8.23', 'sujato/blurb', 'Hatthaka is anxious to know that no lay people were present.', 'Hatthaka is anxious to know that no lay people were present.'],
    // One per grammatical slot the jhāna pair stands in, since the idiom is a phrase rather than a
    // word and a form that fits one slot is ungrammatical in the next. The first also pins the
    // article: the longest form has to swallow "the" or 106 segments read "As the thought and
    // examination are stilled".
    ['vitakka-vicara-thought-examination', 'sn53.1-12:1.6', 'sujato/sutta', 'As the placing of the mind and keeping it connected are stilled, they enter and remain in the second absorption, which has the rapture and bliss born of immersion, with internal clarity and mind at one, without placing the mind and keeping it connected. ', 'As thought and examination are stilled, they enter and remain in the second jhāna, which has the rapture and bliss born of composure, with internal clarity and mind at one, without thought or examination. '],
    // Finite verbs, then the bare subject noun, in one line — a noun-only rule would give "First
    // you thought and examination".
    ['vitakka-vicara-thought-examination', 'sn41.6:2.4', 'sujato/sutta', 'First you place the mind and keep it connected, then you break into speech. That’s why placing the mind and keeping it connected are a verbal process. ', 'First you think and examine, then you break into speech. That’s why thought and examination are a verbal process. '],
    // Negated verbs (na vitakketi na vicāreti).
    ['vitakka-vicara-thought-examination', 'sn47.10:6.13', 'sujato/sutta', 'They relax, and neither place the mind nor keep it connected. ', 'They relax, and neither think nor examine. '],
    // The vicāramatta middle term, where the two halves take different treatments.
    ['vitakka-vicara-thought-examination', 'sn43.12:3.5', 'sujato/sutta', 'Immersion without placing the mind, merely keeping it connected. … ', 'Composure without thought, with just examination. … '],
    // The pair as a bare list of first-absorption factors, comma-joined rather than "and"-joined.
    ['vitakka-vicara-thought-examination', 'mn43:20.4', 'sujato/sutta', 'Placing the mind, keeping it connected, rapture, bliss, and unification of mind are present. ', 'Thought, examination, rapture, bliss, and unification of mind are present. '],
    // vitakka alone, positive and negated (avitakka), where "no thought" carries the negation the
    // "not" would otherwise strand.
    ['vitakka-vicara-thought-examination', 'an9.41:8.11', 'sujato/sutta', 'And so, after some time, I saw the drawbacks of placing the mind and cultivated that, and I realized the benefits of not placing the mind and developed that. ', 'And so, after some time, I saw the drawbacks of thought and cultivated that, and I realized the benefits of no thought and developed that. '],
    // A title, where the single-word form takes Sentence case. SN 43.3's own title needs a segment
    // override instead — its lowercase "it" hides the Title Case from caseAs.
    ['vitakka-vicara-thought-examination', 'sn28.2:0.3', 'sujato/sutta', 'Without Placing the Mind ', 'Without Thought '],
    // Out of scope: the rule is sutta-only, and SN 41.6's note is Bhikkhu Sujato arguing his own rendering
    // — it already uses the words this rule writes, for the sense he says the formula lacks.
    ['vitakka-vicara-thought-examination', 'sn41.6:2.4', 'sujato/notes', 'have a more basic sense in ordinary states of mind (“thought” and “exploring”), and a technical sense of placing the mind and keeping it connected.', 'have a more basic sense in ordinary states of mind (“thought” and “exploring”), and a technical sense of placing the mind and keeping it connected.'],
    // The compound as a noun, and the verb in the same segment — a noun-only rule would give
    // "Nine things rooted in proper attention. When you rational application of mind, joy…".
    ['yoniso-proper-attention', 'dn34:2.2.3', 'sujato/sutta', 'Nine things rooted in rational application of mind. When you apply the mind rationally, joy springs up. ', 'Nine things rooted in proper attention. When you attend properly, joy springs up. '],
    // Bhikkhu Sujato's other word order, third person, and the "to" the verb keeps.
    ['yoniso-proper-attention', 'sn22.122:1.8', 'sujato/sutta', 'It’s possible that an ethical bhikkhu who rationally applies the mind to the five grasping aggregates will realize the fruit of stream-entry.” ', 'It’s possible that an ethical bhikkhu who attends properly to the five grasping aggregates will realize the fruit of stream-entry.” '],
    // Participle, and the imperative in Sentence case.
    ['yoniso-proper-attention', 'iti16:2.2', 'sujato/sutta', 'A bhikkhu rationally applying the mind gives up the unskillful and develops the skillful.” ', 'A bhikkhu attending properly gives up the unskillful and develops the skillful.” '],
    ['yoniso-proper-attention', 'sn35.159:1.6', 'sujato/sutta', 'Rationally apply the mind to sounds … ', 'Attend properly to sounds … '],
    // AN 3.68's stray "on", which the verb has to absorb, since "attend properly on" is not English.
    ['yoniso-proper-attention', 'an3.68:6.3', 'sujato/sutta', 'When you apply the mind rationally on the ugly feature of things, greed doesn’t arise. ', 'When you attend properly to the ugly feature of things, greed doesn’t arise. '],
    // SN 12's second adverb, which moves behind the verb rather than being stranded in front of it.
    ['yoniso-proper-attention', 'sn12.37:2.1', 'sujato/sutta', 'A learned noble disciple carefully and rationally applies the mind to dependent origination itself: ', 'A learned noble disciple attends carefully and properly to dependent origination itself: '],
    // A title, in Title Case.
    ['yoniso-proper-attention', 'sn46.24:0.3', 'sujato/sutta', 'Irrational Application of Mind ', 'Improper Attention '],
    // Bare yoniso, with no manasikāra to compound with — the adverb and the adjective alone.
    ['yoniso-proper-attention', 'an6.58:4.4', 'sujato/sutta', 'Reflecting rationally, they make use of almsfood: ', 'Reflecting properly, they make use of almsfood: '],
    ['yoniso-proper-attention', 'mn126:14.6', 'sujato/sutta', 'Because that’s a rational way to win the fruit. ', 'Because that’s a proper way to win the fruit. '],
    // Denied: ordinary English "rationally", for dhammato vivecetuṁ — no yoniso in the Pali.
    ['yoniso-proper-attention', 'an10.34:1.10', 'sujato/sutta', 'They’re able to rationally dissuade someone from misconceptions that come up. ', 'They’re able to rationally dissuade someone from misconceptions that come up. '],
    // Denied: blurb prose with no Pali to check it against — MN 60's apaṇṇaka method, not yoniso.
    ['yoniso-proper-attention', 'mn-blurbs:mn60', 'sujato/blurb', 'how to use a rational reflection to arrive at practices and principles', 'how to use a rational reflection to arrive at practices and principles'],
    // The plural noun mid-list, then sentence-initial — the case pattern the aggregates and the
    // dependent-origination links are stated in throughout.
    // The aggregate list, where this rule takes its word and leaves the rest of the list alone.
    ['sankhara-pali', 'sn22.56:1.4', 'sujato/sutta', 'The grasping aggregates of form, feeling, perception, choices, and consciousness. ', 'The grasping aggregates of form, feeling, perception, saṅkhāras, and consciousness. '],
    ['sankhara-pali', 'sn12.2:2.3', 'sujato/sutta', 'Choices are a requirement for consciousness. ', 'Saṅkhāras are a requirement for consciousness. '],
    // The singular, which the plural form must not pre-empt.
    ['sankhara-pali', 'mn9:62.2', 'sujato/sutta', 'There are these three kinds of choice. ', 'There are these three kinds of saṅkhāra. '],
    // saṅkhāradhātu, where the term stands in front of another noun and goes singular for it.
    ['sankhara-pali', 'sn22.3:4.7', 'sujato/sutta', 'The choices element is a bastion for consciousness. ', 'The saṅkhāra element is a bastion for consciousness. '],
    // The singular behind an indefinite article, which the replacement leaves alone — unlike the
    // plural slots, this one needs no form of its own, since both words start with a consonant.
    ['sankhara-pali', 'sn12.2:2.3', 'sujato/sutta', 'That is a choice. ', 'That is a saṅkhāra. '],
    // A title: caseAs reads Bhikkhu Sujato's one-word "Choices" as a capitalized sentence, and the
    // one-word replacement takes that capital without help.
    ['sankhara-pali', 'sn33.4:0.3', 'sujato/sutta', 'Not Knowing Choices ', 'Not Knowing Saṅkhāras '],
    // The SN 12.38–40 blurb's doublet, where the longer form claims the phrase and drops the gloss.
    ['sankhara-pali', 'sn-blurbs:sn12.38', 'sujato/blurb', 'Intentions or choices are the force that propels consciousness from one life to the next.', 'Intentions are the force that propels consciousness from one life to the next.'],
    // Denied: MN 120's saṅkhārupapatti, rebirth deliberately aspired to.
    ['sankhara-pali', 'mn120:0.2', 'sujato/sutta', 'Rebirth by Choice ', 'Rebirth by Choice '],
    // Denied: ordinary English, for pabbajjaṁ samarocayi.
    ['sankhara-pali', 'snp3.1:1.4', 'sujato/sutta', 'his choice to go forth. ', 'his choice to go forth. '],
    // One per slot Bhikkhu Sujato's verb stands in — third person, past participle, gerund, and the
    // bare infinitive after a modal, which also shows mendicant-bhikkhu running in the same line.
    ['abhisankharoti-generate', 'an3.23:1.3', 'sujato/sutta', 'Firstly, a certain individual makes hurtful choices by way of body, speech, and mind. ', 'Firstly, a certain individual generates hurtful saṅkhāras by way of body, speech, and mind. '],
    ['abhisankharoti-generate', 'an3.23:1.4', 'sujato/sutta', 'Having made these choices, they’re reborn in a hurtful world, ', 'Having generated these saṅkhāras, they’re reborn in a hurtful world, '],
    ['abhisankharoti-generate', 'sn22.53:3.8', 'sujato/sutta', 'Since that consciousness does not become established and does not grow, not making choices, it is freed. ', 'Since that consciousness does not become established and does not grow, not generating saṅkhāras, it is freed. '],
    ['abhisankharoti-generate', 'sn12.51:13.2', 'sujato/sutta', 'Would a mendicant who has ended the defilements still make good choices, bad choices, or imperturbable choices?” ', 'Would a bhikkhu who has ended the defilements still generate good saṅkhāras, bad saṅkhāras, or imperturbable saṅkhāras?” '],
    // The singular slot, where the verb changes but the article doesn't.
    ['abhisankharoti-generate', 'mn140:22.10', 'sujato/sutta', 'They neither make a choice nor form an intention for existence or nonexistence. ', 'They neither generate a saṅkhāra nor form an intention for existence or nonexistence. '],
    // Snp 3.12's "karmic" is dropped rather than carried over: the Pali is the bare Saṅkhāre
    // uparundhiya, and saṅkhāra already carries the kammic sense.
    ['abhisankharoti-generate', 'snp3.12:43.4', 'sujato/sutta', 'and stopped making karmic choices, ', 'and stopped generating saṅkhāras, '],
    // Denied: "make" is causative around the noun rather than governing it, so the noun moves and
    // the verb stays — eleven of them in this one segment.
    ['abhisankharoti-generate', 'sn12.69:1.5', 'sujato/sutta', 'In the same way, when ignorance surges it makes choices surge. When choices surge they make consciousness surge. ', 'In the same way, when ignorance surges it makes saṅkhāras surge. When saṅkhāras surge they make consciousness surge. '],
    // Denied: SN 22.79's "what make it into form" renders saṅkhata, not abhisaṅkharoti.
    ['abhisankharoti-generate', 'sn22.79:5.4', 'sujato/sutta', 'Form is a conditioned phenomenon; choices are what make it into form. ', 'Form is a conditioned phenomenon; saṅkhāras are what make it into form. '],
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

  // Every word the term rules before `ruleId` can produce, lowercased. These are the tokens the
  // real pass has locked by the time `ruleId` runs, so it can never consume one of them.
  const producedBefore = (rules, ruleId) => {
    const out = new Set();
    for (const rule of rules.filter(isTermRule)) {
      if (rule.id === ruleId) break;
      for (const [, to] of rule.forms) out.add(to.toLowerCase());
    }
    return out;
  };

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
      const { chunks } = applyTermRules(rule.from, {
        treeName: 'sujato/sutta',
        segmentId: segmentsOf(rule)[0],
        rules,
        sidecars: new Map(rules.filter(isTermRule).map((r) => [r.id, loadSidecar(r.id)])),
      });
      // Reprocessing on its own has no lock history, so it re-consumes tokens the real pass had
      // already locked: a word one rule *produces* is invisible to a later rule listing the same
      // word as a source (see "The pass" in docs/retranslation.md). That difference is expected
      // rather than a broken anchor, so a rewrite is only a failure when what it consumed is not
      // an earlier rule's output.
      for (const chunk of chunks) {
        if (!chunk.locked || chunk.text === chunk.original) continue;
        expect(
          producedBefore(rules, chunk.ruleId).has(chunk.original.toLowerCase()),
          `${rule.id}'s from is not post-processed text: ${chunk.ruleId} rewrites `
            + `"${chunk.original}" to "${chunk.text}"`,
        ).toBe(true);
      }
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

describe('blurb openers', () => {
  const opener = { blurb: 'sn-blurbs:sn13', from: 'The “Linked Discourses” contains 11 discourses on ', to: 'Discourses on ' };

  it('replaces the opening prefix and keeps the rest of the paragraph', () => {
    const value = `${opener.from}the value of realizing the Dhamma. Each discourse features a simile.`;
    expect(applyBlurbOpener(value, opener)).toEqual({
      result: 'Discourses on the value of realizing the Dhamma. Each discourse features a simile.',
      applied: true,
    });
  });

  it('refuses when "from" is no longer the opening — the broken-anchor case', () => {
    // Present, but not at the start: an opener anchors on the prefix and nowhere else.
    expect(applyBlurbOpener(`Note: ${opener.from}the value…`, opener).applied).toBe(false);
    expect(applyBlurbOpener('Upstream reworded this opening.', opener).applied).toBe(false);
  });

  it('rejects a malformed rule', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-data-blurb-'));
    const empty = writeRulesFixture(root, `[{ id: 'x', kind: 'blurb', why: 't', openers: [] }]`);
    await expect(loadRules(empty)).rejects.toThrow(/non-empty openers array/);
    const noFrom = writeRulesFixture(root, `[{ id: 'x', kind: 'blurb', why: 't', openers: [{ blurb: 'a:1', to: 'b' }] }]`);
    await expect(loadRules(noFrom)).rejects.toThrow(/without blurb, from and to/);
    const twice = writeRulesFixture(
      root,
      `[{ id: 'x', kind: 'blurb', why: 't', openers: [{ blurb: 'a:1', from: 'a', to: 'b' }, { blurb: 'a:1', from: 'c', to: 'd' }] }]`,
    );
    await expect(loadRules(twice)).rejects.toThrow(/twice — one opener per blurb/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('post trims a blurb opener, anchored on post-processed text', async () => {
    const fx = makeFixture();
    // The fixture blurb is 'A mendicant teaches immersion.', so `from` has to be what the two
    // fixture term rules make of it — the same rule the shipped openers follow.
    const retranslationPath = writeRulesFixture(
      fx.root,
      `[
        { id: 'mendicant-bhikkhu', why: 'fixture', mode: 'deny', forms: [['mendicant', 'bhikkhu']] },
        { id: 'immersion-concentration', why: 'fixture', mode: 'deny', forms: [['immersion', 'concentration']] },
        { id: 'blurb-openers', kind: 'blurb', why: 'fixture', openers: [{ blurb: 'dn-blurbs:dn1', from: 'A bhikkhu teaches ', to: 'Teaching about ' }] },
      ]`,
    );

    const result = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

    expect(result.ok).toBe(true);
    expect(readJson(path.join(fx.postDir, 'blurb/dn-blurbs_root-en.json'))).toEqual({ 'dn-blurbs:dn1': 'Teaching about concentration.' });

    // Upstream rewording the opening is a hard fail, not a silent skip.
    writeJson(path.join(fx.dataDirs.sujato, 'blurb/dn-blurbs_root-en.json'), { 'dn-blurbs:dn1': 'One mendicant teaches immersion.' });
    const drifted = await runPost({ sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });
    expect(drifted.ok).toBe(false);
    expect(drifted.brokenOverrides).toMatchObject([{ id: 'blurb-openers', segment: 'dn-blurbs:dn1' }]);
    fs.rmSync(fx.root, { recursive: true, force: true });
  });

  it('every shipped opener rewrites its own from to its own to', async () => {
    const rules = await loadRules(RETRANSLATION_PATH);
    const blurbRules = rules.filter(isBlurbRule);
    expect(blurbRules.length).toBeGreaterThan(0);
    for (const rule of blurbRules) {
      for (const o of rule.openers) {
        expect(applyBlurbOpener(o.from, o), `${rule.id} · ${o.blurb}`).toEqual({ result: o.to, applied: true });
      }
    }
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    expect(checkSnapshotInSync({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath })).toEqual({ ok: true, issues: [] });
  });

  it('reports drift when a local file changed without the snapshot being regenerated', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    // Simulate: copy+post already happened and got committed, but update-data accept was never
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    fs.rmSync(path.join(fx.dataDirs.sujato, 'name/dn-name_translation-en-sujato.json'));

    const result = checkSnapshotInSync({ dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.startsWith('sujato/name/dn-name_translation-en-sujato.json'));
    expect(issue).toMatch(/missing locally/);
  });

  // Both checks below read every file under data/{sujato,pali,html} — a few thousand of them.
  // That is well under a second on an idle machine, but they run alongside the rest of the suite,
  // and a loaded CI runner needs more room for that much I/O than the default 5s timeout gives.
  it('the real repo: data/{sujato,pali,html} and snapshot.json are in sync', () => {
    // No overrides — this is the one guard that actually protects the repo: if copy/post ran and
    // got committed without a follow-up update-data accept, this fails on the next `npm test`.
    expect(checkSnapshotInSync()).toEqual({ ok: true, issues: [] });
  }, 30_000);

  it('the real repo: pali/html match exactly and sujato is a subset of pali', () => {
    // No overrides — unlike checkSnapshotInSync above (which only catches a per-file drift from
    // snapshot.json), this is what actually protects the repo from a cross-category misalignment:
    // build-corpus.mjs degrades silently (dropped/unstyled segments, not a build failure) when
    // pali/sujato/html disagree — see INTEGRITY_GROUPS in lib/dataSync.js.
    const keysFor = (relPath) => readKeysSafe(localPathFor(relPath));
    expect(checkCrossCategoryIntegrity(listLocalRelPaths(), keysFor)).toEqual([]);
  }, 30_000);
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const before = readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'));

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result).toMatchObject({ ok: true, issues: [], checked: 7, totalTracked: 7 });
    // check never mutates data/sujato — that's post's job, and only into sujato.post/.
    expect(readJson(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual(before);
  });

  it('check reports a segment-id change upstream, naming the new segment ids', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

  it('check accepts a blank English segment added upstream, summarizing it instead of failing', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    // Upstream pads its English file out to the Pali's segment id set — dn1:1.2 is already in
    // pali/html, so nothing about the built text can change.
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/notes/dn/dn1_comment-en-sujato.json'].sourceRel);
    writeJson(sourcePath, { ...readJson(sourcePath), 'dn1:1.2': '' });

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(true);
    expect(result.upstreamIssues).toEqual([]);
    expect(result.padding).toEqual({ 'sujato/notes': { files: 1, segments: 1 } });
    // Accepted means verified, not skipped.
    expect(result.checked).toBe(result.totalTracked);
  });

  it('check still fails on a blank segment added to pali, which is what decides segment order', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['pali/sutta/dn/dn1_root-pli-ms.json'].sourceRel);
    writeJson(sourcePath, { ...readJson(sourcePath), 'dn1:1.3': '' });

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.padding).toEqual({});
    expect(result.upstreamIssues).toHaveLength(1);
    expect(result.upstreamIssues[0]).toMatch(/pali\/sutta\/dn\/dn1_root-pli-ms\.json/);
    expect(result.upstreamIssues[0]).toMatch(/new segment ids: dn1:1\.3/);
  });

  it('check still fails on a segment removed upstream, even with blank ones added alongside', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    writeJson(sourcePath, { 'dn1:1.1': 'The mendicant practiced immersion.', 'dn1:1.3': '' });

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.ok).toBe(false);
    expect(result.padding).toEqual({});
    expect(result.upstreamIssues[0]).toMatch(/missing segment ids: dn1:1\.2/);
  });

  it('check folds in local drift even when the upstream side is clean', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath });

    expect(result.localIssues).toEqual([]);
    expect(result.localIntegrityIssues.length).toBeGreaterThan(0);
    expect(result.localIntegrityIssues[0]).toMatch(/sujato vs pali dn\/dn1/);
    expect(result.ok).toBe(false);
  });

  it('copy overwrites dataDirs byte-for-byte from bilaraRoot and writes manifest.json', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
    const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
    fs.writeFileSync(sourcePath, JSON.stringify({ 'dn1:1.1': 'Revised text.' }, null, 2));

    const gitInfo = { commit: 'abc123def456', commitDate: '2026-01-01T00:00:00Z', dirty: false };
    const manifest = runCopy({ bilaraRoot: fx.bilaraRoot, gitInfo, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath });

    expect(fs.readFileSync(path.join(fx.dataDirs.sujato, 'sutta/dn/dn1_translation-en-sujato.json'), 'utf8')).toBe(fs.readFileSync(sourcePath, 'utf8'));
    expect(manifest).toMatchObject({ sourceRepo: 'suttacentral/sc-data', sourceCommit: 'abc123def456', sourceDirty: false, fileCount: 7 });
    expect(readJson(fx.manifestPath)).toEqual(manifest);
  });

  it('copy sets manifest.snapshotCommit to null when there is no prior manifest.json', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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

    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

    expect(readJson(fx.manifestPath).snapshotCommit).toBe('new-commit');
  });

  it('snapshot is a no-op on manifest.json when one does not exist yet', async () => {
    expect(fs.existsSync(fx.manifestPath)).toBe(false);
    await expect(runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir })).resolves.not.toThrow();
    expect(fs.existsSync(fx.manifestPath)).toBe(false);
  });

  it('copy throws instead of silently skipping if a tracked file is missing from bilaraRoot', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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
    // blurb, name and sutta — not the notes file, which no rule may touch.
    expect(filesChanged).toBe(3);
    expect(replacements).toBeGreaterThan(0);
    expect(readJson(path.join(fx.postDir, 'sutta/dn/dn1_translation-en-sujato.json'))).toEqual({
      'dn1:1.1': 'The bhikkhu practiced concentration.',
      'dn1:1.2': 'A water immerser is different.',
    });
    expect(readJson(path.join(fx.postDir, 'name/dn-name_translation-en-sujato.json'))['dn-name:1.dn1']).toBe('The Bhikkhus Sutta');
    // The note is copied through verbatim, terms and all — see "Notes are never retranslated".
    expect(readJson(path.join(fx.postDir, 'notes/dn/dn1_comment-en-sujato.json'))).toEqual(
      FIXTURE_FILES['sujato/notes/dn/dn1_comment-en-sujato.json'].content,
    );
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

    await runAccept({
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
    // times (blurb, sutta, notes) — see FIXTURE_FILES above. The notes occurrence of each doesn't
    // count: no rule reaches sujato/notes.
    expect(counts.rules['mendicant-bhikkhu']).toBe(3);
    expect(counts.rules['immersion-concentration']).toBe(2);
  });

  describe('check: retranslation rule anchors', () => {
    it('flags a term rule that matches nowhere upstream', async () => {
      const retranslationPath = writeRulesFixture(fx.root, `[{ id: 'dead-rule', why: 'test', mode: 'deny', forms: [['nonexistentword', 'x']] }]`);
      await runAccept({ countsPath: fx.countsPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });

      const result = await runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir, retranslationPath });

      expect(result.ok).toBe(false);
      expect(result.ruleIssues).toHaveLength(1);
      expect(result.ruleIssues[0]).toMatch(/dead-rule: matches nowhere upstream/);
    });

    it('reports a broken segment override as the failing expected/found pair, plus what it would have shipped', async () => {
      const retranslationPath = writeRulesFixture(
        fx.root,
        `[{ id: 'stale-override', kind: 'segment', why: 'test', segment: 'dn1:1.1', from: 'The mendicant practiced immersion.', to: 'Rewritten.' }]`,
      );
      await runAccept({ countsPath: fx.countsPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath });
      // Upstream reworded the segment the override was anchored to.
      const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
      const upstream = readJson(sourcePath);
      upstream['dn1:1.1'] = 'The mendicant practiced something else entirely.';
      writeJson(sourcePath, upstream);

      const result = await runCheck({ bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir, retranslationPath });

      expect(result.ok).toBe(false);
      expect(result.ruleIssues).toHaveLength(1);
      expect(result.ruleIssues[0]).toMatch(/stale-override · dn1:1\.1/);
      expect(result.ruleIssues[0]).toMatch(/expected\s+The mendicant practiced immersion\./);
      expect(result.ruleIssues[0]).toMatch(/found\s+The mendicant practiced something else entirely\./);
      expect(result.ruleIssues[0]).toMatch(/Would write:\s+Rewritten\./);
      // No term rule touched this line, so "found" *is* upstream and repeating it would say nothing.
      expect(result.ruleIssues[0]).not.toMatch(/upstream/);
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
      await runAccept({ countsPath: fx.countsPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir, retranslationPath: good });
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
      // "found" is the term rules' output, derived above it from upstream by the named rule.
      expect(result.ruleIssues[0]).toMatch(/upstream\s+The mendicant practiced immersion\./);
      expect(result.ruleIssues[0]).toMatch(/↪ term {2}"mendicant" → "bhikkhu"/);
      expect(result.ruleIssues[0]).toMatch(/found\s+The bhikkhu practiced immersion\./);
    });

    it('reports a deny entry upstream has invalidated, before the copy and without failing the run', async () => {
      // dn1:1.1 is the only sutta segment carrying "immersion", and it's excluded from the rule.
      writeJson(path.join(fx.rulesDir, 'immersion-concentration.json'), { reviewedAt: '2026-01-01', allow: [], deny: { 'dn1:1.1': 'fixture exclusion' } });
      await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });
      // Upstream rewords it so the term is gone — the exclusion now excludes nothing. Only the
      // value changed, so nothing structural fails and the run stays green.
      const sourcePath = path.join(fx.bilaraRoot, FIXTURE_FILES['sujato/sutta/dn/dn1_translation-en-sujato.json'].sourceRel);
      writeJson(sourcePath, { ...readJson(sourcePath), 'dn1:1.1': 'The mendicant practiced something else.' });

      const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir });

      expect(result.staleTriage).toHaveLength(1);
      expect(result.staleTriage[0]).toMatch(/immersion-concentration: 1 of 1 deny entries no longer contain the term upstream/);
      expect(result.staleTriage[0]).toMatch(/update-data triage immersion-concentration/);
      // Reported, not failed on: a dead entry can only be worked after the copy, and doesn't make
      // copying unsafe.
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('says nothing about a deny entry whose segment still carries the term', async () => {
      writeJson(path.join(fx.rulesDir, 'immersion-concentration.json'), { reviewedAt: '2026-01-01', allow: [], deny: { 'dn1:1.1': 'fixture exclusion' } });
      await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });

      const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir });

      expect(result.staleTriage).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('passes when every rule still matches upstream and no segment override is stale', async () => {
      // Default (real) rules file — FIXTURE_FILES contains both "mendicant" and "immersion".
      await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir, rulesDir: fx.rulesDir });

      const result = await runCheck({ retranslationPath: fx.retranslationPath, bilaraRoot: fx.bilaraRoot, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, rulesDir: fx.rulesDir });

      expect(result.ruleIssues).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  it('the full review workflow (check fails -> copy -> post -> snapshot -> check passes) round-trips', async () => {
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });
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
    await runAccept({ countsPath: fx.countsPath, retranslationPath: fx.retranslationPath, dataDirs: fx.dataDirs, snapshotPath: fx.snapshotPath, manifestPath: fx.manifestPath, sujatoDir: fx.dataDirs.sujato, postDir: fx.postDir });

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
