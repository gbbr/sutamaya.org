# `data/`

The source texts and dictionary the corpus is built from, checked in. `npm run build:corpus` turns
them into the files the app fetches ([docs/corpus.md](../docs/corpus.md)).

## Layout

```
data/
  pali/            the Pali: sutta text, segmented, and titles
  sujato/          Bhikkhu Sujato's English exactly as upstream: text, titles, descriptions, notes
  sujato.post/     the same with this app's editorial rules applied (generated, git-ignored)
  html/            SuttaCentral's per-line markup, used only to give each line its role
  tree/            each collection's structure: DN, MN, SN, AN and the six KN books
  diff/            what the editorial rules change, as diffs (rewritten on every run, checked in)
  pli2en_dpd.json  the dictionary, generated from DPD and trimmed to this corpus
  manifest.json    which sc-data commit the texts were last copied from
```

## Keys and alignment

Every line is keyed by a **uid** and a **segment id**: `mn10` and `2.7` make `mn10:2.7`. The Pali
and the HTML markup share exactly the same ids for a document, and Sujato's English shares them
too, bar a few Pali-only scribal lines he skips. That alignment is what gives each English line its
Pali.

Files are often batched — `an1.1-10_root-pli-ms.json` holds ten suttas — so a file name doesn't
always name a sutta.

## Coverage

The four main collections, DN, MN, SN and AN, and six books of the fifth: Snp, Dhp, Ud, Iti, Thag
and Thig — 4,041 documents in all. SuttaCentral's parallels in other languages aren't included.

## Refreshing from SuttaCentral

`sujato/`, `pali/` and `html/` are refreshed together from a local checkout of
[sc-data](https://github.com/suttacentral/sc-data). `tree/` isn't; it changes only by hand.

```
SC_DATA_PATH=/path/to/sc-data npm run update-data          # plan
                              npm run update-data apply
                              npm run update-data accept
```

- **plan** is read-only: what changed upstream, and what it breaks here — moved or resegmented
  files, lines that no longer align, editorial rules that stopped matching. Files that only gained
  blank English lines pass, since they can't change the built text.
- **apply** copies the new text in and re-runs the editorial rules, leaving the working tree dirty
  for review.
- **accept** records that tree as the new baseline, the one the next `plan` compares against. Run
  it only once you've reviewed:

```
git diff data/sujato/               what upstream changed
git diff data/diff/00-all.diff      what that changes in the shipped text
npm run update-data triage          what it did to the editorial rules
```

`apply` is idempotent, so fixing a rule and applying again is the loop; then `npm test`, then
`accept`. Each step ends by naming the next. `manifest.json` records where you are: `sourceCommit`
is the last copy, `snapshotCommit` the last one accepted. The baseline itself lives in
`scripts/update-data/snapshot.json`, and a refresh copies only the files it names — so a sutta new
upstream needs the snapshot regenerated before it comes in.

The rule-authoring commands (`post`, `counts`, `triage`) are in
[docs/retranslation.md](../docs/retranslation.md); `npm run update-data help` lists every step.

## The dictionary

```
DPD_DB_PATH=/path/to/dpd.db npm run update-data dictionary
```

rebuilds `pli2en_dpd.json` from a
[DPD release](https://github.com/digitalpalidictionary/dpd-db/releases) (the `dpd.db.tar.xz`
asset). `apply` runs it too. It is the pipeline's only optional step: without `DPD_DB_PATH` it is
skipped, and says so. How the dictionary is built is in
[docs/corpus.md](../docs/corpus.md#the-dictionary).

## License and attribution

Everything here but the dictionary — the Pali, Bhikkhu Sujato's translations, titles, descriptions,
notes and markup — comes from [SuttaCentral](https://suttacentral.net), which dedicates it to the
public domain under [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
([sc_bilara_data/LICENSE.md](https://github.com/suttacentral/sc-data/blob/main/sc_bilara_data/LICENSE.md)).
This app's changes to the translation are released under the repository's
[LICENSE](../LICENSE), not as a claim over the text.

`pli2en_dpd.json` is generated from the [Digital Pali Dictionary](https://www.dpdict.net/) by
Bodhirasa, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/):
attribution, non-commercial use, and share-alike on anything derived from it. The file records the
DPD release it came from, and the build passes that on to the app.
