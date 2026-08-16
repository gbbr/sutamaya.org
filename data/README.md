# `data/`

Source data for Sutamaya's corpus build — `scripts/build-corpus.mjs` turns this into
`web/public/data/`, the static bundle the web app fetches at runtime. See CLAUDE.md's "Data
pipeline" section for how each piece below is consumed.

## Layout

```
data/
  tree/               per-collection nav tree (an/dn/mn/sn + kn's 6 curated books, see below)
  manifest.json        provenance of the last `npm run update-data` copy (sc-data commit, when,
                        how many files) — covers sujato/pali/html together, since one copy run
                        refreshes all three from the same checkout
  pali/
    name/             Pali titles
    sutta/             Pali text, segmented
  sujato/
    name/             English titles (Sujato translation)
    blurb/            one-paragraph descriptions
    sutta/             English text, segmented (Sujato translation)
    notes/             Sujato's translator footnotes, segment-keyed
  html/pli/ms/sutta/   SuttaCentral's per-segment HTML structure (verse/heading/end/speaker/
                       list-item), mirrored from bilara-data — used only to set each segment's
                       `role` at build time, not part of the primary text data
  pli2en_dpd.json      standalone Pali -> English dictionary (142k headwords)
```

Everything is keyed by a **uid** (`dn1`, `sn1.1`, `an1.2`, ...) and a **segment id** (`0.1`,
`1.1.2`, ...); `uid:segment_id` is the atomic key used throughout. `pali/sutta/` and
`html/pli/ms/sutta/` always share the exact same segment ids for the same uid (same document, two
renderings of it); `sujato/sutta/` shares them too except for a handful of Pali-only scribal
colophon lines Sujato's translation legitimately skips — that's the alignment that makes
interlinear Pali possible. `npm run update-data:check` verifies this cross-category alignment
itself, not just each category's own segment-id stability — see
[`scripts/update-data/README.md`](../scripts/update-data/README.md). Files under `sutta/` are
range-batched (e.g. `an1.1-10_root-pli-ms.json` covers ten suttas in one file), not
one-file-per-sutta, except where `dn`/`mn` suttas happen to be long enough to each fill a file on
their own.

## Coverage

Only `an`, `dn`, `mn`, `sn`, and `kn` (a curated 6 of its books, not the full traditional set —
see the browse-tree table in [CLAUDE.md](../CLAUDE.md)) have real sutta text in this dataset.
Chinese/Sanskrit/Tibetan parallels and other alternate-language texts aren't part of this dataset
and aren't wired into any tree this app walks.

## Keeping it up to date

`data/sujato/`, `data/pali/`, and `data/html/` are refreshed together from a local
[suttacentral/sc-data](https://github.com/suttacentral/sc-data) checkout via `npm run
update-data` — see [`scripts/update-data/README.md`](../scripts/update-data/README.md) for how
that works. `data/tree/` has no such pipeline; it's static and only changes by hand.

## License and attribution

Everything under `data/` — Pali root text, Bhikkhu Sujato's English translations, titles, blurbs,
translator notes, and the `html/` structural markup — is sourced from
[SuttaCentral](https://suttacentral.net) (`sc-data`/`bilara-data`), which dedicates its texts to
the public domain under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) — see
[`sc_bilara_data/LICENSE.md`](https://github.com/suttacentral/sc-data/blob/main/sc_bilara_data/LICENSE.md).
Sutamaya modifies Sujato's translation in places (see `scripts/update-data/README.md` for the specific
terminology substitutions applied); those modifications are released under the same terms as the
rest of this repo (see the root [`LICENSE`](../LICENSE)), not as a claim over the underlying text.
