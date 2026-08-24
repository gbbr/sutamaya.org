# Retranslation rules

Bhikkhu Sujato's English is the base text; this app ships an edited version of it. The edits are
*declared*, not applied by hand — `scripts/update-data/retranslation.mjs` holds every rule, and
`update-data post` reapplies them on every refresh, so an editorial decision survives the next
upstream sync instead of being silently overwritten by it.

Two kinds of edit: **terminology** (render a Pali term consistently — *mendicant* → *bhikkhu*) and
**per-segment** corrections (one line, reworded). [`data/README.md`](../data/README.md) covers the
surrounding `update-data` pipeline; [`translation-changes.md`](translation-changes.md) is the
plain-language summary written for a reader.

## The two workflows

**Adding or changing a rule:**

```
edit retranslation.mjs   →  npm run update-data triage <rule-id>   enumerate what it would touch
edit the sidecar         →  npm run update-data post               apply, write data/diff/
                         →  git diff data/diff/00-all.diff         read the result
                         →  npm run update-data counts             record the footprint
```

Commit the rule, its sidecar, `data/diff/` and `retranslation.counts.json` together.

**Reconciling after an upstream refresh:** `update-data plan` names every rule that broke, before
anything is copied. Fix those, then `apply` — which is idempotent, so it's also the edit-check loop:

```
npm run update-data apply   →  git diff data/diff/00-all.diff  →  edit  →  apply again
                            →  npm run update-data triage      →  … prune  →  accept
```

## What settles a rendering

The texts here are the Early Buddhist Texts, so a term means what those texts say it means. Where a
passage defines one, that definition governs: SN 22.56 defines the *saṅkhāra* aggregate as the six
classes of intention. The Abhidhamma and the commentaries sit outside that basis — a reading taken
from them neither justifies a rendering nor rules one out. The DPD and the other translators inform
a choice without settling it; Bodhi, Ñāṇamoli, Anālayo and Thanissaro disagree often enough that
"the standard rendering" usually names one of them rather than a consensus.

## Where it sits in the pipeline

```
sc-data ──copy──▶ data/sujato/ ──post──▶ data/sujato.post/ ──build-corpus──▶ web/public/data/
                  (tracked, pristine)     (generated, gitignored)
```

`post` never writes into its own input, which buys three things: it's a pure function of (upstream,
rules), so re-running while authoring is always safe; `git diff data/sujato/` after a copy shows
what upstream changed uncontaminated by our edits; and `retranslation.mjs` plus its sidecars is the
complete delta, not changes spread across 5,396 data files. `data/pali/` and `data/html/` are
untouched — no translatable English. `build:corpus` runs `post` first, since a fresh clone has no
`sujato.post/`.

## Why explicit segment lists

A blind find-and-replace breaks on homonyms: Bhikkhu Sujato renders *sampajañña* as "aware", but
"aware" also appears as ordinary English. So each rule **names the segments involved** — the ones it
applies to, or the ones it must skip, whichever list is shorter and truer.

This works because segment ids are effectively immutable upstream while the text inside them is not
(over two years: 741 ids added, 2 removed, 24,502 values changed). A segment id is a stable address
to hang a decision on. It also handles the two cases nothing else does: **verse**, where Bhikkhu
Sujato reorders freely across lines so English and Pali don't align, and **`blurb`/`name`**, which
have no Pali counterpart at all.

### Notes are never retranslated

`sujato/notes` is out of every rule's reach — a rule naming it is rejected, not ignored
(`RETRANSLATABLE_TREES` in `../scripts/lib/retranslation.js`). A note is Bhikkhu Sujato writing
*about* the text, so his renderings appear there as quotations, and a rule that is right on the
translation is wrong on the note beside it: `sn47.35:3.2` explains which half of "mindfulness and
awareness" is which, and came out as *the "awareness" part of "awareness and awareness"*.

There's no per-note escape hatch — segment overrides resolve ids through a sutta-only index. **A
note therefore reads in Bhikkhu Sujato's terms while the text beside it reads in this app's**, which
is the accepted cost.

### The Pali predicate

A regex over the aligned Pali root text proposes candidates. **The predicate proposes; review
disposes; the list executes** — it's recorded on the rule for re-derivation and never consulted at
build time. It can't be trusted further than that: Pali is heavily inflected and compounds freely,
so `/sati/` matches 6,394 segments of which 4,727 are `passati` ("sees"), while word boundaries
instead lose `sammāsati` and `satipaṭṭhāna`.

## Rule shape

`retranslation.mjs` exports an ordered array of **term rules**, which rewrite words wherever their
list permits, and **segment overrides**, which replace one line outright.

### Term rule

```js
{
  id: 'sampajanna-clear-comprehension',
  why: 'Bhikkhu Sujato renders sampajañña as "aware"/"situational awareness"; this app prefers ' +
       '"clear comprehension". Closed because plain-English "aware" is common and unrelated.',
  mode: 'allow',                            // 'allow' (closed) | 'deny' (open)
  scope: ['sujato/sutta', 'sujato/blurb'],  // optional; defaults to sutta + name + blurb
  predicate: /sampajañ|sampajān/i,          // proposes candidates; never runs at build time
  forms: [
    ['situational awareness', 'clear comprehension'],
    ['aware', 'clearly comprehending'],
  ],
}
```

with `scripts/update-data/rules/sampajanna-clear-comprehension.json`:

```json
{
  "reviewedAt": "2026-08-17",
  "allow": ["dn22:1.9", "dn22:1.10", "…"],
  "deny": {
    "dn34:1.8.20": "plain English 'aware', translating a jhāna formula — no sampajañña"
  }
}
```

Sidecars are machine-written and sorted. **`deny` carries a reason for every entry** — without it,
re-derivation re-proposes the same rejections forever and the queue never empties.

**Closed or open** decides what happens to text that doesn't exist yet:

| | applies where | a new segment that gains the term | queue reports |
|---|---|---|---|
| `allow` (closed) | listed segments only | **not** rewritten, surfaces for review | stale + untriaged |
| `deny` (open) | everywhere except listed | rewritten, no review | stale denials |

Prefer whichever list is shorter, but read it as a signal about ambiguity rather than an
optimization: two exceptions out of seven hundred means the term is essentially unambiguous; two
hundred out of six hundred means you want every future occurrence to stop for review. Where the two
are comparable, choose closed. **An open rule with an empty `deny` list is a global rule** — the
right shape for a term with no homonym problem, like `mendicant-bhikkhu`.

### Segment override

```js
{
  id: 'sampajano-hoti-answer',
  kind: 'segment',
  why: 'Evaṁ kho bhikkhu sampajāno hoti — the section’s closing answer, worded to match the ' +
       'opening question sampajano-hoti-question rebuilds.',
  segments: ['sn47.35:3.5', 'sn36.8:4.3', 'dn16:2.13.3'],
  from: 'That’s how a bhikkhu is clearly comprehending. ',
  to:   'That’s how a bhikkhu has clear comprehension. ',
}
```

`from` is verbatim and doubles as the rule's anchor. Segment rules run **after** all term rules,
against their output — writing one means the term rules got that line wrong. That's routine where a
swap changes a word's part of speech: `forms` picks one replacement per source word, but a single
English word can sit in more than one grammatical slot.

`segments` (plural) covers a line the corpus repeats verbatim; each named segment still has to match
`from` on its own. Ids resolve through a segment→file index scoped to `sujato/sutta` only —
range-batched files hold segments keyed by sub-uid, so the filename can't be derived from the id,
and `sujato/notes` reuses the same ids as the text it annotates.

### Shared fields

- **`id`** — stable, unique; names the sidecar and the diff file.
- **`why`** — required prose: which Pali term, and why this app departs from upstream. A 2,000-id
  list says nothing about intent on its own.
- **`scope`** — trees from `sujato/{sutta,name,blurb}`; defaults to all three. `sujato/notes` is an
  error.
- **`forms`** — `[from, to]` pairs on English word boundaries, longest-first regardless of array
  order so `situational awareness` isn't pre-empted by `awareness`. **List every inflection
  explicitly** rather than swapping stems — MN40's "water immerser" (someone who dunks themselves)
  becomes "water concentrater" otherwise. A form may carry a neighbouring word that depends on it:
  `an immersion` → `a concentration`, rather than a stranded "an concentration".

  The match's case *pattern* is preserved: lowercase stays lowercase, a capitalized first word gives
  Sentence case, and an all-capitalized match gives Title Case word by word (`of`, `the`, `on` and a
  small closed set stay lowercase) — without which a heading reads "The Longer Discourse on
  Establishment of awareness". The replacement's first word follows the *match's* first word rather
  than the title rule, so `on mindfulness meditation` → `on the establishment of awareness` keeps
  its article lowercase.

## The pass

Per segment value: split into one unlocked chunk; for each rule in array order, skip unless this
segment is permitted, then apply its `forms` to **unlocked chunks only**, splitting each match into
its own locked chunk; rejoin.

Locking is what makes the pass order-safe — text a rule has written is invisible to every later
rule. It matters because segments carrying two targeted terms at once are common (531 have both
*sampajañña* and *sati*, so `dn22:1.9` is on both rules' allow lists):

```
dn22:1.9  PLI: …viharati ātāpī sampajāno satimā vineyya…
          EN : …keen, aware, and mindful, rid of covetousness…
```

The *sati* rule produces "aware", the exact token the *sampajañña* rule consumes; locking makes that
new token invisible to it, so the result is "keen, clearly comprehending, and aware" whichever order
they run in. Order therefore matters only when two rules match the *same* English word, where the
earlier rule wins. Order rules deliberately anyway; rely on locking for correctness.

Keys are never touched, by any rule. Only values. Required tests: **idempotence** (`post` twice is
byte-identical), the `dn22:1.9` collision as a pinned fixture, and a per-rule input/output example.

## Anchors: how a rule announces that it broke

Bhikkhu Sujato revises his terminology continuously and in bulk, and the sync commits are
machine-generated with identical messages, so the git log tells you nothing. Rules breaking is
routine maintenance; the only signal is the one we build.

| Anchor | Applies to | On violation |
|---|---|---|
| `from` matches verbatim | segment rules | **Hard fail.** Upstream reworded a line you'd overridden. |
| Rule matched at least once | term rules | **Hard fail.** The term is gone; the rule is dead. |
| `residue` matches nothing | term rules that declare one | **Hard fail.** Upstream wrote a shape the forms don't cover. |
| Triage queue is empty | term rules | **Review.** See below. |

`update-data plan` reports the first two before anything is copied. A broken segment rule prints as
a derivation — upstream's raw line, what the term rules did to it (`↪`), then `expected` against
`found` with the diverging words coloured, and `Would write:` for the rule's `to`. **When `found`
already reads correctly, the override is obsolete rather than drifted** — delete it.

An **open rule with an empty deny list** has no queue to check, so its anchor is its match count in
`retranslation.counts.json` (machine-owned, committed). Nothing verifies it for you; re-recording
shows the movement as a git diff. That's where the half-dead case surfaces — upstream renames the
term across part of the corpus, the rule still fires so zero-match stays silent, but its footprint
drops sharply.

Two commands write that file, because the occasions differ: **`counts`** records a new footprint
after a rule edit, and nothing else; **`accept`** re-records it as part of the wider "this is the new
normal" that also rebaselines `snapshot.json`. Keeping them separate stops a rule edit from quietly
re-accepting the current `data/` tree as the upstream baseline, which would blind the next `plan` to
a real upstream change.

## Working the queue: `update-data triage`

```
npm run update-data triage                                  # every rule: queue counts
npm run update-data triage sampajanna-clear-comprehension   # one rule, every case in full
npm run update-data triage immersion-concentration prune    # drop that rule's stale entries
```

For one rule it lists every queued segment with its English, aligned Pali and role. The queue has
three kinds of entry:

- **Stale** — a listed segment whose English no longer contains any `forms` source word. Upstream
  reworded the term out from under it.
- **Untriaged** — *closed rules only*: contains a source word, on neither list. Either upstream
  introduced the term there, or review missed it. Grouped by whether the `predicate` matches —
  matching ones are usually allows, and the disagreements are where the judgment is.
- **Newly covered** — *open rules only*: gained the term and was rewritten without review.
  Informational, and the price of the open default.

Each untriaged case resolves one of three ways: the term is genuinely there → `allow`; unrelated
English → `deny` with a reason; upstream reworded a line you'd overridden → delete the segment rule
if upstream now reads fine, otherwise re-derive `to` and re-anchor `from`.

**`prune` clears the stale half**, which needs no decision at all — a stale entry has no subject
left, and an upstream reword kills them in bulk (one refresh left 74 of `immersion-concentration`'s
88 denials dead). It leaves `untriaged` untouched, and is the one thing `triage` writes. A positional
word rather than a `--prune` flag because `npm run` drops anything starting with `--` unless a bare
`--` precedes it, so the flag spelling would look like it ran and do nothing.

**Authoring a new rule is the same command.** A closed rule with an empty `allow` list has its whole
footprint untriaged, so the first triage run *is* the enumeration. It also tells you which `mode` the
rule wants: if nearly everything lands in `allow`, write it open with only the exceptions listed.

## Auditing a run: `data/diff/`

`post` always writes it — no separate flag, so the diffs can't be out of date with
`data/sujato.post/`. Wiped and fully rewritten each run:

- **`00-all.diff`** — `data/sujato/` against `data/sujato.post/`. The plain before/after, and the
  file to read.
- `<id>.diff` — one per rule, attributing that result rule by rule.
- `00-summary.txt` — each rule's match and file counts, and any rule that matched zero.

**A rule file's `-` side is not upstream.** Rules run in sequence and each `<id>.diff` records its
own step, so its `-` side is whatever earlier rules had already made of the line. `sn36.7` is
"mindful and aware" upstream and "aware and clearly comprehending" shipped, but in
`sampajanna-clear-comprehension.diff` the `-` side reads "aware and aware" — an intermediate that
never ships, because `sati-aware` had already rewritten *mindful*. Honest attribution, unreadable as
a before/after; that's what `00-all.diff` is for.

`data/diff/` is **checked in**, which is what makes a refresh legible: `git diff data/diff/` next to
`git diff data/sujato/`. Hence no colour, no timestamps, sorted paths — a run over unchanged input
has to produce an unchanged tree.

Each file is a real unified diff, so word-level highlighting comes from the viewer:

```
riff < data/diff/sati-aware.diff      # inline highlight of the changed span
git diff data/diff/00-all.diff        # what the shipped text gained or lost
```

`riff` highlights and leaves the layout alone; `delta --color-only --minus-style normal --plus-style
normal` does the same. `mendicant-bhikkhu.diff` and `00-all.diff` are past GitHub's rendering limit,
so those are local-only; `.gitattributes` marks the directory `linguist-generated` so GitHub
collapses it by default.

Reading for *mechanical* correctness isn't enough. A swap that is right term-for-term can still leave
English no one would write — a stranded article, or a noun standing where an adjective used to. Read
for what sounds wrong, not just for what matched wrong.

## Limits

- **Judgment errors are baked into data, not derivable.** A wrong regex is one line to fix; a wrong
  list entry hides in 2,000 rows. The per-rule diff is the audit surface, and the recorded
  `predicate` lets you re-derive a list and diff it against what's stored.
- **A rule can't distinguish two occurrences within one segment.** If "aware" appears twice, once
  for *sampajañña* and once as plain English, only a segment override separates them.
- **Upstream additions don't arrive.** `apply` iterates the files named in `snapshot.json`, so a
  newly added sutta needs a deliberate snapshot regeneration.
- **Already-cached readers don't see the change.** Per-sutta text is `CacheFirst` with a one-year
  TTL and no cache-busting (CLAUDE.md's "Known gaps"), so your own browser is not a test of whether
  a rule shipped.
