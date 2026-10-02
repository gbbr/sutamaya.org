import fs0 from 'node:fs'; const fs = fs0;
const STOP = new Set(
  ('a an the and or but if of to in on at by for with from as is are was were be been being am this that these those ' +
    'it its he she they them his her hers their theirs there here then than so such not no nor do does did done doing ' +
    'have has had having i me my mine we us our you your yours who whom whose which what when where why how all any both ' +
    'each more most other some own same very can will just should would could may might must shall also into upon about ' +
    'over under again once up down out off only too one ones thus now o oh let'
  ).split(' '),
);

// Returns a word reduced to a crude stem, the same way for every translation.
function stem(w) {
  if (w.length > 4) {
    if (w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.endsWith('ness')) w = w.slice(0, -4);
    else if (w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.endsWith('ly')) w = w.slice(0, -2);
    else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

// The terms the three translators render differently, each group read as one word.
const SYNONYMS = [
  'bhikkhu mendicant monk',
  'bhikkhuni nun',
  'bhagava buddha blessed',
  'bhante sir lord',
  'sankhara choice formation fabrication volitional',
  'nibbana extinguishment extinguished quenching quenched unbinding unbound',
  'dukkha suffering stress stressful suffer',
  'adinava drawback danger',
  'assada gratification allure',
  'pajanati understand discern',
  'samadhi immersion concentration composure',
  'jhana absorption',
  'samana ascetic contemplative recluse',
  'brahmana brahmin brahman',
  'deva god deity devata',
  'asava defilement taint effluent fermentation',
  'tathagata realized',
  'dhamma teaching dharma',
  'vinaya training discipline',
  'arahant perfected arahat worthy',
  'nibbida disillusionment revulsion disenchantment disillusioned disenchanted',
  'viraga dispassion fading dispassionate',
  'upadana grasping clinging sustenance grasp cling',
  'samudaya origin origination originate arising',
  'nirodha cessation cease ending',
  'ahara fuel nutriment food',
  'kamma deed action karma',
  'raga greed lust passion',
  'dosa hate hatred aversion',
  'sila ethics ethical virtue virtuous',
  'saddha faith conviction',
  'appamada diligent diligence heedful heedfulness',
  'dhatu element property',
  'ayatana field base media medium',
  'bodhi awakening enlightenment',
  'mano mind intellect',
  'viriya energy persistence',
  'sukha bliss happiness pleasure',
  'domanassa sadness displeasure distress',
  'kusala skillful wholesome',
  'akusala unskillful unwholesome',
  'bhava existence becoming',
  'sampajanna awareness alertness comprehension',
  'anicca impermanent inconstant impermanence inconstancy',
  'vimutti freedom freed release released liberation liberated',
  'panna wisdom discernment',
  'puthujjana ordinary worldling',
];
const CANON = new Map();
for (const group of SYNONYMS) {
  const [head, ...rest] = group.split(' ');
  for (const w of [head, ...rest]) CANON.set(stem(w), head);
}

// The form each word is compared by, or null for one too common to tell lines apart.
const normCache = new Map();
function normWord(raw) {
  let norm = normCache.get(raw);
  if (norm === undefined) {
    const w = raw.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, '');
    norm = w.length < 2 || STOP.has(w) ? null : (CANON.get(stem(w)) ?? stem(w));
    normCache.set(raw, norm);
  }
  return norm;
}
// Measures each changed group before and after: how many of its Pali lines show with the English
// that matches them best by the dictionary. A line shows with its own text, or, when empty, with
// the nearest line above it in the group that has text (the join the app would make).
// Usage: node measure-verse.mjs <repo> <translator> <out.json>
import path from 'node:path';
const [REPO, T, OUT] = process.argv.slice(2);
const DATA = path.join(REPO, 'data');
const WORD_RE = /[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu;
const wordsOf = (text) => [...new Set((text.match(WORD_RE) ?? []).map(normWord).filter(Boolean))];
const dictionary = new Map();
for (const { entry, definition } of JSON.parse(fs.readFileSync(path.join(DATA, 'pli2en_dpd.json'), 'utf8')).entries ?? []) {
  const had = dictionary.get(entry.toLowerCase()) ?? new Set();
  for (const def of definition) {
    const lemma = normWord(def.slice(0, def.indexOf(':')).replace(/\s*\d+$/, ''));
    if (lemma) had.add(lemma);
    for (const b of def.matchAll(/<b>(.*?)<\/b>/g)) for (const w of wordsOf(b[1])) had.add(w);
  }
  dictionary.set(entry.toLowerCase(), had);
}
const glossOf = (pali) => { const g = new Set(); for (const w of pali.toLowerCase().match(WORD_RE) ?? []) { for (const x of dictionary.get(w) ?? []) g.add(x); const n = normWord(w); if (n) g.add(n); } return g; };
const pali = new Map();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(p, 'utf8')))) pali.set(k, v.trim()); } };
walk(path.join(DATA, 'pali', 'sutta'));
const named = new Set();
for (const f of fs.readdirSync(path.join(DATA, T, 'review', 'hand')).filter((f) => /^verse-\d+\.findings$/.test(f)))
  for (const l of fs.readFileSync(path.join(DATA, T, 'review', 'hand', f), 'utf8').split('\n')) { const m = /^(\S+:\S+) (?:starts: |none)/.exec(l.trim()); if (m) named.add(m[1]); }
const groups = JSON.parse(fs.readFileSync(path.join(DATA, T, 'review', 'findings.json'), 'utf8')).groups.filter((g) => g.verdict === 'passes' && g.findings.some((f) => named.has(f.key)));
// Word weights, from every line of text in the groups.
const df = new Map(); let docs = 0;
for (const g of groups) for (const l of g.lines) for (const t of [l.before, l.after]) if (t) { docs++; for (const w of wordsOf(t)) df.set(w, (df.get(w) ?? 0) + 1); }
const idf = (w) => Math.log((docs + 1) / (df.get(w) ?? 1));
const sim = (gloss, text) => wordsOf(text).reduce((n, w) => n + (gloss.has(w) ? idf(w) : 0), 0);
// Returns how many of the group's lines show with their best-matching unit, how many don't, and how many no unit matches at all.
function score(lines, side, G) {
  const unitOf = [], units = [];
  let cur = -1;
  lines.forEach((l, i) => { if (l[side]) { units.push(l[side]); cur = units.length - 1; } unitOf[i] = cur; });
  let good = 0, bad = 0, blind = 0;
  lines.forEach((l, i) => {
    const s = units.map((u) => sim(G[i], u));
    const best = Math.max(0, ...s);
    if (best <= 0) { blind++; return; }
    if (unitOf[i] >= 0 && s[unitOf[i]] >= best - 0.01) good++; else bad++;
  });
  return { good, bad, blind };
}
const verdict = { better: 0, same: 0, worse: 0 };
const totals = { before: 0, after: 0, lines: 0 };
const worse = [];
for (const g of groups) {
  const G = g.lines.map((l) => glossOf(pali.get(l.key) ?? ''));
  const b = score(g.lines, 'before', G), a = score(g.lines, 'after', G);
  totals.before += b.good; totals.after += a.good; totals.lines += g.lines.length - b.blind;
  const v = a.good > b.good ? 'better' : a.good < b.good ? 'worse' : 'same';
  verdict[v]++;
  if (v === 'worse') worse.push({ keys: g.findings.map((f) => f.key), before: b, after: a });
}
fs.writeFileSync(OUT, JSON.stringify(worse, null, 1));
console.log(`${T}: ${groups.length} changed groups — better ${verdict.better}, same ${verdict.same}, worse ${verdict.worse}; Pali lines shown with their best-matching English: before ${totals.before}, after ${totals.after} (of ${totals.lines} the dictionary can place)`);
