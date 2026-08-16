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

npx wrangler deploy

# Audible confirmation once the whole deploy (tests + build + upload) has actually succeeded —
# `set -e` means we never reach here on failure. macOS-only; silently skipped elsewhere since
# deploys can also run from CI/Linux.
command -v afplay >/dev/null 2>&1 && afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true
