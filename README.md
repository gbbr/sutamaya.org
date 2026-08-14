# Sutamaya

An offline-first reader for the Early Buddhist Texts. Two surfaces: a **Library** (corpus tree +
user lists + search) and an **Immersive reader** (inline Pali, docked dictionary, text-range
highlighting, notes, lists, typography controls).

## Stack

- **`web/`** — React + TypeScript + Tailwind CSS + Vite, packaged as a PWA.
- **`server/`** — Node + Express, using Firestore for storage and Google sign-in for session auth.
  Deploys as a single container to Cloud Run — see `deploy.md`.
- **`scripts/`** — builds the static corpus bundle the web app fetches at runtime, and keeps the
  underlying text data in sync with upstream sources.

See `CLAUDE.md` for full architecture and data-pipeline details.

## Getting started

```
npm install
npm run dev            # builds the corpus bundle, then runs server + web concurrently
npm test                # runs the test suite
```

Requires a local Firestore emulator for `npm run dev:server` — see `CLAUDE.md`.

## Data

The source texts come from [SuttaCentral](https://suttacentral.net) (Bilara-style JSON), pulled
into `data/` and lightly transformed at build time by
[`scripts/build-corpus.mjs`](scripts/build-corpus.mjs) into the static bundle the web app fetches
at runtime. See `data/BRIEF.md` and the "Data pipeline" section of `CLAUDE.md` for details.

## License

MIT — see [LICENSE](LICENSE).
