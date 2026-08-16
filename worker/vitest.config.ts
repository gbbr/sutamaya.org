import fs from 'node:fs';
import path from 'node:path';
import { defineWorkersProject, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  // The pool reads the real wrangler.jsonc below, which errors out if its `assets.directory`
  // doesn't exist — and `web/dist` is a git-ignored build output, absent on a fresh checkout and in
  // CI, where `npm test` runs without a web build. The Worker tests only exercise `/api/*`, which
  // never touches the assets binding, so an empty directory is enough to satisfy the config.
  fs.mkdirSync(path.join(__dirname, '..', 'web', 'dist'), { recursive: true });

  return {
    test: {
      name: 'worker',
      setupFiles: ['./test/apply-migrations.js'],
      poolOptions: {
        workers: {
          wrangler: { configPath: '../wrangler.jsonc' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations, SESSION_SECRET: 'test-secret-not-for-prod' },
          },
        },
      },
    },
  };
});
