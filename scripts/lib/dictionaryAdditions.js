// Definitions added to DPD's, from data/pli2en_additions.json, and the Pali's abbreviations — see
// docs/corpus.md's "The dictionary".

// A definition line's compound part and headword, minus the homonym number: "sampajāno → sampajāna 1: …".
const LINE_HEAD = /^(?:([^:]+?) → )?([^:]+?)(?: [\d.]+)?: /;

function lineHead(line) {
  const m = LINE_HEAD.exec(line);
  return m ? { part: m[1] ?? '', word: m[2] } : null;
}

const headKey = (h) => `${h.part}\n${h.word}`;

/**
 * addDefinitions adds, in place, each addition's line to every entry in dict that defines its
 * headword, after the last line for that headword, and returns the additions that matched none.
 */
export function addDefinitions(dict, additions) {
  const unused = new Set(additions);
  for (const [word, lines] of Object.entries(dict)) {
    const heads = lines.map(lineHead);
    const last = new Map();
    heads.forEach((h, i) => h && last.set(headKey(h), i));
    dict[word] = lines.flatMap((line, i) => {
      const h = heads[i];
      const matched = h && last.get(headKey(h)) === i ? additions.filter((a) => a.headword === h.word) : [];
      for (const a of matched) unused.delete(a);
      const prefix = h?.part ? `${h.part} → ` : '';
      return [line, ...matched.map((a) => `${prefix}${a.headword}: (${a.source}) <b>${a.meaning}</b>`)];
    });
  }
  return [...unused];
}

// Abbreviations in the Pali, each with the headword it stands for.
export const ABBREVIATIONS = { pe: 'peyyāla' };

/**
 * expandAbbreviations replaces, in place, each abbreviation's entry in dict with the lines defining
 * the headword it stands for, and returns the abbreviations whose headword nothing defines.
 */
export function expandAbbreviations(dict, abbreviations = ABBREVIATIONS) {
  const missing = [];
  for (const [abbreviation, headword] of Object.entries(abbreviations)) {
    const lines = new Set();
    for (const entry of Object.values(dict)) {
      for (const line of entry) {
        const h = lineHead(line);
        if (h && !h.part && h.word === headword) lines.add(line);
      }
    }
    if (lines.size) dict[abbreviation] = [...lines];
    else missing.push(abbreviation);
  }
  return missing;
}
