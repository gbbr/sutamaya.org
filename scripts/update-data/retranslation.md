# Retranslation rules

Sujato's English is the base text; this app ships an edited version of it. The edits are
*declared*, not applied by hand — `scripts/update-data/retranslation.mjs` holds every rule, and
`update-data:post` applies them on every refresh. That's what makes an editorial decision survive
the next upstream sync instead of being silently overwritten by it.

Two kinds of edit are in scope: **terminology** (render a Pali term consistently the way this app
prefers — *mendicant* → *bhikkhu*, *immersion* → *concentration*) and **per-segment** corrections
(one specific line, reworded).

Read `README.md` in this directory first for the surrounding `update-data` pipeline; this document
covers only the editorial layer on top of it.

## Where it sits in the pipeline

```
sc-data checkout ──copy──▶ data/sujato/  ──post + retranslation.mjs──▶ data/sujato.post/ ──build-corpus──▶ web/public/data/
                           (tracked,                                    (generated,
                            pristine upstream)                           gitignored)
```

**`data/sujato/` holds upstream's bytes, unmodified.** `data/pali/` and `data/html/` already work
this way and are unaffected — they have no translatable English prose. `post` never writes into
its own input; it reads `data/sujato/` and writes `data/sujato.post/`, which `build-corpus.mjs`
consumes in place of `data/sujato/` for the four trees it reads (`sutta`, `notes`, `name`,
`blurb`).

Three things follow from that separation, and they're the reason for it:

- **`post` is a pure function of (upstream text, rules).** Re-running it is always safe, and
  editing a rule and re-running gives the same result as a clean run — which matters because
  rule-writing is trial and error. Applying rules on top of already-rewritten text compounds them
  (`mindful`→`aware`, then a later `aware`→`understanding`, and now you can't tell which *aware*
  came from where).
- **`git diff data/sujato/` after a copy shows exactly what upstream changed**, uncontaminated by
  our own edits. That diff is the thing you actually read when reconciling a broken rule, so it
  has to be honest.
- **`retranslation.mjs` is the complete delta.** The entire editorial policy is one reviewable
  file plus its sidecars, not a diffuse set of changes spread across 5,396 data files.

`data/sujato.post/` is generated, so `build:corpus` runs `post` first — a fresh clone has no
post-processed tree until it does.

## Why this isn't find-and-replace

The obvious approach — swap English word X for Y everywhere — breaks on homonyms. Sujato renders
*sampajañña* as "aware", but "aware" also appears as ordinary English translating nothing of the
sort. A blind swap corrupts the second set.

**The fix is to name the segments involved, explicitly** — either the ones a rule applies to, or
the ones it must skip, whichever is the shorter and truer statement. This works because segment
ids are effectively immutable upstream, while the text inside them is not:

| Window | ids added | ids removed | values changed |
|---|---|---|---|
| 2 years → now | 741 | 2 | 24,502 |
| 1 year → now | 11 | 0 | 16,241 |
| 8 months → now | 2 | 0 | 9,175 |

So a segment id is a stable address to hang an editorial decision on, even though what's written
at that address changes constantly. That asymmetry is what the whole design rests on.

An explicit list also settles two cases nothing else handles well. **Verse** breaks segment
alignment — Sujato reorders freely across lines, so `sn22.95:14.3`'s English ("with situational
awareness and mindfulness") sits against Pali reading *Divā vā yadi vā rattiṁ* ("whether by day or
by night"). And **`blurb`/`name` have no Pali counterpart at all.** Neither is a special case for
a list; both are just judgment at review time.

### The Pali predicate

Something still has to *propose* the list. That's a regex over the aligned Pali root text — the
translation is segment-aligned with `data/pali/`, an invariant `update-data:check` already
enforces (`INTEGRITY_GROUPS` in `../lib/dataSync.js`), so "segments whose Pali contains
*sampajañña*" is a good first approximation of "segments where 'aware' means *sampajañña*".

**The predicate proposes; review disposes; the list executes.** It is recorded on the rule for
provenance and re-derivation, and never consulted at build time. That matters because a predicate
alone is not trustworthy: Pali is heavily inflected and compounds freely, so a substring `/sati/`
matches 6,394 Pali segments of which 4,727 have no "mindful" in the English — they're `passati` /
`samanupassati` ("sees") — while word boundaries instead lose `sammāsati` and `satipaṭṭhāna`. A
curated stem pattern lands at 2,945. Good enough to propose from, nowhere near good enough to ship.

## Rule shape

`retranslation.mjs` exports an ordered array. Order is significant (see the pass, below). Two
shapes: a **term rule**, which rewrites words wherever its list says it may, and a **segment
override**, which replaces one line outright.

### 1. Term rule

```js
{
  id: 'sampajanna-understanding',
  why: 'Sujato renders sampajañña as "aware"/"situational awareness"; this app prefers ' +
       '"understanding". Closed because plain-English "aware" is common and unrelated.',
  mode: 'allow',                       // 'allow' (closed) | 'deny' (open) — see below
  scope: ['sujato/sutta', 'sujato/notes'],
  predicate: /sampajañ|sampajān/i,     // proposes candidates; never runs at build time
  forms: [
    ['situational awareness', 'understanding'],
    ['aware', 'understanding'],
  ],
}
```

with `scripts/update-data/rules/sampajanna-understanding.json`:

```json
{
  "reviewedAt": "2026-08-17",
  "allow": ["dn22:1.9", "dn22:1.10", "…"],
  "deny": {
    "dn34:1.8.20": "plain English 'aware', translating a jhāna formula — no sampajañña"
  }
}
```

Sidecars are machine-written and sorted, so `retranslation.mjs` stays readable and a sidecar's diff
across refreshes is a clean record of what review decided. **`deny` carries a reason for every
entry** — without it, re-derivation re-proposes the same rejections forever and the queue never
empties.

#### Closed or open

`mode` decides what happens to text that doesn't exist yet, and that — not list length — is the
choice being made:

| | applies where | a new segment that gains the term | queue reports |
|---|---|---|---|
| `allow` (closed) | listed segments only | **not** rewritten, surfaces for review | stale + untriaged |
| `deny` (open) | everywhere except listed | rewritten, no review | stale denials + an FYI list |

Closed is safe and verbose; open is compact and trusts the term to stay unambiguous. **A rule with
an empty `deny` list is simply a global rule** — which is the right shape for a term with no
homonym problem at all:

```js
{
  id: 'mendicant-bhikkhu',
  why: 'Sujato renders bhikkhu as "mendicant"; this app keeps the Pali. Nothing else in the ' +
       'corpus renders as "mendicant", so nothing needs excluding.',
  mode: 'deny',
  forms: [['mendicant', 'bhikkhu'], ['mendicants', 'bhikkhus']],
}
```

List length is a good *proxy* for the right mode, so prefer whichever list is shorter — but read
it as a signal rather than an optimization. Two exceptions out of seven hundred means the term is
essentially unambiguous and open-by-default is genuinely correct; two hundred out of six hundred
and fifty means ambiguity is real and you want every future occurrence to stop for review. Where
the two are comparable, choose closed.

Ambiguous terms tend to be the small ones anyway — `aware` is 656 segments (~13KB), `mindful*`
2,263 (~45KB) — while `mendicant`'s 10,588 would have been 200KB of list solving a problem that
doesn't exist.

### 2. Segment override

```js
{
  id: 'dn22-1.9-satipatthana-gloss',
  kind: 'segment',
  why: 'The stock formula reads awkwardly once sampajāna is "understanding".',
  segment: 'dn22:1.9',
  from: '…keen, aware, and mindful, rid of covetousness and displeasure for the world',
  to:   '…keen, understanding, and aware, rid of covetousness and displeasure for the world',
}
```

`from` is verbatim and doubles as the rule's anchor. Segment rules run **after** all term rules,
against their output — writing one means the term rules got that line wrong.

Segment ids resolve to files through a segment→file index built once per run: range-batched files
hold segments keyed by sub-uid (`an1.5:1.2` lives in `an1.1-10_translation-en-sujato.json`), so
the filename can't be derived from the id.

### Shared fields

- **`id`** — stable, unique; names the sidecar and the diff file.
- **`why`** — required prose. Which Pali term, and why this app departs from upstream. A 2,000-id
  list says nothing about intent on its own; this is what carries it.
- **`scope`** — which trees, from `sujato/{sutta,notes,name,blurb}`. Defaults to all four.
- **`forms`** — `[from, to]` pairs, matched on English word boundaries, longest-first regardless
  of array order so `situational awareness` isn't pre-empted by `awareness`. Every inflection is
  listed explicitly rather than swapping stems: the corpus contains unrelated words on the same
  stem, e.g. MN40's "water immerser" (someone who dunks themselves in water), which a substring
  swap turns into the nonsense "water concentrater". Case is preserved.

## The pass

Per file, per segment value:

1. Split the string into a single unlocked chunk.
2. For each rule in array order: skip unless this segment is permitted — in its `allow` list for a
   closed rule, absent from its `deny` list for an open one. Otherwise apply its `forms` to
   **unlocked chunks only**, splitting each match into its own chunk and marking it locked.
3. Rejoin.

Locked chunks make the pass order-safe: text a rule has already written is invisible to every
later rule. Modelling this as a chunk list rather than offset arithmetic over a mutating string
keeps it obviously correct.

Explicit lists don't remove the need for this. Segments carrying two targeted Pali terms at once
are common — 531 have both *sampajañña* and *sati* — so `dn22:1.9` appears on **both** rules'
allow lists:

```
dn22:1.9  PLI: …viharati ātāpī sampajāno satimā vineyya…
          EN : …keen, aware, and mindful, rid of covetousness…
```

That's benign, because the two rules never compete for the same word: one matches "aware", the
other "mindful". In 472 of those 531 segments the English carries both words, one per rule.
Locking is what keeps them from interfering — the *sati* rule produces "aware", the exact token
the *sampajañña* rule consumes, and locking makes that new token invisible to it. The result is
"keen, understanding, and aware" **whichever order the two rules run in**.

Ordering therefore matters only when two rules match the *same* English word, where the earlier
rule simply wins. Order rules deliberately anyway; rely on locking for correctness.

The remaining 3 segments carry both Pali terms but only one of the two English words, so no rule
can tell which term it renders. Those need segment overrides — see the limits at the end.

Keys are never touched, by any rule. Only values.

Required tests: **idempotence** (`post` twice is byte-identical), the `dn22:1.9` collision as a
pinned fixture, and a per-rule input/output example checked directly.

## Anchors: how a rule announces that it broke

Upstream is a moving target. Sujato revises his own terminology continuously and in bulk — sweeps
touching 500+ files land a few times a year — and the sync commits are machine-generated with
identical messages (`[GHA] Nilakkhana transform and sync files from bilara-data repo.`), so the
git log tells you nothing about what changed. Recent examples: `tradition` → `denomination`,
`overexertion` → `exertion`, and in the eightfold path, `purpose` → `thought`. Rules breaking is
routine maintenance, and the only signal is the one we build.

| Anchor | Applies to | On violation |
|---|---|---|
| `from` matches verbatim | segment rules | **Hard fail.** Upstream reworded a line you'd overridden. |
| Rule matched at least once | term rules | **Hard fail.** The term is gone; the rule is dead. |
| **Triage queue is empty** | term rules | **Review.** See below. |

The triage queue is the coverage check on a rule's list:

- **Stale** — a listed segment whose English no longer contains any `forms` source word. Upstream
  reworded the term out of it (or, for a closed rule, out from under an allow entry).
- **Untriaged** — *closed rules only*: a segment whose English *does* contain a source word but
  which is on neither list. Either upstream introduced the term there, or review missed it.
- **Newly covered** — *open rules only*: a segment that gained the term and was rewritten without
  review. Informational, and the price of the open default.

Every entry names an exact segment id, which is why this replaces a percentage-drift anchor:
`sati-aware: 3 stale, 11 untriaged` is directly actionable where "count drifted 1.4%" is not. The
volumes are small — over the last 8 months `aware` moved 867→859 segments and `mendicant`
10,657→10,588 — so expect **tens of segments per refresh**, not thousands.

An **open rule with an empty deny list** has nothing to check against, so its anchor is its match
count instead, recorded in `retranslation.counts.json` (machine-owned, written by `update-data:snapshot` alongside
`snapshot.json` — both are the same act of accepting the current state as the new baseline).
Reported, never enforced beyond the zero-match fail. It exists for the half-dead case that
zero-match misses: upstream renames the term across part of the corpus, the rule still fires, but
its footprint drops sharply.

## Working the queue: `update-data:triage`

```
npm run update-data:triage                              # every rule: stale + untriaged counts
npm run update-data:triage -- sampajanna-understanding  # one rule, every case in full
```

For one rule it lists every queued segment with its English, its aligned Pali, and its role (prose
/ verse / heading, derived from `data/html` the same way `build-corpus.mjs` derives it). Untriaged
segments are grouped by whether the rule's `predicate` matches — predicate-matching ones are
usually allows, non-matching ones usually denies, and the disagreements are where the judgment
actually is.

**Authoring a new rule is the same command.** A closed rule with an empty `allow` list has its
entire footprint untriaged, so the first triage run *is* the enumeration. There's no separate mode.
It also tells you which `mode` the rule wants: if nearly everything lands in `allow`, the rule is
better written open, with only the exceptions listed.

Every untriaged segment must end up in `allow` or in `deny` with a reason. An empty queue means the
rule is current.

## Auditing a run: `update-data:post:diff`

```
npm run update-data:post          # apply rules
npm run update-data:post:diff     # apply rules, and write per-rule diffs
```

Writes to `scripts/update-data/diff/` (gitignored, wiped each run):

- `00-summary.diff` — every rule with its match count, files touched, triage-queue size, and any
  rule that matched zero.
- `<id>.diff` — one file per rule, every change it made.

Per change: file, segment id, the **Pali** of that segment, then before/after with **the changed
span highlighted inline**. Word-level, not line-level — these are single-word swaps inside long
paragraphs, and a line diff just shows two near-identical walls of text.

Colour is forced on when writing these files; the shared helpers in `../lib/dataSync.js` disable
it when stdout isn't a TTY, which is exactly the case here. Read with `less -R`.

No cap on entries — the directory is gitignored, and auditing all 1,200-odd rewrites of a term is
the actual use case.

## Reconciling an upstream change

`update-data:check` reports rule problems alongside its existing structural ones, **before**
anything is copied, by resolving each rule against the upstream files. For a broken segment rule
it prints three-way: the rule's `from`, upstream's text now, and the rule's `to` — enough to
decide without opening anything.

1. `npm run update-data` → `check` fails, reporting structural and rule issues separately.
2. `npm run update-data:copy` — new content in. `data/sujato/` is pristine upstream, so `git diff
   data/sujato/` is upstream's changes and nothing else.
3. `npm run update-data:triage` — work every queue to empty. Each case resolves one of three ways:
   - the term is genuinely there → add to `allow`;
   - it's unrelated English → add to `deny` with a reason;
   - upstream reworded a line you'd overridden → delete the segment rule if upstream's wording is
     now fine, otherwise re-derive `to` and re-anchor `from`.
4. `npm run update-data:post:diff` — apply, and read the per-rule diffs.
5. Iterate. `post` reads pristine input, so re-running after each edit is always safe.
6. `npm test`, check the reader, then `npm run update-data:snapshot` — which re-baselines segment
   ids and rule match counts together.

Nothing here runs automatically, by design — same as the rest of this pipeline.

## Limits

- **Judgment errors are baked into data, not derivable.** A wrong regex is one line to fix; a
  wrong list entry hides in 2,000 rows. The per-rule diff is the audit surface, and the recorded
  `predicate` lets you re-derive a list and diff it against what's stored.
- **A rule can't distinguish two occurrences within one segment** — if "aware" appears twice in a
  segment, once for *sampajañña* and once as plain English, only a segment override separates
  them.
- **Upstream additions don't arrive.** `copy` iterates the files named in `snapshot.json`, so a
  newly added sutta needs a deliberate snapshot regeneration. Rare: of 208 files added across
  tracked paths in 2026, 207 were Chinese HTML and one was English.
- **Already-cached readers don't see the change.** Per-sutta text is cached `CacheFirst` with a
  one-year TTL and no cache-busting on the URL (see CLAUDE.md's "Known gaps"), so a retranslation
  reaches an existing user only when that lapses or the cache evicts. Your own browser is not a
  test of whether a rule shipped.
