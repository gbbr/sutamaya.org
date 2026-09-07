#!/usr/bin/env node
// Re-anchors an environment's stored highlights from segment positions onto segment keys — the
// conversion migration 0005 cannot do, because turning position 42 into `mn10:2.7` takes the built
// corpus and the database holds none of it.
//
// Two phases, either side of the deploy that carries migration 0005:
//
//   node scripts/anchor-highlights.mjs export prod    # before: reads the positions, resolves them
//   npm run deploy:prod                               #         to keys, writes them to a file
//   node scripts/anchor-highlights.mjs apply prod     # after:  writes those keys to the rows
//
// `export` only reads, so it can run as often as needed while the current version is live. Between
// the deploy and `apply` those highlights have no key and paint nothing; the file holds every one
// of them, so `apply` restores them whole and can be re-run until it does.
//
// `apply` writes only to rows that have no key, so it cannot touch a highlight made since the
// deploy, and re-running it is a no-op. A row whose position falls outside the text — a sutta
// shorter now than when it was highlighted — is reported and left alone rather than pinned to a
// line its reader never chose.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { red, green, bold, dim } from './lib/dataSync.js';
import { parseD1Json } from './lib/wranglerJson.js';

const step = (text) => console.log(bold(text));
const detail = (text) => console.log(dim(`  ${text}`));
const ok = (text) => console.log(`  ${green('✓')} ${text}`);
process.on('uncaughtException', (err) => {
  console.error(`\n  ${red('✗ anchor-highlights failed')}\n\n${err.message.replace(/^/gm, '  ')}\n`);
  process.exit(1);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TEXT = path.join(ROOT, 'web', 'public', 'data', 'text');

// How each environment is addressed. `local` is the on-disk D1 under .wrangler/; the other two are
// the deployed databases, which wrangler reaches with --remote.
const ENVS = {
  local: ['--local'],
  staging: ['--remote', '--env', 'staging'],
  prod: ['--remote'],
};

const [phase, target] = process.argv.slice(2);
if (!['export', 'apply'].includes(phase) || !ENVS[target]) {
  throw new Error(`Usage: node scripts/anchor-highlights.mjs <export|apply> <${Object.keys(ENVS).join('|')}>`);
}

// Where a run's resolved keys wait for the deploy. Kept out of the repo: it names one environment's
// rows at one moment, and it holds user data.
const keyFile = path.join(ROOT, 'node_modules', '.cache', `anchor-highlights.${target}.json`);

// Runs one statement through wrangler and returns its rows. Every call is a separate wrangler
// invocation, which is slow and entirely fine: this runs twice per environment, over a few hundred
// rows.
function d1(sql, { file = false } = {}) {
  const args = ['wrangler', 'd1', 'execute', 'DB', ...ENVS[target], '--json', file ? '--file' : '--command', sql];
  const out = execFileSync('npx', args, { cwd: path.join(ROOT, 'worker'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return parseD1Json(out);
}

// One document's segment keys, in order, or null where the build emitted no such file.
const textCache = new Map();
function segmentKeys(suttaId) {
  if (!textCache.has(suttaId)) {
    const file = path.join(TEXT, `${suttaId}.json`);
    textCache.set(suttaId, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).map((s) => s.key) : null);
  }
  return textCache.get(suttaId);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

if (phase === 'export') {
  if (!fs.existsSync(TEXT)) {
    throw new Error(`Missing ${path.relative(ROOT, TEXT)} — run \`npm run build:corpus\` first`);
  }
  step(`Resolving highlight positions to segment keys — ${target}`);

  const rows = d1('SELECT id, user_id, sutta_id, i0, i1 FROM highlights');
  detail(`${rows.length} highlight${rows.length === 1 ? '' : 's'} stored`);

  const resolved = [];
  const skipped = [];
  for (const row of rows) {
    const keys = segmentKeys(row.sutta_id);
    // `i1` is clamped the way the reader clamps it: a highlight running past the end of a text this
    // build made shorter still ends at the last line it has.
    const k0 = keys?.[row.i0];
    const k1 = keys?.[Math.min(row.i1, keys.length - 1)];
    if (!k0 || !k1) {
      skipped.push(`${row.sutta_id} ${row.i0}–${row.i1}${keys ? ` (${keys.length} segments)` : ' (no such document)'}`);
      continue;
    }
    resolved.push({ id: row.id, userId: row.user_id, k0, k1 });
  }

  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, JSON.stringify(resolved, null, 2));
  ok(`${resolved.length} resolved → ${path.relative(ROOT, keyFile)}`);
  if (skipped.length) {
    detail(`${skipped.length} name a position this corpus no longer has, and are left unkeyed:`);
    skipped.forEach((s) => detail(`  ${s}`));
  }
  detail('Deploy, then re-run with `apply`.');
} else {
  step(`Writing segment keys to the highlights that have none — ${target}`);
  if (!fs.existsSync(keyFile)) {
    throw new Error(`No ${path.relative(ROOT, keyFile)} — run \`export\` against ${target} before the deploy`);
  }
  const resolved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));

  const unkeyed = d1("SELECT COUNT(*) AS n FROM highlights WHERE k0 = ''")[0]?.n ?? 0;
  detail(`${unkeyed} without keys, ${resolved.length} keys held`);
  if (!unkeyed) {
    ok('nothing to write');
    process.exit(0);
  }

  // `k0 = ''` guards every row: a highlight made since the deploy already has its keys and is never
  // overwritten, and a second run finds nothing left to do.
  const updates = resolved.map(
    ({ id, userId, k0, k1 }) =>
      `UPDATE highlights SET k0 = ${sqlString(k0)}, k1 = ${sqlString(k1)} ` +
      `WHERE user_id = ${sqlString(userId)} AND id = ${sqlString(id)} AND k0 = '';`
  );
  // One file rather than one command per row: wrangler runs a file's statements in a single
  // transaction, so the conversion either lands whole or not at all.
  const sqlFile = path.join(ROOT, 'node_modules', '.cache', `anchor-highlights.${target}.sql`);
  fs.writeFileSync(sqlFile, `${updates.join('\n')}\n`);
  d1(sqlFile, { file: true });
  fs.rmSync(sqlFile);

  const left = d1("SELECT COUNT(*) AS n FROM highlights WHERE k0 = ''")[0]?.n ?? 0;
  ok(`${unkeyed - left} anchored onto segment keys`);
  if (left) detail(`${left} still without keys — highlights whose position this corpus no longer has`);
}
