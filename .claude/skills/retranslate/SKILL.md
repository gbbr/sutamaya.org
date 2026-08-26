---
name: retranslate
description: Add, change, or remove an editorial rule over Bhikkhu Sujato's English translation — rendering a Pali term differently throughout (e.g. "replace all forms of sati with aware/awareness", "sampajañña should be clear comprehension", "origin → arising"), or overriding one specific segment's wording. Also use when an update-data run reports a broken rule or a non-empty triage queue.
---

# Retranslation rules

The design is `docs/retranslation.md` — **read it before the first edit in a session.** This file is
the procedure only.

Rules live in `scripts/update-data/retranslation.mjs`, their segment lists in
`scripts/update-data/rules/<id>.json`. `update-data post` applies them to `data/sujato/` (pristine
upstream) and writes `data/sujato.post/` (generated).

## Never

- **Don't hand-edit `data/sujato/`.** Every edit belongs in a rule, or the next refresh silently
  reverts it and the honest upstream diff is lost.
- **Don't run `update-data apply` or `update-data accept`** unless the user explicitly asks.
  `update-data counts` is the one to run after a rule edit — see step 9.
- **Don't list what you don't have to.** Take the shorter of `allow`/`deny`: a term with no homonym
  problem (`mendicant`) is an open rule with an empty deny list, not 10,588 ids.

## Adding a term rule

1. **Identify the Pali term** the user means, and the English Bhikkhu Sujato currently uses for it.
   If the user named an English word ("replace all occurrences of aware"), work out which Pali term
   it renders — a rule keyed on the English alone is the mistake this system exists to prevent.

   Then **check the proposed rendering three ways and report all three** before drafting anything.
   The user proposes the English word, but wants the lexicography in front of him when he confirms:

   - **DPD** — `data/pli2en_dpd.json`, in the repo, is a `[{entry, definition}]` array keyed by Pali
     word (inflected forms and compounds included). Quote the gloss.
   - **The suttas, not the commentaries** — quote the passage that defines the term. The Abhidhamma
     and the Visuddhimagga are not authorities here, and an objection sourced from them is not
     grounds for rejecting a rendering the suttas support.
   - **Other translators** — what Bodhi, Anālayo, Thanissaro and Ñāṇamoli use, and where they
     disagree. These aren't in the repo, so say when you're unsure rather than asserting.

   Report it as its own short block. It belongs in the rule's `why` afterwards.

2. **Draft the rule** with `forms`, a `predicate` regex over the Pali, `mode: 'allow'`, and an empty
   sidecar. Write the `why` now. Place it under the right `// ── Family ──` banner group rather than
   appending to the array — group and array order settle same-word collisions.

3. **Run `npm run update-data triage <rule-id>`.** With an empty list the whole footprint is
   untriaged, so this run *is* the enumeration. Work every case into `allow` or into `deny` with a
   reason:
   - predicate matches, English matches → almost always `allow`;
   - predicate doesn't match → usually `deny`, but check. Compounds (`sammāsati`, `satipaṭṭhāna`)
     hide behind word boundaries and verbs like `passati` get caught by loose substrings;
   - **verse** segments where the two disagree are usually translation reordering, not a wrong
     decision — read the English, not the alignment.

   Report what you found rather than deciding alone. If the queue is large, agree an approach first.

4. **Settle the mode.** Keep whichever list is shorter and flip `mode` to match — but say so: an
   open rule silently rewrites segments that gain the term later, a closed one stops them for
   review. Where the lists are comparable, stay closed.

5. **Check for same-word collisions between rules.** Locking covers a rule producing a token another
   consumes, in either order; two rules sharing a *segment* is fine and common. Order decides the
   outcome only when two rules match the **same English word**, where the earlier wins.

6. **Check what your replacement words already translate.** Step 5 is the source side; this is the
   output side, and nothing in the pipeline catches it — a word you introduce may already be Bhikkhu
   Sujato's rendering of an unrelated Pali term, and the rule is working exactly as written. Grep
   **`data/sujato.post/`, never `data/sujato/`** — this is the output side, so what matters is the
   shipped text, and an earlier rule may already have cleared the word out of the way
   (satipaṭṭhāna's rule removes every "mindfulness meditation", so upstream's count for "meditation"
   overstates the collision by 269). Look at what Pali sits behind the hits, and check whether those
   segments ever share a **sutta** with the ones your rule rewrites. Distance is the whole question:
   the same word for two terms three hundred suttas apart costs nothing, two lines apart is a real
   ambiguity.

   Report rather than resolving alone. Accepting the overlap is common and often right ("unstable"
   renders both *aññathā* and *adhuva*, near-synonyms whose suttas never intersect). The alternatives
   are a different word, or a segment override for the one line where they meet.

7. **Add a fixture** and run `npm test`. One per grammatical slot the rule's forms distinguish, not
   one per rule — a form that is right as a finite verb can be wrong as an infinitive or a noun.

8. **Apply and audit**: `npm run update-data post`, then read `data/diff/<rule-id>.diff` (`riff <`
   for the inline highlight), checking the Pali against each rewrite. Its `-` side is the text this
   rule saw, after every earlier rule; `data/diff/00-all.diff` is the plain upstream → shipped view.
   `data/diff/` is checked in, so commit its changes with the rule.

9. **Record the new counts**: `npm run update-data counts`, committed with the rule. A rule absent
   from that file has no anchor at all when its deny list is empty — the count is what would catch it
   going half-dead after a future refresh.

   **Not `update-data accept`.** It records counts too, but also rebaselines `snapshot.json` and
   `manifest.snapshotCommit` — the upstream drift detector, only ever right after a human has
   reviewed a real upstream change. Rebaselining it as a side effect of a rule edit silently blinds
   the next `update-data plan`.

10. **Update the table in `docs/translation-changes.md`** — the plain-language summary written for a
    reader, not a maintainer. A term rule earns a row (Pali, his word, ours) and nothing else; a
    segment override earns nothing at all. **Add no prose.** The reasoning belongs in the rule's own
    comment in `retranslation.mjs`, and the full footprint in `data/diff/` — this page is a list of
    what changed, deliberately kept to the table and the few paragraphs already framing it. Nothing
    tests or anchors this file, so it goes in the same commit as the rule.

    **The rows are ordered by doctrinal weight and how often the term occurs, not by the order of
    `RULES`** — a reader scanning the table should meet *bhikkhu*, *samādhi* and *saṅkhāra* before
    the six-line *dhamma* fix. Use the rule's count in `retranslation.counts.json` as the occurrence
    figure, and keep a derived pair adjacent to its parent (*abhisaṅkharoti* under *saṅkhāra*) and a
    cluster together (*samudaya* / *atthaṅgama* / *vaya* / *udayabbaya*) even where the counts alone
    would separate them. Slot a new row in rather than appending it.

## Changing a term's rendering

Changing what an existing rule renders a term as is **not** substituting the new English into its
`forms` pairs. Review the whole footprint from scratch, and expect to invent forms the previous
rendering never needed.

The reason is grammatical: a `forms` pair maps one source word to one replacement, but Bhikkhu
Sujato's source word usually sits in more than one slot. `immersion-concentration` is the shipped
example — no single English word covers *samādhi* everywhere, so the rule splits by slot: the noun
and participle take "composure"/"composed", while the finite verb and gerund take
"collect"/"collecting", which also keeps clear of the corpus's existing "compose" for writing verses.
One form carries an article ("an immersion" → "composure") because the word it agrees with is the
word being replaced.

A rendering can also change without touching the slots, one adjective swapped in every form. Dump
the shapes anyway; that the split holds is a finding, not an assumption.

**The method:** dump every rewritten segment's before/after with its aligned Pali, deduplicate by
rewrite shape, and read all the distinct shapes (~700 rewrites collapse to ~200 shapes). Do this
before reporting the change as done, and **report the per-slot form split explicitly** — that split
is the substantive editorial decision, not an implementation detail.

## Segment overrides

For "change this specific line": `kind: 'segment'`, with `from` copied **verbatim** from
`data/sujato.post/` — term rules have already run on it, and segment rules apply last, to their
output. A whitespace difference fails the anchor, so copy, don't retype.

Add it to the trailing `// ── Segment overrides ──` group at the end of the array, never inline next
to the term rule it patches, and within that group under the `// ·· cause ··` sub-banner for whatever
forced it — starting a new sub-banner if the cause is new.

## Keeping the file organized

`RULES` is one array and it only grows, so `retranslation.mjs` groups entries by term family under
`// ── Family Name ──` banners, with a header comment at the top listing the groups in array order.
This isn't cosmetic: order inside and between groups settles same-word collisions, so the grouping
doubles as documentation of why rules sit where they do.

- **Existing family** (shares a Pali root, or the same doctrinal cluster): add it to that group at
  whichever position collision order requires, updating the banner comment if needed.
- **New family**: add a banner group at the position collision order requires, and a header line.
- **Segment overrides**: always the trailing group. **Unlike the term families, this order is
  navigation only** — a segment rule runs last whatever its array position, so regrouping is free;
  say so if you reorganize, since the term-family rule is the opposite.

## Working a triage queue after a refresh

**Prune the stale half first — it needs no decision.** A stale entry names a segment that no longer
contains any of the rule's forms. `npm run update-data triage <rule-id> prune` deletes exactly those
and leaves `untriaged` alone. What remains resolves to `allow`, or `deny` with a reason.

For a broken segment rule, `update-data plan` prints a derivation: upstream's raw line, what the term
rules did to it (`↪`), then `expected` (the rule's `from`) against `found` (what upstream now
produces) with the diverging words coloured, and `Would write:` for the rule's `to`. **When `found`
already reads correctly the override is obsolete — delete it.**

A **global** rule matching zero times is dead, not drifted: the term is gone from upstream entirely.
Find what replaced it before rewriting the rule.

`post` reads pristine input, so re-running after each edit is always safe; iterate freely. Mid-refresh
`apply` does the same thing and is equally idempotent.

## Reporting back

**Keep every report compact** — the lexicography block, the footprint survey, the per-slot form split
and the final summary alike. A dozen lines and a small table is the target; the size of the
investigation never sets the size of the reply. Lead with the decision the user has to make, put
evidence in a table or a few example lines, and hold the rest until asked. A queue of two hundred
cases is reported as a count and a shape breakdown, never as a listing.

Say which rules changed, each one's match count, and what's left in any queue. Point at the diff
files rather than pasting them.

Mention when relevant: a shipped retranslation doesn't reach a reader who already has that sutta
cached (one-year `CacheFirst` TTL, no cache-busting), so the user's own browser isn't a test of
whether it worked.
