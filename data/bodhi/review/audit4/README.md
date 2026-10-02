# Fourth audit of Bodhi's segmenting

A measure of what the full read-through of MN and DN (`../fullread/`) leaves: texts drawn from
those two collections only, about 2,500 lines, none an earlier audit drew, every line read, those
with only Pali too.

## The draw

`draw.py`, run from the repository root, with seed `20261004`: DN's texts in random order up to
half the lines, at least one, then MN's up to 2,500 in all. DN 2 is the only DN text no earlier
audit drew.

| Collection | Drawn |
|---|---|
| DN | dn2 |
| MN | mn103, mn38, mn95, mn6, mn82, mn26, mn75 |

The batches are `review-rounds.py bodhi read audit4 --every` of those texts.

## Results

| Text | Lines read | Lines to change |
|---|---|---|
| mn38 | 443 | 5 |
| mn75 | 261 | 1 |
| dn2 | 648 | 0 |
| mn6, mn26, mn82, mn95, mn103 | 1,273 | 0 |
| **All** | **2,625** | **6** |

That is 0.2% of lines; in MN, 0.3%; in DN, none.

## The errors, by kind

- **A question on the answer line above it** — `mn38:16.5`, 16.7, 16.9, 16.11 and 16.13: "And this
  feeling has what as its source…?" and the four like it follow the answer before them with no
  space after its ellipsis.
- **A list item on the line above** — `mn75:10.2`, "with odours cognizable by the nose…", after an
  ellipsis with no space, on 10.1.

Readers had named all six; a fix by hand from before a line could start right after an ellipsis,
in `hand/flagged-003.findings`, kept them empty. Those lines of it are marked superseded, and
`hand/audit4.findings` holds the six.

## Verdict

Both collections are below half a percent. The six errors have one source: fixes by hand made
before a line could start right after an ellipsis, which overrule readers who had them right. The
same files, `hand/flagged-001` to `004.findings`, empty 34 more lines in MN that a reader starts
right after an ellipsis, MN 11's chain of sources at 16.5 to 16.15 among them; they are unchecked.
