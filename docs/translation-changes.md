# Translation changes

The English here is Bhikkhu Sujato's translation, published by SuttaCentral under CC0. It is not
reproduced verbatim: a small number of recurring terms are rendered differently, and about
a hundred individual lines are reworded. Everything else is his, word for word — and the Pali sits beside
every line, so you can always check.

The changes are declared rather than typed in by hand, so they survive each refresh from upstream.
Nothing else is touched: **Bhikkhu Sujato's own footnotes are never altered**, which is why a note may
gloss a term in his wording while the line above it uses ours.

## Terms

| Pali | Bhikkhu Sujato | Here |
|---|---|---|
| bhikkhu | mendicant | **bhikkhu** |
| samādhi | immersion, immersed | **composure, composed** (and "collect" as a verb) |
| sati | mindfulness, mindful | **awareness, aware** |
| satipaṭṭhāna | mindfulness meditation | **the establishment of awareness** |
| sampajañña | situational awareness, aware | **clear comprehension, clearly comprehending** |
| ātāpī | keen | **ardent** |
| samudaya | origin | **arising** |
| atthaṅgama | disappearance | **disappearing** |
| vaya | vanishing | **passing away** |
| udayabbaya | rise and fall | **arising and passing away** |
| vipariṇāma + aññathābhāva | decays and perishes | **changes and becomes otherwise** |
| vitakka / vicāra | placing the mind / keeping it connected | **thought / examination** |
| yoniso manasikāra | rational application of mind | **proper attention** |
| paṭisambhidā | textual analysis | **analytical knowledge** |
| dhamma (six lines only) | text | **the Dhamma** |
| vedanā | feeling | **sensation** |
| paritassati | anxious, anxiety | **agitated, agitation** |
| saṅkhāra | choices | **volitional formations** |
| abhisaṅkharoti | make (choices) | **generate (volitional formations)** |

A term is changed everywhere it appears, but only where it really is that Pali word — Bhikkhu Sujato's
"aware" also translates ordinary things that have nothing to do with *sampajañña*, and those are
left alone.

## Seeing the changes

Every rewrite is recorded in [`data/diff/`](../data/diff/), one file per rule, with the Pali of
each line for context.

For the nitty-gritty, every change on this page is declared in one file:
[`scripts/update-data/retranslation.mjs`](../scripts/update-data/retranslation.mjs). Each rule
there carries the reasoning for its own term — the dictionary glosses, what other translators use,
which occurrences are deliberately left alone and why — in far more detail than this summary.
[`docs/retranslation.md`](retranslation.md) describes how the machinery works.
