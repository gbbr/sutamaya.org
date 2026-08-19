# How this app's text differs from Sujato's

The English here is Bhikkhu Sujato's translation, published by SuttaCentral under CC0. It is not
reproduced verbatim: a small number of recurring terms are rendered differently, and about fifty
individual lines are reworded. Everything else is his, word for word — and the Pali sits beside
every line, so you can always check.

The changes are declared rather than typed in by hand, so they survive each refresh from upstream.
Nothing else is touched: **Sujato's own footnotes are never altered**, which is why a note may
gloss a term in his wording while the line above it uses ours.

## Terms

| Pali | Sujato | Here | Why |
|---|---|---|---|
| bhikkhu | mendicant | **bhikkhu** | The Pali word is widely known; "mendicant" suggests begging rather than the monastic life. |
| samādhi | immersion | **concentration** | The standard rendering, and the one nearly every other translator uses. |
| sati | mindfulness, mindful | **awareness, aware** | "Mindfulness" now carries a century of secular baggage the Pali doesn't. |
| satipaṭṭhāna | mindfulness meditation | **the establishment of awareness** | The compound read literally (*sati* + *upaṭṭhāna*), rather than named as a practice. |
| sampajañña | situational awareness, aware | **clear comprehension, clearly comprehending** | Bhikkhu Bodhi's rendering, and the dictionary's own first gloss. |
| samudaya | origin | **arising** | So it reads as one half of a pair with *atthaṅgama*. |
| atthaṅgama | disappearance | **disappearing** | The other half of that pair. |
| vaya | vanishing | **passing away** | "Vanish" elsewhere means a being leaving a scene; this is impermanence. |
| udayabbaya | rise and fall | **arising and passing away** | Matches the pair above, and Sujato's own wording for the near-synonym *udayatthagāminī*. |
| vipariṇāma + aññathābhāva | decays and perishes | **changes and is unstable** | Both Pali words mean change; neither means decay or death. |
| vitakka / vicāra | placing the mind / keeping it connected | **thought / examination** | Reads them as thinking, which is what the words mean outside the jhāna formula too. |
| yoniso manasikāra | rational application of mind | **proper attention** | *Yoniso* is "from the source", i.e. appropriately — not a claim about rationality. |
| paṭisambhidā | textual analysis | **analytical knowledge** | The four *paṭisambhidās* are of meaning, text, terminology and eloquence — only the second is textual. |
| paritassati | anxious, anxiety | **agitated, agitation** | Sujato's own note gives the term as desire plus agitation; agitation is the half that survives. |

A term is changed everywhere it appears, but only where it really is that Pali word — Sujato's
"aware" also translates ordinary things that have nothing to do with *sampajañña*, and those are
left alone.

One change is narrower still. In fourteen lines — SN 47.4 and Iti 47 — *vippasanna* becomes
**calm** rather than Sujato's "clear", only because "clear comprehension" sits in the same sentence
and the two words translate unrelated terms. Everywhere else *vippasanna* stays "clear", which is
what it means of water, a gem, or someone's face.

## Reworded lines

About fifty individual lines are rewritten by hand. Nearly all of them exist because a term swap
that reads well as an adjective doesn't work as a whole sentence — "how is a bhikkhu clearly
comprehending?" becomes "how does a bhikkhu have clear comprehension?" — plus a handful where two
different Pali terms would otherwise land on the same English word in one sentence.

## Seeing the changes

Every rewrite is recorded in `data/diff/`, one file per rule, with the Pali of each line for
context. `docs/retranslation.md` describes how the machinery works.
