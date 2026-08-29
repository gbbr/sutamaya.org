import fs from 'node:fs';
import path from 'node:path';
import { defineWorkersProject, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  // The pool reads the real wrangler.jsonc below, which errors out if its `assets.directory`
  // doesn't exist — and `web/dist` is a git-ignored build output, absent on a fresh checkout and in
  // CI, where `npm test` runs without a web build. Create it, and seed the two files
  // src/assetRouting.test.js needs to tell "the assets binding answered" from "the Worker
  // answered": one page for the SPA fallback to return, one plain file to serve directly. Only
  // written when absent, so a real build is never clobbered — the test asserts on how the request
  // was *routed*, not on what these contain, so placeholders serve it as well as the real build.
  // The two HTML pages carry different titles for the same reason: '/' and a client-side route
  // both answer 200 text/html, so only the body distinguishes the landing page from the SPA shell.
  const distDir = path.join(__dirname, '..', 'web', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const seed = (name: string, contents: string) => {
    const file = path.join(distDir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, contents);
  };
  seed('index.html', '<!doctype html><title>app shell placeholder</title>\n');
  seed('landing.html', '<!doctype html><title>landing placeholder</title>\n');
  seed('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>\n');

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
