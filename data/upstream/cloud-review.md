# Reviewing cuts in a cloud session

Instructions for a Claude Code session, in the cloud or on the developer's machine, asked to review
one translation's cuts, `bodhi` or `thanissaro`. [README.md](README.md) explains what the cuts are. The session only hands batches to
subagents and saves their answers; it judges nothing itself.

## The batches

`data/<translator>/review/band3/` holds the cuts the segmenter is unsure of, 100 to a batch, the
least sure first:

| Margin | Bodhi | Thanissaro |
|---|---|---|
| 0.3–0.5 | batches 001–007 | batches 001–015 |
| 0.5–0.7 | batches 008–025 | batches 016–043 |
| 0.7–1.0 | batches 026–034 | batches 044–060 |

A batch is two files: `batch-NNN.txt`, which a reviewer reads, and `batch-NNN.json`, which the
segmenter uses to resolve the answers. A reviewer saves its answers beside them as
`batch-NNN.answers.1`, `.2` and so on, 25 cuts to a file. A batch is done when its answers files
hold one line for each of its cuts.

This lists each batch with its number of cuts and of answers so far:

```
for b in data/<translator>/review/band3/batch-*.txt; do
  echo "$b $(grep -c '^S1: ' "$b") $(cat "${b%.txt}".answers.* 2>/dev/null | grep -c .)"
done
```

## What to do

1. Take the batches in number order, leaving out those already done.
2. Give each batch to one subagent: the Agent tool, type `general-purpose`, model `sonnet`, with the
   prompt below. Run four at a time.
3. When the four have finished, commit the new answers files and push the session's branch:
   `git add data/<translator>/review/band3`, then
   `git commit -m "Review answers: <translator>, batches NNN–NNN"`.
4. Carry on with the next four. After the last batch of each margin row, say how many cuts were
   answered, how many were moved to another mark and how many got "?", from the subagents' replies.
5. Stop when every batch is done, or when a usage limit stops the subagents. Commit and push what is
   saved, and say which batch comes next.

## Rules

- Work on the session's own branch, and never push to `main`.
- Only answers files are added, and only in the folder of the round in hand. Nothing else in the
  repository changes, and no script is run.
- Never read a batch or an answers file yourself: they are large, and the listing above says all
  that is needed.
- A batch left short of answers goes to one more subagent, whose share starts after the last
  answered cut: cut 51 is on line 251 of the file, and its answers go in the next unused file.

## The subagent's prompt

Fill in the translator's name (Bhikkhu Bodhi or Ṭhānissaro Bhikkhu), the batch's absolute path, and
its number of cuts and lines. A batch of 100 cuts has the offsets and answers files shown; a shorter
one has fewer of each.

```
You are reviewing where a Buddhist sutta translation (by <name>) is cut into lines that match the
Pali original's lines. Each item asks where one line's meaning begins in the translation.

Each item is 5 lines of the batch file:

    <key>   the line after the cut
    S1: …   Bhikkhu Sujato's English for the line or lines before the cut, or their Pali
    S2: …   his English for the line after it, or its Pali
    T: …    the other translation around the cut: the places it may be cut are numbered [1], [2] …,
            the current one starred [n*]; ¶ is a paragraph or verse-line break
    (a blank line)

Find where the meaning of S2 begins in T, and answer with the number of the mark there. Judge by
meaning, not wording: the translations word things differently and sometimes order them
differently. A speaker's name ("The Blessed One:") or a heading goes with the words after it. The
translation sometimes has bracketed numbers of its own, such as a step number "[11]" right after a
mark; the marks are the ones that count up [1], [2], [3]… in order, one of them starred.

Answers, one line per item, in the batch's order:

    <key> <n>   the cut belongs at mark n
    <key> =     the starred cut is right, or no other mark is better
    <key> ?     you truly can't tell

Your share: the 100 items of <path>/batch-NNN.txt, which are its 499 lines.

Work 25 items at a time: Read the next 125 lines of the file (offsets 1, 126, 251, 376; limit 125),
judge those 25 items, then save their answers with the Write tool as a new file beside the batch:
<path>/batch-NNN.answers.1 for your first group, batch-NNN.answers.2 for the next, and so on up to
batch-NNN.answers.4. Never rewrite or append to an existing answers file. Answer every item in your
share, and nothing outside it.

Be token-efficient: use only the Read and Write tools, open no file but your batch, run no
commands, and keep your reasoning brief. If a save fails, carry on and put the unsaved answers in
your final reply, one per line.

When done, reply with a single line: items answered, how many you moved to a different mark, and
how many "?".
```

## More rounds

Three more rounds follow the middle band, in this order. Each runs as above — every batch of its
folder in number order, one subagent a batch, four at a time, the answers committed and pushed as
they come — with these differences:

| Round | Batches in | Subagent's model | Prompt | Answers saved as |
|---|---|---|---|---|
| Places | `data/<translator>/review/places/` | `opus` | the places prompt below | `batch-NNN.answers.N` |
| A second look at the cuts the weak bands settled | `data/<translator>/review/recheck/` | `opus` | the prompt above | `batch-NNN.answers.N` |
| A second opinion on the middle band | `data/<translator>/review/band3/` | `opus` | the prompt above | `batch-NNN.opus.N` |

- The second opinion is independent: its subagents never read the answers files already in
  `band3/`, and a batch is done when its `.opus` files hold one line for each of its cuts. The
  listing above counts them with `.opus.*` in place of `.answers.*`.
- In the second look an item shows both its lines whole, so it may be long. It is still 5 lines of
  the file.
- When a usage limit is near, finish the round in hand, push, and stop.

## Last rounds

Once those answers are kept, what is still open comes back in two folders, run the same way with
`opus` subagents, the answers saved as `batch-NNN.answers.N`:

| Round | Batches in | Prompt |
|---|---|---|
| A final look at the cuts still open | `data/<translator>/review/final/` | the first prompt; each item shows both its lines whole |
| The places left | `data/<translator>/review/places2/` | the places prompt below |

## Reading through

The last check reads every line. `data/<translator>/review/read/` holds the whole translation beside
Sujato's, a text after another, the least settled texts first. A batch is read once its
`batch-NNN.findings` is saved beside it, so a session carries on wherever the last one stopped.

1. Take the batches with no `.findings` file, in number order. This lists them:
   `for b in data/<translator>/review/read/batch-*.txt; do [ -e "${b%.txt}.findings" ] || echo "$b"; done`.
   For `thanissaro`, 038, 059 and 062 come first: they hold DN 15, MN 31 and MN 128, where whole
   runs of lines are a line or two off.
2. Give each batch to one subagent, four at a time, with the prompt below: the Agent tool, type
   `line-reader`, which runs `sonnet` at effort high. Where that type isn't available, as in a cloud
   session, use type `general-purpose` with model `sonnet`.
3. Every ten batches, say in one line how many batches are read and how many are left, and how many
   lines the last ten reported. `grep -c : <findings file>` counts a batch's lines.
4. Stop when the last ten batches reported five lines or fewer on average: the texts left are the
   least likely to be off, so reading on finds little. Say so, with the figures, and carry on only
   if asked. Stop as well when the batches are done or a usage limit is near.
5. On stopping, say how many lines were reported in all, and which batch comes next.

On the developer's machine the saved findings are the progress: commit nothing unless asked. In a
cloud session, commit and push them as they come, as the other rounds do.

```
You are checking a Buddhist sutta translation (by <name>) that has been cut into lines to match
the lines of the Pali original. Find the lines whose text is in the wrong place.

The file lists each text line by line:

    <key> | S: Bhikkhu Sujato's English for the line (or P: its Pali) | T: the other translation's
    text on that line, or (none)

A line's T should say what its S says. Report only what is clearly misplaced:
- T holds words that belong to the line above or below: a sentence's opening or ending, or a whole
  sentence or more.
- T is (none) though its meaning sits on the line above or below and could stand as a line.
- A run of lines whose texts are all a line or two too high or too low.

These are not errors, so leave them out: different wording, or a different order of words within
a line; a line the translator leaves out or shortens; several of Sujato's lines given as one
sentence that sits on the first of them, with (none) on the others; a heading or a number the
translator adds at the start of a line.

A line's text runs from its first words to the first words of the next line that has text, so
every fix says where a line should start. Write one line for each line to change:

    <key> starts: <the first six to eight words it should start with, copied exactly from T>
    <key> none        it should hold no text

Words that belong on the line below: report that line, starting at those words. Words that belong
on the line above: report the line they leave, starting at the words that stay. A line that should
be emptied into the line below: report it as none, and the line below as starting at its words.
Report only when you are sure.

Your share: <path>/batch-NNN.txt. Read all of it, in two or three parts, then save your findings
with the Write tool as <path>/batch-NNN.findings, or the single word "none" if nothing is
misplaced. Be token-efficient: use only the Read and Write tools, open no file but your batch, run
no commands, and keep your reasoning brief.

When done, reply with one line: how many lines you reported.
```

### The places prompt

The prompt above, with its first four paragraphs, down to the list of answers, replaced by these:

```
You are reviewing where a Buddhist sutta translation (by <name>) is cut into lines that match the
Pali original's lines. Each item is a place where a line may be cut wrongly: a line left with only
a sentence's opening word or two, or a line left with no English though the translation has it
next door.

Each item is 5 lines of the batch file:

    <key>   the item's name
    S1: …   Bhikkhu Sujato's English for the line or lines before the cut, or their Pali
    S2: …   his English for the line after it, or its Pali
    T: …    the other translation's text for those lines: the places it may be cut are numbered
            [1], [2] …, the current one starred [n*]; ¶ is a paragraph or verse-line break
    (a blank line)

T is cut at one mark: the text before it goes on S1's line, the text after it on S2's. Answer with
the number of the mark where the meaning of S2 begins. Judge by meaning, not wording: the
translations word things differently and sometimes order them differently.

- A mark before all of T gives S1's line none of it. Choose it only when nothing in T is S1's: the
  translator leaves S1 out, or has rendered it earlier.
- A mark after all of T gives S2's line none of it. Choose it when nothing in T is S2's own, or when
  T renders S1 and S2 as one sentence that has no mark where S2 begins.
- A line is never left with only a sentence's opening word or two ("When," "But, Ānanda,") while
  the sentence goes on across the mark: the opening stays with its sentence. If the sentence is
  S2's, choose the mark before the opening. If it is S1's, choose the mark where it ends.
- Words that close S1's line in Sujato stay on S1's line: a lead-in such as "that is," or
  "namely:", and the last of a pair or a list that S1 holds ("It's amazing, lord. It's
  astounding,").
- A speaker's name ("The Blessed One:") or a heading goes with the words after it. The translation
  has bracketed numbers of its own, such as "(9)" or "[11]"; the marks are the ones that count up
  [1], [2], [3]… in order, one of them starred.

Answers, one line per item, in the batch's order:

    <key> <n>   the cut belongs at mark n
    <key> =     the starred mark is right
    <key> ?     you truly can't tell
```
