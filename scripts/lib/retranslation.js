// Shared engine for the retranslation layer — scripts/update-data-post.mjs,
// scripts/update-data-triage.mjs, and scripts/update-data-check.mjs's rule-anchor pass all build
// on this. See docs/retranslation.md for the design; this file is the mechanism.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_ROOT, PALI_DIR, HTML_DIR, walkJsonFiles } from './dataSync.js';
import { roleFor } from './collections.js';

export const SUJATO_DIR = path.join(DATA_ROOT, 'sujato');
export const SUJATO_POST_DIR = path.join(DATA_ROOT, 'sujato.post');
export const RETRANSLATION_PATH = path.join(ROOT, 'scripts', 'update-data', 'retranslation.mjs');
export const RULES_DIR = path.join(ROOT, 'scripts', 'update-data', 'rules');
export const COUNTS_PATH = path.join(ROOT, 'scripts', 'update-data', 'retranslation.counts.json');

// The four sujato trees post copies.
export const SUJATO_TREES = ['sujato/sutta', 'sujato/notes', 'sujato/name', 'sujato/blurb'];

// The three a rule may rewrite, and the default scope. sujato/notes is never retranslated — a note
// is Bhikkhu Sujato writing *about* the text, quoting his own renderings — and naming it in a
// `scope` is rejected rather than ignored.
export const RETRANSLATABLE_TREES = ['sujato/sutta', 'sujato/name', 'sujato/blurb'];

// Loads and validates the rules array from retranslation.mjs, throwing on a malformed rule — a bad
// id would otherwise corrupt sidecar, count and diff filenames. Imported through a data: URL, which
// keeps the file's own content the only freshness question and works under Vitest's module-load
// restrictions; retranslation.mjs must therefore stay self-contained, a data: URL having no base to
// resolve a relative import against.
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
      throw new Error(`Rule "${rule.id}" has no "why" — every rule must state its reason (see docs/retranslation.md).`);
    }
    if (rule.kind === 'segment') {
      if (segmentsOf(rule).length === 0 || !rule.from || typeof rule.to !== 'string') {
        throw new Error(`Segment rule "${rule.id}" needs segment (or segments), from, and to.`);
      }
      if (rule.segment && rule.segments) {
        throw new Error(`Segment rule "${rule.id}" sets both segment and segments — use one.`);
      }
    } else if (rule.kind === 'blurb') {
      if (!Array.isArray(rule.openers) || rule.openers.length === 0) {
        throw new Error(`Blurb rule "${rule.id}" needs a non-empty openers array.`);
      }
      const seenBlurbs = new Set();
      for (const opener of rule.openers) {
        if (!opener.blurb || !opener.from || typeof opener.to !== 'string') {
          throw new Error(`Blurb rule "${rule.id}" has an opener without blurb, from and to.`);
        }
        if (opener.from === opener.to) {
          throw new Error(`Blurb rule "${rule.id}" opener ${opener.blurb} rewrites its from to itself.`);
        }
        if (seenBlurbs.has(opener.blurb)) {
          throw new Error(`Blurb rule "${rule.id}" names ${opener.blurb} twice — one opener per blurb.`);
        }
        seenBlurbs.add(opener.blurb);
      }
    } else {
      if (!Array.isArray(rule.forms) || rule.forms.length === 0) {
        throw new Error(`Term rule "${rule.id}" needs a non-empty forms array.`);
      }
      if (rule.mode !== 'allow' && rule.mode !== 'deny') {
        throw new Error(`Term rule "${rule.id}" needs mode: 'allow' | 'deny'.`);
      }
      for (const tree of rule.scope ?? []) {
        if (!RETRANSLATABLE_TREES.includes(tree)) {
          throw new Error(`Term rule "${rule.id}" scopes ${tree}, which is not retranslatable (see RETRANSLATABLE_TREES).`);
        }
      }
    }
  }
  return rules;
}

export const isTermRule = (rule) => rule.kind !== 'segment' && rule.kind !== 'blurb';
export const isSegmentRule = (rule) => rule.kind === 'segment';
export const isBlurbRule = (rule) => rule.kind === 'blurb';

// The segments one override applies to, from either `segment` or `segments` — the plural being for
// a line the corpus repeats verbatim. Each must still match `from` on its own.
export function segmentsOf(rule) {
  if (rule.segments) return rule.segments;
  return rule.segment ? [rule.segment] : [];
}

// A term rule's own trees, defaulting to every tree a rule may rewrite.
export function scopeOf(rule) {
  return rule.scope && rule.scope.length ? rule.scope : RETRANSLATABLE_TREES;
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

// Writes a rule's sidecar, sorted, so a re-write's diff shows only the actual change.
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

// Whether `rule` may touch `segmentId` at all: the allow/deny gate, independent of whether its
// forms match the text there.
export function isPermitted(rule, sidecar, segmentId) {
  if (rule.mode === 'allow') return sidecar.allow.includes(segmentId);
  return !(segmentId in sidecar.deny); // mode === 'deny'
}

// A rule's forms, longest first, so "situational awareness" is tried before "awareness".
export function sortedForms(rule) {
  return [...rule.forms].sort((a, b) => b[0].length - a[0].length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// Words a title leaves lowercase.
const TITLE_LOWERCASE = new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'of', 'on', 'the', 'to']);

// Whether a match is Title Case rather than a capitalized sentence: every word a title would
// capitalize starts with a capital, over at least two words. A single-word match never is.
function isTitleCase(matched) {
  const words = matched.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const significant = words.filter((w) => !TITLE_LOWERCASE.has(w.toLowerCase()));
  return significant.length > 0 && significant.every((w) => w[0] === w[0].toUpperCase());
}

// Returns `replacement` cased as `matched`: lowercase as written, Sentence case from a capitalized
// first letter, or Title Case throughout. Its first word follows the match's first word rather than
// the title rule, so a form carrying a leading preposition stays lowercase there.
function caseAs(matched, replacement) {
  const firstUpper = matched[0] === matched[0].toUpperCase();
  if (!isTitleCase(matched)) return firstUpper ? capitalize(replacement) : replacement;
  return replacement
    .split(' ')
    .map((word, i) => {
      if (i === 0) return firstUpper ? capitalize(word) : word;
      return TITLE_LOWERCASE.has(word.toLowerCase()) ? word : capitalize(word);
    })
    .join(' ');
}

// One alternation regex over a rule's forms, longest first — JS tries alternatives left to right at
// each position, so that ordering is what makes the longer phrase win.
function combinedFormsRegex(rule) {
  const forms = sortedForms(rule);
  const pattern = forms.map(([from]) => escapeRe(from)).join('|');
  return { re: new RegExp(`\\b(?:${pattern})\\b`, 'gi'), forms };
}

// Whether any of a rule's forms occur in `text`, ignoring allow/deny permission. The same
// word-boundary matching applyRuleToChunks does, so "the form is present" means one thing here.
export function formsMatch(rule, text) {
  const { re } = combinedFormsRegex(rule);
  re.lastIndex = 0;
  return re.test(text);
}

// Runs one term rule over a segment's chunk list and returns the new list and its match count. A
// chunk is `{ text, locked }`, and a locked chunk is invisible to every later rule, so one rule's
// replacement can be another's source word; same-word collisions resolve by array order.
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
      const replacement = caseAs(m[0], replacementFor(m[0]));
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

// Applies every term rule, in array order, to one segment's value, respecting each rule's scope,
// mode and sidecar permission. Returns the rewritten text, a Map<ruleId, matchCount> of the rules
// that matched here, and the chunks behind it. `treeName` is one of SUJATO_TREES.
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
  // Each locked chunk carries the rule that produced it and the text it replaced, which is how the
  // diff writer attributes a span without re-deriving it from a text diff.
  return { result: chunksToString(chunks), counts, chunks };
}

// Applies one segment override to `value`, which is the term rules' output — overrides run last.
// `applied` is false, with no change made, when `from` doesn't match verbatim: the anchor is broken.
export function applySegmentOverride(value, rule) {
  if (value !== rule.from) return { result: value, applied: false };
  return { result: rule.to, applied: true };
}

// Applies one blurb opener to that blurb's post-term-rule text. `from` anchors as a prefix, not the
// whole paragraph and not a free-floating substring, so there is exactly one place it can match.
export function applyBlurbOpener(value, opener) {
  if (typeof value !== 'string' || !value.startsWith(opener.from)) return { result: value, applied: false };
  return { result: opener.to + value.slice(opener.from.length), applied: true };
}

// segment id ("dn22:1.9", "an1.5:1.2") -> its uid, i.e. everything before the first ':'.
export function uidOf(segmentId) {
  return segmentId.slice(0, segmentId.indexOf(':'));
}

// Maps every segment id in sujato/sutta to the logical relPath of the file holding it. Built by
// walking the tree, since a range-batched file keys its segments by sub-uid rather than the batch
// uid its filename carries. Sutta-only: sujato/notes reuses the sutta's segment ids, so one map
// spanning both would be ambiguous, and blurbs have their own index below.
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

// Maps every blurb id in sujato/blurb to its file, in the same logical relPath shape
// buildSegmentIndex uses, and kept apart from that index so it stays sutta-only.
export function buildBlurbIndex(sujatoDir = SUJATO_DIR) {
  const index = new Map();
  const blurbDir = path.join(sujatoDir, 'blurb');
  if (!fs.existsSync(blurbDir)) return index;
  for (const fullPath of walkJsonFiles(blurbDir)) {
    const relPath = 'sujato/blurb/' + path.relative(blurbDir, fullPath).split(path.sep).join('/');
    const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    for (const key of Object.keys(obj)) index.set(key, relPath);
  }
  return index;
}

// The pali/sutta relPath holding the Pali counterpart of a sujato/sutta file. A path transform
// rather than an index lookup: the two trees share their relative path, filename suffix aside.
export function paliCounterpartPath(sujatoSuttaRelPath) {
  if (!sujatoSuttaRelPath.startsWith('sujato/sutta/')) return null;
  return sujatoSuttaRelPath.replace(/^sujato\/sutta\//, 'pali/sutta/').replace(/_translation-en-sujato\.json$/, '_root-pli-ms.json');
}

const paliMapCache = new Map();
// The Pali root text aligned with one sujato/sutta segment, or null. Used by the triage, report and
// diff tooling; nothing at build time consults it.
export function paliTextFor(segmentId, sujatoSuttaRelPath, paliDir = PALI_DIR) {
  const paliRel = paliCounterpartPath(sujatoSuttaRelPath); // 'pali/sutta/...'
  if (!paliRel) return null;
  const paliPath = path.join(paliDir, paliRel.slice('pali/'.length));
  if (!paliMapCache.has(paliPath)) {
    paliMapCache.set(paliPath, fs.existsSync(paliPath) ? JSON.parse(fs.readFileSync(paliPath, 'utf8')) : {});
  }
  return paliMapCache.get(paliPath)[segmentId] ?? null;
}

// The html/pli/ms/sutta relPath holding a sujato/sutta file's structural HTML — the same path
// transform as paliCounterpartPath, one tree further, html/ mirroring pali/sutta 1:1.
function htmlCounterpartPath(sujatoSuttaRelPath) {
  const paliRel = paliCounterpartPath(sujatoSuttaRelPath);
  if (!paliRel) return null;
  return paliRel.replace(/^pali\/sutta\//, 'html/pli/ms/sutta/').replace(/_root-pli-ms\.json$/, '_html.json');
}

const htmlMapCache = new Map();
// One segment's structural role (prose, verse, heading, …), for triage's role partition.
export function roleOf(segmentId, sujatoSuttaRelPath, htmlDir = HTML_DIR) {
  const htmlRel = htmlCounterpartPath(sujatoSuttaRelPath); // 'html/pli/ms/sutta/...'
  if (!htmlRel) return undefined;
  const htmlPath = path.join(htmlDir, htmlRel.slice('html/'.length));
  if (!htmlMapCache.has(htmlPath)) {
    htmlMapCache.set(htmlPath, fs.existsSync(htmlPath) ? JSON.parse(fs.readFileSync(htmlPath, 'utf8')) : {});
  }
  return roleFor(htmlMapCache.get(htmlPath)[segmentId])?.role;
}
