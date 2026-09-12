# Sutamaya

An offline-first reader for the Early Buddhist Texts. @README.md is the map: what each part of the
repo does, where it lives, and every npm command. This file holds what the map doesn't: where to
read before changing something, the rules that span files, and how documentation is written here.

## Read before you change

| Before changing | Read |
|---|---|
| the offline mirror, the sync, or the Worker's data routes | [docs/offline-sync.md](docs/offline-sync.md), the design and its invariants |
| a retranslation rule, or anything under `data/sujato*` | [docs/retranslation.md](docs/retranslation.md), then the `retranslate` skill |
| search | [docs/search.md](docs/search.md) |
| the corpus build, the browse tree, the dictionary | [docs/corpus.md](docs/corpus.md) |
| the Worker: routes, schema, sign-in, hostnames | [docs/backend.md](docs/backend.md) |
| routing, providers, caching, the service worker | [docs/web-app.md](docs/web-app.md) |
| the native apps and their updates | [docs/native-apps.md](docs/native-apps.md) |
| deploys, staging, migrations | [docs/deploy.md](docs/deploy.md) |
| local setup, ports, secrets | [docs/development.md](docs/development.md) |
| end-to-end specs | [docs/e2e.md](docs/e2e.md) |

Offline sync covers `web/src/lib/{mirror,sync,mirrorView,mirrorDb,listTree}.ts`,
`web/src/context/UserDataContext.tsx`, `worker/src/routes/data.js` and
`worker/src/lib/{writes,listTree,userData}.js`.

## Working here

- **`npm run typecheck` is the only type check.** The build transpiles without checking; CI runs it.
- **`npm test` is the unit suite. `npm run test:e2e` is separate** and starts the dev servers itself.
- **`npm run dev:worker` applies local migrations first.** A migration added while the Worker runs
  needs a restart. The unit tests migrate a fresh database of their own, so they stay green when the
  local one is behind.
- **Deploys name their environment** (`deploy:prod`, `deploy:staging`); a bare `npm run deploy`
  refuses to run.
- **Never hand-edit `data/sujato/`**: every change to the English is a rule. Don't run
  `update-data apply` or `accept` unless asked.
- **`web/public/data/` is generated and git-ignored.** `data/diff/` is generated too, but checked in.

## Rules that span files

- **Signing in is never required.** A reader who hasn't signed in gets a local account and a mirror
  of their own, which signing in adopts. Nothing in the UI is gated on a session except the sync.
- **Every D1 query on user data is scoped `AND user_id = ?`** — reads, writes and existence checks
  alike. It is the only thing separating one account's rows from another's.
- **User data is local-first.** Rows carry an `mtime` stamped when the reader acts, the last write
  wins per row, and deletes are tombstones every read skips ([docs/offline-sync.md](docs/offline-sync.md)).
- **Changing what the mirror stores bumps its IndexedDB version**, in the same change.
- **Migrations only add**; a destructive schema change takes two deploys ([docs/deploy.md](docs/deploy.md)).
- **Some logic exists twice, on purpose**, since the workspaces share no modules. Change one, change
  the other:
  - list-tree repair and snapshot shaping — `worker/src/lib/{listTree,userData}.js` and
    `web/src/lib/{listTree,mirrorView}.ts`;
  - the automatic lists' ids and caps — `web/src/lib/autoLists.ts`;
  - the segment-key comparator and the Pali word splitter — `scripts/lib/` and `web/src/lib/`;
  - the corpus lookups behind link previews — `worker/src/shareMeta.js` and `web/src/lib/corpus.ts`.

  Parity tests catch drift in the first three.
- **`APP_PATHS` (`worker/src/index.js`) and `assets.run_worker_first` (`wrangler.jsonc`) change
  together**, or an app path skips the Worker ([docs/backend.md](docs/backend.md)).
- **`WEB_ORIGIN` is always the app's origin**, never the landing page's: sign-in builds its redirects
  from it.
- **Staging runs production's build.** Whatever differs is decided from the hostname at runtime,
  never compiled in.
- **Dictionary shards are ordered with plain `<` and `>`**, never `localeCompare`, in the build and
  the app alike.
- **Import the router and its hooks from `react-router`**, never `react-router/dom`.
- **`<StrictMode>` is off.** Turning it on means checking every effect against a double run first.
- **Drag and drop uses Pointer Events**, never HTML5 drag-and-drop.
- **A Capacitor plugin on the startup path is imported statically**, never behind `await import()`.
- **The app ships as one main chunk, on purpose.** Raise `build.chunkSizeWarningLimit` only after
  checking what grew.
- **`docs/translation-changes.md` is linked from the app and the landing page.** Never rename or
  move it.

## Writing documentation

Everything written in this repo — the docs and the comments in the code — explains **how things
work and why**, at a level the code can't show at a glance. The code already says *what* it does;
never restate it as prose.

### Docs

- **Explain the system, not the code**: what the pieces are, how they fit, the flows, the rules that
  must hold and why. Never walk through functions, constants and branches.
- **Name files and symbols only as signposts** to where something lives, and end a doc with a short
  "Where to look" table.
- **Keep sections short** — a few sentences, a table or a list. A number goes in only when it is the
  design: a cap the reader sees, a limit a deploy must respect.
- **Present tense, no history.** Say what is, never how it came to be or what it replaced.
- **Put things where they belong.** README.md is the developer's map, a short paragraph per part
  linking to its doc. `docs/` holds one doc per subsystem. This file holds only rules and pointers.
  `docs/translation-changes.md` is written for readers, not developers.
- **Change the doc with the code.** A change to how something works updates its doc in the same
  change.
- **Keep headings stable.** Code comments cite them by name; renaming one means updating what cites
  it.

### Comments

- **JSDoc or GoDoc style, giving purpose and reason**: what something is for, and why a non-obvious
  choice was made — never what the next lines do.
- **Present tense, no history**: no "used to", "was changed to", "we tried".
- **Point to a doc by file and heading** — `docs/offline-sync.md's "Sync state"` — rather than
  repeating it.

Older text written before these rules is not a model. Follow the rules, not what's nearby.
