# Full-text search

**Status: specified, not built.** What ships today is `searchCorpus()` in `web/src/lib/corpus.ts`,
which reads sutta numbers, titles, Pali titles, group descriptions, the reader's own notes and their
list names — everything *about* a sutta and nothing *in* it. `SEARCH_SCOPE_NOTE` says so on screen.

This document specifies the addition: the reader types a word or a phrase and finds the suttas that
contain it, in either language, offline.

## Scale

The corpus is small enough that the conventional apparatus is unnecessary. Measured over
`web/public/data/text/`:

| | |
|---|---|
| suttas | 4,041 |
| segments | 125,439 · median 8 words |
| English text | 8.5 MB raw · **830 KB brotli** |
| Pali text | 10.2 MB raw · **920 KB brotli** |
| distinct English word types | 13,523 |
| scanning all English for a phrase | **2–10 ms** |

A brute-force scan of the whole canon is faster than a keystroke, so there is no index, no stemmer,
no stored statistics and nothing to keep in step with the corpus build. **The text is the index.**

## The data

Three files, written by `scripts/build-corpus.mjs` from the segments it already emits into
`web/public/data/text/`:

```
web/public/data/search/en.<dataVersion>.txt     segment strings, "\n"-joined, canonical sutta order
web/public/data/search/pa.<dataVersion>.txt     the same segments' Pali
web/public/data/search/map.<dataVersion>.json   [[uid, charOffset], …] — one entry per sutta
```

Plain UTF-8, served compressed. Both languages carry one line per segment in the same order, so an
offset in one file addresses the same segment in the other.

`map` is ~4,000 entries (~20 KB brotli). A match at character offset *N* resolves by binary search
to the sutta whose range contains it; counting newlines from that sutta's start gives the segment
index, which indexes the array already loaded from `text/{uid}.json` to produce the segment `key`
for a deep link.

**The filename carries `dataVersion`.** One file per corpus means versioning costs one URL, so these
can be `CacheFirst` and never go stale — the per-document staleness described in CLAUDE.md's "A
corpus fix reaches a cached device one document at a time" does not apply here.

## Matching

The query is folded with the existing `searchKey()` — NFD, combining marks stripped, lowercased —
then compiled to a regular expression run against the **unfolded** text. One copy of the text stays
in memory (~16 MB per language) and match offsets are exact, which a parallel folded copy would not
guarantee.

Folding is inverted per character when the expression is built, so a typed ASCII letter matches its
Pali forms. Regex metacharacters in the query are escaped first.

```
a → [aā]   i → [iī]   u → [uū]   m → [mṁṃ]
n → [nñṅṇ] t → [tṭ]   d → [dḍ]   l → [lḷ]
```

**Word boundaries are `(?<!\p{L})` and `(?!\p{L})` with the `u` flag, never `\b`.** JavaScript's `\b`
is ASCII-only, so it treats `ā` as a non-word character and would match "nibbāna" inside
"mahānibbāna".

### English

Whole words, with an optional trailing `(?:s|es)?`. Without the plural, `four noble truths` misses
"the noble truth of…" and the results look plainly broken.

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
- **Probe the space-joined form too** for a multi-word query. The corpus writes Pali compounds
  joined — *mahākassapa*, never "mahā kassapa" — so `Maha Kassapa` otherwise finds nothing.

**Searching the Pali is not optional.** The editorial layer moved the English away from the words
readers type: `nibbana`, `karma` and `absorption` match no English at all, and `concentration`
matches one sutta, because the shipped text says "extinguishment", "deeds", "jhāna" and "composure".
The Pali side answers those queries.

### Both languages

English and Pali are scanned and scored **independently**, and a sutta keeps its better result. A
query is written in one language or the other; mixing a word from each would match noise.

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

A paragraph is the segment key's middle field — `mn10:2.1` is paragraph 2. Segments are clause-level
(median 8 words), far too fine to require both query words inside one; the paragraph is the unit a
reader sees as a block.

**Within every bucket, sort by raw occurrence count in the sutta text**, then the existing `saved`
tie-break. No length normalisation: measured against a curated topic index, plain occurrence count
beats `1/√length` and every BM25 setting swept, on both precision@10 and MRR. Length-normalised
scores promote short stock passages — a 40-word verse above the sutta that discusses the subject.

The occurrence count is what orders suttas that share a title: four are titled "Right View", and it
is the count that puts MN 9 first.

`SEARCH_RESULTS_CAP` is unchanged.

## Query expansion

A table maps what readers type to what the corpus says, applied before matching — each entry adds an
alternative query, never replaces one. It is the only thing that reaches a sutta through different
words, and it holds two kinds of entry.

**Vocabulary**, where the shipped English differs from the words readers know:

```
loving-kindness → love, mettā          arahant       → perfected
enlightenment   → awakening            concentration → composure
```

`scripts/update-data/retranslation.mjs` already lists the upstream-to-shipped pairs for every term
this app rewrote, and supplies a good part of these.

**Sutta names**, where a discourse is known by a traditional name that is neither its English title
nor its Pali title:

```
sigalovāda      → Advice to Sigālaka   the fire sermon → Burning
karaṇīya mettā  → Discourse on Love    ānāpānasati     → ānāpānassati
honeyball       → The Honey-Cake       ant-hill        → The Ant-Hill
```

These are how readers name suttas to each other, and without them the queries return nothing at all
rather than something imperfect. A few hundred entries between the two kinds, hand-written and
reviewable.

## Golden query set

`scripts/search-golden.json` holds the queries this search is expected to answer and the suttas each
should surface in its top five — canonical discourses, similes by their traditional names, people,
Pali terms, and the vocabulary cases that fail until query expansion exists (marked `known_gap`, and
the measure of whether that table is working). Expectations are drawn from the canon and from this
corpus's own titles, so the file depends on nothing outside the repo.

Run it against any change to Matching, Ranking or Query expansion.

## Snippets

The snippet is the paragraph containing the most distinct query words; earliest wins ties, so a
one-word query gets the first occurrence. Because the two blobs are line-aligned, a Pali hit can show
the Pali line and its English underneath.

## Late, or never

**Search never waits on the text.** The blob is fetched lazily — on first focus of a search field —
and every stage below is a valid resting state:

- **Before it loads.** Metadata results render on the keystroke, exactly as today. A quiet line under
  the results reads "Searching sutta text…".
- **When it lands.** Text hits append below the metadata hits. Cached from then on.
- **If it never arrives** — offline, never fetched, fetch failed — that line becomes the existing
  `SEARCH_SCOPE_NOTE`. The feature degrades to today's behaviour, labelled honestly, with no error
  state and nothing blocked.

Bucket membership never changes when the text arrives, so no result moves between buckets; order
*within* the metadata buckets refines once occurrence counts are available.

`prefetchAllSuttas()` in `web/src/lib/offline.ts` fetches the blobs too, so a device that has run
"Download all suttas for offline" is never in the degraded state.

## Measured baseline

Replaying 16,467 topic-to-sutta citations from a curated index of this canon (in git history at
`e6380de6^:data/cips-index.json`) against this design:

| | |
|---|---|
| curated citations found | **68.8%** |
| first correct answer at rank | **~2** (MRR 0.500) |
| precision@10 | 18.7%, against a 39.7% ceiling |

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
- **~16 MB of memory per language while search is open**, released when it closes.
- **No stemming on the English side** beyond plurals. "arise" does not find "arising", and
  "friendship" does not find "friend".
- **No typo tolerance.** With 13,523 word types a Levenshtein pass over the vocabulary on a
  zero-result query would be instant, but it is not part of this design.
