#!/usr/bin/env node
// Prints an aggregate usage report (registered/active users, reading volume) to the terminal.
// Run manually by the maintainer — nothing here is wired into the app or any schedule. Every
// figure excludes the maintainer's own accounts (MAINTAINER_USER_IDS below), so the report is
// about other people's use of the app.
//
// Privacy: this script only ever computes and prints *aggregate* numbers (counts, sums, totals
// across all users). It never prints a per-user row, a uid, an email/name, or the content of any
// note/highlight — it only counts whether those rows exist. That's a deliberate constraint, not
// an incidental one: see the per-user D1 table shapes in CLAUDE.md ("Backend (worker/)") — this
// script is what it looks like to summarize usage without exposing any of that per-user detail.
// If you're extending this file, keep new metrics to the same shape (a total, not a breakdown by
// person). The one exception is the `visited` table's `sutta_id`/`visited_at` columns, read in
// full below to compute reading-time totals — still no user identifier leaves this script.
//
// Runs every query in one batch against the remote D1 database via `wrangler d1 execute --remote
// --json`; this script has no D1 access of its own, same as every other admin action against it.
// Needs `wrangler login` first.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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

const esc = (iso) => iso.replace(/'/g, "''");

// The maintainer's own accounts. Every number in the report excludes them, so what it shows is
// other people's usage rather than the developer's own reading and testing — which is otherwise
// the largest share of it. Identified by opaque user id rather than email address: this
// repository is public, and a checked-in address is a spam magnet.
const MAINTAINER_USER_IDS = ['ZOKS5yCDqDito7JH8Ose', '7962a2d9-130b-4265-b76e-aa231fb87a27'];
const MAINTAINER_IDS_SQL = MAINTAINER_USER_IDS.map((id) => `'${esc(id)}'`).join(', ');
const NOT_MAINTAINER = `user_id NOT IN (${MAINTAINER_IDS_SQL})`;
const NOT_MAINTAINER_USERS = `id NOT IN (${MAINTAINER_IDS_SQL})`;

// One batch, executed as a single `wrangler d1 execute`; the result array comes back in this
// same order.
const STATEMENTS = [
  `SELECT COUNT(*) AS c FROM users WHERE ${NOT_MAINTAINER_USERS};`,
  `SELECT COUNT(*) AS c FROM users WHERE created_at >= '${esc(CUTOFF_7D)}' AND ${NOT_MAINTAINER_USERS};`,
  `SELECT COUNT(*) AS c FROM users WHERE created_at >= '${esc(CUTOFF_30D)}' AND ${NOT_MAINTAINER_USERS};`,
  `SELECT COUNT(DISTINCT user_id) AS c FROM visited WHERE visited_at >= '${esc(CUTOFF_7D)}' AND ${NOT_MAINTAINER};`,
  `SELECT COUNT(DISTINCT user_id) AS c FROM visited WHERE visited_at >= '${esc(CUTOFF_30D)}' AND ${NOT_MAINTAINER};`,
  `SELECT sutta_id, visited_at FROM visited WHERE ${NOT_MAINTAINER};`,
  `SELECT COUNT(*) AS c FROM notes WHERE ${NOT_MAINTAINER};`,
  `SELECT COUNT(*) AS c FROM highlights WHERE ${NOT_MAINTAINER};`,
  `SELECT COUNT(*) AS c FROM lists WHERE ${NOT_MAINTAINER};`,
];

function queryD1() {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'sutamaya', '--remote', '--json', '--command', STATEMENTS.join('\n')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(out);
}

async function main() {
  const suttaMinutes = await loadSuttaMinutes();

  const [
    usersResult,
    newUsers7dResult,
    newUsers30dResult,
    activeUsers7dResult,
    activeUsers30dResult,
    visitedRowsResult,
    notesResult,
    highlightsResult,
    listsResult,
  ] = queryD1();

  const totalUsers = usersResult.results[0].c;
  const newUsers7d = newUsers7dResult.results[0].c;
  const newUsers30d = newUsers30dResult.results[0].c;
  const activeUsers7d = activeUsers7dResult.results[0].c;
  const activeUsers30d = activeUsers30dResult.results[0].c;
  const totalNotes = notesResult.results[0].c;
  const totalHighlights = highlightsResult.results[0].c;
  const totalLists = listsResult.results[0].c;

  let visitsAllTime = 0;
  let visits7d = 0;
  let visits30d = 0;
  let minutesAllTime = 0;
  let minutes7d = 0;
  let minutes30d = 0;
  for (const row of visitedRowsResult.results) {
    const min = suttaMinutes ? suttaMinutes[row.sutta_id] || 0 : 0;
    visitsAllTime += 1;
    minutesAllTime += min;
    if (row.visited_at >= CUTOFF_30D) {
      visits30d += 1;
      minutes30d += min;
    }
    if (row.visited_at >= CUTOFF_7D) {
      visits7d += 1;
      minutes7d += min;
    }
  }

  const fmtMin = (m) => `${Math.round(m)} min (~${(m / 60).toFixed(1)} h)`;

  console.log('Sutamaya usage report (excluding maintainers)');
  console.log('=============================================');
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
