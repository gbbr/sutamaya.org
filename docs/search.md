# Full-text search

The reader types a word or a phrase and finds the suttas that contain it, in either language,
offline. It extends `searchCorpus()` in `web/src/lib/search/metadata.ts`, which reads everything *about* a
sutta — numbers, titles, Pali titles, group descriptions, the reader's own notes and list names —
with the text *in* it.

```
web/src/lib/search/metadata.ts       search over everything *about* a sutta, and the shared copy
web/src/lib/search/text.ts           matching, ranking and snippets — pure, over a TextIndex
web/src/lib/search/worker.ts         the Web Worker that holds the text and scans it
web/src/lib/search/textClient.ts     the main thread's side: the worker's lifecycle and status
web/src/lib/search/expansion.ts      the query-expansion table
web/src/lib/search/match.ts          the folded offsets a hit's highlighting is painted at
web/src/lib/search/text.test.ts      the matching, ranking and snippet rules, over a hand-built blob
web/src/lib/search/textClient.test.ts loading, releasing and one-search-at-a-time, over a stub worker
web/src/lib/search/golden.test.ts    the golden query set, run against a real corpus build
scripts/build-corpus.mjs             writes the three files the search reads
```

## Scale

The corpus is small enough that the conventional apparatus is unnecessary. Measured over
`web/public/data/text/`:

| | |
|---|---|
| suttas | 4,041 |
| segments | 125,439 · median 8 words |
| English blob | 8.8 MB raw · **~1.4 MB served** |
| Pali blob | 10.7 MB raw · **~1.5 MB served** |
| distinct English word types | 13,523 |
| one keystroke, expansions included | **9–150 ms**, median 43 ms |

A brute-force scan of the whole canon is faster than a keystroke, so there is no index, no stemmer,
no stored statistics and nothing to keep in step with the corpus build. **The text is the index.**

## The data

Three files, written by `scripts/build-corpus.mjs` from the segments it already emits into
`web/public/data/text/`:

```
web/public/data/search/en.<dataVersion>.txt     segment strings, "\n"-joined, canonical sutta order
web/public/data/search/pa.<dataVersion>.txt     the same segments' Pali
web/public/data/search/map.<dataVersion>.json   [[uid, enOffset, paOffset], …] — one entry per sutta
```

Plain UTF-8, served compressed. Both languages carry one line per segment in the same order, so a
line number in one file addresses the same segment in the other. **Offsets are per language**: the
two blobs hold the same lines at different lengths, so one number cannot address both.

**A line holding only `\x1e` opens each paragraph, and each sutta.** It is what the "every word in
one paragraph" bucket counts, and being neither a letter nor whitespace it is also what stops a
phrase match running from the end of one paragraph into the next, or out of one sutta into another.

`map` is ~4,000 entries (37 KB brotli). A match at character offset *N* resolves by binary search to
the sutta whose range contains it, and to the paragraph opened by the last marker before it.

**The filename carries `dataVersion`.** One file per corpus means versioning costs one URL, so these
can be `CacheFirst` and never go stale — the per-document staleness described in CLAUDE.md's "A
corpus fix reaches a cached device one document at a time" does not apply here.

## Matching

The query is folded with the existing `searchKey()` — NFD, combining marks stripped, the curly
apostrophe folded to the straight one, lowercased — then compiled to a regular expression run
against the **unfolded** text. One copy of the text stays in memory and match offsets are exact,
which a parallel folded copy would not guarantee.

Folding is inverted per character when the expression is built, so a typed ASCII letter matches its
Pali forms. Regex metacharacters in the query are escaped first.

```
a → [aā]   i → [iī]   u → [uū]   m → [mṁṃ]
n → [nñṅṇ] t → [tṭ]   d → [dḍ]   l → [lḷ]   ' → ['‘’]
```

The apostrophe belongs there because the corpus writes `’` and a keyboard types `'`: without it
`elephant's footprint` misses the sutta titled with it. The fold is one character for one, so the
offsets `lib/search/match.ts` paints its highlights at stay aligned.

**Word boundaries are `(?<!\p{L})` and `(?!\p{L})` with the `u` flag, never `\b`.** JavaScript's `\b`
is ASCII-only, so it treats `ā` as a non-word character and would match "nibbāna" inside
"mahānibbāna".

### English

Whole words. A trailing `s` is stripped from the query word and an optional `(?:s|es)?` added back,
so the query and the text may each be singular or plural: `four noble truths` finds "the noble truth
of…", and `truth` finds "the noble truths". Stripping only on one side leaves half the queries
looking plainly broken.

### Pali

**A leading boundary only — a prefix.** Pali inflects at the end, so the headword a reader knows is a
prefix of most of its forms, and requiring a trailing boundary finds almost nothing:

| query | exact word | prefix | | prefix length | suttas matched |
|---|---|---|---|---|---|
| `nibbana` | 6 | **274** | | `sa` | 3,770 |
| `kamma` | 6 | **310** | | `sat` | 1,782 |
| `metta` | 23 | **105** | | `sati` | **645** |

Three rules follow from that:

- **Four characters minimum** for the prefix rule. Below four, fall back to whole-word matching so
  `ko` and `na` still work. English needs no minimum — whole-word matching is self-limiting.
- **Strip a trailing English plural** (5+ characters ending in `s`) before prefix matching. Readers
  type English plurals of Pali words: `arahants` matches nothing against *arahanto*, and finding 102
  suttas instead of 0 costs one `slice`.
- **Scan the space-joined form as its own query** when more than one word was typed. The corpus
  writes Pali compounds joined — *mahākassapa*, never "mahā kassapa" — and the parts of a compound
  are not words in their own right, so requiring each of them separately finds nothing. The joined
  form has to be a scan of its own, not an alternative inside the phrase pattern.

**Searching the Pali is not optional.** The editorial layer moved the English away from the words
readers type: `nibbana`, `karma` and `absorption` match no English at all, and `concentration`
matches one sutta, because the shipped text says "extinguishment", "deeds", "jhāna" and "composure".
The Pali side answers those queries.

### Function words

An ordinary English stopword list — `the`, `of`, `is`, `to` and some fifty others — is dropped from
the query's **required words** and from the **occurrence count** that orders a bucket, in both
languages. `mind is luminous` is a search for "mind" and "luminous", scored on those two.

Three things it deliberately does not do. The **phrase keeps every word**, so bucket 4 still matches
"mind is radiant" as typed and ranks it above the suttas that merely hold the two words. A query
holding nothing but function words searches for them literally, so `the` still finds "the". And
**`not` and `no` are not on the list** — they are the whole of "not-self".

### Both languages

English and Pali are scanned and scored **independently**, and a sutta keeps its better result. A
query is written in one language or the other; mixing a word from each would match noise.

**The English result wins a tie**, in the same bucket and across every query the expansion table
adds — the occurrence count only orders one language against itself, and the reader reads the
English. So the Pali is shown where it is the only thing that answered the query, or answered it in
a better bucket, and never where the English says the same thing.

## Ranking

Text hits extend the existing bucket ladder in `searchCorpus()`. The four buckets that exist today
keep their order and their meaning:

```
0  phrase in ref, title or Pali title
1  every word in the title
2  phrase in a group description, note or list name
3  every word, anywhere metadata search reads
4  the phrase as typed, in the sutta text
5  every word of the query, in one paragraph
6  every word of the query, anywhere in the sutta
```

A paragraph is what the build's markers delimit, taken from the segment key's middle field —
`mn10:2.1` is paragraph 2. Segments are clause-level (median 8 words), far too fine to require both
query words inside one; the paragraph is the unit a reader sees as a block.

**It is a coarse unit, and for some suttas no unit at all.** The median sutta has 3 paragraphs of 6
segments, but **29% of suttas are a single paragraph** — SN 35.28 numbers its every segment `1.n`,
so the whole fire sermon is paragraph 1. For those, bucket 5 collapses into bucket 6 and only the
phrase distinguishes anything. Nothing in the source data marks a finer division.

**Within every bucket, sort by how often the query's rarest word occurs in the sutta** — the
smallest of the per-word counts, not their sum — then the existing `saved` tie-break. The minimum is
what makes a sutta carry every word of the query rather than many of its commonest one: summed,
`mind is radiant` puts DN 1 first on 221 occurrences of "is".

No length normalisation: measured against a curated topic index, the plain count beats `1/√length`
and every BM25 setting swept, on both precision@10 and MRR. Length-normalised scores promote short
stock passages — a 40-word verse above the sutta that discusses the subject.

The count is also what orders suttas that share a title: four are titled "Right View", and it is the
count that puts MN 9 first.

`SEARCH_RESULTS_CAP` is unchanged.

## Query expansion

A table maps what readers type to what the corpus says, applied before matching — each entry adds an
alternative query, never replaces one. It is the only thing that reaches a sutta through different
words, and it holds two kinds of entry.

**Vocabulary**, where the shipped English differs from the words readers know:

```
loving-kindness → love, mettā          arahant       → perfected
enlightenment   → awakening            concentration → composure
wholesome       → skillful, kusala     monk          → bhikkhu
```

`scripts/update-data/retranslation.mjs` already lists the upstream-to-shipped pairs for every term
this app rewrote, and supplies a good part of these. The rest is ordinary Buddhist English and the
vocabulary of other translations — "stress", "cankers", "sloth and torpor", "sympathetic joy" — read
against what this corpus says.

**A vocabulary entry names the Pali term too**, where the term of art is the stable one:
`wholesome → skillful, kusala`. The English rendering is what varies between translations, so it is
the half that misses; the Pali is written the same way in every sutta that discusses the subject,
and the Pali blob is line-aligned with the English, so the Pali alternative reaches the passage
whatever the English calls it.

**Sutta names**, where a discourse is known by a traditional name that is neither its English title
nor its Pali title:

```
sigalovāda      → Advice to Sigālaka   the fire sermon → Burning
karaṇīya mettā  → Discourse on Love    ānāpānasati     → ānāpānassati
honeyball       → The Honey-Cake       ant-hill        → The Ant-Hill
```

These are how readers name suttas to each other, and without them the queries return nothing at all
rather than something imperfect.

The table is hand-written and reviewable in `web/src/lib/search/expansion.ts`. One query adds at most
`MAX_EXPANSIONS` alternatives, because each one costs a scan of both blobs and past a handful the
results stop being about what was typed.

**An entry fires wherever its key appears**, including inside a longer query, where substituting a
Pali term into an English phrase leaves something neither blob can match — `right view` would gain
"right ditthi" from the `view` entry. Two rules keep those out: the table is walked **longest key
first**, and an entry whose key sits inside one that has already matched is skipped. A phrase
readers are likely to type whole earns its own entry for the same reason.

## Off the main thread

**The blobs live in a Web Worker and are never on the main thread.** A scan is a few milliseconds
on a fast machine but up to ~150 ms for the worst query, and several times that on a mid-range
phone — long enough, run on the keystroke, to hold up the character the reader is typing. The 34 MB
is the bigger reason: the main heap never carries it, which is what an iOS tab is judged on.

The split follows what each side holds:

- **The main thread** scans the metadata — `searchCorpusVariants()` — because the reader's notes,
  lists and highlights are here, and that pass is fast. Those hits render on the keystroke, as they
  always have.
- **The worker** fetches the three files, holds them, and answers one search at a time. A request
  carries the query and the metadata hits' ids; the worker scans the text and returns the merged,
  ordered result, with the snippets already cut.
- **`mergeSearchHits()` is one function used on both sides**, so `searchCorpusAndText()` — the whole
  search in a single call, over an index the caller holds — still exists for the tests and the
  offline evaluation harness, and still produces exactly what the app shows.

`lib/search/textClient.ts` owns the worker and publishes the load status the UI renders. **Only the
newest waiting search is run**: a reader types faster than a scan, so a queue would answer each
keystroke long after it was typed. The search in flight finishes, the newest waiting one goes next,
and the ones typed over are dropped.

Text hits therefore arrive a moment after the metadata hits — where they sort anyway, below every
metadata bucket.

**Only the first search shows that gap.** Once a search has been answered, the answer stays on
screen while the worker answers the next keystroke, rather than being replaced by that keystroke's
metadata half: the rows keep their text hits and their snippets, and only the marked words move,
until the new answer arrives some tens of milliseconds later. Falling back to the metadata half
takes every text hit off the list and every snippet out of the rows it did keep, so each keystroke
collapses the results and rebuilds them — the whole pane flickering under a reader typing a word
whose results are barely changing. `useCorpusSearch` holds them.

The worker inherits the page's service worker, so the `CacheFirst` rule for `/data/search/` in
`web/vite.config.ts` serves its fetches exactly as it served the main thread's.

## Golden query set

`scripts/search-golden.json` holds the queries this search is expected to answer and the suttas each
should surface in its top five — canonical discourses, similes by their traditional names, people,
Pali terms, and the vocabulary cases that fail until query expansion exists (marked `known_gap`, and
the measure of whether that table is working). Expectations are drawn from the canon and from this
corpus's own titles, so the file depends on nothing outside the repo.

`web/src/lib/searchGolden.test.ts` runs it as part of `npm test`, against a corpus built into a
temporary directory rather than a fixture, since a fixture tree cannot catch a ranking regression.
Queries split in two: most must put an expected sutta in the top five or the suite fails, and the
rest are **pending** — the file's own `known_gap` entries plus the test's `UNMET` list, which the
ranking as specified does not reach. Pending queries are reported rather than asserted one by one,
but every one that *is* reached today is held, so slipping back still fails.

## Snippets

A hit found in the text shows the paragraph it was found in, in place of the group description a
metadata hit shows. It is the paragraph containing the most of the query's distinct words; the
earliest wins ties, so a one-word query gets the first occurrence.

**The paragraph is windowed around the match**, broken on spaces and elided at each trimmed end. A
paragraph is often the whole sutta (see Ranking) and the row clamps to three lines, so without the
window the reader is shown the opening line of every result with nothing marked in it.

The window centres on **the phrase as typed, or failing that the query's rarest word** — never
simply the earliest word matched. `the` and `of` are in every opening line, so centring on the
earliest pins every snippet to the top of the paragraph, which is the bug the window exists to
avoid.

Because the two blobs are line-aligned, a hit found in the Pali shows the Pali paragraph with that
paragraph's English underneath it. A hit found in the English shows English alone.

**A row marks the query that found it**, which is not always the one that was typed: a hit the
expansion table found on `ariyasacca` marks that word in the Pali line and the typed "noble truths"
in the English. The English line is windowed on the typed query too, so the words that answer the
query are inside the window rather than past the end of it. Marking follows the matching's
stemming, so a typed plural marks the singular the text carries: "truths" marks "the noble truth
of".

Snippets are cut for the first `SEARCH_RESULTS_CAP` hits only, which is every row that renders — a
broad query matches thousands of suttas and the cap is what is drawn. A metadata-only hit has no
snippet and keeps the description; so does every hit while the text is still loading, or if it never
arrives.

**A snippet carries the segment it was cut from, and clicking the row opens the reader there** — a
one-shot route intent, consumed once so a refresh doesn't jump again, and it suppresses the usual
scroll restore. Only a text hit has one: a title or description match opens at the top of the sutta
as it always did, because there is nothing in the text for it to point at.

## Late, or never

**Search never waits on the text.** The blob is fetched lazily — on first focus of a search field —
and every stage below is a valid resting state:

- **Before it loads.** Metadata results render on the keystroke, exactly as today. A spinner and
  "Searching sutta text…" sit under the last row, where the hits still coming will append, held back
  for `TEXT_LOADING_DELAY_MS` so a load that lands in a blink says nothing at all. The field starts
  the fetch on focus, so on a fast connection it never appears.
- **When it lands.** Text hits append below the metadata hits. Cached from then on.
- **If it never arrives** — offline, never fetched, fetch failed, or the device gave no worker to
  scan it in — the empty state carries the
  existing `SEARCH_SCOPE_NOTE`. The feature degrades to today's behaviour, labelled honestly, with
  no error state and nothing blocked. A failed fetch is not remembered, so the next search tries
  again and a reader who searched offline gets the text as soon as they are back.

Bucket membership never changes when the text arrives, so no result moves between buckets; order
*within* the metadata buckets refines once occurrence counts are available.

`prefetchAllSuttas()` in `web/src/lib/offline.ts` fetches the blobs too, so a device that has run
"Download all suttas for offline" is never in the degraded state.

## Measured baseline

Replaying 16,467 topic-to-sutta citations from a curated index of this canon (in git history at
`e6380de6^:data/cips-index.json`) through the shipped module:

| | |
|---|---|
| curated citations found | **75.9%** |
| first correct answer at rank | **~2** (MRR 0.516) |
| precision@10 | 19.5%, against a 39.7% ceiling |

Of the citations missed, about a fifth are suttas containing no word of the topic in either language
— unreachable by text search of any kind. Every constant in Matching and Ranking was chosen by this
comparison.

That index is third-party data whose author withdrew permission for it to be used as part of this
project, so neither it nor the harness that reads it belongs in the repository; both are kept on
disk outside it, and the golden query set above is what ships.

## Accepted limits

- **Frequency is not aboutness.** A sutta that never names its subject cannot be found. Query
  expansion narrows this; it does not close it.
- **Broad queries are broad.** "suffering" is in 819 suttas. The cap and the ranking are what make
  that usable; there is no filtering by collection.
- **No stemming on the English side** beyond plurals. "arise" does not find "arising", and
  "friendship" does not find "friend".
- **No typo tolerance.** With 13,523 word types a Levenshtein pass over the vocabulary on a
  zero-result query would be instant, but it is not part of this design.

## What it costs the device

Nothing until the reader searches; the text is fetched on the first focus of a search field.

| | |
|---|---|
| that first fetch | **~2.9 MB** over the wire |
| held in Cache Storage | **19 MB** decoded, ×2 corpus versions at `maxEntries: 6` |
| held in memory | **34 MB** in the worker, for as long as the app is open |

The two blobs are `CacheFirst` in `web/vite.config.ts` — their filenames carry `dataVersion`, so a
corrected sutta arrives as a new URL and there is nothing to revalidate. Three entries, because only
the current version's URLs are ever requested.

**The memory is released a minute after the app goes out of sight** (`watchTextSearchIdle`, armed in
`main.tsx`), by terminating the worker, which takes the blobs with it whatever else is holding them.
The next search starts a fresh worker, which fetches again and is served from Cache Storage, so it
costs a pause rather than a download — and an idle tab holding 34 MB is a bigger target for iOS to discard
outright, which would cost a whole reload instead.
