#!/usr/bin/env bash
# Deploys Sutamaya to Cloudflare as a single Worker serving both the built SPA + static corpus
# (the assets binding, from web/dist) and /api/*, backed by D1. See deploy.md for the one-time
# setup this assumes (wrangler login, the D1 database, the SESSION_SECRET secret).
set -euo pipefail

SKIP_TESTS=0
for arg in "$@"; do
  if [ "$arg" = "--skip-tests" ]; then SKIP_TESTS=1; fi
done

if [ "$SKIP_TESTS" = "1" ]; then
  echo "Skipping tests (--skip-tests passed) — deploying without a green test run."
else
  echo "Running tests before deploy (pass --skip-tests to override)…"
  if ! npm test --silent; then
    echo "error: tests failed. Fix them, or re-run with --skip-tests to deploy anyway." >&2
    exit 1
  fi
fi

# wrangler uploads web/dist exactly as it finds it, so the build has to run every deploy —
# a stale or missing directory would ship yesterday's SPA, or no static corpus at all.
echo "Building the SPA and corpus bundle…"
npm run build

# Migrations run before the upload, not after: for the window between the two, the old Worker is
# still serving, so a migration has to leave the *previous* code working — additive only (ADD COLUMN
# with a default, a new index), never a rename or a drop. The other order would put new code in front
# of an un-migrated database and 500 every affected route until this finished. Idempotent — wrangler
# tracks what it has already applied in the d1_migrations table — so re-running a deploy is free.
echo "Applying any pending D1 migrations…"
npx wrangler d1 migrations apply sutamaya --remote

npx wrangler deploy

# Audible confirmation once the whole deploy (tests + build + upload) has actually succeeded —
# `set -e` means we never reach here on failure. macOS-only; silently skipped elsewhere since
# deploys can also run from CI/Linux.
command -v afplay >/dev/null 2>&1 && afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true
