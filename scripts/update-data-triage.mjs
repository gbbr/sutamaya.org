#!/usr/bin/env node
// Works (or authors) a term rule's segment list — see docs/retranslation.md's
// "Working the queue" and .claude/skills/retranslate/SKILL.md for the workflow this serves.
//
// No-args: one line per term rule (stale/untriaged, or stale-denial counts, per its mode). One rule
// id: every queued case in full, with English, aligned Pali, and role. Read-only, with one opt-in
// exception: `-- <rule-id> --prune` deletes that rule's stale entries from its sidecar (see
// pruneStale). Everything else is still a hand edit — this command tells you what to add — and
// npm run update-data:accept is what re-baselines counts.
import fs from 'node:fs';
import path from 'node:path';
import { walkJsonFiles, red, green, yellow, bold, blue, dim } from './lib/dataSync.js';
import { SUJATO_DIR, RULES_DIR, RETRANSLATION_PATH, loadRules, isTermRule, scopeOf, loadSidecar, saveSidecar, formsMatch, paliTextFor, roleOf } from './lib/retranslation.js';

// Every segment id in `treeName`, with its current English text — read fresh from sujatoDir, not
// data/sujato.post, since triage is about the *source* wording a rule's forms would see, before
// any rule has touched it.
export function segmentsInTree(sujatoDir, treeName) {
  const subdir = treeName.slice('sujato/'.length); // 'sutta' | 'notes' | 'name' | 'blurb'
  const dir = path.join(sujatoDir, subdir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const fullPath of walkJsonFiles(dir)) {
    const relPath = 'sujato/' + path.relative(sujatoDir, fullPath).split(path.sep).join('/');
    const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    for (const [segmentId, value] of Object.entries(obj)) {
      if (typeof value === 'string') out.push({ segmentId, value, relPath });
    }
  }
  return out;
}

// One rule's full triage state: which segments are stale, which are untriaged (closed) or
// active-but-undenied (open, informational — see the comment on that below).
//
// `segmentsFor(treeName)` supplies the text to judge against, rather than a directory, so the same
// logic can be resolved against something other than data/sujato: update-data-check.mjs runs it
// over the *upstream* checkout it has already parsed, which is what lets a stale entry surface
// before the copy rather than only after (see its staleTriageIssues).
export function triageRule(rule, sidecar, segmentsFor) {
  // segmentId -> { segmentId, value, relPath, matched } — every segment in scope, one entry per id.
  // sujato/notes reuses the sutta text's own segment ids, so one id can name two different strings
  // in two trees while allow/deny can only say one thing about it. The entry kept for display is
  // the first tree walked (sutta, which has aligned Pali to show) unless it's a later tree that
  // actually carries the term — and "contains a form" means any tree does, so a note that doesn't
  // quote the term isn't reported as its sutta segment having lost it.
  const bySegmentId = new Map();
  for (const treeName of scopeOf(rule)) {
    for (const seg of segmentsFor(treeName)) {
      const matched = formsMatch(rule, seg.value);
      const prev = bySegmentId.get(seg.segmentId);
      if (!prev || (matched && !prev.matched)) bySegmentId.set(seg.segmentId, { ...seg, matched });
    }
  }
  const matched = [...bySegmentId.values()].filter((seg) => seg.matched);
  const matchedIds = new Set(matched.map((s) => s.segmentId));

  // A listed id's current segment, or a placeholder noting it's gone missing entirely (upstream
  // removed the segment) — distinct from merely no longer containing the term.
  const resolve = (id) => bySegmentId.get(id) ?? { segmentId: id, value: '', relPath: '', missing: true };

  if (rule.mode === 'allow') {
    const stale = sidecar.allow.filter((id) => !matchedIds.has(id)).map(resolve);
    const untriaged = matched.filter((seg) => !sidecar.allow.includes(seg.segmentId) && !(seg.segmentId in sidecar.deny));
    return { mode: 'allow', stale, untriaged, matchedCount: matched.length };
  }

  // Open (deny) mode. "Stale denial": a deny entry whose reason no longer holds — the source text
  // no longer contains the term at all, so excluding it does nothing. That is the entire queue:
  // with no persisted record of which segments were already reviewed under an open rule (only the
  // exclusions are tracked), "newly covered" can't be computed per-segment the way a closed rule's
  // `untriaged` can. Aggregate drift across refreshes is what retranslation.counts.json (written by
  // update-data:accept) tracks instead.
  const staleDenials = Object.keys(sidecar.deny).filter((id) => !matchedIds.has(id)).map(resolve);
  return { mode: 'deny', staleDenials, matchedCount: matched.length };
}

// Deletes a rule's stale entries from its sidecar — the only part of a queue that needs no
// judgement: a stale entry names a segment that no longer contains any of the rule's forms, so
// allowing or denying it does nothing either way, and the decision it recorded has no subject left.
// An upstream reword can kill dozens at once (one refresh left 74 of 88 dead), which is more than
// anyone should delete by hand.
//
// Explicit --prune only, never a side effect of looking: triage is otherwise read-only, and the
// untriaged queue — the half that does need judgement — is deliberately left untouched. The result
// is an ordinary git diff on the sidecar, reviewed like any other change.
export function pruneStale(rule, sidecar, t, rulesDir = RULES_DIR) {
  const stale = (t.mode === 'allow' ? t.stale : t.staleDenials).map((seg) => seg.segmentId);
  if (!stale.length) return { removed: [], sidecar };

  const staleSet = new Set(stale);
  const next =
    t.mode === 'allow'
      ? { ...sidecar, allow: sidecar.allow.filter((id) => !staleSet.has(id)) }
      : { ...sidecar, deny: Object.fromEntries(Object.entries(sidecar.deny).filter(([id]) => !staleSet.has(id))) };

  return { removed: stale, sidecar: saveSidecar(rule.id, next, rulesDir) };
}

function describeSegment(seg) {
  if (seg.missing) return { ...seg, role: undefined, pali: null };
  const role = seg.relPath.startsWith('sujato/sutta/') ? roleOf(seg.segmentId, seg.relPath) : undefined;
  const pali = seg.relPath.startsWith('sujato/sutta/') ? paliTextFor(seg.segmentId, seg.relPath) : null;
  return { ...seg, role: role ?? 'prose', pali };
}

function printSegmentList(entries, { limit } = {}) {
  const shown = limit ? entries.slice(0, limit) : entries;
  for (const raw of shown) {
    const seg = describeSegment(raw);
    if (seg.missing) {
      console.log(`  ${yellow(seg.segmentId)} ${dim('— segment no longer exists upstream')}`);
      continue;
    }
    console.log(`  ${yellow(seg.segmentId)} ${dim(`[${seg.role}]`)} ${dim(seg.relPath)}`);
    if (seg.pali) console.log(`    ${dim('PLI:')} ${seg.pali}`);
    console.log(`    ${dim('EN :')} ${seg.value.trim()}`);
  }
  if (limit && entries.length > limit) console.log(dim(`  … (${entries.length - limit} more)`));
}

async function main() {
  const args = process.argv.slice(2);
  const prune = args.includes('--prune');
  const ruleId = args.find((arg) => !arg.startsWith('--'));
  const rules = (await loadRules(RETRANSLATION_PATH)).filter(isTermRule);

  if (prune && !ruleId) {
    console.error(red('--prune needs a rule id: update-data:triage -- <rule-id> --prune'));
    return 1;
  }

  // Memoized so a whole-corpus walk happens once per tree rather than once per rule per tree.
  const cache = new Map();
  const segmentsFor = (treeName) => {
    if (!cache.has(treeName)) cache.set(treeName, segmentsInTree(SUJATO_DIR, treeName));
    return cache.get(treeName);
  };

  if (!ruleId) {
    console.log(bold('update-data:triage — every term rule\n'));
    let anyQueue = false;
    let anyStale = false;
    for (const rule of rules) {
      const sidecar = loadSidecar(rule.id, RULES_DIR);
      const t = triageRule(rule, sidecar, segmentsFor);
      if (t.mode === 'allow') {
        const queue = t.stale.length + t.untriaged.length;
        if (queue > 0) anyQueue = true;
        if (t.stale.length > 0) anyStale = true;
        const label = queue > 0 ? yellow(`${t.stale.length}/${sidecar.allow.length} stale, ${t.untriaged.length} untriaged`) : green('current');
        console.log(`${blue(rule.id)} ${dim(`(closed, ${sidecar.allow.length} allowed)`)}  ${label}`);
      } else {
        const label = t.staleDenials.length > 0 ? yellow(`${t.staleDenials.length}/${Object.keys(sidecar.deny).length} stale denial(s)`) : green('current');
        if (t.staleDenials.length > 0) anyQueue = anyStale = true;
        console.log(`${blue(rule.id)} ${dim(`(open, ${Object.keys(sidecar.deny).length} denied, ${t.matchedCount} active)`)}  ${label}`);
      }
    }
    console.log();
    console.log(
      anyQueue
        ? yellow(`Some rules have a non-empty queue — run ${blue('update-data:triage -- <rule-id>')} to work through one.`)
        : green('All rules current.'),
    );
    // The stale half of any queue is mechanical, so say so here rather than only inside a rule's
    // own listing — it's usually the bulk of the work after an upstream reword.
    if (anyStale) {
      console.log(dim(`Stale entries need no decision — clear a rule's with `) + blue(`update-data:triage -- <rule-id> --prune`) + dim('.'));
    }
    return anyQueue ? 1 : 0;
  }

  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    console.error(red(`No such term rule: ${ruleId}`));
    return 1;
  }
  const sidecar = loadSidecar(rule.id, RULES_DIR);
  const t = triageRule(rule, sidecar, segmentsFor);

  console.log(bold(`${rule.id}`) + dim(`  (${t.mode === 'allow' ? 'closed' : 'open'})`));

  if (prune) {
    const kind = t.mode === 'allow' ? 'allow' : 'deny';
    const listed = t.mode === 'allow' ? sidecar.allow.length : Object.keys(sidecar.deny).length;
    const { removed } = pruneStale(rule, sidecar, t, RULES_DIR);
    if (!removed.length) {
      console.log(green(`\nNothing to prune — no stale ${kind} entries.`));
      return 0;
    }
    console.log(bold(yellow(`\nDropped ${removed.length} stale ${kind} entr${removed.length === 1 ? 'y' : 'ies'}, ${listed - removed.length} remain:`)));
    console.log(dim(`  ${removed.join(', ')}`));
    console.log(dim(`\nReview it with ${blue(`git diff scripts/update-data/rules/${rule.id}.json`)}.`));
    return 0;
  }

  console.log(dim(rule.why));
  console.log();

  if (t.mode === 'allow') {
    if (t.stale.length) {
      console.log(bold(red(`Stale (${t.stale.length}/${sidecar.allow.length}) — allow-listed, no longer contains any form:`)));
      printSegmentList(t.stale);
      console.log(dim(`  No decision to make — drop all ${t.stale.length} with `) + blue(`update-data:triage -- ${rule.id} --prune`));
      console.log();
    }
    if (t.untriaged.length) {
      const withPredicate = rule.predicate ? t.untriaged.filter((s) => rule.predicate.test(paliTextFor(s.segmentId, s.relPath) ?? '')) : t.untriaged;
      const withoutPredicate = rule.predicate ? t.untriaged.filter((s) => !withPredicate.includes(s)) : [];
      console.log(bold(yellow(`Untriaged (${t.untriaged.length}) — contains a form, on neither list:`)));
      if (rule.predicate) {
        console.log(dim(`  predicate matches (${withPredicate.length}) — likely allow:`));
        printSegmentList(withPredicate, { limit: 200 });
        console.log(dim(`  predicate doesn't match (${withoutPredicate.length}) — check before deciding:`));
        printSegmentList(withoutPredicate, { limit: 200 });
      } else {
        printSegmentList(t.untriaged, { limit: 200 });
      }
      console.log();
    }
    if (!t.stale.length && !t.untriaged.length) console.log(green('Queue empty — rule is current.'));
    console.log(dim(`\nEdit scripts/update-data/rules/${rule.id}.json directly: add each segment id to "allow" or to "deny" with a reason.`));
  } else {
    if (t.staleDenials.length) {
      console.log(bold(red(`Stale denials (${t.staleDenials.length}/${Object.keys(sidecar.deny).length}) — denied, no longer contains any form:`)));
      printSegmentList(t.staleDenials);
      console.log(dim(`  No decision to make — drop all ${t.staleDenials.length} with `) + blue(`update-data:triage -- ${rule.id} --prune`));
      console.log();
    } else {
      console.log(green('No stale denials.'));
    }
    console.log(
      dim(`\n${t.matchedCount} segment(s) currently match this rule. Drift in that number across refreshes is tracked in scripts/update-data/retranslation.counts.json.`),
    );
  }

  return t.mode === 'allow' ? (t.stale.length || t.untriaged.length ? 1 : 0) : t.staleDenials.length ? 1 : 0;
}

// Guarded like the other update-data-*.mjs entry points, so importing triageRule from here (which
// update-data-check.mjs does) doesn't run the CLI and exit the process.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
