#!/usr/bin/env bash
# Replaces the staging database's contents with a copy of the local development database, so
# staging has lists, notes and highlights to read rather than an empty account. Destructive on
# staging and only on staging: the environment is hardcoded, and production is never opened.
#
# Usage: seed-staging.sh
set -euo pipefail

DUMP="$(mktemp -t sutamaya-seed)"
SEED="$DUMP.seed.sql"
trap 'rm -f "$DUMP" "$SEED"' EXIT

echo "Exporting the local D1 database…"
npx wrangler d1 export DB --local --output "$DUMP"

# The dump recreates every table but never drops one first, so without this a second seed fails on
# the tables the first one left behind. The names come from the dump itself rather than a list kept
# here, so a new migration needs no change.
{
  echo "PRAGMA defer_foreign_keys=TRUE;"
  sed -n 's/^CREATE TABLE \(IF NOT EXISTS \)\{0,1\}"\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)"\{0,1\}.*/DROP TABLE IF EXISTS "\2";/p' "$DUMP"
  cat "$DUMP"
} > "$SEED"

echo "Replacing the staging database with it…"
npx wrangler d1 execute DB --env staging --remote --yes --file "$SEED"

echo "Done. Staging now holds a copy of the local database."
