#!/usr/bin/env node
// Prints an aggregate usage report (registered/active users, reading volume) to the terminal.
// Run manually by the maintainer — nothing here is wired into the app or any schedule.
//
// Privacy: this script only ever computes and prints *aggregate* numbers (counts, sums, totals
// across all users). It never prints a per-user row, a uid, an email/name, or the content of any
// note/highlight — it only counts whether those docs exist. That's a deliberate constraint, not
// an incidental one: see the per-user Firestore doc shapes in CLAUDE.md ("Backend (server/)") —
// this script is what it looks like to summarize usage without exposing any of that per-user
// detail. If you're extending this file, keep new metrics to the same shape (a total, not a
// breakdown by person).
//
// Against the local emulator (default): just run `npm run usage-report`.
// Against production Firestore: `NODE_ENV=production GOOGLE_CLOUD_PROJECT=<project-id> npm run
// usage-report`, with valid Application Default Credentials for a principal that has Firestore
// read access (e.g. `gcloud auth application-default login`) — same as any other script talking
// to `server/src/firestore.js` (see deploy.md).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { usersCol, listsCol, notesCol, highlightsCol, visitedCol } from '../server/src/firestore.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoffIso = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const CUTOFF_7D = cutoffIso(7);
const CUTOFF_30D = cutoffIso(30);

// Estimated reading minutes per sutta, keyed by uid — only used to turn "a sutta was visited"
// into a rough total-time-read figure. Optional: falls back to skipping that line if the corpus
// bundle hasn't been built locally (it's git-ignored, see CLAUDE.md's "Data pipeline").
async function loadSuttaMinutes() {
  const corpusPath = fileURLToPath(new URL('../web/public/data/corpus.json', import.meta.url));
  try {
    const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
    const minutes = {};
    for (const [uid, sutta] of Object.entries(corpus.suttas)) minutes[uid] = sutta.min || 0;
    return minutes;
  } catch {
    return null;
  }
}

async function main() {
  const suttaMinutes = await loadSuttaMinutes();

  const usersSnap = await usersCol().get();
  const totalUsers = usersSnap.size;
  let newUsers7d = 0;
  let newUsers30d = 0;
  for (const doc of usersSnap.docs) {
    const createdAt = doc.data().createdAt;
    if (createdAt >= CUTOFF_30D) newUsers30d += 1;
    if (createdAt >= CUTOFF_7D) newUsers7d += 1;
  }

  let activeUsers7d = 0;
  let activeUsers30d = 0;
  let visitsAllTime = 0;
  let visits7d = 0;
  let visits30d = 0;
  let minutesAllTime = 0;
  let minutes7d = 0;
  let minutes30d = 0;
  let totalNotes = 0;
  let totalHighlights = 0;
  let totalLists = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const [visitedSnap, notesCount, highlightsCount, listsCount] = await Promise.all([
      visitedCol(uid).get(),
      notesCol(uid).count().get(),
      highlightsCol(uid).count().get(),
      listsCol(uid).count().get(),
    ]);

    totalNotes += notesCount.data().count;
    totalHighlights += highlightsCount.data().count;
    totalLists += listsCount.data().count;

    let userActive7d = false;
    let userActive30d = false;
    for (const doc of visitedSnap.docs) {
      const { visitedAt } = doc.data();
      const min = suttaMinutes ? suttaMinutes[doc.id] || 0 : 0;
      visitsAllTime += 1;
      minutesAllTime += min;
      if (visitedAt >= CUTOFF_30D) {
        visits30d += 1;
        minutes30d += min;
        userActive30d = true;
      }
      if (visitedAt >= CUTOFF_7D) {
        visits7d += 1;
        minutes7d += min;
        userActive7d = true;
      }
    }
    if (userActive7d) activeUsers7d += 1;
    if (userActive30d) activeUsers30d += 1;
  }

  const fmtMin = (m) => `${Math.round(m)} min (~${(m / 60).toFixed(1)} h)`;

  console.log('Sutamaya usage report');
  console.log('======================');
  console.log(`Registered users:        ${totalUsers}`);
  console.log(`  new in last 7 days:    ${newUsers7d}`);
  console.log(`  new in last 30 days:   ${newUsers30d}`);
  console.log(`Active users (visited a sutta):`);
  console.log(`  last 7 days:           ${activeUsers7d}`);
  console.log(`  last 30 days:          ${activeUsers30d}`);
  console.log(`Sutta visits:`);
  console.log(`  last 7 days:           ${visits7d}`);
  console.log(`  last 30 days:          ${visits30d}`);
  console.log(`  all time:              ${visitsAllTime}`);
  if (suttaMinutes) {
    console.log(`Estimated reading time (sum of each visited sutta's estimated length):`);
    console.log(`  last 7 days:           ${fmtMin(minutes7d)}`);
    console.log(`  last 30 days:          ${fmtMin(minutes30d)}`);
    console.log(`  all time:              ${fmtMin(minutesAllTime)}`);
  } else {
    console.log(`Estimated reading time:  (run "npm run build:corpus" first to enable this)`);
  }
  console.log(`Totals across all users:`);
  console.log(`  lists:                 ${totalLists}`);
  console.log(`  notes:                 ${totalNotes}`);
  console.log(`  highlights:            ${totalHighlights}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
