# `npm run update-sujato`

Pulls Sujato's English translation into `data/sujato/` from a local
[sc-data](https://github.com/suttacentral/sc-data) checkout, then re-applies our own terminology
tweaks (e.g. "mendicant" → "bhikkhu") on top, since a fresh copy would otherwise overwrite them.

```
SC_DATA_PATH=/path/to/sc-data npm run update-sujato
```

If it refuses to run, it's flagging a moved/restructured file upstream — read what it prints
before doing anything else. It'll keep refusing on a plain re-run, since that's the guard doing
its job; once you've confirmed the change is legitimate, this is the sequence:

1. `npm run update-sujato:copy` — bypasses the guard and copies the new content in directly.
2. `npm run update-sujato:post` — applies post-processing
3. Test and ensure all is well.
4. `npm run update-sujato:snapshot` — tells the tool "yes, this is now the new normal" by
   recording what's now in `data/sujato/` as the new baseline, so future `check` runs compare
   against it instead of flagging this same change again.

This whole sequence is manual and deliberate — none of these steps run automatically.

Everything else — matching, copying, the terminology list — is in the scripts themselves
(`../update-sujato-*.mjs`, `../lib/sujatoSync.js`); read those for details.
