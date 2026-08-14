# `npm run update-sujato`

Refreshes `data/sujato/` (blurb/name/sutta/notes — see `data/BRIEF.md`) from a local checkout of
[suttacentral/sc-data](https://github.com/suttacentral/sc-data), pointed to by the `SC_DATA_PATH`
env var (must be the repo root — the pipeline reads from its `sc_bilara_data/` subtree, and (for
`copy`) its git commit). Runs three steps in order (`npm run update-sujato:check && :copy &&
:post`):

1. **check** (`../update-sujato-check.mjs`) — for every file we currently track, confirms a file
   still exists at its expected upstream path (`data/sujato/{category}/...` maps to a hardcoded
   `sc_bilara_data/` prefix per category — `CATEGORY_SOURCE_PREFIXES` in `../lib/sujatoSync.js`,
   verified file-by-file against a real sc-data checkout for all 5396 files this pipeline
   currently tracks), and that its segment ids (JSON keys) are byte-identical to `snapshot.json`
   below — only the translated values are allowed to change. Fails loudly, listing every problem
   found, without touching `data/sujato/`.
2. **copy** (`../update-sujato-copy.mjs`) — byte-copies each matched source file over its
   `data/sujato/` counterpart, then writes `data/sujato/manifest.json` recording the `SC_DATA_PATH`
   git commit it copied from (`sourceCommit`/`sourceCommitDate`/`sourceDirty`, plus `updatedAt` and
   `fileCount`). Assumes `check` already passed; fails if `SC_DATA_PATH` isn't itself a git
   checkout, since there'd be nothing to record.
3. **post** (`../update-sujato-post.mjs`) — baked-in terminology fixes applied to every string
   value under `data/sujato/` (`manifest.json` itself excluded, since it's provenance metadata,
   not translation content): `mendicant(s)`/`Mendicant(s)` → `bhikkhu(s)`/`Bhikkhu(s)`, and
   `immerse(s)/immersed/immersing/immersion(s)` → the matching `concentrat...` form. Deliberately
   an explicit word-form list, not a blind `immers` → `concentrat` substring swap — the source text
   also has unrelated words on the same stem, e.g. MN40's "water immerser" (someone dunking
   themselves in water, nothing to do with meditative immersion/concentration), which a substring
   swap turned into the nonsense "water concentrater".

## `npm run update-sujato:snapshot` — manual only

Regenerates `snapshot.json` (below) from the *current* `data/sujato/`. **Not** part of `npm run
update-sujato` and never invoked by `check`/`copy`/`post` themselves — run it by hand, and only
after a `check` failure whose reported segment-id changes you've reviewed and confirmed are
legitimate upstream revisions (not a renamed file or a bad basename match) and then copied in.
Regenerating the snapshot without that review defeats its purpose: it's what makes the *next*
`check` able to detect changes, not the one that just failed.

## `snapshot.json`

The baseline `check` compares a prospective `SC_DATA_PATH` checkout against — originally taken
once against `data/sujato/` as it stood when this pipeline was built, and from then on updated
only via `update-sujato:snapshot` above, never automatically. `check` always compares against this
frozen snapshot, not against the current (already post-processed) contents of `data/sujato/` —
that's what lets it catch a file being renamed/restructured or gaining/losing segments upstream. A
file added to `data/sujato/` by some other means after the snapshot was taken is outside this
pipeline's tracked scope (not in `snapshot.json`'s `files` map) and won't be checked, copied, or
snapshotted by this pipeline until a manual `update-sujato:snapshot` run picks it up.

## Tests

`../update-sujato.test.js` covers all four `runXxx()` exports (`runCheck`/`runCopy`/`runPost`/
`runSnapshot` — the same functions each script's CLI entry point calls) against throwaway
temp-dir fixtures, never the real `data/sujato` or a real `SC_DATA_PATH` checkout: every script
accepts explicit `sujatoDir`/`bilaraRoot`/`snapshotPath`/`manifestPath` overrides for exactly this
reason, defaulting to the real paths only when called from each script's own CLI guard
(`if (import.meta.url === ...)`). Covers a clean check pass, a detected segment-id change, a
missing/relocated file (with and without a basename-fallback hint), copy's byte-for-byte output
and manifest, post's word-form substitution (including the "immerser" false-positive it's meant to
avoid) and idempotency, and a full check-fails → copy → post → snapshot → check-passes round trip.
`requireSourceRoot`/`sourceGitInfo` (`../lib/sujatoSync.js`) are covered separately against a real
throwaway `git init` fixture and `SC_DATA_PATH` env var manipulation, restored after each test.
