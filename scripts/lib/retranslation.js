// Shared engine for the retranslation layer — scripts/update-data-post.mjs,
// scripts/update-data-triage.mjs, and scripts/update-data-check.mjs's rule-anchor pass all build
// on this. See scripts/update-data/retranslation.md for the design; this file is the mechanism.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_ROOT, PALI_DIR, HTML_DIR, walkJsonFiles } from './dataSync.js';
import { roleFor } from './collections.js';

export const SUJATO_DIR = path.join(DATA_ROOT, 'sujato');
export const SUJATO_POST_DIR = path.join(DATA_ROOT, 'sujato.post');
export const RETRANSLATION_PATH = path.join(ROOT, 'scripts', 'update-data', 'retranslation.mjs');
export const RULES_DIR = path.join(ROOT, 'scripts', 'update-data', 'rules');
export const COUNTS_PATH = path.join(ROOT, 'scripts', 'update-data', 'retranslation.counts.json');

// The four sujato trees a rule's `scope` can name — matches CATEGORY_SOURCE_PREFIXES's sujato/*
// entries in lib/dataSync.js. Defaulted to all four when a rule has no explicit `scope`.
export const SUJATO_TREES = ['sujato/sutta', 'sujato/notes', 'sujato/name', 'sujato/blurb'];

// Loads the rules array from retranslation.mjs, read as text and imported via a data: URL rather
// than `import('file://...')` — the file's own content decides freshness (no ESM module-cache
// staleness to fight, so no cache-busting query string needed either), and it's also what lets
// this work under Vitest at all: Vite's dev server restricts filesystem module loads to the
// project root by default, which a test's tmp-dir fixture rules file falls outside of; a data:
// URL never touches that allow-list. The one constraint this puts on retranslation.mjs itself: it
// must be self-contained (no imports of its own), since a data: URL has no base to resolve a
// relative specifier against — true today and expected to stay true (it's a plain array literal).
// Validates ids are unique and every id/kind combination is well-formed, since a bad id silently
// corrupts sidecar/count/diff filenames otherwise.
export async function loadRules(retranslationPath = RETRANSLATION_PATH) {
  const source = fs.readFileSync(retranslationPath, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const mod = await import(/* @vite-ignore */ url);
  const rules = mod.RULES ?? mod.default;
  if (!Array.isArray(rules)) {
    throw new Error(`${retranslationPath} must export RULES as an array.`);
  }
  const seen = new Set();
  for (const rule of rules) {
    if (!rule.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rule.id)) {
      throw new Error(`Rule has an invalid or missing id: ${JSON.stringify(rule.id)} (must be kebab-case).`);
    }
    if (seen.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
    if (!rule.why || typeof rule.why !== 'string') {
      throw new Error(`Rule "${rule.id}" has no "why" — every rule must state its reason (see retranslation.md).`);
    }
    if (rule.kind === 'segment') {
      if (segmentsOf(rule).length === 0 || !rule.from || typeof rule.to !== 'string') {
        throw new Error(`Segment rule "${rule.id}" needs segment (or segments), from, and to.`);
      }
      if (rule.segment && rule.segments) {
        throw new Error(`Segment rule "${rule.id}" sets both segment and segments — use one.`);
      }
    } else {
      if (!Array.isArray(rule.forms) || rule.forms.length === 0) {
        throw new Error(`Term rule "${rule.id}" needs a non-empty forms array.`);
      }
      if (rule.mode !== 'allow' && rule.mode !== 'deny') {
        throw new Error(`Term rule "${rule.id}" needs mode: 'allow' | 'deny'.`);
      }
    }
  }
  return rules;
}

export const isTermRule = (rule) => rule.kind !== 'segment';
export const isSegmentRule = (rule) => rule.kind === 'segment';

// The segments one override applies to. `segment: 'x'` and `segments: ['x', 'y']` are the same
// thing, one entry versus several — the plural is for a line the corpus repeats verbatim (a stock
// verse recurring across three Theragāthā poems, say), where one `from`/`to` is the whole decision
// and spelling it out per segment would be the same rule copied. Every named segment must still
// match `from` on its own, so a repeat that has since drifted breaks the anchor instead of being
// quietly skipped.
export function segmentsOf(rule) {
  if (rule.segments) return rule.segments;
  return rule.segment ? [rule.segment] : [];
}

// A term rule's own trees, defaulting to all four sujato/* categories.
export function scopeOf(rule) {
  return rule.scope && rule.scope.length ? rule.scope : SUJATO_TREES;
}

export function sidecarPath(ruleId, rulesDir = RULES_DIR) {
  return path.join(rulesDir, `${ruleId}.json`);
}

const emptySidecar = () => ({ reviewedAt: null, allow: [], deny: {} });

export function loadSidecar(ruleId, rulesDir = RULES_DIR) {
  const p = sidecarPath(ruleId, rulesDir);
  if (!fs.existsSync(p)) return emptySidecar();
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { reviewedAt: raw.reviewedAt ?? null, allow: raw.allow ?? [], deny: raw.deny ?? {} };
}

// Machine-written, deterministically sorted so a re-write's diff shows only the actual change —
// see retranslation.md's "Sidecars are machine-written and sorted".
export function saveSidecar(ruleId, sidecar, rulesDir = RULES_DIR) {
  fs.mkdirSync(rulesDir, { recursive: true });
  const sorted = {
    reviewedAt: sidecar.reviewedAt ?? new Date().toISOString().slice(0, 10),
    allow: [...new Set(sidecar.allow)].sort(),
    deny: Object.fromEntries(Object.entries(sidecar.deny).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  fs.writeFileSync(sidecarPath(ruleId, rulesDir), JSON.stringify(sorted, null, 2) + '\n');
  return sorted;
}

// Whether `rule` may touch `segmentId` at all — the allow/deny gate described in retranslation.md
// under "Closed or open". Independent of whether the rule's forms actually match the text there;
// callers combine this with a forms match to decide what to do.
export function isPermitted(rule, sidecar, segmentId) {
  if (rule.mode === 'allow') return sidecar.allow.includes(segmentId);
  return !(segmentId in sidecar.deny); // mode === 'deny'
}

// Longest-first so e.g. "situational awareness" is tried before "awareness" would otherwise
// shadow it — see retranslation.md's "forms" field.
export function sortedForms(rule) {
  return [...rule.forms].sort((a, b) => b[0].length - a[0].length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// One combined alternation regex for a rule's forms, longest-first so e.g. "situational
// awareness" is offered before "awareness" — JS regex alternation tries alternatives left to
// right at each position, so ordering the alternatives this way is what makes the longer phrase
// win when both could start at the same point.
function combinedFormsRegex(rule) {
  const forms = sortedForms(rule);
  const pattern = forms.map(([from]) => escapeRe(from)).join('|');
  return { re: new RegExp(`\\b(?:${pattern})\\b`, 'gi'), forms };
}

// Whether any of a rule's forms occur in `text` at all — independent of allow/deny permission.
// This is the membership test triage uses to find candidates and to detect staleness; it's
// deliberately the same word-boundary matching applyRuleToChunks uses, so "the form is present"
// means the same thing everywhere in this module.
export function formsMatch(rule, text) {
  const { re } = combinedFormsRegex(rule);
  re.lastIndex = 0;
  return re.test(text);
}

// The locked-chunk pass for one term rule against one segment's current chunk list — see
// retranslation.md's "The pass". A chunk is `{ text, locked }`; locked chunks are invisible to
// every rule (this one and all later ones), which is what makes same-segment rules order-safe
// (dn22:1.9's sampajañña/sati collision) while same-word collisions still resolve by array order.
export function applyRuleToChunks(chunks, rule) {
  let count = 0;
  const { re, forms } = combinedFormsRegex(rule);
  const replacementFor = (matchedText) => forms.find(([from]) => from.toLowerCase() === matchedText.toLowerCase())[1];
  const out = [];
  for (const chunk of chunks) {
    if (chunk.locked) {
      out.push(chunk);
      continue;
    }
    const text = chunk.text;
    let cursor = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > cursor) out.push({ text: text.slice(cursor, m.index), locked: false });
      const to = replacementFor(m[0]);
      const replacement = m[0][0] === m[0][0].toUpperCase() ? capitalize(to) : to;
      out.push({ text: replacement, locked: true, ruleId: rule.id, original: m[0] });
      count += 1;
      cursor = m.index + m[0].length;
      re.lastIndex = cursor; // avoid an infinite loop / overlap when a match is zero-width-adjacent
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), locked: false });
  }
  return { chunks: out, count };
}

export function chunksToString(chunks) {
  return chunks.map((c) => c.text).join('');
}

// Applies every term rule (in array order) to one segment's value, respecting each rule's
// scope/mode/sidecar permission. Returns the rewritten text and a Map<ruleId, matchCount> of only
// the rules that actually matched here (used by post to accumulate totals and by triage's stale
// check). `treeName` is one of SUJATO_TREES; `paliText` isn't consulted here — the predicate never
// runs at build time (see retranslation.md) — it's only used by triage/report tooling.
export function applyTermRules(value, { treeName, segmentId, rules, sidecars }) {
  let chunks = [{ text: value, locked: false }];
  const counts = new Map();
  for (const rule of rules) {
    if (!isTermRule(rule)) continue;
    if (!scopeOf(rule).includes(treeName)) continue;
    const sidecar = sidecars.get(rule.id) ?? emptySidecar();
    if (!isPermitted(rule, sidecar, segmentId)) continue;
    const { chunks: next, count } = applyRuleToChunks(chunks, rule);
    if (count > 0) counts.set(rule.id, count);
    chunks = next;
  }
  // `chunks` is returned alongside the joined string so a diff writer can isolate exactly which
  // span each rule touched (each locked chunk carries the ruleId that produced it and the
  // original matched text) without re-deriving that from a generic text diff — see
  // update-data-post.mjs's --diff writer.
  return { result: chunksToString(chunks), counts, chunks };
}

// Segment override rules run after all term rules, against their output — see retranslation.md.
// Returns { result, applied } where applied is false (with no change made) if `from` doesn't match
// verbatim, so callers can treat that as the anchor-broken case rather than silently no-op'ing.
export function applySegmentOverride(value, rule) {
  if (value !== rule.from) return { result: value, applied: false };
  return { result: rule.to, applied: true };
}

// segment id ("dn22:1.9", "an1.5:1.2") -> its uid, i.e. everything before the first ':'.
export function uidOf(segmentId) {
  return segmentId.slice(0, segmentId.indexOf(':'));
}

// Maps every segment id in sujato/sutta (only — see below) to the file it lives in, relative to
// DATA_ROOT (e.g. 'sujato/sutta/an/an1/an1.1-10_translation-en-sujato.json'). Built by walking
// every sutta file once — necessary because range-batched files key their segments by sub-uid,
// not by the batch uid the filename carries, so the file can't be derived from a segment id alone
// (see retranslation.md's "Segment ids resolve to files through a segment→file index"). Cheap
// (~4,000 files, a few hundred ms) and only needed for segment-override rules, so callers build it
// once per run rather than per rule.
//
// Deliberately sutta-only: sujato/notes is keyed by the *same* segment ids as the sutta text it
// annotates (a note on dn1:1.1 is filed under the key 'dn1:1.1', same as the segment itself), so a
// single id->file map spanning sutta+notes+name+blurb together would be ambiguous — whichever tree
// happened to be walked last for a given id would silently win. A segment override therefore
// targets the main translation only; retargeting a note or blurb isn't something this resolves.
//
// relPath keys throughout this function (and this whole module) are logical, in the same
// 'sujato/sutta/dn/dn1_translation-en-sujato.json' shape lib/dataSync.js's own relPath/localPathFor
// use — not literal filesystem-relative paths from some shared root. That's what lets a fixture
// sujatoDir (unrelated to a real DATA_ROOT) still produce paths paliTextFor/localPathFor can
// resolve.
export function buildSegmentIndex(sujatoDir = SUJATO_DIR) {
  const index = new Map();
  const suttaDir = path.join(sujatoDir, 'sutta');
  if (!fs.existsSync(suttaDir)) return index;
  for (const fullPath of walkJsonFiles(suttaDir)) {
    const relPath = 'sujato/sutta/' + path.relative(suttaDir, fullPath).split(path.sep).join('/');
    const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    for (const key of Object.keys(obj)) index.set(key, relPath);
  }
  return index;
}

// The Pali root text segment aligned with a given sujato/sutta segment id — used only by
// triage/report/diff tooling (never at build time; see the predicate note above). Sujato's
// sutta/notes files share their relative path (minus filename suffix) with pali/sutta, so this is
// a pure path transform, not a lookup through buildSegmentIndex.
export function paliCounterpartPath(sujatoSuttaRelPath) {
  if (!sujatoSuttaRelPath.startsWith('sujato/sutta/')) return null;
  return sujatoSuttaRelPath.replace(/^sujato\/sutta\//, 'pali/sutta/').replace(/_translation-en-sujato\.json$/, '_root-pli-ms.json');
}

const paliMapCache = new Map();
export function paliTextFor(segmentId, sujatoSuttaRelPath, paliDir = PALI_DIR) {
  const paliRel = paliCounterpartPath(sujatoSuttaRelPath); // 'pali/sutta/...'
  if (!paliRel) return null;
  const paliPath = path.join(paliDir, paliRel.slice('pali/'.length));
  if (!paliMapCache.has(paliPath)) {
    paliMapCache.set(paliPath, fs.existsSync(paliPath) ? JSON.parse(fs.readFileSync(paliPath, 'utf8')) : {});
  }
  return paliMapCache.get(paliPath)[segmentId] ?? null;
}

// SuttaCentral's structural HTML template for the same segment (see lib/collections.js's roleFor)
// — used only to classify a segment's role (prose/verse/heading/…) for triage's role partition.
// 'html/pli/ms/sutta/...' mirrors 'pali/sutta/...' 1:1 (see CATEGORY_SOURCE_PREFIXES), so this is
// the same path transform as paliCounterpartPath, one level further.
function htmlCounterpartPath(sujatoSuttaRelPath) {
  const paliRel = paliCounterpartPath(sujatoSuttaRelPath);
  if (!paliRel) return null;
  return paliRel.replace(/^pali\/sutta\//, 'html/pli/ms/sutta/').replace(/_root-pli-ms\.json$/, '_html.json');
}

const htmlMapCache = new Map();
export function roleOf(segmentId, sujatoSuttaRelPath, htmlDir = HTML_DIR) {
  const htmlRel = htmlCounterpartPath(sujatoSuttaRelPath); // 'html/pli/ms/sutta/...'
  if (!htmlRel) return undefined;
  const htmlPath = path.join(htmlDir, htmlRel.slice('html/'.length));
  if (!htmlMapCache.has(htmlPath)) {
    htmlMapCache.set(htmlPath, fs.existsSync(htmlPath) ? JSON.parse(fs.readFileSync(htmlPath, 'utf8')) : {});
  }
  return roleFor(htmlMapCache.get(htmlPath)[segmentId])?.role;
}
