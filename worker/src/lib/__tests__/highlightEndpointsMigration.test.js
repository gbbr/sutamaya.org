import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Migration 0004, run against rows in the shape it replaces. It executes once against real data and
// can never be re-run, so it is driven from the migration file itself (via the TEST_MIGRATIONS
// binding) rather than from a copy of its SQL — the thing under test is the file that will run.
//
// Each test rebuilds the pre-0004 `highlights` table over the top of the current one, which is safe
// because vitest-pool-workers rolls back every test's storage writes.

const MIGRATION = '0004_highlight_endpoints';

// `highlights` as migrations 0001 and 0002 left it: one row per segment a highlight covered, with
// the group id in `g` and a server-minted uuid in `id`.
const LEGACY_SCHEMA = [
  'DROP TABLE IF EXISTS highlights',
  `CREATE TABLE highlights (
     id          TEXT PRIMARY KEY,
     user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     sutta_id    TEXT NOT NULL,
     i           INTEGER NOT NULL,
     s           INTEGER NOT NULL,
     e           INTEGER NOT NULL,
     color       TEXT NOT NULL,
     g           TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     mtime       TEXT NOT NULL DEFAULT '',
     deleted     INTEGER NOT NULL DEFAULT 0
   )`,
  'CREATE INDEX highlights_user_sutta ON highlights(user_id, sutta_id)',
  'CREATE UNIQUE INDEX highlights_user_group_seg ON highlights(user_id, g, i)',
];

async function user(id) {
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, `${id}@example.com`, `google-${id}`, '2026-01-01T00:00:00.000Z')
    .run();
  return id;
}

async function legacyRows(rows) {
  for (const sql of LEGACY_SCHEMA) await env.DB.prepare(sql).run();
  for (const row of rows) {
    await env.DB.prepare(
      `INSERT INTO highlights (id, user_id, sutta_id, i, s, e, color, g, created_at, mtime, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.userId,
        row.suttaId ?? 'sn1.1',
        row.i,
        row.s,
        row.e,
        row.color ?? 'yellow',
        row.g,
        row.createdAt ?? '2026-01-01T00:00:00.000Z',
        row.mtime ?? '2026-01-01T00:00:00.000Z|a',
        row.deleted ?? 0
      )
      .run();
  }
}

async function runMigration() {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith(MIGRATION));
  expect(migration, `migration ${MIGRATION} not found`).toBeTruthy();
  for (const query of migration.queries) await env.DB.prepare(query).run();
}

async function endpointsOf(userId) {
  const { results } = await env.DB.prepare('SELECT * FROM highlights WHERE user_id = ? ORDER BY id').bind(userId).all();
  return results;
}

describe('migration 0004 — collapsing highlight rows to endpoints', () => {
  it('collapses a cross-segment highlight into one row holding both ends', async () => {
    const userId = await user(crypto.randomUUID());
    await legacyRows([
      { id: 'row-1', userId, g: 'grp', i: 2, s: 4, e: 30 },
      { id: 'row-2', userId, g: 'grp', i: 3, s: 0, e: 41 },
      { id: 'row-3', userId, g: 'grp', i: 4, s: 0, e: 7 },
    ]);

    await runMigration();

    // The start is the first segment's own (i, s); the end is the last segment's (i, e). The middle
    // row's stored length — the value that went stale when the text was reworded — is gone.
    expect(await endpointsOf(userId)).toEqual([
      expect.objectContaining({ id: 'grp', sutta_id: 'sn1.1', i0: 2, o0: 4, i1: 4, o1: 7, color: 'yellow', deleted: 0 }),
    ]);
  });

  it('keeps a single-segment highlight as the one row it already was', async () => {
    const userId = await user(crypto.randomUUID());
    await legacyRows([{ id: 'row-1', userId, g: 'grp', i: 9, s: 3, e: 12, color: 'green' }]);

    await runMigration();

    expect(await endpointsOf(userId)).toEqual([
      expect.objectContaining({ id: 'grp', i0: 9, o0: 3, i1: 9, o1: 12, color: 'green' }),
    ]);
  });

  it('collapses each highlight separately, and keeps every one of them', async () => {
    const userId = await user(crypto.randomUUID());
    await legacyRows([
      { id: 'row-1', userId, g: 'a', i: 0, s: 0, e: 5 },
      { id: 'row-2', userId, g: 'b', i: 1, s: 2, e: 6 },
      { id: 'row-3', userId, g: 'b', i: 2, s: 0, e: 3 },
      { id: 'row-4', userId, g: 'c', suttaId: 'mn1', i: 7, s: 1, e: 4 },
    ]);

    await runMigration();

    expect((await endpointsOf(userId)).map((r) => [r.id, r.sutta_id, r.i0, r.o0, r.i1, r.o1])).toEqual([
      ['a', 'sn1.1', 0, 0, 0, 5],
      ['b', 'sn1.1', 1, 2, 2, 3],
      ['c', 'mn1', 7, 1, 7, 4],
    ]);
  });

  // Tombstones must survive as tombstones: a device that was offline when the erase happened would
  // otherwise push its still-live copy back and resurrect the highlight.
  it('carries a tombstoned highlight across as a single tombstone', async () => {
    const userId = await user(crypto.randomUUID());
    await legacyRows([
      { id: 'row-1', userId, g: 'dead', i: 0, s: 0, e: 5, deleted: 1, mtime: '2026-02-01T00:00:00.000Z|a' },
      { id: 'row-2', userId, g: 'dead', i: 1, s: 0, e: 9, deleted: 1, mtime: '2026-02-01T00:00:00.000Z|a' },
    ]);

    await runMigration();

    expect(await endpointsOf(userId)).toEqual([
      expect.objectContaining({ id: 'dead', deleted: 1, i0: 0, o0: 0, i1: 1, o1: 9, mtime: '2026-02-01T00:00:00.000Z|a' }),
    ]);
  });

  // Two accounts' rows must not be collapsed into each other, however their group ids collide.
  it('keeps two accounts that used the same group id apart', async () => {
    const a = await user(crypto.randomUUID());
    const b = await user(crypto.randomUUID());
    await legacyRows([
      { id: 'row-1', userId: a, g: 'same', i: 0, s: 0, e: 5, color: 'yellow' },
      { id: 'row-2', userId: b, g: 'same', i: 8, s: 1, e: 4, color: 'green' },
    ]);

    await runMigration();

    expect(await endpointsOf(a)).toEqual([expect.objectContaining({ id: 'same', i0: 0, o0: 0, i1: 0, o1: 5, color: 'yellow' })]);
    expect(await endpointsOf(b)).toEqual([expect.objectContaining({ id: 'same', i0: 8, o0: 1, i1: 8, o1: 4, color: 'green' })]);
  });

  it('leaves an empty table empty, and rebuilds the per-sutta index', async () => {
    const userId = await user(crypto.randomUUID());
    await legacyRows([]);

    await runMigration();

    expect(await endpointsOf(userId)).toEqual([]);
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'highlights'").all();
    expect(results.map((r) => r.name)).toContain('highlights_user_sutta');
  });
});
