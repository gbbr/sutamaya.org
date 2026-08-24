#!/usr/bin/env node
// Verifies a checked-out sc-data repo (SC_DATA_PATH) is safe to copy from before
// update-data-copy.mjs overwrites data/{sujato,pali,html} with it: every file we currently track
// must still exist at its expected path (see CATEGORY_SOURCE_PREFIXES in lib/dataSync.js), with
// the same set of segment ids it had when scripts/update-data/snapshot.json was taken — only the
// translated/structural values, and the blank English-side additions isInertPadding accepts, are
// allowed to differ. It also cross-checks that a
// sutta's Pali root text, Bhikkhu Sujato translation, and HTML structure stay aligned with each other
// (pali/html exactly, sujato as a subset of pali — see INTEGRITY_GROUPS in lib/dataSync.js), both
// upstream and against the local data/{sujato,pali,html} trees — the local pass is what catches a
// snapshot taken from an already-misaligned local state, which would otherwise pass every other
// check here. See data/README.md.
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
import { RULES_DIR, RETRANSLATION_PATH, loadRules, loadSidecar, isTermRule, isSegmentRule, segmentsOf, scopeOf, formsMatch, applyTermRules, buildSegmentIndex, uidOf } from './lib/retranslation.js';
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

// Upstream periodically pads its English files out to the root text's full segment id set, adding
// blank entries in bulk — one refresh brought 87k of them across 5030 files. Such an addition
// cannot change what the app ships: build-corpus orders a sutta's segments by the *Pali* keys and
// drops any segment empty on both sides (see buildBodySegments), so a blank English entry against
// a segment the Pali already carried produces byte-identical output. Reported as one summary line
// rather than 5030 findings, since burying the ones that need a human is the greater risk.
//
// Deliberately narrow — everything else stays a hard failure, because it moves segment indices and
// so silently invalidates stored highlight offsets (`(i, s, e)`, see docs/offline-sync.md):
// a removal, an addition carrying text, and any addition under pali/ or html/, which is where
// segment order is actually decided. Cross-category integrity still runs over these files
// regardless, so padding that has no Pali counterpart at all fails there instead.
function isInertPadding(relPath, { removed, added }, upstream) {
  if (!relPath.startsWith('sujato/')) return false;
  if (removed.length) return false;
  return added.every((key) => typeof upstream[key] === 'string' && upstream[key].trim() === '');
}

// Splits into words, each keeping its own trailing whitespace, so joining the pieces back is
// lossless and a token boundary is always a word boundary.
function tokenizeWords(text) {
  return text.match(/\S+\s*/g) ?? [];
}

// Paints `text` for display beside `reference`: the words the two share at the head and tail are
// dimmed and the span between them is coloured. These lines are long sentences usually differing in
// a single word, and dimming everything but that word is what makes the difference findable without
// reading both end to end. Purely a common prefix/suffix trim — not a real diff — which is exact for
// the substitution and reword cases that break an anchor, and degrades to "the whole middle is
// highlighted" for anything larger. Colour rather than an underline caret because these lines wrap
// in a terminal, and a caret on a separate line lands under the wrong words once they do.
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

// ruleId -> the distinct '"was" → "now"' rewrites it made, read off the locked chunks
// applyTermRules hands back (each carries the rule that produced it and the text it replaced).
function rewritesByRule(chunks) {
  const byRule = new Map();
  for (const chunk of chunks) {
    if (!chunk.locked || !chunk.ruleId) continue;
    if (!byRule.has(chunk.ruleId)) byRule.set(chunk.ruleId, new Set());
    byRule.get(chunk.ruleId).add(`"${chunk.original}" → "${chunk.text}"`);
  }
  return byRule;
}

// A broken segment override, laid out as the derivation that produced the mismatch, top to bottom:
// upstream's raw line, what the term rules did to it, and only then the expected/found pair that
// had to be identical and wasn't. Reading downward answers the question the bare four-way dump this
// replaced left to the reader — which pair was the actual comparison (the rule's `from` against the
// term rules' output, never against raw upstream), and where a word in `found` that appears nowhere
// upstream came from.
function describeAnchorBreak({ rule, segment, upstreamNow, anchorNow, chunks, relatedStale }) {
  const lines = [
    `${bold(rule.id)} · ${segment}`,
    `  Upstream changed the line this override is pinned to, so it no longer anchors.`,
    ``,
  ];

  const removedUpstream = typeof anchorNow !== 'string';
  if (removedUpstream) {
    lines.push(`      expected  ${dim(rule.from)}`, `      found     ${red('(segment removed upstream)')}`);
  } else {
    // Only when a term rule actually rewrote the line — otherwise `found` is upstream verbatim and
    // showing it twice says nothing.
    if (anchorNow !== upstreamNow) {
      lines.push(`      upstream  ${dim(upstreamNow)}`);
      for (const [ruleId, edits] of rewritesByRule(chunks)) lines.push(`        ↪ ${ruleId}  ${[...edits].join(', ')}`);
    }
    lines.push(`      expected  ${highlightAgainst(anchorNow, rule.from, red)}`, `      found     ${highlightAgainst(rule.from, anchorNow, green)}`);
  }

  // The override's whole purpose, and what deciding between re-anchoring it and deleting it turns
  // on: seeing that upstream now says by itself what the override was written to say makes it
  // obvious the rule is obsolete rather than merely drifted. Diffed against `found` (what ships
  // while the rule is broken) rather than against the dead anchor, so the coloured words are
  // exactly what re-anchoring it would still change.
  lines.push(``, `  Would write:`, `      ${highlightAgainst(removedUpstream ? rule.from : anchorNow, rule.to, yellow)}`);

  // Term-rule exclusions on the same sutta that upstream has also invalidated. Nearly always the
  // same upstream edit as the one that broke this anchor — an override and its rule's deny entries
  // are usually written together, in one pass over one passage — so removing the override without
  // them leaves the dead half behind. The per-rule triage summary counts them but never names one.
  if (relatedStale?.length) {
    const MAX = 10;
    const byRule = new Map();
    for (const { ruleId, segmentId, kind } of relatedStale) {
      if (!byRule.has(ruleId)) byRule.set(ruleId, { kind, ids: [] });
      byRule.get(ruleId).ids.push(segmentId);
    }
    lines.push(``, `  Dead on this sutta too — ${kindsOf(byRule)} entries that no longer match upstream:`);
    for (const [ruleId, { kind, ids }] of byRule) {
      const shown = ids.slice(0, MAX).join(', ') + (ids.length > MAX ? `, … (${ids.length} total)` : '');
      lines.push(`      ${ruleId}  ${dim(`(${kind})`)}  ${yellow(shown)}`);
    }
  }

  return lines.join('\n');
}

function kindsOf(byRule) {
  const kinds = new Set([...byRule.values()].map((v) => v.kind));
  return [...kinds].join('/');
}

// Term rules whose reviewed allow/deny entries upstream has since invalidated — a denied segment
// that no longer contains the term (so the exclusion does nothing), or an allow-listed one that
// doesn't either. Same computation update-data:triage does, resolved against the upstream checkout
// rather than data/sujato, which is the whole point of doing it here: triage reads the local tree,
// so it can only see this *after* update-data:copy has landed the new text, and it runs last in the
// `npm run update-data` chain behind a `|| true`. Dead entries would otherwise sit in a sidecar
// unnoticed.
//
// Reported one line per rule, not per segment — 77 stale entries in one rule is a realistic refresh,
// and listing them here would bury everything else. The per-segment queue is triage's job, and the
// message says so.
//
// Informational, never a failure: nothing about a dead entry makes the copy unsafe, and it can only
// actually be worked after the copy. Matches data/README.md's "a non-empty queue doesn't fail the
// run". Untriaged/newly-active segments are deliberately not reported — that's new work rather than
// an invalidated decision, and it runs to thousands of segments on a normal refresh.
function checkStaleTriage(rules, sujatoUpstreamByRelPath, rulesDir) {
  // treeName -> [{ segmentId, value, relPath }], built once and shared by every rule, from the
  // upstream content the caller has already parsed (no second read of the checkout).
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
  // uid -> [{ ruleId, segmentId }], so a broken override can name the dead entries sitting on the
  // same sutta (see describeAnchorBreak) — they are almost always the same upstream edit, and the
  // per-rule summary below never names an individual segment.
  const staleByUid = new Map();

  for (const rule of rules.filter(isTermRule)) {
    const sidecar = loadSidecar(rule.id, rulesDir);
    const t = triageRule(rule, sidecar, segmentsFor);
    const [stale, listed, kind] =
      t.mode === 'allow' ? [t.stale, sidecar.allow.length, 'allow'] : [t.staleDenials, Object.keys(sidecar.deny).length, 'deny'];
    if (!stale.length) continue;
    notes.push(
      `${bold(rule.id)}: ${stale.length} of ${listed} ${kind} entries no longer contain the term upstream.\n` +
        `    ${dim(`dead after the copy — drop them with`)} ${blue(`update-data:triage -- ${rule.id} --prune`)}`,
    );
    for (const seg of stale) {
      const uid = uidOf(seg.segmentId);
      if (!staleByUid.has(uid)) staleByUid.set(uid, []);
      staleByUid.get(uid).push({ ruleId: rule.id, segmentId: seg.segmentId, kind });
    }
  }
  return { notes, staleByUid };
}

// Every term rule that finds no match anywhere in `sujatoUpstreamByRelPath` (restricted to its own
// scope), and every segment rule whose `from` no longer anchors — resolved against upstream (via
// bilaraRoot), before anything is copied, so a broken rule surfaces at the same point a structural
// problem would rather than only after `update-data:post` runs against already-copied-in local data.
// Segment rules resolve their file via the *local* segment index (data/sujato is expected to still
// have every override's segment at its current relPath — a renamed/relocated file is what the
// structural upstreamIssues pass above already catches).
//
// An override's `from` is post-processed text, not upstream's own: overrides run last, over the term
// rules' output (see docs/retranslation.md's "Segment override"), so the term rules are applied to the
// upstream segment here before comparing. Comparing against raw upstream instead would fail every
// override whose line contains a term any rule rewrites, which is most of them — an override usually
// exists *because* a term rule got that line wrong.
function checkRuleAnchors(rules, sujatoUpstreamByRelPath, localSegmentIndex, rulesDir, staleByUid) {
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
    // Each named segment is checked on its own, so an override covering a repeated line reports the
    // one repeat that drifted rather than the whole rule.
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
        issues.push(
          describeAnchorBreak({
            rule,
            segment,
            upstreamNow,
            anchorNow,
            chunks: rewritten?.chunks ?? [],
            relatedStale: (staleByUid.get(uidOf(segment)) ?? []).filter((s) => s.segmentId !== segment),
          }),
        );
      }
    }
  }

  return issues;
}

// Core logic, callable directly with an explicit bilaraRoot/dataDirs/snapshotPath (tests use this
// to point at fixture trees instead of the real data/{sujato,pali,html} — see
// scripts/update-data.test.js). Returns a result object instead of printing/exiting so callers
// (the CLI entry point below, or a test) decide what to do with it.
export async function runCheck({ bilaraRoot, dataDirs = DATA_DIRS, snapshotPath = SNAPSHOT_PATH, rulesDir = RULES_DIR, retranslationPath = RETRANSLATION_PATH }) {
  const snapshot = loadSnapshot(snapshotPath);

  // Built lazily on the first missing file — a full-tree scan, so not worth doing unless
  // something has actually gone missing from its expected path.
  let basenameIndex = null;
  function possibleRelocations(relPath) {
    if (!basenameIndex) basenameIndex = buildBasenameIndex(bilaraRoot);
    return basenameIndex.get(path.basename(relPath)) || [];
  }

  // Independent of bilaraRoot entirely — verifies data/{sujato,pali,html} itself still matches
  // snapshot.json, catching a copy that got committed without a follow-up update-data:accept.
  // Kept separate from upstreamIssues below (rather than one merged list) since they're different
  // questions with different fixes: local drift means "run update-data:accept", an upstream
  // issue means "review what changed in SC_DATA_PATH".
  const localIssues = checkSnapshotInSync({ dataDirs, snapshotPath }).issues;
  const upstreamIssues = [];
  // category -> { files, segments } for the inert blank-segment additions isInertPadding waves
  // through. Accepted, not an issue — reported as one summary line so the refresh is still visible.
  const padding = new Map();
  let checked = 0;

  // Reused below for the upstream integrity cross-check, so every tracked file is only read once.
  const upstreamKeysByRelPath = new Map();
  // Full parsed content (not just keys), but only for sujato/* categories — pali/html have no
  // translatable prose, so rules never touch them and there's no reason to hold their content in
  // memory here. Feeds checkRuleAnchors below.
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

  // Cheap (a few hundred ms even over the full corpus) and catches something upstreamIssues/
  // localIssues together can't: a snapshot taken from an already cross-category-misaligned local
  // state, which matches itself and matches upstream just fine on a per-file basis.
  const localIntegrityIssues = checkCrossCategoryIntegrity(listLocalRelPaths(dataDirs), (relPath) => readKeysSafe(localPathFor(relPath, dataDirs)));

  // Independent of every check above — a retranslation rule can be perfectly fine structurally
  // (segment ids untouched, cross-category alignment intact) while still being dead or stale, so
  // this runs regardless of whether anything else failed. sujatoDir defaults from dataDirs.sujato
  // rather than importing SUJATO_DIR directly, so a fixture dataDirs override (tests) is honored.
  const rules = await loadRules(retranslationPath);
  const localSegmentIndex = buildSegmentIndex(dataDirs.sujato);
  // Before checkRuleAnchors, which folds each broken override's same-sutta stale entries into its
  // own block.
  const { notes: staleTriage, staleByUid } = checkStaleTriage(rules, sujatoUpstreamByRelPath, rulesDir);
  const ruleIssues = checkRuleAnchors(rules, sujatoUpstreamByRelPath, localSegmentIndex, rulesDir, staleByUid);

  // staleTriage is deliberately not folded in — see checkStaleTriage: it's reported, not failed on.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  let bilaraRoot;
  try {
    ({ bilaraRoot } = requireSourceRoot());
  } catch (err) {
    console.error(red(err.message));
    process.exit(1);
  }

  const result = await runCheck({ bilaraRoot });

  // Printed whether or not anything failed: accepted, but the one trace that upstream resegmented
  // at all, so it shouldn't vanish just because it needs no action.
  const paddingTotals = Object.values(result.padding).reduce(
    (acc, { files, segments }) => ({ files: acc.files + files, segments: acc.segments + segments }),
    { files: 0, segments: 0 },
  );
  function reportStaleTriage() {
    if (!result.staleTriage.length) return;
    console.error(bold(yellow(`\nRetranslation triage — upstream moved terms out from under reviewed decisions (${result.staleTriage.length}):`)));
    for (const note of result.staleTriage) console.error(`- ${note}`);
  }

  function reportPadding() {
    if (!paddingTotals.files) return;
    const n = (x) => x.toLocaleString('en-US');
    const breakdown = Object.entries(result.padding)
      .sort((a, b) => b[1].segments - a[1].segments)
      .map(([category, { segments }]) => `${category} ${n(segments)}`)
      .join(', ');
    console.error(
      dim(
        `\nAccepted — ${n(paddingTotals.segments)} blank segment ids added across ${n(paddingTotals.files)} files ` +
          `(${breakdown}). English side only, pali/html unchanged, so the built text is unaffected.`,
      ),
    );
  }

  if (!result.ok) {
    console.error(bold(red(`update-data check FAILED — ${result.issues.length} problem(s) found (${result.totalTracked} tracked files):`)));

    if (result.localIssues.length) {
      console.error(bold(red(`\nLocal drift — data/{sujato,pali,html} vs snapshot.json (${result.localIssues.length}):`)));
      console.error(red(`  did a previous update-data:copy forget to run update-data:accept afterward?`));
      for (const issue of result.localIssues) console.error(red(`- ${issue}`));

      if (fs.existsSync(MANIFEST_PATH)) {
        const { sourceCommit, snapshotCommit } = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        console.error(`\ndata/manifest.json:\n\tsourceCommit   = ${sourceCommit ?? '(none)'}\n\tsnapshotCommit = ${snapshotCommit ?? '(none)'}`);
      }
    }

    if (result.upstreamIssues.length) {
      console.error(bold(yellow(`\nUpstream changes — ${bilaraRoot} vs snapshot.json (${result.upstreamIssues.length}):`)));
      for (const issue of result.upstreamIssues) console.error(yellow(`- ${issue}`));
    }

    if (result.integrityIssues.length) {
      console.error(bold(yellow(`\nUpstream cross-category integrity — Pali/Bhikkhu Sujato/HTML segment ids don't line up (${result.integrityIssues.length}):`)));
      for (const issue of result.integrityIssues) console.error(yellow(`- ${issue}`));
    }

    if (result.localIntegrityIssues.length) {
      console.error(bold(red(`\nLocal cross-category integrity — data/{sujato,pali,html} segment ids don't line up (${result.localIntegrityIssues.length}):`)));
      for (const issue of result.localIntegrityIssues) console.error(red(`- ${issue}`));
    }

    if (result.ruleIssues.length) {
      console.error(bold(yellow(`\nRetranslation rules — broken against upstream (${result.ruleIssues.length}):`)));
      // Printed uncoloured: each issue paints its own spans (see describeAnchorBreak), and wrapping
      // the whole block in one colour would end it at the first inner reset, leaving the rest of a
      // multi-line issue a different colour than the lines above it.
      for (const issue of result.ruleIssues) console.error(`\n- ${issue}`);
      console.error(`\n  → docs/retranslation.md, "Reconciling an upstream change"`);
    }

    reportStaleTriage();
    reportPadding();

    console.error(
      `\nReview the files, copy them over using ${blue('update-data:copy')}, test the post-processing using ${blue('update-data:post')} ` +
        `(review the rewrites with ${blue('git diff data/diff/')}), work whatever ${blue('update-data:triage')} then queues up, and if all ` +
        `looks well regenerate the snapshot using ${blue('update-data:accept')}.`,
    );
    process.exit(1);
  }

  console.log(
    green(
      `update-data check OK — ${result.checked} tracked files verified against ${bilaraRoot}, cross-category segment ids consistent (upstream and local).`,
    ),
  );
  reportStaleTriage();
  reportPadding();
}
