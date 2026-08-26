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

// The four sujato trees post copies — matches CATEGORY_SOURCE_PREFIXES's sujato/* entries in
// lib/dataSync.js.
export const SUJATO_TREES = ['sujato/sutta', 'sujato/notes', 'sujato/name', 'sujato/blurb'];

// The three a rule may rewrite, and the default scope. **sujato/notes is never retranslated**: a
// note is Bhikkhu Sujato writing *about* the text rather than translating it, so he quotes his own
// renderings and uses the same words as ordinary English, and a rule that is right on the
// translation is routinely wrong there — MN 10's note arguing for "mindfulness meditation" rewritten
// into the "establishment of mindfulness" that replaces it, "its gradual disappearance" becoming
// "its gradual disappearing". A note can't be
// corrected by hand either, since a segment override resolves through sutta-only ids (see
// buildSegmentIndex). Naming it in a `scope` is rejected rather than ignored, so the policy can't
// be half-undone by one rule.
export const RETRANSLATABLE_TREES = ['sujato/sutta', 'sujato/name', 'sujato/blurb'];

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

// Machine-written, deterministically sorted so a re-write's diff shows only the actual change —
// see docs/retranslation.md's "Sidecars are machine-written and sorted".
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

// Whether `rule` may touch `segmentId` at all — the allow/deny gate described in docs/retranslation.md
// under "Closed or open". Independent of whether the rule's forms actually match the text there;
// callers combine this with a forms match to decide what to do.
export function isPermitted(rule, sidecar, segmentId) {
  if (rule.mode === 'allow') return sidecar.allow.includes(segmentId);
  return !(segmentId in sidecar.deny); // mode === 'deny'
}

// Longest-first so e.g. "situational awareness" is tried before "awareness" would otherwise
// shadow it — see docs/retranslation.md's "forms" field.
export function sortedForms(rule) {
  return [...rule.forms].sort((a, b) => b[0].length - a[0].length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// Words a title leaves lowercase — enough to classify the corpus's own headings ("The Longer
// Discourse on Mindfulness Meditation") and to set the ones this layer writes.
const TITLE_LOWERCASE = new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'of', 'on', 'the', 'to']);

// Whether a match is Title Case rather than a capitalized sentence — every word that a title would
// capitalize does start with a capital, and there are at least two words to tell the two apart.
// Single-word matches are never title case, so a one-word form behaves exactly as it always has.
function isTitleCase(matched) {
  const words = matched.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const significant = words.filter((w) => !TITLE_LOWERCASE.has(w.toLowerCase()));
  return significant.length > 0 && significant.every((w) => w[0] === w[0].toUpperCase());
}

// The replacement, cased to match what it replaces: lowercase as written, Sentence case from a
// capitalized first letter, or Title Case throughout. The replacement's own first word follows the
// match's first word rather than the title rule, so a form that carries a leading preposition
// ("on mindfulness meditation" → "on the establishment of mindfulness") stays lowercase there while
// a bare one ("Mindfulness Meditation" → "The Establishment of Mindfulness") does not.
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
// docs/retranslation.md's "The pass". A chunk is `{ text, locked }`; locked chunks are invisible to
// every rule (this one and all later ones), which is what makes same-segment rules order-safe —
// one rule's replacement can be another's source word — while same-word collisions between two
// rules still resolve by array order.
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

// Applies every term rule (in array order) to one segment's value, respecting each rule's
// scope/mode/sidecar permission. Returns the rewritten text and a Map<ruleId, matchCount> of only
// the rules that actually matched here (used by post to accumulate totals and by triage's stale
// check). `treeName` is one of SUJATO_TREES; `paliText` isn't consulted here — the predicate never
// runs at build time (see docs/retranslation.md) — it's only used by triage/report tooling.
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

// Segment override rules run after all term rules, against their output — see docs/retranslation.md.
// Returns { result, applied } where applied is false (with no change made) if `from` doesn't match
// verbatim, so callers can treat that as the anchor-broken case rather than silently no-op'ing.
export function applySegmentOverride(value, rule) {
  if (value !== rule.from) return { result: value, applied: false };
  return { result: rule.to, applied: true };
}

// One opener of a blurb rule, applied to that blurb's post-term-rule text. `from` anchors as a
// *prefix* rather than the whole value, because a blurb is a paragraph and only its opening span
// is being rewritten — quoting the rest of it into the rule would put a page of unchanged prose in
// retranslation.mjs for every entry. Prefix and not a free-floating substring so the anchor stays
// unambiguous: there is one place it can match.
export function applyBlurbOpener(value, opener) {
  if (typeof value !== 'string' || !value.startsWith(opener.from)) return { result: value, applied: false };
  return { result: opener.to + value.slice(opener.from.length), applied: true };
}

// segment id ("dn22:1.9", "an1.5:1.2") -> its uid, i.e. everything before the first ':'.
export function uidOf(segmentId) {
  return segmentId.slice(0, segmentId.indexOf(':'));
}

// Maps every segment id in sujato/sutta (only — see below) to the file it lives in, relative to
// DATA_ROOT (e.g. 'sujato/sutta/an/an1/an1.1-10_translation-en-sujato.json'). Built by walking
// every sutta file once — necessary because range-batched files key their segments by sub-uid,
// not by the batch uid the filename carries, so the file can't be derived from a segment id alone
// (see docs/retranslation.md's "Segment ids resolve to files through a segment→file index"). Cheap
// (~4,000 files, a few hundred ms) and only needed for segment-override rules, so callers build it
// once per run rather than per rule.
//
// Deliberately sutta-only: sujato/notes is keyed by the *same* segment ids as the sutta text it
// annotates (a note on dn1:1.1 is filed under the key 'dn1:1.1', same as the segment itself), so a
// single id->file map spanning sutta+notes+name+blurb together would be ambiguous — whichever tree
// happened to be walked last for a given id would silently win. A segment override therefore
// targets the main translation only; retargeting a note isn't something this resolves. Blurbs are
// addressable, but through their own index below rather than this one.
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

// Maps every blurb id in sujato/blurb to its file, in the same logical relPath shape
// buildSegmentIndex uses. Its own index rather than an entry in that one: blurb keys are
// namespaced by collection ('sn-blurbs:sn12'), so they can't collide with a sutta segment id or
// with each other, but keeping the two maps apart is what keeps the sutta index free of the
// ambiguity the notes tree would introduce. Cheap — seven files.
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

// The Pali root text segment aligned with a given sujato/sutta segment id — used only by
// triage/report/diff tooling (never at build time; see the predicate note above). Bhikkhu Sujato's
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
