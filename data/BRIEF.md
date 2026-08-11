# Data brief: linking `data/` into one tree

Self-note on how the pieces under `data/` fit together to drive Sutamaya's
Sutta Browser, Reader, and Pali dictionary overlay. See `design/README.md`
(git history, since it's deleted from the working tree) for the product spec
this data feeds.

## The five pieces

```
data/
  super-tree.json  root of the whole-canon tree (all languages, all collections)
  tree/            per-collection navigation structure (which suttas exist, how they nest)
  pali/
    name/          titles, per collection, in Pali
    sutta/         root Pali text, segmented
  sujato/
    name/          titles, per collection, in English (Sujato translation)
    blurb/         one-paragraph descriptions for nikayas/vaggas/suttas
    sutta/         English text, segmented (Sujato translation)
  html/pli/ms/sutta/ SuttaCentral's per-segment HTML structure (verse/heading/end/speaker/
                   list-item), mirrored from bilara-data via scripts/fetch-html-structure.mjs
                   — used only to set each segment's `role`, not part of the primary text data
  pli2en_dpd.json  standalone Pali->English dictionary (142,495 headwords)
```

Note: `super-tree.json` lives at the top level of `data/`, *not* inside
`data/tree/` — it's the whole-canon root, one level above the per-collection
files in `tree/`. Don't glob `data/tree/*.json` expecting to find it there.

Everything is keyed off a **uid** (`dn1`, `sn1.1`, `an1.2`, `dn-mahavagga`, ...)
and a **segment id** (`0.1`, `1.1.2`, ...). The pair `uid:segment_id` is the
atomic key used everywhere text is stored.

## 1. `tree/*.json` — the navigation skeleton

One file per top-level collection (`dn-tree.json`, `mn-tree.json`,
`sn-tree.json`, `an-tree.json`, plus one per Khuddaka Nikaya sub-book:
`kp`, `dhp`, `ud`, `iti`, `snp`, `vv`, `pv`, `thag`, `thig`, `tha-ap`,
`thi-ap`, `bv`, `cp`, `ja`, `mnd`, `cnd`, `ps`, `ne`, `pe`, `mil`).

Shape is a recursive dict: `{ groupUid: [child, child, ...] }` where each
child is either

- a **string** — a leaf sutta uid (`"dn1"`, `"sn1.1"`), or
- another **`{ groupUid: [...] }` object** — a nested group (vagga /
  saṁyutta / nikāya).

Nesting depth varies: `dn` is 2 levels (nikaya > vagga > sutta), `sn` is 4
(saṁyutta > sn-number > vagga > sutta). Walk it generically, don't assume a
fixed depth.

`data/super-tree.json` (top level, sibling of `tree/`, not inside it) is the
root of the *entire* SC canon (all languages), not just what's in this
dataset — it's a list of nested groups like `sutta > long > [dn, da, da-ot]`
and `minor > kn > [kp, dhp, ud, ...]`. Use it only to get the top-level
ordering/grouping of collections (`sutta`/`vinaya`/`abhidhamma`, and the `kn`
sub-book order) — most of the uids it references (`da`, `sa`, `ma`, `ea`,
`lzh-*`, `sht`, ...) have **no text in this dataset** (see §4). Don't recurse
into branches whose root uid isn't one of the five collections listed above.

## 2. `pali/sutta/` and `sujato/sutta/` — the text

Only **an, dn, mn, sn, kn(+its 20 sub-books)** have real text, in both Pali
(`pali/sutta/`) and English (`sujato/sutta/`). Everything else in
`data/super-tree.json` is out of scope for text rendering.

Files are **range-batched, not one-file-per-sutta**: e.g.
`pali/sutta/an/an1/an1.1-10_root-pli-ms.json` holds suttas an1.1 through
an1.10 in one dict. `dn`/`mn` happen to be one-file-per-sutta
(`dn1_root-pli-ms.json`) only because each of those suttas is long enough to
be its own file — don't hardcode that assumption for an/sn/kn.

Each file is a flat `{ "uid:segment_id": "text " }` dict, insertion-ordered
(reading order). To resolve a single sutta:

1. Find its file: either build a uid -> filename index once (cheap: parse
   every filename's numeric range, or just scan each file's first key), or
   glob the directory and pick the file whose numeric range in the filename
   contains the sutta's number.
2. Load the file, filter keys where `key.split(':')[0] == uid`.
3. Segment ids sort correctly as dotted numeric strings in file order
   already — don't re-sort by naive string compare (`"1.10" < "1.2"`
   lexicographically but should come after).

`pali/sutta/{uid}:{seg}` and `sujato/sutta/{uid}:{seg}` share **identical
segment ids** for the same uid — that's the alignment mechanism for
interlinear Pali (design brief's "segment-aligned Pali"). Zip them by key,
not by array position (a Pali segment can exist with no English counterpart
or vice versa, e.g. structural markers).

## 3. `name/` and `blurb/` — titles and descriptions

`{collection}-name_root-misc-site.json` (Pali) and
`{collection}-name_translation-en-sujato.json` (English) hold titles for
**every node in that collection's tree** — nikayas, vaggas, and individual
suttas alike. Key format: `"{collection}-name:{n}.{ref-uid}"` where `ref-uid`
is the tree-node uid (matches a key in the corresponding `tree/*.json`) and
`n` is a sequential index (not otherwise meaningful — don't rely on it for
ordering, use tree order instead).

Pali and English name files use the **same `n.ref-uid` suffix** for the same
node, so pair them by stripping the `{collection}-name:` prefix and matching
on the rest, not by array position.

`blurb/{collection}-blurbs_root-en.json` is simpler: `"{collection}-blurbs:
{ref-uid}"` -> one paragraph, English only, no Pali counterpart. Present for
nikayas/vaggas and top-level collections; not every leaf sutta has one —
treat missing as "no blurb", not an error. `blurb/super-blurbs_root-en.json`
covers the collection-level blurbs (an/dn/mn/sn/kn description shown at the
top of the browser).

## 4. Name files with no tree/text (the long tail)

`pali/name/` has ~70 files but only ~20 have a matching `tree/*.json` (see
§1). The rest (`sa`, `ma`, `ea`, `da`, `lzh-*`, `sht`, `divy`, `uv`, other
Dharmapada recensions, etc.) are Chinese/Sanskrit/Tibetan parallels or
alternate-language texts referenced only from `super-tree.json`'s flat lists,
with no root/translation text anywhere in this dataset. They're not wired
into any tree we can walk (no nested `tree/*.json` for them — the
super-tree entry is a flat array of uids, no vagga structure). Ignore them
for MVP; they'd only matter for a future "parallels" feature, and even then
you'd need to source the actual text from elsewhere.

## 5. `pli2en_dpd.json` — the tap-a-word dictionary

Flat list of `{ "entry": "<inflected Pali word>", "definition": ["...", ...] }`,
142,495 unique entries, **not indexed by segment** — it's a standalone
headword table (Digital Pāḷi Dictionary), independent of the tree/sutta data.

To power the reader's word-tap overlay: build an in-memory map
`entry -> definition[]` once at load (or ship it pre-indexed), then on tap,
tokenize the tapped Pali segment's text, strip surrounding punctuation, and
look up the token verbatim — entries are already inflected surface forms
(`abaddhañca`, not just the dictionary headword `abaddha`), so no stemming
needed, just exact match after punctuation/whitespace trim. A word with
multiple senses has multiple strings in `definition[]`; render as a list.

## Putting it together: rendering one sutta screen

1. Walk the relevant `tree/{collection}-tree.json` to build breadcrumbs and
   sibling nav (prev/next sutta at the same nesting level).
2. Resolve title: `pali/name` + `sujato/name` for the uid, matched by
   `n.ref-uid` suffix.
3. Resolve blurb (optional): `sujato/blurb` for the uid.
4. Resolve body: locate the range-batched file in `pali/sutta/` and
   `sujato/sutta/`, filter both to the uid's segments, zip by segment id for
   interlinear display.
5. Dictionary overlay is lazy/on-demand against `pli2en_dpd.json`, unrelated
   to the above until the user taps a word.

## Note: user state lives elsewhere

None of this data carries user state (lists, notes, highlights, visited) — that's a separate
per-user Firestore sync layer (Google auth) sitting on top of these read-only uids/segment-ids as
foreign keys, since implemented — see CLAUDE.md's "Backend" section.
