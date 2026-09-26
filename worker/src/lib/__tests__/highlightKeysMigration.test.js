import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Migration 0005, run against rows in the shape it replaces. It executes once against real data and
// can never be re-run, so it is driven from the migration file itself (via the TEST_MIGRATIONS
// binding) rather than from a copy of its SQL — the thing under test is the file that will run.
//
// Each test rebuilds the pre-0005 `highlights` table over the top of the current one, which is safe
// because vitest-pool-workers rolls back every test's storage writes.
//
// What matters here is that a rebuild carrying no conversion of its own still carries every row and
// every column it is not replacing: the keys arrive empty and are filled in afterwards, from
// outside the database, so anything this drops is lost outright.

const MIGRATION = '0005_highlight_segment_keys';

// `highlights` as migration 0004 left it: the span's two endpoints as segment positions.
const PRE_0005_SCHEMA = [
  'DROP TABLE IF EXISTS highlights',
  `CREATE TABLE highlights (
     id          TEXT NOT NULL,
     user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     sutta_id    TEXT NOT NULL,
     i0          INTEGER NOT NULL,
     o0          INTEGER NOT NULL,
     i1          INTEGER NOT NULL,
     o1          INTEGER NOT NULL,
     color       TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     mtime       TEXT NOT NULL DEFAULT '',
     deleted     INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, id)
   )`,
  'CREATE INDEX highlights_user_sutta ON highlights(user_id, sutta_id)',
];

async function user(id) {
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, `${id}@example.com`, `google-${id}`, '2026-01-01T00:00:00.000Z')
    .run();
  return id;
}

async function positionedRows(rows) {
  for (const sql of PRE_0005_SCHEMA) await env.DB.prepare(sql).run();
  for (const row of rows) {
    await env.DB.prepare(
      `INSERT INTO highlights (id, user_id, sutta_id, i0, o0, i1, o1, color, created_at, mtime, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.userId,
        row.suttaId ?? 'sn1.1',
        row.i0,
        row.o0,
        row.i1,
        row.o1,
        row.color ?? 'yellow',
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

async function highlightsOf(userId) {
  const { results } = await env.DB.prepare('SELECT * FROM highlights WHERE user_id = ? ORDER BY id').bind(userId).all();
  return results;
}

describe('migration 0005 — highlights anchored on segment keys', () => {
  it('carries every row across, keeping its id, sutta, offsets and colour', async () => {
    const userId = await user(crypto.randomUUID());
    await positionedRows([
      { id: 'a', userId, i0: 0, o0: 4, i1: 2, o1: 7 },
      { id: 'b', userId, suttaId: 'mn1', i0: 9, o0: 0, i1: 9, o1: 12, color: 'green' },
    ]);

    await runMigration();

    expect((await highlightsOf(userId)).map((r) => [r.id, r.sutta_id, r.o0, r.o1, r.color])).toEqual([
      ['a', 'sn1.1', 4, 7, 'yellow'],
      ['b', 'mn1', 0, 12, 'green'],
    ]);
  });

  // The keys are the one thing the migration cannot supply: turning a position into `mn10:2.7` takes
  // the corpus, which the database does not hold. They arrive empty and are filled in afterwards,
  // from the positions read before this ran.
  it('leaves the keys empty rather than inventing them', async () => {
    const userId = await user(crypto.randomUUID());
    await positionedRows([{ id: 'a', userId, i0: 3, o0: 1, i1: 3, o1: 8 }]);

    await runMigration();

    expect(await highlightsOf(userId)).toEqual([expect.objectContaining({ k0: '', k1: '' })]);
  });

  it('drops the position columns', async () => {
    const userId = await user(crypto.randomUUID());
    await positionedRows([{ id: 'a', userId, i0: 3, o0: 1, i1: 3, o1: 8 }]);

    await runMigration();

    const [row] = await highlightsOf(userId);
    expect(Object.keys(row)).not.toContain('i0');
    expect(Object.keys(row)).not.toContain('i1');
  });

  // A tombstone must survive as a tombstone: a device that was offline when the erase happened
  // would otherwise push its still-live copy back and resurrect the highlight.
  it('carries a tombstone across as a tombstone, with its mtime', async () => {
    const userId = await user(crypto.randomUUID());
    await positionedRows([
      { id: 'dead', userId, i0: 0, o0: 0, i1: 0, o1: 5, deleted: 1, mtime: '2026-02-01T00:00:00.000Z|a' },
    ]);

    await runMigration();

    expect(await highlightsOf(userId)).toEqual([
      expect.objectContaining({ id: 'dead', deleted: 1, mtime: '2026-02-01T00:00:00.000Z|a' }),
    ]);
  });

  it('keeps two accounts holding the same highlight id apart', async () => {
    const [one, two] = [await user(crypto.randomUUID()), await user(crypto.randomUUID())];
    await positionedRows([
      { id: 'shared', userId: one, i0: 0, o0: 0, i1: 0, o1: 5, color: 'yellow' },
      { id: 'shared', userId: two, i0: 1, o0: 2, i1: 1, o1: 9, color: 'blue' },
    ]);

    await runMigration();

    expect((await highlightsOf(one)).map((r) => [r.o0, r.o1, r.color])).toEqual([[0, 5, 'yellow']]);
    expect((await highlightsOf(two)).map((r) => [r.o0, r.o1, r.color])).toEqual([[2, 9, 'blue']]);
  });

  // The index the reads rely on is dropped with the old table and has to come back with the new one,
  // or every /api/data scans.
  it('leaves the per-user, per-sutta index in place', async () => {
    const userId = await user(crypto.randomUUID());
    await positionedRows([{ id: 'a', userId, i0: 0, o0: 0, i1: 0, o1: 5 }]);

    await runMigration();

    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'highlights'"
    ).all();
    expect(results.map((r) => r.name)).toContain('highlights_user_sutta');
  });

  // A write arriving after the migration names keys and no positions, which the old table's NOT NULL
  // columns would have refused.
  it('accepts a key-only insert afterwards', async () => {
    const userId = await user(crypto.randomUUID());
    await positionedRows([]);

    await runMigration();

    await env.DB.prepare(
      `INSERT INTO highlights (id, user_id, sutta_id, k0, o0, k1, o1, color, created_at, mtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind('new', userId, 'dn1', 'dn1:1.1', 0, 'dn1:1.2', 5, 'yellow', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z|a')
      .run();

    expect(await highlightsOf(userId)).toEqual([
      expect.objectContaining({ id: 'new', k0: 'dn1:1.1', k1: 'dn1:1.2', o0: 0, o1: 5 }),
    ]);
  });
});
