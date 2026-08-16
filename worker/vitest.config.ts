import path from 'node:path';
import { defineWorkersProject, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

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
