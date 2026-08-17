#!/usr/bin/env node
// Works (or authors) a term rule's segment list — see scripts/update-data/retranslation.md's
// "Working the queue" and .claude/skills/retranslate/SKILL.md for the workflow this serves.
//
// No-args: one line per term rule (stale/untriaged, or stale-denial/active-footprint counts, per
// its mode). One rule id: every queued case in full, with English, aligned Pali, and role. Never
// writes anything — that's what `allow`/`deny` edits (this command tells you what to add) and
// npm run update-data:snapshot (which re-baselines counts) are for.
import fs from 'node:fs';
import path from 'node:path';
import { walkJsonFiles, red, green, yellow, bold, blue, dim } from './lib/dataSync.js';
import { SUJATO_DIR, RULES_DIR, RETRANSLATION_PATH, loadRules, isTermRule, scopeOf, loadSidecar, formsMatch, paliTextFor, roleOf } from './lib/retranslation.js';

// Every segment id in `treeName`, with its current English text — read fresh from sujatoDir, not
// data/sujato.post, since triage is about the *source* wording a rule's forms would see, before
// any rule has touched it.
function segmentsInTree(sujatoDir, treeName) {
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
function triageRule(rule, sidecar, sujatoDir) {
  const bySegmentId = new Map(); // segmentId -> { segmentId, value, relPath } — every segment in scope
  for (const treeName of scopeOf(rule)) {
    for (const seg of segmentsInTree(sujatoDir, treeName)) bySegmentId.set(seg.segmentId, seg);
  }
  const matched = [...bySegmentId.values()].filter((seg) => formsMatch(rule, seg.value));
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
  // no longer contains the term at all, so excluding it does nothing. There's no persisted
  // historical baseline of which segments were already reviewed under an open rule (only the
  // exclusions are tracked), so unlike a closed rule's `untriaged`, "newly covered" here can't be
  // computed per-segment — it's reported as the current active footprint (matched, not denied)
  // instead, an informational preview rather than an actionable queue. Aggregate drift across
  // refreshes is what retranslation.counts.json (written by update-data:snapshot) is for instead.
  const staleDenials = Object.keys(sidecar.deny).filter((id) => !matchedIds.has(id)).map(resolve);
  const active = matched.filter((seg) => !(seg.segmentId in sidecar.deny));
  return { mode: 'deny', staleDenials, active, matchedCount: matched.length };
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
  const ruleId = process.argv[2];
  const rules = (await loadRules(RETRANSLATION_PATH)).filter(isTermRule);

  if (!ruleId) {
    console.log(bold('update-data:triage — every term rule\n'));
    let anyQueue = false;
    for (const rule of rules) {
      const sidecar = loadSidecar(rule.id, RULES_DIR);
      const t = triageRule(rule, sidecar, SUJATO_DIR);
      if (t.mode === 'allow') {
        const queue = t.stale.length + t.untriaged.length;
        if (queue > 0) anyQueue = true;
        const label = queue > 0 ? yellow(`${t.stale.length} stale, ${t.untriaged.length} untriaged`) : green('current');
        console.log(`${blue(rule.id)} ${dim(`(closed, ${sidecar.allow.length} allowed)`)}  ${label}`);
      } else {
        const label = t.staleDenials.length > 0 ? yellow(`${t.staleDenials.length} stale denial(s)`) : green('current');
        if (t.staleDenials.length > 0) anyQueue = true;
        console.log(`${blue(rule.id)} ${dim(`(open, ${Object.keys(sidecar.deny).length} denied, ${t.matchedCount} active)`)}  ${label}`);
      }
    }
    console.log();
    console.log(
      anyQueue
        ? yellow(`Some rules have a non-empty queue — run ${blue('update-data:triage -- <rule-id>')} to work through one.`)
        : green('All rules current.'),
    );
    return anyQueue ? 1 : 0;
  }

  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    console.error(red(`No such term rule: ${ruleId}`));
    return 1;
  }
  const sidecar = loadSidecar(rule.id, RULES_DIR);
  const t = triageRule(rule, sidecar, SUJATO_DIR);

  console.log(bold(`${rule.id}`) + dim(`  (${t.mode === 'allow' ? 'closed' : 'open'})`));
  console.log(dim(rule.why));
  console.log();

  if (t.mode === 'allow') {
    if (t.stale.length) {
      console.log(bold(red(`Stale (${t.stale.length}) — allow-listed, no longer contains any form:`)));
      printSegmentList(t.stale);
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
      console.log(bold(red(`Stale denials (${t.staleDenials.length}) — denied, no longer contains any form:`)));
      printSegmentList(t.staleDenials);
      console.log();
    } else {
      console.log(green('No stale denials.'));
    }
    console.log(dim(`\nActive footprint (${t.active.length} segment(s) currently rewritten, not denied) — informational preview, not an action queue:`));
    printSegmentList(t.active, { limit: 15 });
    console.log(dim(`\nAggregate drift across refreshes is tracked in scripts/update-data/retranslation.counts.json instead.`));
  }

  return t.mode === 'allow' ? (t.stale.length || t.untriaged.length ? 1 : 0) : t.staleDenials.length ? 1 : 0;
}

const code = await main();
process.exit(code);
