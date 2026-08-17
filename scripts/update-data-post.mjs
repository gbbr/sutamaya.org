#!/usr/bin/env node
// Applies the declared editorial layer over Sujato's English (scripts/update-data/
// retranslation.mjs) to data/sujato/ and writes the result to data/sujato.post/ — never mutating
// data/sujato/ itself, so it stays pristine upstream text and `post` is a pure function of
// (upstream, rules), safely re-runnable while rules are being authored. See
// scripts/update-data/retranslation.md for the full design; this is the mechanism.
//
// Pali/HTML have no translatable English prose, so this step only ever touches sujato/*.
import fs from 'node:fs';
import path from 'node:path';
import { walkJsonFiles, ROOT, red, green, yellow, bold } from './lib/dataSync.js';
import {
  SUJATO_DIR,
  SUJATO_POST_DIR,
  RULES_DIR,
  RETRANSLATION_PATH,
  loadRules,
  isTermRule,
  isSegmentRule,
  loadSidecar,
  applyTermRules,
  applySegmentOverride,
  buildSegmentIndex,
  paliTextFor,
} from './lib/retranslation.js';

const DIFF_DIR = path.join(ROOT, 'scripts', 'update-data', 'diff');

// Core logic, callable directly with explicit dirs/paths (tests point these at fixture trees
// instead of the real data/sujato(.post) — see scripts/update-data.test.js). Never touches
// `sujatoDir`; only reads it. Writes `postDir` (wiped and fully rewritten each run) only when
// every anchor holds — a dead term rule or a segment override whose `from` no longer matches
// verbatim is a hard fail, and a hard-failing run must not silently produce a degraded build (see
// retranslation.md's anchors table).
export async function runPost({
  sujatoDir = SUJATO_DIR,
  postDir = SUJATO_POST_DIR,
  rulesDir = RULES_DIR,
  retranslationPath = RETRANSLATION_PATH,
  diff = false,
  diffDir = DIFF_DIR,
} = {}) {
  const rules = await loadRules(retranslationPath);
  const termRules = rules.filter(isTermRule);
  const segmentRules = rules.filter(isSegmentRule);
  const sidecars = new Map(termRules.map((r) => [r.id, loadSidecar(r.id, rulesDir)]));

  // Load every tracked file up front, keyed by the same logical 'sujato/sutta/...' relPath
  // lib/dataSync.js uses — cheap (a few thousand small JSON files) and lets segment-override
  // resolution and the diff writer share this same in-memory tree rather than re-reading.
  const objects = new Map(); // relPath -> parsed object (mutated in place as rules apply)
  for (const fullPath of walkJsonFiles(sujatoDir)) {
    const relPath = 'sujato/' + path.relative(sujatoDir, fullPath).split(path.sep).join('/');
    objects.set(relPath, JSON.parse(fs.readFileSync(fullPath, 'utf8')));
  }

  const ruleCounts = new Map(); // ruleId -> total match count across the whole run
  const diffEntries = []; // { ruleId, relPath, segmentId, chunks } — only populated when diff
  let replacements = 0;
  const changedFiles = new Set();

  for (const [relPath, obj] of objects) {
    const treeName = relPath.split('/').slice(0, 2).join('/'); // e.g. 'sujato/sutta'
    for (const [segmentId, value] of Object.entries(obj)) {
      if (typeof value !== 'string') continue;
      const { result, counts, chunks } = applyTermRules(value, { treeName, segmentId, rules: termRules, sidecars });
      if (result === value) continue;
      obj[segmentId] = result;
      changedFiles.add(relPath);
      for (const [ruleId, count] of counts) {
        ruleCounts.set(ruleId, (ruleCounts.get(ruleId) ?? 0) + count);
        replacements += count;
        if (diff) diffEntries.push({ ruleId, relPath, segmentId, chunks });
      }
    }
  }

  // Every term rule gets an entry in ruleCounts, including ones that matched nowhere — that's
  // exactly the zero-match anchor below, and it's how a rule with real matches elsewhere still
  // shows 0 rather than being silently absent from the summary.
  for (const rule of termRules) if (!ruleCounts.has(rule.id)) ruleCounts.set(rule.id, 0);

  const deadRules = termRules.filter((r) => ruleCounts.get(r.id) === 0).map((r) => r.id);

  const brokenOverrides = [];
  if (segmentRules.length > 0) {
    const segmentIndex = buildSegmentIndex(sujatoDir);
    for (const rule of segmentRules) {
      const relPath = segmentIndex.get(rule.segment);
      if (!relPath) {
        brokenOverrides.push({ id: rule.id, segment: rule.segment, reason: 'segment id not found in data/sujato' });
        continue;
      }
      const obj = objects.get(relPath);
      const current = obj[rule.segment];
      const { result, applied } = applySegmentOverride(current, rule);
      if (!applied) {
        brokenOverrides.push({ id: rule.id, segment: rule.segment, reason: "rule's from no longer matches verbatim", from: rule.from, current });
        continue;
      }
      obj[rule.segment] = result;
      changedFiles.add(relPath);
    }
  }

  const ok = deadRules.length === 0 && brokenOverrides.length === 0;

  if (ok) {
    fs.rmSync(postDir, { recursive: true, force: true });
    for (const [relPath, obj] of objects) {
      const destPath = path.join(postDir, relPath.slice('sujato/'.length));
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, JSON.stringify(obj, null, 2));
    }
  }

  if (diff) writeDiffFiles({ diffDir, diffEntries, rules: termRules, ruleCounts, deadRules, changedFiles, paliDir: path.join(path.dirname(sujatoDir), 'pali') });

  return {
    ok,
    filesChanged: changedFiles.size,
    replacements,
    ruleCounts: Object.fromEntries(ruleCounts),
    deadRules,
    brokenOverrides,
  };
}

// --- Diff writer (npm run update-data:post:diff) -------------------------------------------
// Writes scripts/update-data/diff/{00-summary,<id>}.diff — gitignored, wiped each run. Colour is
// forced on regardless of TTY (unlike lib/dataSync.js's red/green/etc, which are TTY-gated) since
// these files are always written non-interactively and are meant to be read with `less -R`.
const wrap = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const fRed = wrap(91);
const fGreen = wrap(32);
const fYellow = wrap(33);
const fBold = wrap(1);
const fDim = wrap(2);
const fCyan = wrap(36);

// Renders one rule's contribution to a segment's final text: `variant` picks whether each of this
// rule's own chunks shows its pre-image (`original`) or post-image (`text`) — chunks from every
// other rule (or never touched at all) always show their already-final text, since the point is
// to see this rule's change in the context it actually landed in, not to re-derive the whole
// segment's history.
function renderChunks(chunks, ruleId, variant, colorFn) {
  return chunks
    .map((c) => (c.locked && c.ruleId === ruleId ? colorFn(variant === 'before' ? c.original : c.text) : c.text))
    .join('');
}

function writeDiffFiles({ diffDir, diffEntries, rules, ruleCounts, deadRules, changedFiles, paliDir }) {
  fs.rmSync(diffDir, { recursive: true, force: true });
  fs.mkdirSync(diffDir, { recursive: true });

  const byRule = new Map(rules.map((r) => [r.id, []]));
  for (const entry of diffEntries) byRule.get(entry.ruleId)?.push(entry);

  const summaryLines = [fBold('update-data:post:diff summary'), ''];
  for (const rule of rules) {
    const count = ruleCounts.get(rule.id) ?? 0;
    const files = new Set(byRule.get(rule.id).map((e) => e.relPath)).size;
    const flag = deadRules.includes(rule.id) ? fRed('  ZERO MATCHES') : '';
    summaryLines.push(`${count === 0 ? fRed(rule.id) : fCyan(rule.id)}  ${count} match(es), ${files} file(s)${flag}`);
  }
  fs.writeFileSync(path.join(diffDir, '00-summary.diff'), summaryLines.join('\n') + '\n');

  for (const [ruleId, entries] of byRule) {
    const lines = [fBold(`Rule: ${ruleId}`), fDim(`${entries.length} change(s)`), ''];
    for (const { relPath, segmentId, chunks } of entries) {
      const pali = relPath.startsWith('sujato/sutta/') ? paliTextFor(segmentId, relPath, paliDir) : null;
      lines.push(fYellow(`${segmentId}`) + fDim(`  (${relPath})`));
      if (pali) lines.push(fDim(`  PLI: `) + pali);
      lines.push(fRed(`  - `) + renderChunks(chunks, ruleId, 'before', fRed));
      lines.push(fGreen(`  + `) + renderChunks(chunks, ruleId, 'after', fGreen));
      lines.push('');
    }
    fs.writeFileSync(path.join(diffDir, `${ruleId}.diff`), lines.join('\n') + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const diff = process.argv.includes('--diff');
  const result = await runPost({ diff });

  if (!result.ok) {
    console.error(bold(red(`update-data post FAILED — data/sujato.post/ was NOT written.`)));
    if (result.deadRules.length) {
      console.error(bold(red(`\nDead rules — matched nowhere (${result.deadRules.length}):`)));
      for (const id of result.deadRules) console.error(red(`- ${id}`));
    }
    if (result.brokenOverrides.length) {
      console.error(bold(red(`\nBroken segment overrides (${result.brokenOverrides.length}):`)));
      for (const b of result.brokenOverrides) {
        console.error(red(`- ${b.id} (${b.segment}): ${b.reason}`));
        if (b.current !== undefined) {
          console.error(yellow(`    rule's from: ${b.from}`));
          console.error(yellow(`    current text: ${b.current}`));
        }
      }
    }
    console.error(`\nRun ${green('update-data:triage')} to work through it — see scripts/update-data/retranslation.md.`);
    process.exit(1);
  }

  console.log(green(`update-data post done — ${result.replacements} replacement(s) across ${result.filesChanged} file(s). Wrote data/sujato.post/.`));
  if (diff) console.log(green(`Diffs written to scripts/update-data/diff/ — read with 'less -R'.`));
}
