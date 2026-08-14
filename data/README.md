# `data/`

Source data for Sutamaya's corpus build — `scripts/build-corpus.mjs` turns this into
`web/public/data/`, the static bundle the web app fetches at runtime. See CLAUDE.md's "Data
pipeline" section for how each piece below is consumed.

## Layout

```
data/
  super-tree.json    whole-canon nav tree (all languages/collections; only its an/dn/mn/sn/kn
                      branches are in scope here — see "Coverage" below)
  tree/               per-collection nav tree (an/dn/mn/sn + kn's 20 sub-books)
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
`sujato/sutta/` share identical segment ids for the same uid — that's the alignment that makes
interlinear Pali possible. Files under `sutta/` are range-batched (e.g.
`an1.1-10_root-pli-ms.json` covers ten suttas in one file), not one-file-per-sutta, except where
`dn`/`mn` suttas happen to be long enough to each fill a file on their own.

## Coverage

Only `an`, `dn`, `mn`, `sn`, and `kn` (its 20 sub-books) have real sutta text in this dataset. The
rest of `super-tree.json` — Chinese/Sanskrit/Tibetan parallels and other alternate-language
texts — has no root/translation text here and isn't wired into any tree this app walks.

## Keeping it up to date

`data/sujato/` (name/blurb/sutta/notes) is refreshed from a local
[suttacentral/sc-data](https://github.com/suttacentral/sc-data) checkout via `npm run
update-sujato` — see [`scripts/update-sujato/README.md`](../scripts/update-sujato/README.md) for
how that works. `data/pali/`, `data/tree/`, `data/super-tree.json`, and `data/html/` have no such
pipeline; they're static and only change by hand.

## License and attribution

Everything under `data/` — Pali root text, Bhikkhu Sujato's English translations, titles, blurbs,
translator notes, and the `html/` structural markup — is sourced from
[SuttaCentral](https://suttacentral.net) (`sc-data`/`bilara-data`), which dedicates its texts to
the public domain under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) — see
[`sc_bilara_data/LICENSE.md`](https://github.com/suttacentral/sc-data/blob/main/sc_bilara_data/LICENSE.md).
Sutamaya modifies Sujato's translation in places (see `scripts/update-sujato/README.md` for the specific
terminology substitutions applied); those modifications are released under the same terms as the
rest of this repo (see the root [`LICENSE`](../LICENSE)), not as a claim over the underlying text.
