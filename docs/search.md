# Full-text search

One search box finds suttas by what's written *about* them — number, title, description, the
reader's notes, the names of their lists — and by the text itself, in English or Pali, across the
whole canon, offline. It also finds the collections and lists a query names.

## Two halves

- **Metadata** is searched on the main thread, on every keystroke, since the reader's notes and
  lists live there and the pass is quick.
- **The text** is searched in a Web Worker, which holds the whole canon and scans it for each query.
  Its hits arrive a moment later and merge into the same ranked list.

## No index

The corpus is small enough to scan in full on every keystroke — tens of milliseconds on a laptop —
so there is no index, no stemmer and nothing to keep in step with the build. **The text is the
index.**

The build writes three files for it ([corpus.md](corpus.md)):

| File | Holds |
|---|---|
| `search/en.<version>.txt` | every segment's English, one per line, in canonical order |
| `search/pa.<version>.txt` | the same segments' Pali, line for line |
| `search/map.<version>.json` | where each sutta starts in each file |

A marker line opens each paragraph and each sutta, so a match can't run from one into the next.
About 120,000 segments make 18 MB of text, 2.7 MB over the wire. The file names carry a hash of
their contents, so a cached copy is never stale.

## Matching

- **Folding.** Case and diacritics are ignored — a typed `a` matches `ā`, a straight apostrophe a
  curly one — while matches are found in the original text, so what gets marked is exact.
- **English** matches whole words, singular or plural either way: `four noble truths` finds "the
  noble truth of".
- **Pali** matches the start of a word, since Pali inflects at the end: `nibbana` finds
  *nibbānaṁ*. A word under four letters must match whole. A trailing English plural is dropped
  (`arahants`), and a query of several words is also tried as one compound, since `maha kassapa` is
  written *mahākassapa*.
- **Function words** — `the`, `of`, `is` and some fifty others — aren't required and don't count
  toward ranking, but stay in the phrase. `not` and `no` count: they are the whole of "not-self".
- **Both languages** are scanned separately, and a sutta keeps its better result; on a tie the
  English shows.
- **The sutta being read** matches a word anywhere, inside a longer one too — see
  [The sutta being read](#the-sutta-being-read).

Searching the Pali matters because the editorial layer moved the English away from words readers
type: the text says "extinguishment" and "deeds", never "nibbana" or "karma".

## Ranking

Every hit lands in one bucket, best first:

| | Bucket |
|---|---|
| 0 | the query as typed, in the reference, title or Pali title |
| 1 | every word, in the title |
| 2 | the query as typed, in a description, note or list name |
| 3 | every word, anywhere the metadata search reads |
| 4 | the query as typed, in the text |
| 5 | every word, in one paragraph of the text |
| 6 | every word, anywhere in the text |

Within a bucket, suttas are ordered by how often the query's *rarest* word occurs — so a sutta has
to carry every word, not many of one — then by whether the reader has filed, noted or highlighted
it. There's no length normalisation: measured against a curated topic index, the plain count beat
every weighting tried.

A paragraph is what the source numbers as one (`mn10:2.1` is in paragraph 2). For almost a third of
suttas the whole text is one paragraph, and bucket 5 adds nothing. The results show the first 80
hits.

## Query expansion

A hand-written table (`lib/search/expansion.ts`) adds alternative queries — never replacements — for
what readers type but this corpus doesn't say:

- **Vocabulary:** the words the editorial layer replaced (`mendicant` → `bhikkhu`, `concentration`
  → `composure`), and the words of other translations (`cankers` → `defilements`, `sympathetic
  joy` → `rejoicing`).
- **Sutta names:** discourses known by a name that is neither their English nor their Pali title
  (`fire sermon` → *Burning*, `sigalovada` → *Advice to Sigālaka*).

An English query gains English alternatives; Pali is added only where it is the reader's one
handle, since a Pali word can match inside an unrelated compound. The table is walked longest
phrase first, a key inside one that already matched is skipped, and a query gains at most four
alternatives, each costing a scan.

## Off the main thread

The search text never reaches the main thread. The worker fetches and holds it — about 33 MB in
memory, for as long as the app is open — and answers one search at a time. A reader types faster
than a scan, so only the newest waiting query runs; the ones typed over are dropped.

## Late, or never

The search text is fetched the first time a search field is focused, and search works at every stage:

- **Before the first answer**, the results area says "Searching sutta text…" rather than showing the
  metadata half alone, which would reorder under the reader a moment later. It fades in after
  150 ms, so a quick answer shows nothing.
- **Once answered**, each keystroke keeps the previous results on screen, with a small spinner,
  until the new answer replaces them.
- **If the text never arrives** — offline before it was ever fetched, a failed fetch, no Web Worker
  — search answers from metadata alone and says the text isn't covered. A failed fetch is retried
  on the next search.

Settings' offline download fetches the search text too, so a device that ran it always has it.

## Snippets

A hit the query reached through the text shows the paragraph it was found in, windowed around the
match and marked with the words that matched — including, where an expansion found it, the
expansion's words. A Pali hit shows the Pali with that paragraph's English beneath. Opening such a
row takes the Reader straight to that passage, and a Pali hit arrives with the Pali of each line
holding a marked word open, as find-in-page opens a collapsed section it finds a match in.

A row shows what it opens. Where the query reached a sutta through the row's own lines — its number,
title, Pali title, description or the reader's note — that line is the answer: the row shows no
paragraph and opens the sutta at the top. A sutta reached only through the name of a list holding it
says nothing about itself, so it keeps its paragraph.

## The sutta being read

The Reader's search gives the sutta on screen a section of its own, *In this sutta*, above the
other suttas: a row for each line of it holding the query, in reading order, windowed on its
paragraph. The first shows, and *more* adds ten at a time, up to 80. A row takes the Reader straight
to its line. Finding in the page in hand isn't a search of the canon, so it isn't saved to recent
searches.

It matches as find-in-page does: a word anywhere, inside a longer word too, so `sampajann` finds
*satisampajañña* and *asampajañña*, where the search of the canon, matching the start of a word,
finds neither. The price is the same as find-in-page's — `sati` also stops on *bhavissati* — which
matters little in reading order and would bury a ranking. A line shows in English where its English
holds the query, else in Pali with its English beneath, and a line shown in Pali opens with its Pali
showing.

Reopened on the same sutta, the search comes back as it was left — the query, the lines shown, the
scroll and the selected row — so the next result is a tap away. The query is selected, so typing
starts a new search. Moving to another sutta starts it afresh.

## Collections and lists

A collection matches where every query word starts a word of its English or Pali name, or the whole
query run together does, as `sutta nipata` does *Suttanipāta* — matching anywhere in a word would let
`vagga` name most of the tree. Its reference matches too, typed whole, as `sn 35` finds SN35 — but
not a range like SN35.1–10, since a number inside one names a sutta. One that only expands opens
expanded in the tree, not on an empty list.

## Recent searches

With the box empty, search lists the reader's last eight searches, in the Library and the Reader
alike, and a tap runs one again. On a wide Library they take the tree's column, and stay there
beside the results, the search on screen marked.

A search is saved, at the top, when one of its results is opened — a sutta, a list or a collection,
by tap, click or Enter. Typing alone saves nothing, so a half-typed word or a typo never lands
there, and running one again from the history leaves the order alone, so its rows hold still under
the pointer. Case, diacritics and spacing don't make a different search.

The history stays on the device, unsynced: one copy that every screen and tab reads, so a change
made in one shows in all. Signing out clears it.

## Golden queries

`scripts/search-golden.json` lists queries and the suttas each should put near the top — famous
discourses, similes by name, people, Pali terms. `npm test` runs them against a real corpus build.
A few are pending, where the ranking as designed doesn't reach the sutta; they're reported rather
than failed, and any that start passing are held to it.

## Measured baseline

Against 16,467 topic-to-sutta citations from a curated index of this canon: 75.9% found, the first
right answer at rank ~2 on average (MRR 0.516), and precision at 10 of 19.5%, against a ceiling of
39.7%. About a fifth of the misses contain no word of the topic in either language. The index is
third-party data that can't be distributed with the project, so neither it nor the harness is in
the repo.

## Accepted limits

- **Frequency isn't aboutness.** A sutta that never names its subject can't be found by it;
  expansion narrows this without closing it.
- **Broad queries are broad.** "suffering" is in hundreds of suttas, and there's no filter by
  collection.
- **No English stemming beyond plurals:** "arise" doesn't find "arising".
- **No typo tolerance.**

## Where to look

| Where | What |
|---|---|
| `web/src/lib/search/metadata.ts` | metadata search, list and collection matching, the shared wording, the function words |
| `web/src/components/search/SearchListHits.tsx` | the collections and lists block |
| `web/src/lib/search/text.ts` | matching, ranking and snippets over the text |
| `web/src/components/search/ReaderSearchOverlay.tsx` | the Reader's search |
| `web/src/lib/search/worker.ts`, `textClient.ts` | the worker, and the main thread's side of it |
| `web/src/lib/search/expansion.ts` | the expansion table |
| `web/src/hooks/useCorpusSearch.ts` | the two halves combined for a page |
| `web/src/lib/search/recentSearches.ts`, `web/src/hooks/useRecentSearches.ts` | the history, and the hook that reads it |
| `web/src/components/search/RecentSearches.tsx` | the list both searches draw |
| `scripts/search-golden.json`, `web/src/lib/search/__tests__/golden.test.ts` | the golden queries |
