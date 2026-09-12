# Retranslation rules

The app ships Bhikkhu Sujato's English with an editorial layer on top: some terms rendered
differently, some lines reworded, some group descriptions trimmed. Every edit is a **declared rule**
in `scripts/update-data/retranslation.mjs`, re-applied on each refresh, so an editorial decision
survives the next upstream sync instead of being overwritten by it.

[translation-changes.md](translation-changes.md) summarizes the changes for readers;
[data/README.md](../data/README.md) covers the refresh around them; the
[retranslate skill](../.claude/skills/retranslate/SKILL.md) is the step-by-step procedure for
writing a rule.

## Where it sits

```
sc-data ──copy──▶ data/sujato/ ──post──▶ data/sujato.post/ ──build-corpus──▶ web/public/data/
                  (checked in,             (generated,
                   as upstream)             git-ignored)
```

`post` never writes into its own input. So it can be re-run at will while authoring;
`git diff data/sujato/` after a refresh shows exactly what upstream changed; and the rules with
their segment lists are the complete record of what this app changes. The Pali and the HTML
templates hold no English and are never touched. `npm run build:corpus` runs `post` first.

## What settles a rendering

The texts are the Early Buddhist Texts, so a term means what they say it means. Where a passage
defines one, the definition governs: SN 22.56 defines the *saṅkhāra* aggregate as the six classes of
intention. The Abhidhamma and the commentaries neither justify a rendering nor rule one out. The DPD
and other translators inform a choice without settling it.

## Three kinds of rule

### Term rules

A term rule renders a Pali term's English consistently — *mendicant* → *bhikkhu* — wherever it is
permitted to (see [Allow and deny lists](#allow-and-deny-lists)). It lists its `forms`: every
inflection, spelled out (`immersed` → `composed`, `immerses` → `collects`), because swapping stems
breaks on unrelated words — MN 40's "water immerser" would become a "water concentrater". A form can
carry a neighbouring word that depends on it (`an immersion` → `composure`). Case is kept:
lowercase stays lowercase, a capitalized word stays capitalized, a title stays in Title Case.

### Segment overrides

A segment override replaces one line outright, where the term rules got it wrong — usually because
a swap changed a word's part of speech. It quotes the line exactly as the term rules leave it, and
that quote is also its anchor.

### Blurb rules

A blurb rule trims the opening of a group description that repeats the heading above it — *The
“Linked Discourses on the Truths” contains 131 discourses on…* The opening is quoted as a prefix
rather than the whole paragraph.

### What every rule has

An `id`, which names its segment list and its diff, and a `why`: which Pali term, and why this app
departs from upstream.

**Translator's notes are never rewritten.** A note is Sujato writing *about* his renderings, and a
rule right for the text would be wrong in the note that quotes it. So a note can read in his terms
while the line beside it reads in this app's.

## Allow and deny lists

A blind find-and-replace breaks on homonyms: Sujato's "vanish" renders *vaya*, but more often
*antaradhāyati*, a being disappearing from a scene. So each term rule names the segments involved,
in a sidecar file (`scripts/update-data/rules/<id>.json`) — either the ones it applies to or the
ones it skips, whichever is shorter and truer. Every denial carries a reason, or each review
re-proposes it.

| Mode | Applies | A new segment that gains the term |
|---|---|---|
| `allow` (closed) | only to the listed segments | is **not** rewritten; it waits for review |
| `deny` (open) | everywhere but the listed segments | is rewritten, unreviewed |

Read the choice as a statement about ambiguity: two exceptions in seven hundred means the term is
essentially unambiguous, so open; two hundred in six hundred means every new occurrence should stop
for review, so closed. When in doubt, close. An open rule with no denials is a global rule, right
for a term with no homonyms, like *mendicant*.

This works because segment ids are effectively fixed upstream while the text in them changes. It
also handles what nothing else can: verse, where English and Pali lines don't align, and titles and
descriptions, which have no Pali at all.

A rule also records a `predicate`, a pattern over the Pali that proposes candidates during review.
The build never consults it: the predicate proposes, review decides, the list executes.

## One pass, order-safe

Rules run in array order over each line, and **text a rule has written is locked** — invisible to
every later rule. That makes chains safe. Over "keen, aware, and mindful", with one rule turning
*aware* into *understanding* and another *mindful* into *aware*, the result is "keen,
understanding, and aware" whichever runs first. Order matters only when two rules match the same
English word, where the earlier wins. Segment overrides run after every term rule, blurb rules
last.

`retranslation.mjs` groups its rules under banner comments by term family, in the order that
settles such collisions.

## Anchors

Upstream rewords in bulk, under machine-written commit messages, so a rule breaking is routine and
the only signal is the one built here:

| Anchor | Rule | When it breaks |
|---|---|---|
| its quoted line still matches exactly | segment override | **hard fail** — upstream reworded a line this app overrides |
| its quoted opening still starts the description | blurb rule | **hard fail** |
| it still matches somewhere | term rule | **hard fail** — the term is gone and the rule is dead |
| its segment lists still fit the text | term rule | **review**, through `update-data triage` |
| its match count | open rule with no denials | recorded in `retranslation.counts.json`; a sharp drop shows in its diff |

`update-data plan` reports the hard fails before anything is copied. A broken override prints its
derivation: upstream's line, what the term rules made of it, then the expected line against the one
found. **When the found line already reads right, the override is obsolete — delete it.**

`update-data counts` records match counts after a rule edit, and does nothing else. `update-data
accept` records them too, as part of re-baselining after a refresh. Never run `accept` just to record
a rule edit: it would hide the next upstream change from `plan`.

## Authoring a rule

```
edit retranslation.mjs  →  npm run update-data triage <rule-id>   what the rule would touch
edit its sidecar        →  npm run update-data post               apply; writes data/diff/
                        →  git diff data/diff/00-all.diff         read the result
                        →  npm run update-data counts             record its footprint
```

A new closed rule with an empty list is entirely untriaged, so the first `triage` run *is* the
enumeration — and shows which mode the rule wants. Commit the rule, its sidecar, `data/diff/` and the
counts together.

## Reconciling an upstream change

`npm run update-data` (plan) names every rule a refresh breaks, before anything is copied. Fix
those, then `apply`, which is idempotent and so doubles as the edit-and-check loop:

```
npm run update-data apply  →  git diff data/diff/00-all.diff  →  fix  →  apply again
                           →  npm run update-data triage      →  prune  →  accept
```

## Working the queue

`npm run update-data triage` shows each rule's queue, and `triage <rule-id>` lists every case in
full, with its English, aligned Pali and role. A queue holds three kinds of entry:

- **Stale:** a listed segment that no longer contains the term — upstream reworded it away.
  `triage <rule-id> prune` drops these; they need no decision.
- **Untriaged:** closed rules only — a segment containing the term that sits on neither list.
  Either upstream added the term there, or review missed it.
- **Newly covered:** open rules only — a segment that gained the term and was rewritten
  unreviewed. Informational.

Each untriaged case goes to `allow`, or to `deny` with a reason. `prune` is a word rather than a
`--prune` flag because `npm run` swallows flags unless a bare `--` comes first.

## Auditing: `data/diff/`

`post` rewrites `data/diff/` on every run, and it is checked in, so a refresh or a rule edit leaves
a reviewable record of what changed in the shipped text:

- **`00-all.diff`** — upstream against shipped. The file to read.
- **`<rule-id>.diff`** — what each rule did. Its `-` side is the text that rule saw, after every
  earlier rule, not upstream.
- **`00-summary.txt`** — each rule's match and file counts.

They are real unified diffs, so any viewer's word highlighting works
(`riff < data/diff/atapi-ardent.diff`). Read them for what sounds wrong, not just what matched
wrong: a swap that is right term for term can still leave English no one would write.

## Limits

- **Judgement errors live in the lists.** A wrong pattern is one line to fix; a wrong entry hides
  among thousands. The per-rule diff is the audit surface.
- **A rule can't tell apart two occurrences in one line.** Only a segment override can.
- **New suttas upstream don't arrive on their own:** a refresh copies the files named in
  `snapshot.json`, so a new one needs the snapshot regenerated.
- **A reader with a sutta cached sees a change one visit late**
  ([web-app.md](web-app.md#offline-reading)), so your own browser isn't a first-visit test of
  whether a rule shipped.
