# The corpus

The texts are built ahead of time from `data/` into static files under `web/public/data/`, which
the app fetches and the service worker caches. `npm run build:corpus` builds them in a few seconds,
and `npm run dev` and `npm run build` run it first.

```
data/sujato ───post───▶ data/sujato.post ──┐
data/bodhi, data/thanissaro ───────────────┤
data/pali, data/html, data/tree ───────────┼──build-corpus──▶ web/public/data/
data/pli2en_dpd.json ──────────────────────┘
```

The first step applies the editorial rules ([retranslation.md](retranslation.md));
[data/README.md](../data/README.md) describes the dataset and how it's refreshed.

## What the build writes

| File | Holds |
|---|---|
| `corpus.json` | the browse tree, an index of every sutta (reference, titles, description, reading time, other translations) and version stamps |
| `text/<uid>.json` | one document's segments: each line's Pali and English, its translator's note, and its role |
| `text/bodhi/`, `text/thanissaro/` | the same, in Bodhi's or Ṭhānissaro's English ([Other translations](#other-translations)) |
| `text-shards/` | every offered translation in ~1 MB bundles, for Settings' offline download; left out of the native bundle |
| `dict-shards/` | the dictionary in ~256 KB alphabetical ranges, so a tap fetches one |
| `search/` | the whole canon as two plain-text files, English and Pali ([search.md](search.md)) |

A document is a sutta, or a batch of short ones such as `an1.1-10`; there are 4,041. Each segment
is keyed by SuttaCentral's own id, such as `mn10:2.7`, which is also what a highlight anchors on.

`corpus.json` also carries versions: `dataVersion`, a hash of all translations and the offline
download format; `dictionaryVersion`; `searchVersion`, a hash of the search files that also names
them; and the DPD release and sc-data commit it was built from. Settings compares the first two
with what a device downloaded, to say
when its offline copy is out of date. The download format is part of the version so a completed
copy missing translations needs an update even when the documents themselves are unchanged.

Each offline bundle holds complete documents, keyed by their path under `text/`, including
`bodhi/` or `thanissaro/` for an alternative. Its manifest names those paths and their total count.
Unpacking restores each document at the same URL an ordinary read caches, so the Reader needs no
separate offline loading path.

## A segment

Each line joins three aligned sources: the Pali, Bhikkhu Sujato's English, and SuttaCentral's HTML
templates, which say whether a line is prose, verse, a heading, a speaker or a closing line. Lines
follow the Pali's order, and the translator's notes attach to their lines.

A line with no English is left out, Pali and all. Most are repetitions the translator elides, where
the Pali alone would put a wall of it mid-page, and closing lines that only number the sutta or end
its chapter. A lone one between two translated lines of a paragraph usually has its meaning carried
by the line above, so its Pali joins that line and the Pali shown for it is whole. What counts as
translated is read from the English itself, so a line translated upstream appears on the next
refresh.

Paragraphs are the ones SuttaCentral prints: the Pali's markup opens each, and each sutta of a
batch starts one. The segment numbers group lines more loosely, often several printed paragraphs
to one number, so paragraphs don't follow them. The build marks the line ending each paragraph with `pe`, a
short key since nearly every paragraph carries one, and the Reader leaves a gap below it. A text
cached without the marks breaks at its segment numbers instead.

The build refuses a document whose segment keys are out of order, because highlights compare keys
to work out what overlaps ([offline-sync.md](offline-sync.md#anchored-on-segment-keys)).

## Links in the notes

A translator's note cites other suttas as links to SuttaCentral's reader. The build points each one
at a text the app holds at its own Reader, at the line it names — `/read/sn46.53?at=15.4` — and
reduces the rest, the Vinaya, the Jātakas and other texts outside the corpus, to their words. A
batch's inner sutta keeps its own uid, `/read/dhp274`, which the Reader resolves.

A line the text doesn't show — a title, a line whose English elides a repetition, a line a refresh
renumbered — lands on the next line of that sutta. Where there is none, the build leaves the line
out and the link opens the sutta at the top. A test over the real data checks every link opens a
sutta the app holds at a line it can land on, and that no link to one was lost to a change in how
the source writes them.

## Other translations

Bhikkhu Bodhi's and Ṭhānissaro Bhikkhu's texts, cut onto the Pali's lines in `data/bodhi/` and
`data/thanissaro/` ([data/upstream/README.md](../data/upstream/README.md)), are built beside
Sujato's, each document with its own Pali under its own lines. The index names each text's other
translations, with the page each was published on, for the Reader's credit.

- **Only whole translations.** A text is offered where the translator's pages cover every sutta in
  it and it holds more than titles. A group he only partly translates, as Ṭhānissaro's AN 1 and AN 2
  selections, isn't, nor is a sutta he gives in excerpt. A page standing for several texts is built
  whole on each.
- **The Pali under a line** follows "A segment", but paragraphs come from the Pali's markup, so a
  lone line inside a Dhammapada verse joins too. A line in his `covered.json`, whose content the
  English above renders, joins the nearest translated line above, past any abbreviated ones.
- **His markup** stays as offsets into the line's plain text, which is what highlights slice:
  `headings` round a heading or title of his that no Pali heading line holds, `speakers` round
  his source-marked speaker labels, and `links` round a reference to another sutta. Speakers
  come from dhammatalks.org's `p.vspk` or SuttaCentral's `span.speaker`, including inline prose
  attributions; their words and breaks stay in place. A label opening a line, after at most the
  quotation mark opening its paragraph, leaves the text as the line's `speaker`, which the Reader
  sets on a line of its own above, outside a verse's rule; one closing a line after its other
  words names the speaker of the next line, and becomes that line's `speaker`. The Reader gives
  them the muted, smaller type of Sujato's speaker lines.
  `blocks` holds `[from, to, kind]` where two or more of his paragraphs
  share a Pali line (`paragraph`, from `<p>`), or one shares a Pali verse line with his verse,
  which the Reader draws as prose outside the verse's rule, and for his bulleted list items (`list-item`, from
  `<ul><li>`). Ṭhānissaro's `<div class="iblock">` and `<div class="sq-list">` give
  `indented-item` ranges only where the source wrapper holds at least two direct `<p>` children
  and no other content, and every item except the last ends in `;`, `,` or `—`, ignoring note
  markers and whitespace. These lists are indented, tight and unbulleted, including continuations
  across Pali paragraphs; other source prose keeps ordinary paragraphs. A list fragment alone
  on a Pali line keeps its range too; these layouts do not change the alignment.
  The spaces between blocks and the breaks between his verse lines stay in the text, so markup
  adds no characters to a highlight's offsets. The Reader draws the source blocks around the
  inline highlights and links. A source heading spanning consecutive Pali heading lines sits
  whole on the first, leaving the other English lines empty.
- **His links**, in the text and the notes, open the cited text in his translation where it is
  offered, and in Sujato's otherwise.
- **Left out**: his introduction and "See also", which sit on the title line's note. Search covers
  Sujato's text alone; the dictionary covers the words every text shows.

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
- **Only a bottom-level group opens a list of suttas.** A row with children expands in place, and a
  search result naming one opens it expanded in the tree.

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

Some definitions are the app's own, added to DPD's from `data/pli2en_additions.json`. Each names
its source, which the dictionary shows with it — `sampajañña: (Goenka) …` — and follows DPD's lines
for its headword in every entry that has them, never replacing one. The build adds them, so a DPD
refresh keeps them; one whose headword no entry defines any more fails the build.

## Where to look

| Where | What |
|---|---|
| `scripts/build-corpus.mjs` | the build |
| `scripts/lib/collections.js` | how the library is grouped, how a segment is assembled, and a note's links |
| `scripts/lib/translations.js` | which texts Bodhi and Ṭhānissaro offer, where each was published, and their lines' markup |
| `scripts/__tests__/build-corpus.counts.test.js` | the checks over the real data, the note links among them |
| `scripts/lib/paliWords.js` | the build's copy of the app's word splitting and shard lookup |
| `scripts/update-data-dictionary.mjs` | the DPD import |
| `data/pli2en_additions.json`, `scripts/lib/dictionaryAdditions.js` | the app's own definitions, and where the build adds them |
| `web/src/lib/corpus/corpus.ts`, `dictionaryShards.ts` | the app's side: loading text, finding groups, looking words up |
