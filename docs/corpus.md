# The corpus

The texts are built ahead of time from `data/` into static files under `web/public/data/`, which
the app fetches and the service worker caches. `npm run build:corpus` builds them in a few seconds,
and `npm run dev` and `npm run build` run it first.

```
data/sujato ───post───▶ data/sujato.post ──┐
data/pali, data/html, data/tree ───────────┼──build-corpus──▶ web/public/data/
data/pli2en_dpd.json ──────────────────────┘
```

The first step applies the editorial rules ([retranslation.md](retranslation.md));
[data/README.md](../data/README.md) describes the dataset and how it's refreshed.

## What the build writes

| File | Holds |
|---|---|
| `corpus.json` | the browse tree, an index of every sutta (reference, titles, description, reading time) and version stamps |
| `text/<uid>.json` | one document's segments: each line's Pali and English, its translator's note, and its role |
| `text-shards/` | the same text in ~1 MB bundles, for Settings' offline download |
| `dict-shards/` | the dictionary in ~256 KB alphabetical ranges, so a tap fetches one |
| `search/` | the whole canon as two plain-text files, English and Pali ([search.md](search.md)) |

A document is a sutta, or a batch of short ones such as `an1.1-10`; there are 4,041. Each segment
is keyed by SuttaCentral's own id, such as `mn10:2.7`, which is also what a highlight anchors on.

`corpus.json` also carries versions: `dataVersion`, a hash of all the text; `dictionaryVersion`;
`searchVersion`, a hash of the search files that also names them; and the DPD release and sc-data
commit it was built from. Settings compares the first two with what a device downloaded, to say
when its offline copy is out of date.

## A segment

Each line joins three aligned sources: the Pali, Bhikkhu Sujato's English, and SuttaCentral's HTML
templates, which say whether a line is prose, verse, a heading, a speaker or a closing line. Lines
follow the Pali's order, lines empty in both languages are dropped, and the translator's notes
attach to their lines.

The build refuses a document whose segment keys are out of order, because highlights compare keys
to work out what overlaps ([offline-sync.md](offline-sync.md#anchored-on-segment-keys)).

## How the library is arranged

How the canon is grouped is a product decision, made in the build (`scripts/lib/collections.js`)
rather than taken from the source:

| Collection | Top level | One level in | Two levels in |
|---|---|---|---|
| DN | its 3 vaggas | the vagga's suttas | |
| MN | its 15 vaggas | the vagga's suttas | |
| SN | 5 groups, from *Verses* to *The Great Chapter* | the group's saṁyuttas, SN 1–56 | the saṁyutta's vaggas |
| AN | its 11 nipātas, *Book of Ones* to *Elevens* | the nipāta's vaggas | |
| KN | 6 books: Snp, Dhp, Ud, Iti, Thag, Thig | Snp and Ud: their vaggas; the others: their documents | the vagga's documents |

- The "fifty" wrappers (paṇṇāsa) that MN, SN and AN put around their vaggas never appear as rows.
- A level stays wherever the source describes it, since the description is what makes it worth
  opening: that's why DN keeps its three vaggas, and Snp and Ud keep theirs.
- The collection names, AN's book names, the KN book list and SN's five group labels are fixed in
  the build; every other title comes from the data.
- **Only a bottom-level group opens a list of suttas.** A row with children expands in place, so an
  id such as `dn` or `sn12` never names a page.

## Group descriptions

A group's description sits above its sutta list. The source writes them at uneven depths — SN's
belong to the saṁyutta, a level above the vaggas that show them — so a group without one borrows
its nearest ancestor's, labelled with where it came from: "About SN12 · Causation". AN has none, and
neither do the four KN books that list their documents directly.

Many descriptions open by naming the group and counting its suttas, which the heading above already
says; an editorial rule trims that opening.

## The dictionary

Tapping a Pali word looks it up in a dictionary derived from the
[Digital Pali Dictionary](https://www.dpdict.net/) (DPD), built in two stages:

1. **`npm run update-data dictionary`** reads a DPD release database and writes
   `data/pli2en_dpd.json`: only the words in the corpus, and for each only the lines the dictionary
   panel shows. A compound that DPD answers with a bare split (`jhāyatha + ānanda`) gets each part's
   meaning after the split. The step is optional: without `DPD_DB_PATH` it is skipped and the
   checked-in file is used. It refuses to write a file more than 10% smaller than the one it
   replaces, unless run with `force`.
2. **The build** trims that file to exactly the words the Reader can tap, splits it into shards,
   then replays every tappable word through the app's own lookup and fails if any resolves
   differently. That catches the build's copy of the app's word splitting drifting from the real one.

The replay proves the shards match the file, not that the file is right; the 10% guard is what
protects the file.

SuttaCentral and DPD spell the niggahita differently — `ṁ` here, `ṃ` there — so the import tries
each word's DPD spellings and converts the answers back. About 90 words in the corpus have no entry
anywhere and show as a bare headword.

## Where to look

| Where | What |
|---|---|
| `scripts/build-corpus.mjs` | the build |
| `scripts/lib/collections.js` | how the library is grouped, and how a segment is assembled |
| `scripts/lib/paliWords.js` | the build's copy of the app's word splitting and shard lookup |
| `scripts/update-data-dictionary.mjs` | the DPD import |
| `web/src/lib/corpus.ts`, `dictionaryShards.ts` | the app's side: loading text, finding groups, looking words up |
