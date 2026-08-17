---
name: retranslate
description: Add, change, or remove an editorial rule over Sujato's English translation — rendering a Pali term differently throughout (e.g. "replace all forms of sati with aware/awareness", "sampajañña should be understanding", "origin → arising"), or overriding one specific segment's wording. Also use when an update-data run reports a broken rule or a non-empty triage queue.
---

# Retranslation rules

The full design is `scripts/update-data/retranslation.md` — **read it before the first edit in a
session.** This file is the procedure only.

Rules live in `scripts/update-data/retranslation.mjs`, their segment lists in
`scripts/update-data/rules/<id>.json`. `update-data:post` applies them to `data/sujato/` (pristine
upstream) and writes `data/sujato.post/` (generated).

## Never

- **Don't hand-edit `data/sujato/`.** It's upstream's bytes; every edit belongs in a rule, or the
  next refresh silently reverts it and the honest upstream diff is lost.
- **Don't run `update-data:copy` or `update-data:snapshot`** unless the user explicitly asks.
- **Don't list what you don't have to.** Always take the shorter of `allow`/`deny` — a term with
  no homonym problem (`mendicant`) is an open rule with an empty deny list, not 10,588 ids.

## Adding a term rule

1. **Identify the Pali term** the user means, and the English Sujato currently uses for it. If the
   user named an English word ("replace all occurrences of aware"), work out which Pali term it
   renders — a rule keyed on the English alone is the mistake this system exists to prevent.

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

5. **Check for same-word collisions.** Locking already covers a rule producing a token another
   rule consumes, in either order — two rules sharing a *segment* is fine and common. Order only
   decides the outcome when two rules match the **same English word**; there the earlier wins.

6. **Add a fixture** to the rule's examples and run `npm test`.

7. **Apply and audit**: `npm run update-data:post:diff`, then read
   `data/diff/<rule-id>.diff`. Check the Pali shown against each rewrite.

8. **Leave the baseline alone.** Match counts are recorded by `update-data:snapshot`, which is the
   user's call to run — don't run it yourself.

## Segment overrides

For "change this specific line": `kind: 'segment'`, with `from` copied **verbatim** from
`data/sujato.post/` — term rules have already run on it, and segment rules apply last, to their
output. A whitespace difference fails the anchor, so copy, don't retype. Add it to the trailing
`// ── Segment overrides ──` group at the end of the array, not next to the term rule it patches —
see "Keeping the file organized" below.

## Keeping the file organized

`RULES` is one array, and it only grows, so `retranslation.mjs` groups entries by term family
under a `// ── Family Name ──` banner comment, with a short header comment at the top of the file
listing the groups in array order — e.g. `standalone terms`, `awareness`, `arising / passing`,
`segment overrides`. This isn't cosmetic: order inside and between groups is exactly what settles
a same-word collision (locking handles the rest — see the same-word-collisions step above), so the
grouping doubles as documentation of *why* rules sit where they do — the awareness group's own
comment, for instance, records that `sati-aware` and `sampajanna-understanding` are neighbors
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
  reader has to remember.

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

Which rules changed, each one's match count, and what's left in any queue. Point at the diff files
rather than pasting them.

Mention when relevant: a shipped retranslation doesn't reach a reader who already has that sutta
cached (one-year `CacheFirst` TTL, no cache-busting), so the user's own browser isn't a test of
whether it worked.
