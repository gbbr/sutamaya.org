#!/usr/bin/env node
// Post-processing baked into every update-sujato run: Sujato's translation uses "mendicant" and
// "immersion" where this app prefers "bhikkhu" and "concentration" — rewrite every value under
// data/sujato (blurb, name, sutta, notes alike) accordingly. Keys (segment ids) are never
// touched. See scripts/update-sujato/README.md.
//
// Word forms are listed explicitly rather than done as a blind "immers" -> "concentrat" substring
// swap: the source text also has unrelated words built on the same stem, e.g. MN40's "water
// immerser" (someone who dunks themselves in water, nothing to do with meditative immersion/
// concentration) — a substring swap turned that into the nonsense "water concentrater".
import fs from 'node:fs';
import path from 'node:path';
import { listLocalRelPaths, SUJATO_DIR } from './lib/sujatoSync.js';

export const WORD_FORMS = [
  ['mendicant', 'bhikkhu'],
  ['mendicants', 'bhikkhus'],
  ['immerse', 'concentrate'],
  ['immerses', 'concentrates'],
  ['immersed', 'concentrated'],
  ['immersing', 'concentrating'],
  ['immersion', 'concentration'],
  ['immersions', 'concentrations'],
];

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

export function applyReplacements(text) {
  let result = text;
  let count = 0;
  for (const [word, replacement] of WORD_FORMS) {
    result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), (m) => {
      count += 1;
      return m[0] === m[0].toUpperCase() ? capitalize(replacement) : replacement;
    });
  }
  return { result, count };
}

// Core logic, callable directly with an explicit sujatoDir (tests use this to point at a fixture
// tree instead of the real data/sujato — see scripts/update-sujato.test.js).
export function runPost({ sujatoDir = SUJATO_DIR } = {}) {
  let filesChanged = 0;
  let replacements = 0;

  for (const relPath of listLocalRelPaths(sujatoDir)) {
    const fullPath = path.join(sujatoDir, relPath);
    const obj = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

    let changed = false;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== 'string') continue;
      const { result, count } = applyReplacements(value);
      if (count > 0) {
        obj[key] = result;
        replacements += count;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(fullPath, JSON.stringify(obj, null, 2));
      filesChanged += 1;
    }
  }

  return { filesChanged, replacements };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { filesChanged, replacements } = runPost();
  console.log(`update-sujato post done — ${replacements} replacements across ${filesChanged} file(s).`);
}
