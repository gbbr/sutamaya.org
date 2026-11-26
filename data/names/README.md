# Names

Tapping a proper name will show, under its dictionary line, the entry for that person or place from
the *Dictionary of Pāli Proper Names* — G. P. Malalasekera's, revised by Ānandajoti Bhikkhu in 2025,
under CC BY-SA 3.0 (the site-wide notice of [Ancient Buddhist Texts](https://www.ancient-buddhist-texts.net/Miscellaneous/Copyright-Notice.htm)).
Where several people share a name, the panel lists them, and in a sutta whose own text settles which
one it means, that one comes first. Only people and places the suttas mention are shown; the
dictionary's others come from later literature.

This folder holds the review that decides what ships. Nothing reaches the app until it is done.

## The data

`npm run update-data dictionary`, with `DPPN_PATH` naming the DPPN.json in DPD's
[other-dictionaries](https://github.com/digitalpalidictionary/other-dictionaries) repository
(`dictionaries/dppn/dppn.tar.zst`), writes `data/pli2en_dppn.json`: for each name DPD glosses
"name of …", the entries whose citations reach the app's books (DN, MN, SN, AN, Dhp, Ud, Iti, Snp,
Thag, Thig — not the commentaries), each with the suttas SuttaCentral's page and verse references
place those citations in. These are candidates. The citations are the dictionary's own, so a page
that holds two suttas places both.

## The review

Every candidate is read against the suttas twice, by two independent Codex sessions, one writing
`decisions/` and the other `second/`. Where the two readings differ, Claude reads the case and
decides, in `decisions/`; a sutta identification only ships where both readings, or Claude's,
settle it. For each name the review decides:

- **senses** — for each DPD sense (a line the panel shows), the entries describing that same person
  or place.
- **others** — entries about someone or somewhere the suttas mention that no DPD sense covers, such
  as Channa the charioteer. They ship after the senses' entries. An entry in neither list does not
  ship.
- **suttas** — for a name with more than one entry shipping, the suttas whose text makes certain
  which entry it means. Anything less than certain is left out: no pick is better than a wrong one.

`node scripts/names-review.mjs packets` writes one packet per batch of names to `review/packets/`
(regenerated at will, not committed): DPD's senses, the candidate entries, and every mention of the
name in the app's suttas, in Pali and in Sujato's English. A word that is also an ordinary word
(*citta*, "mind") counts as a mention only where the English names the person. The answers go to
`decisions/NNN.json`, one per packet; `node scripts/names-review.mjs check [second]` validates a
reading, and `node scripts/names-review.mjs compare` lists where the two differ.

## The review prompt

Given to each Codex session with its batch range, run from the repository root. The second reading
adds: "This is the second reading: write to data/names/second/ instead of data/names/decisions/,
keep your status in data/names/review/second-status-FIRST-LAST.md, run the check as
`node scripts/names-review.mjs check second`, and don't read data/names/decisions/."

```
codex exec -s workspace-write -c model_reasoning_effort="xhigh" "Follow data/names/README.md's 'The review prompt' for batches 001–006."
```

> RESUMABLE — you may be resuming. A batch is done when `data/names/decisions/NNN.json` exists and
> ends with `"done": true`; skip it. Redo any other. After each batch, add a line to
> `data/names/review/status-FIRST-LAST.md` for your range.
>
> sutamaya's dictionary panel will show, under a proper name's line, the entry for that person or
> place from the Dictionary of Pāli Proper Names, and — in a sutta whose own text makes it certain —
> which of several people of that name the sutta means. Your job is to make sure nothing wrong
> reaches a reader. The packet, `data/names/review/packets/NNN.md`, gives for each name DPD's senses
> with the example suttas and notes DPD keeps for each (which tell apart senses glossed alike), the
> candidate entries with the suttas their citations place, and the name's mentions in the app's
> suttas: every word whose tap shows one of the name's lines. A compound DPD defines as a whole
> shows its own lines instead, so it is not a mention. The whole suttas are in `data/pali/sutta/`
> and `data/sujato/sutta/`.
>
> For every name and every sense in the packet, decide which entries describe that same person or
> place; a sense may have none. An entry about someone the suttas do mention but no sense covers goes
> in the name's others; one about someone the suttas never mention goes nowhere and won't ship. For a
> name with more than one entry shipping, list for each entry the suttas whose text settles that it
> is the one meant: an epithet, a place, the episode the entry tells. If two could fit, or you are
> unsure, leave the sutta out. Name only suttas the packet lists for that name.
> Put anything a person should look at — an entry that seems wrong, a citation that lands in the
> wrong sutta, a mention the packet missed — in the name's notes. Push back in the notes if the
> setup itself looks wrong.
>
> Write `data/names/decisions/NNN.json` as
> `{"names": {"<name>": {"senses": {"<sense>": ["<entry id>"]}, "others": ["<entry id>"], "suttas": {"<entry id>": ["<sutta id>"]}, "notes": "…"}}, "done": true}`,
> then run `node scripts/names-review.mjs check` and fix what it reports for your batches. Change no
> other file.

## What's left

The review is complete: 858 of the 876 candidates ship, under a sense or among the others, with
1,158 sutta identifications.

- **The names in the panel.** Under a name's line, the entry's opening paragraph, cut to three
  lines, with More opening the whole entry in the panel — only when there is more to show (61% of
  entries). An entry among the others follows the senses' entries. In a sutta the review
  identifies, that sutta's person comes first. A name's line gets no root line: a name's
  etymology (Citta from √citt, "paint") is noise.
- **Where the names live.** The previews go into the dictionary shards, once per name per shard
  (about 0.7 MB, 5% of the dictionary); the whole entries go into files of their own, fetched on
  More (about 1.2 MB). The offline download and the native apps include both.
- **DPD's line under every definition.** The root with its meaning and the opposites
  (`√sar remember · opposite asati`): stored once per headword in each shard, with the labels
  written by the panel, it adds 0.9 MB (7%). Repeated in every line it would add 75%. Sanskrit is
  left out for its size (+11% more); frequency is left out because DPD counts a spelling, not a
  meaning — Citta the householder would get the count for *citta*, "mind".
- **The Help page's credit** for the names, with its jump link.

## To explore

- **Telling a name from a word.** The Pali doesn't capitalise names, but Sujato's English does: when
  the tapped line's English names the person ("Citta"), the tap is the name and its entry shows
  first; otherwise the word's own meanings do. It misses where the English translates a name
  ("Fury" for Caṇḍa), so it only orders the panel and never hides a meaning.
- **Tabs for words and names.** The panel could split into two tabs, the word's meanings and its
  names, so a crowded entry stays readable — as Kindle's look-up splits a word into swipeable
  Dictionary, Wikipedia and Translation cards. A tap identified as a name opens on the names tab.
  The tabs appear only for a word that has a name entry. The label is open: "Name", which covers
  places too, or "Person" and "Place".

## Where to look

| What | Where |
|---|---|
| The import | `scripts/update-data-names.mjs`, run by `npm run update-data dictionary` |
| The candidates | `data/pli2en_dppn.json` |
| Packets and the check | `scripts/names-review.mjs` |
| Decisions | `data/names/decisions/` |
