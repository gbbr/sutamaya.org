---
name: retranslate
description: Add, change, or remove an editorial rule over Bhikkhu Sujato's English translation — rendering a Pali term differently throughout (e.g. "replace all forms of sati with aware/awareness", "sampajañña should be clear comprehension", "origin → arising"), or overriding one specific segment's wording. Also use when an update-data run reports a broken rule or a non-empty triage queue.
---

# Retranslation rules

The full design is `docs/retranslation.md` — **read it before the first edit in a session.** This
file is the procedure only.

Rules live in `scripts/update-data/retranslation.mjs`, their segment lists in
`scripts/update-data/rules/<id>.json`. `update-data:post` applies them to `data/sujato/` (pristine
upstream) and writes `data/sujato.post/` (generated).

## Never

- **Don't hand-edit `data/sujato/`.** It's upstream's bytes; every edit belongs in a rule, or the
  next refresh silently reverts it and the honest upstream diff is lost.
- **Don't run `update-data:copy` or `update-data:snapshot`** unless the user explicitly asks.
  `update-data:counts` is the one to run after a rule edit — see step 9 for why they're separate.
- **Don't list what you don't have to.** Always take the shorter of `allow`/`deny` — a term with
  no homonym problem (`mendicant`) is an open rule with an empty deny list, not 10,588 ids.

## Adding a term rule

1. **Identify the Pali term** the user means, and the English Bhikkhu Sujato currently uses for it. If the
   user named an English word ("replace all occurrences of aware"), work out which Pali term it
   renders — a rule keyed on the English alone is the mistake this system exists to prevent.

   Then **check the proposed rendering against the DPD and against other translators, and report
   both** before drafting anything. The user proposes the English word, but he wants the
   lexicography in front of him when he confirms it:

   - **DPD** — `data/pli2en_dpd.json`, already in the repo, is a `[{entry, definition}]` array
     keyed by Pali word (inflected forms included). Look up the base term and quote its gloss:
     `paṭisambhidā` gives "penetrating insight (into); analytical knowledge (of); discriminating
     understanding (of)", which is why "analytical knowledge" won over "analytical understanding".
     Compounds have their own entries, so a term that only ever appears bound (`anekadhātu-`
     `paṭisambhidā`) is still findable.
   - **Other translators** — say what Bodhi, Anālayo, Thanissaro and Ñāṇamoli use for the term,
     and note where they disagree with each other or with Bhikkhu Sujato. These aren't in the repo, so
     they come from knowledge rather than a lookup; say so when a rendering is one you're unsure
     of rather than asserting it.

   Report this as its own short block, not buried in the footprint table — an agreed rendering
   backed by the dictionary and the other translations is the point of the exercise, and it
   belongs in the rule's `why` afterwards.

2. **Draft the rule** with `forms`, a `predicate` regex over the Pali, `mode: 'allow'`, and an
   empty sidecar. Write the `why` now: which Pali term, why this app departs from upstream. Place
   it under the right `// ── Family ──` banner group (or start a new one) rather than appending to
   the end of the array — see "Keeping the file organized" below; this is not optional tidiness,
   since group/array order is what settles same-word collisions.

3. **Run `npm run update-data:triage -- <rule-id>`.** With an empty list, the whole footprint is
   untriaged — this run *is* the enumeration. Work every case into `allow` or into `deny` with a
   reason:
   - predicate matches, English matches → almost always `allow`;
   - predicate doesn't match → usually `deny`, but check. Pali compounds (`sammāsati`,
     `satipaṭṭhāna`) hide behind word boundaries and verbs like `passati` get caught by loose
     substrings, so predicate misses are not proof of anything;
   - **verse** segments where the two disagree are usually translation reordering, not a wrong
     decision — read the English, not the alignment.

   Report what you found rather than deciding alone which residual cases are acceptable. If the
   queue is large, say so and agree an approach before grinding through it.

4. **Settle the mode.** Once triaged, keep whichever of the two lists is shorter and flip `mode`
   to match — but say so, because it isn't only a size choice: an open rule silently rewrites
   segments that gain the term later, a closed one stops them for review. Where the lists are
   comparable, stay closed.

5. **Check for same-word collisions between rules.** Locking already covers a rule producing a
   token another rule consumes, in either order — two rules sharing a *segment* is fine and
   common. Order only decides the outcome when two rules match the **same English word**; there
   the earlier wins.

6. **Check what your replacement words already translate.** Step 5 is the source side; this is
   the output side, and nothing in the pipeline catches it. A word you introduce may already be
   Bhikkhu Sujato's rendering of an unrelated Pali term — no predicate, list or triage queue will ever
   flag that, because the rule is working exactly as written. For each replacement word, grep the
   corpus for it, look at what Pali sits behind the hits, and then check whether those segments
   ever share a **sutta** with the ones your rule rewrites. Distance is the whole question: the
   same English word for two terms three hundred suttas apart costs a reader nothing, two lines
   apart is a genuine ambiguity.

   Report what you find rather than resolving it alone. Accepting the overlap is the common
   answer and often the right one — "unstable" renders both aññathā and adhuva, which are
   near-synonyms whose suttas never intersect. The alternatives are picking a different word, or
   a segment override for the one line where they meet, which is what
   `sn56-34-abhisamaya-understand` exists for: "clear comprehension" landed in the same sentence
   as Bhikkhu Sujato's "comprehend" for abhisamaya, a different term entirely.

7. **Add a fixture** to the rule's examples and run `npm test`. One per grammatical slot the
   rule's forms distinguish, not just one per rule — a form that is right as a finite verb can be
   wrong as an infinitive or a noun, and a single example hides that.

8. **Apply and audit**: `npm run update-data:post`, then read `data/diff/<rule-id>.diff` (with
   `riff <` for the inline highlight). Check the Pali shown against each rewrite. `data/diff/`
   is checked in, so commit its changes with the rule — for an edit to an existing rule, `git
   diff data/diff/` is exactly what the edit did to the corpus.

9. **Record the new counts**: `npm run update-data:counts`, and commit the
   `retranslation.counts.json` diff with the rule. A rule absent from that file has no anchor at
   all when its deny list is empty — the count *is* what would catch it going half-dead after a
   future refresh — and the one-line-per-rule diff is the reviewable record of what the edit did.

   **Not `update-data:snapshot`.** That command records counts too, but it also rebaselines
   `snapshot.json` and `manifest.snapshotCommit`, the upstream segment-id drift detector — only
   ever right after a human has reviewed a real upstream change. Rebaselining it as a side effect
   of a rule edit silently blinds the *next* `update-data:check`. Same code, run through the
   entry point that does only the half you're entitled to.

10. **Update `docs/translation-changes.md`** — the plain-language summary of every departure from
    Bhikkhu Sujato, written for a reader who wants to know how this app's text differs from his, not for
    anyone maintaining the rules. A term rule earns a row in its table (Pali, Bhikkhu Sujato's word, ours,
    one line of why); a segment override usually earns nothing but a bump to the approximate count
    in "Reworded lines", unless it's a new *kind* of rewording. It's the one artifact here that
    won't announce its own staleness — no test or anchor covers it — so it goes in the same commit
    as the rule. Keep it short: a reader who wants the full footprint has `data/diff/`.

## Changing a term's rendering

Changing what an existing rule renders a term as is **not** substituting the new English into the
rule's existing `forms` pairs. Review the rule's entire footprint again from scratch, and expect to
invent forms the previous rendering never needed.

The reason is grammatical. A `forms` pair maps one English source word to one replacement, but
Bhikkhu Sujato's source word usually sits in more than one grammatical slot, and a replacement that works
in one slot is routinely ungrammatical in another. `sampajanna-clear-comprehension` is the worked
example: "understanding" happened to double as a participle, so one form covered both slots,
whereas "clear comprehension" is a noun phrase that cannot stand in the satipaṭṭhāna formula's list
of adjectives — "keen, aware, and mindful" would have become "keen, clear comprehension, and
aware" across roughly 250 segments. The fix was to split Bhikkhu Sujato's own vocabulary: his nouns
"situational awareness"/"awareness" render the noun *sampajañña* and take "clear comprehension",
while his bare "aware"/"unaware" render the adjective *sampajāna* and take "clearly
comprehending"/"without clear comprehension", leaving only a dozen predicative lines for segment
overrides.

A rendering can also change without touching the slots at all — "full comprehension" → "clear
comprehension" is one adjective swapped for another in every form and every override, so the split
above survived intact. Dump the shapes anyway; that the split holds is a finding, not an
assumption.

The method: dump every rewritten segment's before/after with its aligned Pali, deduplicate by
rewrite shape, and read all the distinct shapes. Around 700 rewrites collapse to roughly 200
shapes, which is small enough to read in full, and reading them is what surfaces the slots that
need their own form. Do this before reporting the change as done, and **report the per-slot form
split explicitly** — that split is the substantive editorial decision, not an implementation
detail.

## Segment overrides

For "change this specific line": `kind: 'segment'`, with `from` copied **verbatim** from
`data/sujato.post/` — term rules have already run on it, and segment rules apply last, to their
output. A whitespace difference fails the anchor, so copy, don't retype. Add it to the trailing
`// ── Segment overrides ──` group at the end of the array, not next to the term rule it patches,
and within that group under the `// ·· cause ··` sub-banner for whatever forced the override —
starting a new sub-banner if the cause is new. See "Keeping the file organized" below.

## Keeping the file organized

`RULES` is one array, and it only grows, so `retranslation.mjs` groups entries by term family
under a `// ── Family Name ──` banner comment, with a short header comment at the top of the file
listing the groups in array order — e.g. `standalone terms`, `awareness`, `arising / passing`,
`segment overrides`. This isn't cosmetic: order inside and between groups is exactly what settles
a same-word collision (locking handles the rest — see the same-word-collisions step above), so the
grouping doubles as documentation of *why* rules sit where they do — the awareness group's own
comment, for instance, records that `sati-aware` and `sampajanna-clear-comprehension` are neighbors
because they meet in the satipaṭṭhāna formula, a fact that would otherwise have to be
reconstructed from the two rules' `why` fields.

When adding a rule:

- **Existing family** (shares a Pali root, or is part of the same doctrinal cluster): add it to
  that group, at whichever position collision order requires, and update the group's banner
  comment if the new rule changes what it needs to say.
- **New family**: add a new banner group at the array position collision order requires, and add a
  line for it to the file's header comment.
- **Segment overrides** always go in the trailing `// ── Segment overrides ──` group, never inline
  next to the term rule they patch — they already run last regardless of array position, so
  keeping them together makes that fixed ordering the array's own shape rather than something a
  reader has to remember. That group has its own internal structure: `// ·· cause ··` sub-banners
  collecting the overrides that one problem forced (a participle that can't be a predicate, a
  noun the term rule deliberately leaves alone, a phrase whose word order has to move), each
  carrying the reasoning for its own rules so the group's preamble states only what is true of
  every override. Put a new rule under the sub-banner for its cause, or start one. **Unlike the
  term families, this order is navigation only** — a segment rule runs last whatever its array
  position, so nothing turns on where it sits and regrouping is free; say so if you reorganize,
  since the term-family rule above is the opposite.

This is a low bar — a `why` per rule, one banner per family, one header line per group — but it's
what keeps a file that will only keep growing navigable without `git blame`.

## Working a triage queue after a refresh

Every case is `allow`, or `deny` with a reason, or (for a stale entry) a decision about the
override that no longer matches. `update-data:check` prints three-way for broken segment rules:
the rule's `from`, upstream now, and the rule's `to`.

A **global** rule matching zero times is dead, not drifted — the term is gone from upstream
entirely. Find what replaced it before rewriting the rule.

`post` reads pristine input, so re-running after each edit is always safe; iterate freely.

## Reporting back

**Keep every report compact** — this applies to the lexicography block, the footprint survey, the
per-slot form split and the final summary alike, not just the closing message. A dozen lines and a
small table is the target; the size of the investigation never sets the size of the reply. Lead
with the decision the user has to make, put supporting evidence in a table or a handful of example
lines rather than prose, and hold the rest until asked. A queue of two hundred cases is reported as
a count and a shape breakdown, never as a listing.

Which rules changed, each one's match count, and what's left in any queue. Point at the diff files
rather than pasting them.

Mention when relevant: a shipped retranslation doesn't reach a reader who already has that sutta
cached (one-year `CacheFirst` TTL, no cache-busting), so the user's own browser isn't a test of
whether it worked.
