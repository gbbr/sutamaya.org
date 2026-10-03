// Run in an isolated copy with verse-layout.patch and note-placement.patch applied:
// node scripts/segmenter/proposals/note-placement/measure-notes.mjs bodhi
// Uses the production parser, aligner and placement function before the CLI's writing stages.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const translator = process.argv[2];
if (translator !== 'bodhi') throw new Error('The hand-reviewed measurement cohort is Bodhi');
const proposal = path.dirname(new URL(import.meta.url).pathname);
const withheld = JSON.parse(fs.readFileSync(path.join(proposal, 'withheld-cuts.json'), 'utf8'));
const decisions = JSON.parse(fs.readFileSync(`data/${translator}/cuts.json`, 'utf8'));
for (const [key, old] of Object.entries(withheld)) {
  if (old.present) decisions[key] = old.value;
  else delete decisions[key];
}
const source = fs.readFileSync('scripts/segmenter/segment-translations.mjs', 'utf8');
const beforeRun = source.slice(0, source.indexOf('// Running it'));
const parse = source.slice(source.indexOf('const pages ='), source.indexOf('// The words this translator uses'));
const segments = source.slice(source.indexOf('function segmentsOf('), source.indexOf('// Returns the places in `text`'));
const apply = source.slice(source.indexOf('function applyDecisions('), source.indexOf('// Returns the words before `at`'));
const apiPath = path.resolve('scripts/segmenter/.measure-note-placement.mjs');
fs.mkdirSync('prototype', { recursive: true });
fs.writeFileSync(apiPath, `${beforeRun}\n${parse}\nconst decisions = ${JSON.stringify(decisions)};\nconst anchorOf = d => typeof d === 'string' ? d : d?.after;\n${segments}\n${apply}\nfor (const [s, ts] of Object.entries(readJson(path.join(OUT, 'learned.json')))) learned.set(idOf(s), ts.map(idOf));\nexport { units, align, applyDecisions, segmentsOf, spreadVerses, placePassageNotes };\n`);
try {
  const { units, align, applyDecisions, segmentsOf, spreadVerses, placePassageNotes } = await import(pathToFileURL(apiPath));
  const raw = JSON.parse(fs.readFileSync(`data/${translator}/review/notes-placement/judgments.json`, 'utf8'));
  const judgments = Array.isArray(raw) ? raw : raw.judgments;
  const byKey = new Map(units.flatMap(unit => unit.body.map(line => [line.key, unit])));
  const relevant = new Set(judgments.map(j => byKey.get(j.candidateKey)));
  if (relevant.has(undefined)) throw new Error('A judged candidate has no source unit');
  const predictions = new Map();
  let brokenStreams = 0;
  for (const unit of relevant) {
    const aligned = align(unit.stream, unit.body);
    if (!aligned) throw new Error(`Could not align ${unit.name}`);
    // Restore pre-note-review prose context. Neither the new hand answers nor the gold targets
    // are given to the placement function; its cut guard receives an empty decision map.
    applyDecisions(aligned.results, unit.stream.text, {});
    const original = structuredClone(aligned.results);
    const before = segmentsOf(original, unit.stream.text);
    const entry = {};
    placePassageNotes(unit.stream, unit.body, aligned.results, entry, {});
    spreadVerses(unit.stream, unit.body, aligned.results, {});
    const after = segmentsOf(aligned.results, unit.stream.text);
    if (before.joined !== after.joined) brokenStreams++;
    predictions.set(unit, { original, results: aligned.results, before, after, placements: entry.notePlacements ?? [] });
  }
  // Gold keys are used only after all predictions have been made, to score ownership and controls.
  const records = judgments.map(j => {
    const unit = byKey.get(j.candidateKey);
    const p = predictions.get(unit);
    const keys = j.noteKeys?.length ? j.noteKeys : [j.candidateKey];
    const spans = unit.stream.notes.filter(note => p.original.some(r => keys.includes(r.key)
      && !r.empty && !r.merged && r.start < note.end && r.end > note.start));
    const owners = spans.map(note => p.results.find(r => !r.empty && !r.merged && r.start <= note.start && r.end >= note.end)?.key);
    const unchanged = keys.every(key => {
      const i = unit.body.findIndex(line => line.key === key);
      if (i < 0) throw new Error(`Missing control row ${key}`);
      return p.before.segText[i] === p.after.segText[i];
    });
    return { ...j, recognized: spans.length > 0, inferred: owners,
      exact: j.decision === 'move' ? spans.length > 0 && owners.every(key => key === j.targetKey) : unchanged,
      placements: p.placements };
  });
  const moves = records.filter(r => r.decision === 'move');
  const distinct = [...new Map(moves.map(r => [`${r.targetKey}|${[...r.noteKeys].sort().join(',')}`, r])).values()];
  const left = records.filter(r => r.decision === 'leave' && r.classification !== 'ordinary-translation');
  const ordinary = records.filter(r => r.classification === 'ordinary-translation');
  const summary = { translator, candidates: records.length, withheldAnswerKeys: Object.keys(withheld).length,
    movedCandidates: { total: moves.length, exact: moves.filter(r => r.exact).length },
    distinctMovedNotes: { total: distinct.length, exact: distinct.filter(r => r.exact).length },
    notesLeftAlone: { total: left.length, unchanged: left.filter(r => r.exact).length },
    ordinaryTranslationControls: { total: ordinary.length, unchanged: ordinary.filter(r => r.exact).length },
    brokenStreams };
  fs.writeFileSync(`prototype/measured-notes-${translator}.json`, JSON.stringify(records, null, 2) + '\n');
  fs.writeFileSync(`prototype/summary-notes-${translator}.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.unlinkSync(apiPath);
}
