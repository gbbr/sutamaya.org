#!/usr/bin/env node
// Applies the declared editorial layer over Bhikkhu Sujato's English (scripts/update-data/
// retranslation.mjs) to data/sujato/ and writes the result to data/sujato.post/ — never mutating
// data/sujato/ itself, so it stays pristine upstream text and `post` is a pure function of
// (upstream, rules), safely re-runnable while rules are being authored. See
// docs/retranslation.md for the full design; this is the mechanism.
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
  segmentsOf,
  loadSidecar,
  applyTermRules,
  applySegmentOverride,
  buildSegmentIndex,
  paliTextFor,
} from './lib/retranslation.js';

const DIFF_DIR = path.join(ROOT, 'data', 'diff');

// Core logic, callable directly with explicit dirs/paths (tests point these at fixture trees
// instead of the real data/sujato(.post) — see scripts/update-data.test.js). Never touches
// `sujatoDir`; only reads it. Writes `postDir` (wiped and fully rewritten each run) only when
// every anchor holds — a dead term rule or a segment override whose `from` no longer matches
// verbatim is a hard fail, and a hard-failing run must not silently produce a degraded build (see
// docs/retranslation.md's anchors table).
// `diff` is off by default so programmatic callers (the tests, update-data:counts) don't write
// over the checked-in data/diff/; the CLI below always turns it on.
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
      for (const segment of segmentsOf(rule)) {
        const relPath = segmentIndex.get(segment);
        if (!relPath) {
          brokenOverrides.push({ id: rule.id, segment, reason: 'segment id not found in data/sujato' });
          continue;
        }
        const obj = objects.get(relPath);
        const current = obj[segment];
        const { result, applied } = applySegmentOverride(current, rule);
        if (!applied) {
          brokenOverrides.push({ id: rule.id, segment, reason: "rule's from no longer matches verbatim", from: rule.from, current });
          continue;
        }
        obj[segment] = result;
        changedFiles.add(relPath);
        ruleCounts.set(rule.id, (ruleCounts.get(rule.id) ?? 0) + 1);
        if (diff) diffEntries.push({ ruleId: rule.id, relPath, segmentId: segment, from: current, to: result });
      }
    }
  }
  for (const rule of segmentRules) if (!ruleCounts.has(rule.id)) ruleCounts.set(rule.id, 0);

  const ok = deadRules.length === 0 && brokenOverrides.length === 0;

  if (ok) {
    fs.rmSync(postDir, { recursive: true, force: true });
    for (const [relPath, obj] of objects) {
      const destPath = path.join(postDir, relPath.slice('sujato/'.length));
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, JSON.stringify(obj, null, 2));
    }
  }

  if (diff) writeDiffFiles({ diffDir, diffEntries, rules: [...termRules, ...segmentRules], ruleCounts, deadRules, paliDir: path.join(path.dirname(sujatoDir), 'pali') });

  return {
    ok,
    filesChanged: changedFiles.size,
    replacements,
    ruleCounts: Object.fromEntries(ruleCounts),
    deadRules,
    brokenOverrides,
  };
}

// --- Diff writer -----------------------------------------------------------------------------
// Writes data/diff/{00-summary.txt,<id>.diff}, wiped and fully rewritten on every `post` run.
// These files are **checked in**: `git diff data/diff/` after an `update-data` refresh is what
// shows which of this app's own rewrites upstream has moved under, rule by rule. That makes
// byte-stability the requirement — no colour, no timestamps, source files in sorted order — so a
// run over unchanged input produces an unchanged tree and any diff at all is real.
//
// Each rule file is a genuine unified diff, which is what pays for the plain bytes: `riff <
// data/diff/<id>.diff` (or delta) recomputes the changed span and highlights it inline, so the
// word-level view lives in the viewer instead of in the file, and the same file still reads
// cleanly through `git diff` and on GitHub.

// A segment value is normally a single line; three in the whole corpus aren't, and a raw newline
// would break the diff grammar around it.
const oneLine = (s) => String(s).replace(/\r?\n/g, ' ⏎ ');

// Renders one rule's contribution to a segment's final text: `variant` picks whether each of this
// rule's own chunks shows its pre-image (`original`) or post-image (`text`) — chunks from every
// other rule (or never touched at all) always show their already-final text, since the point is
// to see this rule's change in the context it actually landed in, not to re-derive the whole
// segment's history. It's also what keeps a viewer's inline highlight honest: the two rendered
// lines differ in this rule's spans and nowhere else.
function renderChunks(chunks, ruleId, variant) {
  return chunks.map((c) => (c.locked && c.ruleId === ruleId ? (variant === 'before' ? c.original : c.text) : c.text)).join('');
}

function writeDiffFiles({ diffDir, diffEntries, rules, ruleCounts, deadRules, paliDir }) {
  fs.rmSync(diffDir, { recursive: true, force: true });
  fs.mkdirSync(diffDir, { recursive: true });

  const byRule = new Map(rules.map((r) => [r.id, []]));
  for (const entry of diffEntries) byRule.get(entry.ruleId)?.push(entry);

  const summaryLines = ['update-data:post summary', ''];
  for (const rule of rules) {
    const count = ruleCounts.get(rule.id) ?? 0;
    const files = new Set(byRule.get(rule.id).map((e) => e.relPath)).size;
    const flag = deadRules.includes(rule.id) ? '  ZERO MATCHES' : '';
    summaryLines.push(`${rule.id}  ${count} match(es), ${files} file(s)${flag}`);
  }
  fs.writeFileSync(path.join(diffDir, '00-summary.txt'), summaryLines.join('\n') + '\n');

  for (const [ruleId, entries] of byRule) {
    // Group by source file so one `---`/`+++` header covers every segment changed in it, and sort
    // the paths: entries arrive in walkJsonFiles' readdir order, which isn't stable across
    // machines, and these files are committed.
    const byFile = new Map();
    for (const entry of entries) {
      if (!byFile.has(entry.relPath)) byFile.set(entry.relPath, []);
      byFile.get(entry.relPath).push(entry);
    }

    const lines = [`Rule: ${ruleId} — ${entries.length} change(s), ${byFile.size} file(s)`, ''];
    for (const relPath of [...byFile.keys()].sort()) {
      lines.push(`--- ${relPath}`, `+++ ${relPath}`);
      for (const { segmentId, chunks, from, to } of byFile.get(relPath)) {
        const pali = relPath.startsWith('sujato/sutta/') ? paliTextFor(segmentId, relPath, paliDir) : null;
        // One hunk per changed segment: the segment id goes in the header's section field and the
        // Pali is the hunk's single context line, both plain unified-diff grammar so every viewer
        // parses them. The line numbers are nominal — nothing ever applies these patches.
        lines.push(`@@ -1${pali ? ',2' : ''} +1${pali ? ',2' : ''} @@ ${segmentId}`);
        if (pali) lines.push(` PLI: ${oneLine(pali)}`);
        // Segment-override entries carry the whole before/after value directly (`from`/`to`) rather
        // than chunks — the rule replaces the entire segment, so there's no surrounding context to
        // isolate a span within.
        lines.push(`-${oneLine(chunks ? renderChunks(chunks, ruleId, 'before') : from)}`);
        lines.push(`+${oneLine(chunks ? renderChunks(chunks, ruleId, 'after') : to)}`);
      }
    }
    fs.writeFileSync(path.join(diffDir, `${ruleId}.diff`), lines.join('\n') + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runPost({ diff: true });

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
    console.error(`\nRun ${green('update-data:triage')} to work through it — see docs/retranslation.md.`);
    process.exit(1);
  }

  console.log(green(`update-data post done — ${result.replacements} replacement(s) across ${result.filesChanged} file(s). Wrote data/sujato.post/.`));
  console.log(green(`Per-rule diffs written to data/diff/ — read one with 'riff < data/diff/<rule-id>.diff'.`));
}
