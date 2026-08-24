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
    name/             English titles (Bhikkhu Sujato translation)
    blurb/            one-paragraph descriptions
    sutta/             English text, segmented (Bhikkhu Sujato translation)
    notes/             Bhikkhu Sujato's translator footnotes, segment-keyed
  sujato.post/         generated, gitignored: `sujato/` with this app's editorial rules applied —
                        what build-corpus actually reads. See ../docs/retranslation.md
  html/pli/ms/sutta/   SuttaCentral's per-segment HTML structure (verse/heading/end/speaker/
                       list-item), mirrored from bilara-data — used only to set each segment's
                       `role` at build time, not part of the primary text data
  pli2en_dpd.json      standalone Pali -> English dictionary (142k headwords)
```

Everything is keyed by a **uid** (`dn1`, `sn1.1`, `an1.2`, ...) and a **segment id** (`0.1`,
`1.1.2`, ...); `uid:segment_id` is the atomic key used throughout. `pali/sutta/` and
`html/pli/ms/sutta/` always share the exact same segment ids for the same uid (same document, two
renderings of it); `sujato/sutta/` shares them too except for a handful of Pali-only scribal
colophon lines Bhikkhu Sujato's translation legitimately skips — that's the alignment that makes
interlinear Pali possible. Files under `sutta/` are range-batched (e.g. `an1.1-10_root-pli-ms.json`
covers ten suttas in one file), not one-file-per-sutta, except where `dn`/`mn` suttas happen to be
long enough to each fill a file on their own.

## Coverage

Only `an`, `dn`, `mn`, `sn`, and `kn` (a curated 6 of its books, not the full traditional set —
see the browse-tree table in [CLAUDE.md](../CLAUDE.md)) have real sutta text in this dataset.
Chinese/Sanskrit/Tibetan parallels and other alternate-language texts aren't part of this dataset
and aren't wired into any tree this app walks.

## Refreshing from sc-data

`sujato/`, `pali/` and `html/` are refreshed together from a local
[sc-data](https://github.com/suttacentral/sc-data) checkout. `tree/` has no such pipeline; it's
static and only changes by hand.

```
SC_DATA_PATH=/path/to/sc-data npm run update-data
```

A clean run ends by printing each retranslation rule's triage queue (see
[`../docs/retranslation.md`](../docs/retranslation.md)). A non-empty queue doesn't fail the run —
it's upstream having moved a term into or out of a segment a rule cares about, and it's worked by
hand.

`update-data:check` previews half of that queue before the copy: an allow/deny entry whose segment
no longer contains the term upstream is dead, and it says so one line per rule. `:triage` itself
can't see this until afterwards — it reads `data/sujato`, so it's judging the old text until the
copy lands the new one, and it runs last in the chain behind a `|| true`. Also informational, for
the same reason: the entries can only actually be removed once the copy has happened.

If it refuses to run, it's flagging one of two things — read what it prints before doing anything
else:

- a moved or restructured file upstream (segment ids changed, or a tracked file isn't where it's
  expected). One shape of change is exempt: upstream periodically pads its English files out to the
  root text's full segment id set, and blank additions under `sujato/` can't alter the built text —
  `build-corpus` orders a sutta's segments by the *Pali* keys and drops any segment blank on both
  sides. Those are counted into a one-line "Accepted" summary instead of failing. A removal, an
  addition carrying text, or any addition under `pali/`/`html/` still refuses;
- a **cross-category integrity problem**: the segment-id alignment described above, which
  `update-data:check` verifies both against the upstream checkout and against the local trees. The
  local pass is what catches a snapshot taken from an already-misaligned local state, which would
  otherwise pass every other check. A Bhikkhu Sujato-only segment id is always worth flagging; a
  Pali/html-only one usually isn't.

It'll keep refusing on a plain re-run, since that's the guard doing its job. Once you've confirmed
the change is legitimate:

1. `npm run update-data:copy` — bypasses the guard and copies the new content in. `sujato/` is
   pristine upstream, so `git diff data/sujato/` now shows exactly what upstream changed.
2. `npm run update-data:triage` — work every retranslation queue to empty; see
   [`../docs/retranslation.md`](../docs/retranslation.md).
3. `npm run update-data:post` — regenerate `sujato.post/` and, always, each rule's rewrites in
   `data/diff/`. That directory is checked in, so `git diff data/diff/` now shows which of this
   app's own rewrites upstream moved under — review it alongside `git diff data/sujato/`.
4. `npm test`, and check the reader.
5. `npm run update-data:accept` — records what's now in `sujato/`, `pali/` and `html/` as the new
   baseline, along with each rule's match count, so future `check` runs stop flagging this same
   change.

Nothing here runs automatically, by design. Everything else — matching, copying, the integrity
cross-check — is in `scripts/update-data-*.mjs` and `scripts/lib/dataSync.js`.

## License and attribution

Everything under `data/` — Pali root text, Bhikkhu Sujato's English translations, titles, blurbs,
translator notes, and the `html/` structural markup — is sourced from
[SuttaCentral](https://suttacentral.net) (`sc-data`/`bilara-data`), which dedicates its texts to
the public domain under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) — see
[`sc_bilara_data/LICENSE.md`](https://github.com/suttacentral/sc-data/blob/main/sc_bilara_data/LICENSE.md).
Sutamaya modifies Bhikkhu Sujato's translation in places (see [`../docs/retranslation.md`](../docs/retranslation.md));
those modifications are released under the same terms as the rest of this repo (see the root
[`LICENSE`](../LICENSE)), not as a claim over the underlying text.
