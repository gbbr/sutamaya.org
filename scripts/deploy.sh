#!/usr/bin/env bash
# Deploys Sutamaya to Cloudflare as a single Worker serving both the built SPA + static corpus
# (the assets binding, from web/dist) and /api/*, backed by D1. See docs/deploy.md for the one-time
# setup this assumes (wrangler login, the D1 database, the SESSION_SECRET secret).
#
# Usage: deploy.sh --env production|staging [--skip-tests]
#
# The environment is never implied. Named none, this refuses to do anything, so production is only
# ever deployed by asking for it — `npm run deploy` alone stops here rather than shipping.
set -euo pipefail

# Only when stderr is a terminal, so a piped or logged run stays plain text.
if [ -t 2 ]; then
  RED=$'\033[31m'
  BOLD=$'\033[1m'
  OFF=$'\033[0m'
else
  RED='' BOLD='' OFF=''
fi

SKIP_TESTS=0
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1 ;;
    --env)
      TARGET="${2:-}"
      if [ -z "$TARGET" ]; then echo "${RED}error:${OFF} --env needs an environment name" >&2; exit 1; fi
      shift
      ;;
    *) echo "${RED}error:${OFF} unknown argument '$1'. Usage: deploy.sh --env production|staging [--skip-tests]" >&2; exit 1 ;;
  esac
  shift
done

# Passed through to every wrangler command below.
case "$TARGET" in
  # Production is the config's top-level environment, which wrangler wants named explicitly now
  # that a second one exists — left unnamed it warns on every deploy that it is guessing.
  production) ENV_FLAG="--env=" ;;
  staging) ENV_FLAG="--env staging" ;;
  '')
    echo "${RED}error:${OFF} name an environment — ${BOLD}npm run deploy:prod${OFF}, or ${BOLD}npm run deploy:staging${OFF}." >&2
    exit 1
    ;;
  *) echo "${RED}error:${OFF} unknown environment '$TARGET'. Expected production or staging." >&2; exit 1 ;;
esac

echo "Deploying to: $TARGET"

# Fail fast, before the test/build cycle, if wrangler isn't authenticated. `wrangler whoami`
# always exits 0, even when logged out, so check its output instead of its exit code.
if npx wrangler whoami 2>&1 | grep -q "You are not authenticated"; then
  echo "${RED}error:${OFF} not logged in to Cloudflare. Run: ${BOLD}npx wrangler login${OFF}" >&2
  exit 1
fi

if [ "$SKIP_TESTS" = "1" ]; then
  echo "Skipping tests (--skip-tests passed) — deploying without a green test run."
else
  echo "Running tests before deploy (pass --skip-tests to override)…"
  if ! npm test --silent; then
    echo "${RED}error:${OFF} tests failed. Fix them, or re-run with ${BOLD}--skip-tests${OFF} to deploy anyway." >&2
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
# Named by binding rather than by database name, so each environment migrates its own database.
echo "Applying any pending D1 migrations…"
npx wrangler d1 migrations apply DB --remote $ENV_FLAG

npx wrangler deploy $ENV_FLAG

# Audible confirmation once the whole deploy (tests + build + upload) has actually succeeded —
# `set -e` means we never reach here on failure. macOS-only; silently skipped elsewhere since
# deploys can also run from CI/Linux.
command -v afplay >/dev/null 2>&1 && afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || true
