# Sutamaya

An offline-first reader for the Early Buddhist Texts: the Pali discourses in Pali and Bhikkhu
Sujato's English, with a dictionary a tap away, highlights, notes and lists. It runs in the
browser, installs as an app, and builds for iOS and Android. Live at
[sutamaya.org](https://sutamaya.org).

## Contents

- [Getting started](#getting-started)
- [Repository layout](#repository-layout)
- [The web app](#the-web-app)
- [Search](#search)
- [Offline sync](#offline-sync)
- [The corpus](#the-corpus)
  - [Refreshing the texts](#refreshing-the-texts)
  - [The editorial layer](#the-editorial-layer)
  - [The dictionary](#the-dictionary)
- [Backend](#backend)
- [Native apps](#native-apps)
- [Deploying](#deploying)
- [Tests](#tests)
- [npm commands](#npm-commands)
- [License](#license)

## Getting started

Needs Node 24.15 or later.

```
npm install
npm run dev        # the app on http://localhost:5173
```

That builds the corpus, then runs the app and a local API with its own database. No Cloudflare
account is needed. Signing in locally takes a few secrets in `.dev.vars`; without them the app
runs signed out, which is a complete mode, not a degraded one.

More: [docs/development.md](docs/development.md) covers secrets, ports, running a second copy and
testing on a phone.

## Repository layout

```
web/             the app — React, TypeScript, Tailwind, Vite
  src/           pages, components, state (context/), hooks, logic (lib/)
  public/        landing page, fonts, icons; data/ is the built corpus (git-ignored)
  ios/ android/  the native projects
worker/          the backend — a Cloudflare Worker and its database migrations
scripts/         corpus build, update-data, deploy and native tooling
data/            source texts and dictionary, checked in
e2e/             end-to-end tests
docs/            how each part works
wrangler.jsonc   the Worker's config, production and staging
CLAUDE.md        working rules for Claude Code
```

## The web app

Two screens. The **Library** browses the five collections, holds the reader's own lists, and
searches. The **Reader** shows a sutta in English with each line's Pali a tap away, a dictionary
on every Pali word, and the reader's highlights, notes and lists.

It is a single-page React app, routed with React Router. A service worker caches the app and
whatever the reader opens, so both work offline; Settings can download the whole canon.

More: [docs/web-app.md](docs/web-app.md).

## Search

One box finds suttas by number, title, description, the reader's notes and list names — and by
their text, in English or Pali, across the whole canon. The text is scanned without an index, in a
background worker, and stays searchable offline after the first search.

More: [docs/search.md](docs/search.md).

## Offline sync

Lists, notes, highlights and reading history are saved on the device first and synced afterwards,
so nothing needs a network or an account. The last edit wins, per item. Signing in moves whatever
was made signed out onto the account.

More: [docs/offline-sync.md](docs/offline-sync.md).

## The corpus

`data/` holds the texts from [SuttaCentral](https://suttacentral.net): the Pali, Bhikkhu Sujato's
English and notes, titles, descriptions, and the markup that tells verse from prose.
`npm run build:corpus` turns it into the static files the app fetches: the browse tree, each
sutta's text, the dictionary and the search text. The build also decides how the library is
grouped, which is a product choice rather than the source's.

More: [docs/corpus.md](docs/corpus.md), and [data/README.md](data/README.md) for the dataset.

### Refreshing the texts

`npm run update-data` refreshes `data/` from a local checkout of SuttaCentral's
[sc-data](https://github.com/suttacentral/sc-data) in three steps: **plan** (what changed upstream,
and what it breaks), **apply** (copy it in), **accept** (once the diff is reviewed).

More: [data/README.md](data/README.md).

### The editorial layer

The app ships an edited version of Bhikkhu Sujato's translation: some recurring terms rendered
differently (*mendicant* → *bhikkhu*, *immersion* → *composure*), several dozen lines reworded,
and some group descriptions trimmed. Every edit is a declared rule, re-applied on each refresh, and
`data/diff/` shows what the rules do to the shipped text.

More: [docs/retranslation.md](docs/retranslation.md) for how it works,
[docs/translation-changes.md](docs/translation-changes.md) for what changed (written for readers),
and the [retranslate skill](.claude/skills/retranslate/SKILL.md) for Claude Code.

### The dictionary

Lookups come from the [Digital Pali Dictionary](https://www.dpdict.net/), cut down to the words
this corpus uses and split into small shards, so a tap fetches one. `npm run update-data dictionary`
rebuilds it from a DPD release.

More: [docs/corpus.md](docs/corpus.md).

## Backend

One Cloudflare Worker (Hono) with a D1 database for user data. It serves the API and, from the
same origin, the built app and corpus. Two hostnames share it: `sutamaya.org` is the landing page,
`app.sutamaya.org` the app.

Sign-in is by Google or by an emailed code. Sessions are signed cookies, or tokens in the native
apps.

More: [docs/backend.md](docs/backend.md).

## Native apps

The iOS and Android apps wrap the same web build in [Capacitor](https://capacitorjs.com), with the
whole corpus bundled, so they read offline from the first launch. New web code and texts reach
them as over-the-air updates, served by the Worker.

More: [docs/native-apps.md](docs/native-apps.md).

## Deploying

`npm run deploy:prod` tests, builds, migrates the database and uploads to Cloudflare.
`npm run deploy:staging` does the same for staging, a full copy on `staging.sutamaya.org` with its
own database. Nothing deploys on push.

More: [docs/deploy.md](docs/deploy.md).

## Tests

Unit tests (`npm test`) cover the app, the Worker and the scripts. `npm run typecheck` is the only
type check, since the build skips it. `npm run test:e2e` drives real browsers with Playwright. CI
runs all three on pull requests and pushes to `main`.

More: [docs/e2e.md](docs/e2e.md).

## npm commands

| Command | Does |
|---|---|
| `npm run dev` | Build the corpus, run the app and API locally |
| `npm run dev:web`, `dev:worker` | Run one of the two |
| `npm test` | Unit tests |
| `npm run typecheck` | Type-check the app |
| `npm run test:e2e` | End-to-end tests |
| `npm run build:corpus` | Rebuild `web/public/data/` from `data/` |
| `npm run build` | Production build |
| `npm run update-data` | Refresh the texts and maintain the editorial rules; `help` lists every step |
| `npm run deploy:prod`, `deploy:staging` | Deploy |
| `npm run seed:staging` | Copy the local database over staging's |
| `npm run build:native` | Build the native bundle into the iOS and Android projects |
| `npm run dev:ios`, `dev:android`, `dev:native` | Run the native app against local servers, with live reload |
| `npm run devices` | List the simulators and devices those can run on |
| `npm run release:ota` | Publish an over-the-air update to the native apps |
| `npm run usage-report` | Aggregate usage figures from the production database |
| `npm run migrate:local` | Apply migrations to the local database (`dev:worker` does it first) |

## License

Code: MIT, see [LICENSE](LICENSE). Texts: SuttaCentral, public domain (CC0). Dictionary: derived
from DPD, CC BY-NC-SA 4.0. Details in [data/README.md](data/README.md).
