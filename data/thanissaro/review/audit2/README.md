# Second audit of Thanissaro's segmenting

A measure of the errors left after the left-out-lines round and the settling of the lines readers
disagreed on: 12 more texts drawn at random, none of the first audit's (`../audit/`), every line
read, those with only Pali too.

## The draw

`draw.py`, run from the repository root, with seed `20261002`, drawn as the first audit's, leaving
out the texts it drew.

| Collection | Texts | Share | Drawn |
|---|---|---|---|
| KN | 819 | 5.18 | snp2.7, dhp6, dhp93, thig2.4, dhp43 |
| SN | 506 | 3.20 | sn43.30, sn55.31, sn35.80 |
| AN | 454 | 2.87 | an11.16, an6.20, an10.92 |
| MN | 105 | 0.66 | mn111 |
| DN | 14 | 0.09 | — |

The batches are `review-rounds.py thanissaro read audit2 --every` of those texts, which lists every
line with its Pali, and the `.findings` beside them say "none".

## Results

| Lines | Read | Lines to change |
|---|---|---|
| With English of either translation | 450 | 0 |
| With only Pali | 19 | 0 |
| **All** | **469** | **0** |

The first batch was read a second time, by the session that ran the audit, with the same result.
The lines that look out of place, in Snp 2.7's verses, follow Thanissaro's own order, as do the
passages he condenses in AN 11.16 ("Similarly with the second, third, and fourth jhanas").

## Verdict

None found in 469 lines, where the first audit found 46 in 802. The draw holds no DN text and only
one MN, the collections where the first audit and the other rounds found the most; a draw weighted
toward them would say more.
