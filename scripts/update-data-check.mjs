#!/usr/bin/env node
// Verifies a checked-out sc-data repo (SC_DATA_PATH) is safe to copy from, before
// update-data-copy.mjs overwrites data/{sujato,pali,html} with it. Four passes:
//   structure  – every tracked file still at its expected path, with the segment ids
//                scripts/update-data/snapshot.json recorded (bar the blank English-side additions
//                isInertPadding accepts)
//   integrity  – a sutta's Pali, Sujato and HTML stay aligned (see INTEGRITY_GROUPS)
//   local      – the same two checks over data/{sujato,pali,html}, catching a snapshot taken from
//                an already-misaligned tree
//   rules      – every term rule still matches, every override and blurb opener still anchors
// See data/README.md.
import fs from 'node:fs';
import path from 'node:path';
import {
  requireSourceRoot,
  sourcePathFor,
  localPathFor,
  buildBasenameIndex,
  loadSnapshot,
  keysHash,
  checkSnapshotInSync,
  checkCrossCategoryIntegrity,
  listLocalRelPaths,
  readKeysSafe,
  DATA_DIRS,
  SNAPSHOT_PATH,
  MANIFEST_PATH,
  red,
  green,
  yellow,
  bold,
  blue,
  dim,
} from './lib/dataSync.js';
import { RULES_DIR, RETRANSLATION_PATH, loadRules, loadSidecar, isTermRule, isSegmentRule, isBlurbRule, segmentsOf, scopeOf, formsMatch, applyTermRules, buildSegmentIndex, buildBlurbIndex } from './lib/retranslation.js';
import { triageRule } from './update-data-triage.mjs';

function diffKeys(oldKeys, newKeys) {
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);
  return {
    removed: oldKeys.filter((k) => !newSet.has(k)),
    added: newKeys.filter((k) => !oldSet.has(k)),
  };
}

function describeSetDiff({ removed, added }) {
  const MAX = 10;
  const fmt = (arr) => arr.slice(0, MAX).join(', ') + (arr.length > MAX ? `, … (${arr.length} total)` : '');
  const parts = [];
  if (removed.length) parts.push(`missing segment ids: ${fmt(removed)}`);
  if (added.length) parts.push(`new segment ids: ${fmt(added)}`);
  return parts.join('; ');
}

// Whether a file's segment-id change is upstream padding its English out to the root text's id
// set — an English-side addition, every added value blank. Such an addition cannot change what the
// app ships, since build-corpus orders by the Pali keys and drops segments empty on both sides.
// Everything else stays a hard failure: a removal, an addition carrying text, and any addition
// under pali/ or html/, where segment order is decided.
function isInertPadding(relPath, { removed, added }, upstream) {
  if (!relPath.startsWith('sujato/')) return false;
  if (removed.length) return false;
  return added.every((key) => typeof upstream[key] === 'string' && upstream[key].trim() === '');
}

// Splits `text` into words, each keeping its trailing whitespace, so rejoining is lossless.
function tokenizeWords(text) {
  return text.match(/\S+\s*/g) ?? [];
}

// Returns `text` painted for display beside `reference`: the words the two share at head and tail
// dimmed, the span between them in `color`. A common prefix/suffix trim rather than a real diff, so
// anything larger than a substitution or reword highlights the whole middle.
function highlightAgainst(reference, text, color) {
  const a = tokenizeWords(reference);
  const b = tokenizeWords(text);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const shared = (slice) => (slice.length ? dim(slice.join('')) : '');
  const middle = b.slice(head, b.length - tail);
  return shared(b.slice(0, head)) + (middle.length ? color(middle.join('')) : '') + shared(b.slice(b.length - tail));
}

// Returns ruleId -> the distinct '"was" → "now"' rewrites it made, read off applyTermRules' chunks.
function rewritesByRule(chunks) {
  const byRule = new Map();
  for (const chunk of chunks) {
    if (!chunk.locked || !chunk.ruleId) continue;
    if (!byRule.has(chunk.ruleId)) byRule.set(chunk.ruleId, new Set());
    byRule.get(chunk.ruleId).add(`"${chunk.original}" → "${chunk.text}"`);
  }
  return byRule;
}

// Renders a broken segment override as the derivation that produced the mismatch, top to bottom:
// upstream's raw line, what the term rules made of it, then the expected/found pair that had to be
// identical — the rule's `from` against the term rules' output, never against raw upstream.
function describeAnchorBreak({ rule, segment, upstreamNow, anchorNow, chunks }) {
  const lines = [
    `${bold(rule.id)} · ${segment}`,
    `  Upstream changed the line this override is pinned to, so it no longer anchors.`,
    ``,
  ];

  const removedUpstream = typeof anchorNow !== 'string';
  if (removedUpstream) {
    lines.push(`      expected  ${dim(rule.from)}`, `      found     ${red('(segment removed upstream)')}`);
  } else {
    // Shown only when a term rule rewrote the line; otherwise `found` is upstream verbatim.
    if (anchorNow !== upstreamNow) {
      lines.push(`      upstream  ${dim(upstreamNow)}`);
      for (const [ruleId, edits] of rewritesByRule(chunks)) lines.push(`        ↪ ${ruleId}  ${[...edits].join(', ')}`);
    }
    lines.push(`      expected  ${highlightAgainst(anchorNow, rule.from, red)}`, `      found     ${highlightAgainst(rule.from, anchorNow, green)}`);
  }

  // What the override would still write, coloured against `found` — what ships while it is broken —
  // so the highlighted words are what re-anchoring it would change.
  lines.push(``, `  Would write:`, `      ${highlightAgainst(removedUpstream ? rule.from : anchorNow, rule.to, yellow)}`);

  return lines.join('\n');
}

// Returns one note per term rule whose reviewed allow/deny entries upstream has invalidated — a
// listed segment that no longer contains the term. The same computation update-data triage does,
// resolved against the upstream checkout, which triage cannot see until after the copy.
// Informational, never a failure: a dead entry doesn't make the copy unsafe, and it can only be
// worked afterwards. Newly-active segments are triage's queue, not an invalidated decision.
function checkStaleTriage(rules, sujatoUpstreamByRelPath, rulesDir) {
  // treeName -> [{ segmentId, value, relPath }], built once from content the caller already parsed.
  const cache = new Map();
  const segmentsFor = (treeName) => {
    if (!cache.has(treeName)) {
      const out = [];
      for (const [relPath, obj] of sujatoUpstreamByRelPath) {
        if (relPath.split('/').slice(0, 2).join('/') !== treeName) continue;
        for (const [segmentId, value] of Object.entries(obj)) {
          if (typeof value === 'string') out.push({ segmentId, value, relPath });
        }
      }
      cache.set(treeName, out);
    }
    return cache.get(treeName);
  };

  const notes = [];
  for (const rule of rules.filter(isTermRule)) {
    const sidecar = loadSidecar(rule.id, rulesDir);
    const t = triageRule(rule, sidecar, segmentsFor);
    const [stale, listed, kind] =
      t.mode === 'allow' ? [t.stale, sidecar.allow.length, 'allow'] : [t.staleDenials, Object.keys(sidecar.deny).length, 'deny'];
    if (!stale.length) continue;
    notes.push(
      `${bold(rule.id)}: ${stale.length} of ${listed} ${kind} entries no longer contain the term upstream.\n` +
        `    ${dim(`dead after the copy — drop them with`)} ${blue(`update-data triage ${rule.id} prune`)}`,
    );
  }
  return notes;
}

// Returns a finding for every term rule that matches nowhere upstream, and every segment rule or
// blurb opener whose `from` no longer anchors — all resolved against upstream, before anything is
// copied. Each override's file comes from the *local* index; a relocated file is upstreamIssues'
// business. An override's `from` is post-processed text, so the term rules are applied to the
// upstream segment before comparing (see docs/retranslation.md's "Segment override").
function checkRuleAnchors(rules, sujatoUpstreamByRelPath, localSegmentIndex, localBlurbIndex, rulesDir) {
  const issues = [];
  const sidecars = new Map(rules.filter(isTermRule).map((rule) => [rule.id, loadSidecar(rule.id, rulesDir)]));

  for (const rule of rules.filter(isTermRule)) {
    const scope = new Set(scopeOf(rule));
    let matched = false;
    for (const [relPath, obj] of sujatoUpstreamByRelPath) {
      if (!scope.has(relPath.split('/').slice(0, 2).join('/'))) continue;
      for (const value of Object.values(obj)) {
        if (typeof value === 'string' && formsMatch(rule, value)) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) issues.push(yellow(`${bold(rule.id)}: matches nowhere upstream — the term may be gone. Dead rule, not just drifted.`));
  }

  for (const rule of rules.filter(isSegmentRule)) {
    // Checked one segment at a time, so an override covering a repeated line reports the repeat
    // that drifted rather than the whole rule.
    for (const segment of segmentsOf(rule)) {
      const relPath = localSegmentIndex.get(segment);
      if (!relPath) {
        issues.push(yellow(`${bold(rule.id)} · ${segment}: segment not found in local data/sujato — can't verify against upstream.`));
        continue;
      }
      const upstreamObj = sujatoUpstreamByRelPath.get(relPath);
      if (!upstreamObj) continue; // relPath wasn't read this run (not in snapshot.files) — nothing to compare
      const upstreamNow = upstreamObj[segment];
      const rewritten =
        typeof upstreamNow === 'string'
          ? applyTermRules(upstreamNow, { treeName: 'sujato/sutta', segmentId: segment, rules, sidecars })
          : null;
      const anchorNow = rewritten ? rewritten.result : upstreamNow;
      if (anchorNow !== rule.from) {
        issues.push(describeAnchorBreak({ rule, segment, upstreamNow, anchorNow, chunks: rewritten?.chunks ?? [] }));
      }
    }
  }

  // A blurb opener anchors on a prefix, so a break is reported as the two openings side by side
  // rather than the whole paragraph.
  for (const rule of rules.filter(isBlurbRule)) {
    for (const opener of rule.openers) {
      const relPath = localBlurbIndex.get(opener.blurb);
      if (!relPath) {
        issues.push(yellow(`${bold(rule.id)} · ${opener.blurb}: blurb not found in local data/sujato — can't verify against upstream.`));
        continue;
      }
      const upstreamObj = sujatoUpstreamByRelPath.get(relPath);
      if (!upstreamObj) continue; // relPath wasn't read this run (not in snapshot.files) — nothing to compare
      const upstreamNow = upstreamObj[opener.blurb];
      const anchorNow =
        typeof upstreamNow === 'string'
          ? applyTermRules(upstreamNow, { treeName: 'sujato/blurb', segmentId: opener.blurb, rules, sidecars }).result
          : null;
      if (typeof anchorNow !== 'string') {
        issues.push([`${bold(rule.id)} · ${opener.blurb}`, `      expected  ${dim(opener.from)}`, `      found     ${red('(blurb removed upstream)')}`].join('\n'));
        continue;
      }
      if (anchorNow.startsWith(opener.from)) continue;
      issues.push(
        [
          `${bold(rule.id)} · ${opener.blurb}`,
          `  Upstream reworded the opening this rule trims, so it no longer anchors.`,
          ``,
          `      expected  ${dim(opener.from)}`,
          `      found     ${red(anchorNow.slice(0, Math.max(opener.from.length, 120)))}`,
        ].join('\n'),
      );
    }
  }

  return issues;
}

// Runs every pass and returns the findings, grouped, rather than printing or exiting. Every path is
// a parameter so a test can point it at fixture trees.
export async function runCheck({ bilaraRoot, dataDirs = DATA_DIRS, snapshotPath = SNAPSHOT_PATH, rulesDir = RULES_DIR, retranslationPath = RETRANSLATION_PATH }) {
  const snapshot = loadSnapshot(snapshotPath);

  // A full-tree scan, so built lazily on the first file missing from its expected path.
  let basenameIndex = null;
  function possibleRelocations(relPath) {
    if (!basenameIndex) basenameIndex = buildBasenameIndex(bilaraRoot);
    return basenameIndex.get(path.basename(relPath)) || [];
  }

  // Local drift from snapshot.json, independent of bilaraRoot. Kept apart from upstreamIssues
  // because the fix differs: local drift means "run update-data accept", an upstream issue means
  // "review what changed in SC_DATA_PATH".
  const localIssues = checkSnapshotInSync({ dataDirs, snapshotPath }).issues;
  const upstreamIssues = [];
  // category -> { files, segments } for the additions isInertPadding waves through.
  const padding = new Map();
  let checked = 0;

  // Every tracked file's keys, so the integrity cross-check below re-reads nothing.
  const upstreamKeysByRelPath = new Map();
  // Full parsed content, for sujato/* only — rules never touch pali/html. Feeds checkRuleAnchors.
  const sujatoUpstreamByRelPath = new Map();

  for (const [relPath, expected] of Object.entries(snapshot.files)) {
    const sourcePath = sourcePathFor(bilaraRoot, relPath);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const where = sourcePath ?? '(no known category)';
      const relocations = possibleRelocations(relPath);
      const hint = relocations.length > 0 ? ` — might have moved to: ${relocations.join(', ')}` : '';
      upstreamIssues.push(`${relPath}: expected at ${where}, not found${hint} (renamed or removed upstream?)`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    } catch (err) {
      upstreamIssues.push(`${relPath}: failed to parse ${sourcePath}: ${err.message}`);
      continue;
    }
    const keys = Object.keys(parsed);
    if (relPath.startsWith('sujato/')) sujatoUpstreamByRelPath.set(relPath, parsed);

    upstreamKeysByRelPath.set(relPath, keys);

    if (keys.length !== expected.keyCount || keysHash(keys) !== expected.keysHash) {
      const localPath = localPathFor(relPath, dataDirs);
      const oldKeys = fs.existsSync(localPath) ? Object.keys(JSON.parse(fs.readFileSync(localPath, 'utf8'))) : [];
      const diff = diffKeys(oldKeys, keys);
      if (isInertPadding(relPath, diff, parsed)) {
        const category = relPath.split('/').slice(0, 2).join('/');
        const tally = padding.get(category) ?? { files: 0, segments: 0 };
        padding.set(category, { files: tally.files + 1, segments: tally.segments + diff.added.length });
      } else {
        upstreamIssues.push(`${relPath}: segment ids changed (${oldKeys.length} → ${keys.length}) — ${describeSetDiff(diff)}`);
        continue;
      }
    }

    checked += 1;
  }

  const integrityIssues = checkCrossCategoryIntegrity(Object.keys(snapshot.files), (relPath) => upstreamKeysByRelPath.get(relPath) ?? null);

  // Catches what neither pass above can: a snapshot taken from an already-misaligned local tree,
  // which matches itself and upstream file by file.
  const localIntegrityIssues = checkCrossCategoryIntegrity(listLocalRelPaths(dataDirs), (relPath) => readKeysSafe(localPathFor(relPath, dataDirs)));

  // Run whatever the passes above found: a rule can be dead or stale while every segment id and
  // every alignment is intact.
  const rules = await loadRules(retranslationPath);
  const localSegmentIndex = buildSegmentIndex(dataDirs.sujato);
  const localBlurbIndex = buildBlurbIndex(dataDirs.sujato);
  const ruleIssues = checkRuleAnchors(rules, sujatoUpstreamByRelPath, localSegmentIndex, localBlurbIndex, rulesDir);
  const staleTriage = checkStaleTriage(rules, sujatoUpstreamByRelPath, rulesDir);

  // staleTriage is not folded in: it is reported, never failed on.
  const issues = [...localIssues, ...upstreamIssues, ...integrityIssues, ...localIntegrityIssues, ...ruleIssues];
  return {
    ok: issues.length === 0,
    issues,
    localIssues,
    upstreamIssues,
    integrityIssues,
    localIntegrityIssues,
    ruleIssues,
    staleTriage,
    padding: Object.fromEntries(padding),
    checked,
    totalTracked: Object.keys(snapshot.files).length,
  };
}
