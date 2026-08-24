# Translation changes

The English here is Bhikkhu Sujato's translation, published by SuttaCentral under CC0. It is not
reproduced verbatim: a small number of recurring terms are rendered differently, and about fifty
individual lines are reworded. Everything else is his, word for word — and the Pali sits beside
every line, so you can always check.

The changes are declared rather than typed in by hand, so they survive each refresh from upstream.
Nothing else is touched: **Bhikkhu Sujato's own footnotes are never altered**, which is why a note may
gloss a term in his wording while the line above it uses ours.

## Terms

| Pali | Bhikkhu Sujato | Here | Why |
|---|---|---|---|
| bhikkhu | mendicant | **bhikkhu** | The Pali word is widely known; "mendicant" suggests begging rather than the monastic life. |
| samādhi | immersion | **concentration** | The standard rendering, and the one nearly every other translator uses. |
| sati | mindfulness, mindful | **awareness, aware** | "Mindfulness" now carries a century of secular baggage the Pali doesn't. |
| satipaṭṭhāna | mindfulness meditation | **the establishment of awareness** | The compound read literally (*sati* + *upaṭṭhāna*), rather than named as a practice. |
| sampajañña | situational awareness, aware | **clear comprehension, clearly comprehending** | Bhikkhu Bodhi's rendering, and the dictionary's own first gloss. |
| ātāpī | keen | **ardent** | The word is literally "burning" (*ā* + *√tap*), which "keen" loses. Bhikkhu Bodhi, Ñāṇamoli and Thanissaro all say "ardent", and Bhikkhu Sujato himself does twice. |
| samudaya | origin | **arising** | So it reads as one half of a pair with *atthaṅgama*. |
| atthaṅgama | disappearance | **disappearing** | The other half of that pair. |
| vaya | vanishing | **passing away** | "Vanish" elsewhere means a being leaving a scene; this is impermanence. |
| udayabbaya | rise and fall | **arising and passing away** | Matches the pair above, and Bhikkhu Sujato's own wording for the near-synonym *udayatthagāminī*. |
| vipariṇāma + aññathābhāva | decays and perishes | **changes and becomes otherwise** | Both Pali words mean change; neither means decay or death. |
| vitakka / vicāra | placing the mind / keeping it connected | **thought / examination** | Reads them as thinking, which is what the words mean outside the jhāna formula too. |
| yoniso manasikāra | rational application of mind | **proper attention** | *Yoniso* is "from the source", i.e. appropriately — not a claim about rationality. |
| paṭisambhidā | textual analysis | **analytical knowledge** | The four *paṭisambhidās* are of meaning, the Dhamma, terminology and eloquence — "textual" names only one of them. |
| dhamma (six lines only) | text | **the Dhamma** | These discourses were memorized and recited, not written, so "text" imports something that didn't exist. Bhikkhu Bodhi's rendering. |
| paritassati | anxious, anxiety | **agitated, agitation** | Bhikkhu Sujato's own note gives the term as desire plus agitation; agitation is the half that survives. |
| saṅkhāra | choices | **volitional formations** | Bhikkhu Bodhi's rendering, and the nearest thing the term has to a standard one. "Choices" narrows a word that covers much more than deliberate choosing. |
| abhisaṅkharoti | make (choices) | **generate (volitional formations)** | The verb that goes with it — Bhikkhu Bodhi's too, and one of the dictionary's own glosses. |

A term is changed everywhere it appears, but only where it really is that Pali word — Bhikkhu Sujato's
"aware" also translates ordinary things that have nothing to do with *sampajañña*, and those are
left alone.

*Saṅkhāra* is the longest phrase on this page, and the cost is real: 137 lines list the five
aggregates, and "form, feeling, perception, volitional formations, and consciousness" puts a
seven-syllable phrase after four short words. The shorter "volitions" was rejected because that is
*cetanā*'s word, and the two terms stand side by side in one list in eight lines — "intentions,
aims, wishes, and volitions" would read as two synonyms rather than two distinct terms. Fourteen
lines keep "choices", where the Pali means something else or the English was never *saṅkhāra* at
all; MN 120, on a rebirth one deliberately aspires to, is left alone entirely.

This only ever touches the one sense of the word. Where Bhikkhu Sujato renders *saṅkhāra* as
"conditions", "conditioned phenomena", "physical process" or "life force", his wording stands.

One change is narrower still. In fourteen lines — SN 47.4 and Iti 47 — *vippasanna* becomes
**calm** rather than Bhikkhu Sujato's "clear", only because "clear comprehension" sits in the same sentence
and the two words translate unrelated terms. Everywhere else *vippasanna* stays "clear", which is
what it means of water, a gem, or someone's face.

## Reworded lines

About sixty individual lines are rewritten by hand. Nearly all of them exist because a term
swap that reads well as an adjective doesn't work as a whole sentence — "how is a bhikkhu clearly
comprehending?" becomes "how does a bhikkhu have clear comprehension?" — plus a handful where two
different Pali terms would otherwise land on the same English word in one sentence.

Three of them are DN 9, where Bhikkhu Sujato's two English phrases sit on the opposite Pali words
to everywhere else in the corpus, so the halves of the sentence are swapped back. One is Snp 3.12,
which reads "when choices *has* faded away" upstream and is corrected to "have" in passing. Two are
the titles of AN 3.23 and SN 33.4, where a one-word title becoming a two-word one needs its
capitals put back.

## Seeing the changes

Every rewrite is recorded in [`data/diff/`](../data/diff/), one file per rule, with the Pali of
each line for context.

For the nitty-gritty, every change on this page is declared in one file:
[`scripts/update-data/retranslation.mjs`](../scripts/update-data/retranslation.mjs). Each rule
there carries the reasoning for its own term — the dictionary glosses, what other translators use,
which occurrences are deliberately left alone and why — in far more detail than this summary.
[`docs/retranslation.md`](retranslation.md) describes how the machinery works.
