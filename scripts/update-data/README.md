# `npm run update-data`

Pulls the Pali root text, Sujato's English translation, and SuttaCentral's HTML structural markup
into `data/pali/`, `data/sujato/`, and `data/html/` from a local
[sc-data](https://github.com/suttacentral/sc-data) checkout, then applies this app's own editorial
layer over Sujato's English (terminology like "mendicant" → "bhikkhu", plus per-segment overrides)
onto a separate, generated `data/sujato.post/` — `data/sujato/` itself always stays pristine
upstream text, never mutated in place. `build-corpus.mjs` reads `data/sujato.post/`, not
`data/sujato/`. See `retranslation.md` for that layer: the rule shapes, why it isn't a plain
find-and-replace, and `update-data:triage`/`update-data:post:diff`, the tools for authoring and
auditing a rule.

```
SC_DATA_PATH=/path/to/sc-data npm run update-data
```

If it refuses to run, it's flagging one of two things — read what it prints before doing anything
else:

- a moved/restructured file upstream (segment ids changed, or a tracked file isn't where it's
  expected).
- a **cross-category integrity problem**: the Pali root text and its HTML structural mirror are
  expected to share exactly the same segment ids (they're the same document, just rendered two
  ways), and Sujato's translation is expected to be a *subset* of the Pali root's segment ids
  (never the reverse) — Sujato's translation legitimately skips some Pali-only scribal colophon
  lines that root/html both always carry, so a Sujato-only segment id is always worth flagging,
  but a Pali/html-only one usually isn't. `update-data:check` runs this both against the upstream
  checkout and against the local `data/{sujato,pali,html}` trees — the local pass is what catches
  a snapshot taken from an already-misaligned local state, which would otherwise pass every other
  check here.

It'll keep refusing on a plain re-run, since that's the guard doing its job; once you've confirmed
the change is legitimate, this is the sequence:

1. `npm run update-data:copy` — bypasses the guard and copies the new content in directly.
   `data/sujato/` is now pristine upstream, so `git diff data/sujato/` shows exactly what changed.
2. `npm run update-data:post:diff` — regenerates `data/sujato.post/` (Sujato's text only — Pali
   and HTML have no translatable English prose) and writes per-rule rewrites to `data/diff/` for
   review. If a retranslation rule broke, work it via `npm run update-data:triage` — see
   `retranslation.md`.
3. Test and ensure all is well.
4. `npm run update-data:snapshot` — tells the tool "yes, this is now the new normal" by recording
   what's now in `data/{sujato,pali,html}` as the new baseline (so future `check` runs compare
   against it instead of flagging this same change again), and by recording each retranslation
   rule's current match count.

This whole sequence is manual and deliberate — none of these steps run automatically.

Everything else — matching, copying, the integrity cross-check — is in the scripts themselves
(`../update-data-*.mjs`, `../lib/dataSync.js`); read those for details. The editorial layer
(`../update-data-post.mjs`, `../lib/retranslation.js`, `retranslation.mjs`) has its own doc,
`retranslation.md`.
