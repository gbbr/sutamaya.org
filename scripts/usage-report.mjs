#!/usr/bin/env node
// Prints an aggregate usage report — people, engagement, reading, library — to the terminal.
// Run manually by the maintainer: `npm run usage-report`, or `npm run usage-report -- --json` for
// the same figures as one JSON object. Nothing here is wired into the app or any schedule. Every
// figure excludes the maintainer's own accounts (MAINTAINER_USER_IDS below), so the report is
// about other people's use of the app.
//
// Privacy: this script only ever computes and prints *aggregate* numbers — counts, sums, and
// per-sutta totals across all users. It never prints a per-user row, a uid, an email/name, or the
// content of any note or highlight; it only counts whether those rows exist. That's a deliberate
// constraint, not an incidental one: see the per-user D1 table shapes in CLAUDE.md ("Backend
// (worker/)"). If you're extending this file, keep new metrics to that shape — a total, or a
// breakdown by sutta, never a breakdown by person. The two result sets read in full carry no user
// identifier out of the database: every account's `created_at`, and every `visited` row's
// `sutta_id` and `visited_at`.
//
// What the reading figures actually mean: `visited` holds one row per (user, sutta), and its
// `visited_at` is the *most recent* read, so re-reading a sutta replaces the earlier timestamp
// rather than adding to it. Every reading figure is therefore "suttas opened, counted once per
// reader, at their latest read" — not a visit count, which this schema cannot answer. For the same
// reason only windows ending now (the last 7 or 30 days) are exact: any earlier window undercounts,
// because a later re-read moved rows out of it. That is why signups — whose `created_at` never
// moves — are the only figures shown against the previous period.
//
// Runs every query in one batch against the remote D1 database via `wrangler d1 execute --remote
// --json`; this script has no D1 access of its own, same as every other admin action against it.
// Needs `wrangler login` first.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { fileURLToPath } from 'node:url';

const JSON_OUTPUT = process.argv.includes('--json');

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoffIso = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const CUTOFF_7D = cutoffIso(7);
const CUTOFF_14D = cutoffIso(14);
const CUTOFF_30D = cutoffIso(30);
const CUTOFF_60D = cutoffIso(60);

// Weeks of signup history drawn as a sparkline. One block per week, so this is also the width of
// that cell — keep it equal to VALUE_W and the sparkline lines up with the numbers above it.
const SPARK_WEEKS = 10;

// The maintainer's own accounts. Every number in the report excludes them, so what it shows is
// other people's usage rather than the developer's own reading and testing — which is otherwise
// the largest share of it. Identified by opaque user id rather than email address: this
// repository is public, and a checked-in address is a spam magnet.
const MAINTAINER_USER_IDS = ['ZOKS5yCDqDito7JH8Ose', '7962a2d9-130b-4265-b76e-aa231fb87a27'];

const esc = (value) => String(value).replace(/'/g, "''");
const MAINTAINER_IDS_SQL = MAINTAINER_USER_IDS.map((id) => `'${esc(id)}'`).join(', ');
// `users` names the column `id`; every other table names it `user_id`.
const notMaintainer = (column = 'user_id') => `${column} NOT IN (${MAINTAINER_IDS_SQL})`;

// Lists, notes and highlights are deleted by tombstone, never by removing the row (see
// docs/offline-sync.md), so every count of them has to exclude the tombstones.
const LIVE = 'deleted = 0';

// One batch, executed as a single `wrangler d1 execute`; the result array comes back in this
// same order.
const STATEMENTS = [
  // Every account's signup time, with no identifier beside it: the total, both new-user windows
  // and the sparkline are all counted from this one list.
  `SELECT created_at FROM users WHERE ${notMaintainer('id')};`,

  // Active readers. Both windows end now, so both are exact.
  `SELECT
     COUNT(DISTINCT CASE WHEN visited_at >= '${esc(CUTOFF_7D)}'  THEN user_id END) AS wau,
     COUNT(DISTINCT CASE WHEN visited_at >= '${esc(CUTOFF_30D)}' THEN user_id END) AS mau,
     COUNT(DISTINCT user_id) AS ever
   FROM visited WHERE ${notMaintainer()};`,

  // Of the people who joined more than a week ago — the ones who had a chance to come back — how
  // many read something this week.
  `SELECT COUNT(DISTINCT v.user_id) AS returned
     FROM visited v JOIN users u ON u.id = v.user_id
    WHERE v.visited_at >= '${esc(CUTOFF_7D)}'
      AND u.created_at <  '${esc(CUTOFF_7D)}'
      AND ${notMaintainer('v.user_id')};`,

  // Readers who opened one sutta and never another.
  `SELECT COUNT(*) AS c FROM (
     SELECT user_id FROM visited WHERE ${notMaintainer()} GROUP BY user_id HAVING COUNT(*) = 1
   );`,

  // Which suttas have been read, and when each was last opened. No user id — see the privacy note.
  `SELECT sutta_id, visited_at FROM visited WHERE ${notMaintainer()};`,

  // Library totals, alongside how many people have at least one of each.
  `SELECT COUNT(*) AS c, COUNT(DISTINCT user_id) AS people
     FROM notes WHERE ${LIVE} AND ${notMaintainer()};`,
  `SELECT COUNT(*) AS c, COUNT(DISTINCT user_id) AS people
     FROM highlights WHERE ${LIVE} AND ${notMaintainer()};`,
  `SELECT
     SUM(CASE WHEN kind = 'group' THEN 0 ELSE 1 END) AS lists,
     SUM(CASE WHEN kind = 'group' THEN 1 ELSE 0 END) AS groups,
     COUNT(DISTINCT user_id) AS people
   FROM lists WHERE ${LIVE} AND ${notMaintainer()};`,
];

function queryD1() {
  const command = STATEMENTS.map((sql) => sql.replace(/\s+/g, ' ').trim()).join('\n');
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'sutamaya', '--remote', '--json', '--command', command],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // Capture wrangler's own stderr instead of letting it print: its progress chatter would
      // otherwise land in the middle of the report, and on a failure it is shown by the handler
      // at the bottom of this file.
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return JSON.parse(out);
}

// Estimated reading minutes and display titles, keyed by uid. Optional: the corpus bundle is
// git-ignored (see CLAUDE.md's "Data pipeline"), so a clone that hasn't run `npm run build:corpus`
// gets a report without the reading-time and canon-coverage lines, and bare uids in the most-read
// table.
async function loadCorpus() {
  const corpusPath = fileURLToPath(new URL('../web/public/data/corpus.json', import.meta.url));
  try {
    const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
    return {
      suttas: corpus.suttas,
      total: Object.keys(corpus.suttas).length,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------- rendering

const bold = (s) => styleText('bold', s);
const dim = (s) => styleText('dim', s);
const heading = (s) => styleText(['bold', 'cyan'], s);

const LABEL_W = 34;
const VALUE_W = 10;
const RULE_W = 68;

const num = (n) => Number(n || 0).toLocaleString('en-US');
// A share that rounds to nothing still isn't nothing — the corpus is large enough that early
// reading rounds to 0%, which reads as "none has been opened".
const pct = (n, of) => {
  if (of <= 0) return '—';
  const share = (n / of) * 100;
  return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
};
// A percentage note, or nothing at all when there is no denominator to take a share of.
const share = (n, of, what) => (of > 0 ? `${pct(n, of)} ${what}` : '');

function out(line = '') {
  console.log(line);
}

function section(title) {
  out();
  out('  ' + heading(title.toUpperCase()));
}

function row(label, value, note = '') {
  const cells = dim(String(label).padEnd(LABEL_W)) + bold(String(value).padStart(VALUE_W));
  out('  ' + cells + (note ? '   ' + dim(note) : ''));
}

// A signed comparison against the previous period of the same length. Only ever shown for
// signups, the one figure the schema can compare honestly.
function delta(now, previous, period) {
  const change = now - previous;
  if (change === 0) return dim(`unchanged from the previous ${period}`);
  const arrow = change > 0 ? '▲' : '▼';
  const text = `${arrow} ${num(Math.abs(change))} vs the previous ${period}`;
  return styleText(change > 0 ? 'green' : 'red', text);
}

const BLOCKS = '▁▂▃▄▅▆▇█';
function sparkline(values) {
  const max = Math.max(...values, 1);
  return values
    .map((v) => BLOCKS[Math.round((v / max) * (BLOCKS.length - 1))])
    .join('');
}

function duration(minutes) {
  const hours = minutes / 60;
  return hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(minutes)} min`;
}

// ---------------------------------------------------------------------------- report

function buildReport(rows, corpus) {
  const [signupRows, activeRow, returnedRow, singleRow, visitedRows, noteRow, highlightRow, listRow] =
    rows;

  const signups = signupRows.results.map((r) => r.created_at);
  const since = (cutoff, until) =>
    signups.filter((at) => at >= cutoff && (until === undefined || at < until)).length;

  const active = activeRow.results[0];
  const notes = noteRow.results[0];
  const highlights = highlightRow.results[0];
  const lists = listRow.results[0];

  const weeks = new Array(SPARK_WEEKS).fill(0);
  const now = Date.now();
  for (const at of signups) {
    const week = Math.floor((now - Date.parse(at)) / (7 * DAY_MS));
    if (week >= 0 && week < SPARK_WEEKS) weeks[SPARK_WEEKS - 1 - week] += 1;
  }

  const readers = new Map();
  let opened = 0;
  let opened7d = 0;
  let opened30d = 0;
  let minutes = 0;
  let minutes7d = 0;
  let minutes30d = 0;
  for (const { sutta_id: uid, visited_at: at } of visitedRows.results) {
    const min = corpus?.suttas[uid]?.min || 0;
    readers.set(uid, (readers.get(uid) || 0) + 1);
    opened += 1;
    minutes += min;
    if (at >= CUTOFF_30D) {
      opened30d += 1;
      minutes30d += min;
    }
    if (at >= CUTOFF_7D) {
      opened7d += 1;
      minutes7d += min;
    }
  }

  const mostRead = [...readers.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([uid, count]) => ({ uid, ref: corpus?.suttas[uid]?.ref, title: corpus?.suttas[uid]?.en, readers: count }));

  return {
    generatedAt: new Date().toISOString(),
    people: {
      registered: signups.length,
      new7d: since(CUTOFF_7D),
      new7dPrevious: since(CUTOFF_14D, CUTOFF_7D),
      new30d: since(CUTOFF_30D),
      new30dPrevious: since(CUTOFF_60D, CUTOFF_30D),
      signupsByWeek: weeks,
    },
    engagement: {
      weeklyActive: active.wau,
      monthlyActive: active.mau,
      everRead: active.ever,
      joinedOverAWeekAgo: signups.filter((at) => at < CUTOFF_7D).length,
      returnedThisWeek: returnedRow.results[0].returned,
      readOneSuttaOnly: singleRow.results[0].c,
    },
    reading: {
      suttasOpened: opened,
      suttasOpened7d: opened7d,
      suttasOpened30d: opened30d,
      distinctSuttas: readers.size,
      canonSize: corpus?.total ?? null,
      minutes: corpus ? minutes : null,
      minutes7d: corpus ? minutes7d : null,
      minutes30d: corpus ? minutes30d : null,
      mostRead,
    },
    library: {
      lists: lists.lists || 0,
      groups: lists.groups || 0,
      listOwners: lists.people,
      notes: notes.c,
      noteWriters: notes.people,
      highlights: highlights.c,
      highlighters: highlights.people,
    },
  };
}

function print(report, corpus) {
  const { people, engagement, reading, library } = report;
  const title = 'sutamaya · usage report';
  const when = new Date(report.generatedAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  out();
  out('  ' + bold(title) + dim(when.padStart(RULE_W - title.length)));
  out('  ' + dim('─'.repeat(RULE_W)));
  out('  ' + dim("Aggregate figures only, excluding the maintainer's own accounts."));

  section('People');
  row('Registered', num(people.registered));
  row('Joined in the last 7 days', num(people.new7d), delta(people.new7d, people.new7dPrevious, '7 days'));
  row('Joined in the last 30 days', num(people.new30d), delta(people.new30d, people.new30dPrevious, '30 days'));
  row(`Weekly signups, ${SPARK_WEEKS} weeks to now`, sparkline(people.signupsByWeek), `peak ${num(Math.max(...people.signupsByWeek))} in a week`);

  section('Engagement');
  row('Read something this week', num(engagement.weeklyActive), share(engagement.weeklyActive, people.registered, 'of everyone registered'));
  row('Read something this month', num(engagement.monthlyActive), share(engagement.monthlyActive, people.registered, 'of everyone registered'));
  row('Weekly as a share of monthly', pct(engagement.weeklyActive, engagement.monthlyActive), 'how often the monthly readers come back');
  row('Opened at least one sutta, ever', num(engagement.everRead), share(engagement.everRead, people.registered, 'of everyone registered'));
  row('Came back after their first week', num(engagement.returnedThisWeek), `of ${num(engagement.joinedOverAWeekAgo)} who joined over a week ago`);
  row('Opened one sutta and no more', num(engagement.readOneSuttaOnly), `of ${num(engagement.everRead)} who read anything`);

  const readingTime = (minutes) => (minutes ? `about ${duration(minutes)} of reading` : '');

  section('Reading');
  row('Suttas opened, last 7 days', num(reading.suttasOpened7d), readingTime(reading.minutes7d));
  row('Suttas opened, last 30 days', num(reading.suttasOpened30d), readingTime(reading.minutes30d));
  row('Suttas opened, all time', num(reading.suttasOpened), readingTime(reading.minutes));
  row(
    'Suttas anyone has opened',
    num(reading.distinctSuttas),
    share(reading.distinctSuttas, reading.canonSize ?? 0, `of the ${num(reading.canonSize)} in the corpus`)
  );
  out();
  out('  ' + dim('  Counted once per reader, at their most recent read — the app keeps no visit log.'));
  if (!corpus) out('  ' + dim('  Run "npm run build:corpus" to add reading times and corpus coverage.'));

  if (reading.mostRead.length) {
    section('Most read');
    for (const sutta of reading.mostRead) {
      const label = sutta.ref ? `${sutta.ref} · ${sutta.title}` : sutta.uid;
      row(label.length > LABEL_W - 1 ? label.slice(0, LABEL_W - 2) + '…' : label, num(sutta.readers), sutta.readers === 1 ? 'reader' : 'readers');
    }
  }

  section('Library');
  row('Lists', num(library.lists), `kept by ${num(library.listOwners)} ${library.listOwners === 1 ? 'person' : 'people'}`);
  row('Groups of lists', num(library.groups));
  row('Notes', num(library.notes), `written by ${num(library.noteWriters)} ${library.noteWriters === 1 ? 'person' : 'people'}`);
  row('Highlights', num(library.highlights), `made by ${num(library.highlighters)} ${library.highlighters === 1 ? 'person' : 'people'}`);
  out();
}

// The wrangler round trip takes a few seconds. Say so on stderr while it runs, then wipe the line
// so it leaves nothing behind; a redirected stderr gets no status line at all rather than a stray
// one it can't erase.
function withStatus(message, work) {
  const live = process.stderr.isTTY;
  if (live) process.stderr.write(dim(message));
  try {
    return work();
  } finally {
    if (live) process.stderr.write('\r\x1b[2K');
  }
}

async function main() {
  const corpus = await loadCorpus();
  const report = buildReport(withStatus('Reading the production database…', queryD1), corpus);

  if (JSON_OUTPUT) console.log(JSON.stringify(report, null, 2));
  else print(report, corpus);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(styleText('red', '\n  The usage report could not read the database.'));
    console.error(dim('  Check that `npx wrangler login` has been run, then try again.\n'));
    console.error(err.stderr?.toString?.() || err.message || err);
    process.exit(1);
  }
);
