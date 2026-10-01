# Answering a review round

Instructions for a Claude Code session asked to answer a review round of one translation, `bodhi` or
`thanissaro`. [README.md](README.md) says what the rounds are and puts them up. The session only
hands batches to subagents and saves their answers; it judges nothing itself.

## The batches

`data/<translator>/review/<folder>/` holds a round's items, 100 to a batch. A batch is two files:
`batch-NNN.txt`, which a reviewer reads, and `batch-NNN.json`, which the segmenter uses to resolve
the answers. A reviewer saves its answers beside them as `batch-NNN.answers.1`, `.2` and so on, 25
items to a file. A batch is done when its answers files hold one line for each of its items.

This lists each batch with its number of items and of answers so far:

```
for b in data/<translator>/review/<folder>/batch-*.txt; do
  echo "$b $(grep -c '^S1: ' "$b") $(cat "${b%.txt}".answers.* 2>/dev/null | grep -c .)"
done
```

## Rounds

| Round | Folder | Subagent's model | Prompt | Answers saved as |
|---|---|---|---|---|
| Unsure cuts, first pass | `cuts/` | `sonnet` | the cuts prompt | `batch-NNN.answers.N` |
| Unsure cuts, second opinion | `cuts/` | `opus` | the cuts prompt | `batch-NNN.opus.N` |
| Final look | `final/` | `opus` | the cuts prompt; each item shows both its lines whole | `batch-NNN.answers.N` |
| Places | `places/` | `opus` | the places prompt | `batch-NNN.answers.N` |
| Read-through | see "Reading through" | `sonnet` | the reading prompt | `batch-NNN.findings` |
| Second read | `reread/` | `opus` | the reading prompt | `batch-NNN.findings` |
| Check of a read's changes | outside the repository | `opus` | the check prompt | one file of answers |
| References | — | `opus` | the references prompt | `references.json` |

The second opinion is independent: its subagents never read the `.answers` files, and a batch is
done when its `.opus` files hold one line for each of its items (the listing above counts them with
`.opus.*` in place of `.answers.*`).

## What to do

1. Take the batches in number order, leaving out those already done.
2. Give each batch to one subagent: the Agent tool, type `general-purpose`, the round's model, with
   its prompt. Run three at a time.
3. As they finish, say how many items were answered, how many were moved to another mark and how
   many got "?", from the subagents' replies.
4. Stop when every batch is done, or when a usage limit stops the subagents, and say which batch
   comes next.

The saved answers are the progress: commit nothing unless asked.

## Rules

- Only the round's answers are saved: files in its folder, or `references.json`. Nothing else in
  the repository changes, and no script is run.
- Never read a batch or an answers file yourself: they are large, and the listing above says all
  that is needed.
- A batch left short of answers goes to one more subagent, whose share starts after the last
  answered item: item 51 is on line 251 of the file, and its answers go in the next unused file.

## The cuts prompt

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

## Reading through

The last round reads every line of its texts, each beside Sujato's, the least settled texts first:
`data/<translator>/review/read/` for a whole translation, or the folder the round was put up in. A
batch is read once its `batch-NNN.findings` is saved beside it, so a session carries on wherever the
last one stopped. A second read puts up first the texts whose findings couldn't all be applied, which
hold most of what is left.

1. Take the batches with no `.findings` file, in number order. This lists them:
   `for b in data/<translator>/review/<folder>/batch-*.txt; do [ -e "${b%.txt}.findings" ] || echo "$b"; done`.
2. Give each batch to one subagent, three at a time, with the reading prompt below: the Agent tool,
   type `line-reader`, which runs `sonnet` at effort high, or type `general-purpose` with model
   `sonnet` where that type isn't available. A second read sets the model to `opus`.
3. Every ten batches, say in one line how many batches are read and how many are left, and how many
   lines the last ten reported. `grep -c : <findings file>` counts a batch's lines.
4. Stop when the last ten batches reported five lines or fewer on average: the texts left are the
   least likely to be off, so reading on finds little. Say so, with the figures, and carry on only
   if asked. Stop as well when the batches are done or a usage limit is near.
5. On stopping, say how many lines were reported in all, and which batch comes next.

The saved findings are the progress: commit nothing unless asked.

### The reading prompt

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
no commands, and keep your reasoning brief. Quote at most a few words at a time anywhere, your
reasoning included: a content filter stops replies that copy out long stretches of the translation.

When done, reply with one line: how many lines you reported.
```

## The check prompt

For one subagent, after a read's findings are tried: 50 of the passing groups in
`review/findings.json`, drawn at random, each written out whole with its lines' key, Sujato's English
(or the Pali), and the translation's text before and after, numbered `## 1 (<name>, <text ID>)` on.
More than 2 judged worse means keeping none of that read's findings; a group judged worse is looked
at whole, with the lines around it, before it is dropped or fixed by hand.

```
You are checking changes to where a Buddhist sutta translation, by <name>, is cut into lines that
match the lines of the Pali original.

The file <path> holds 50 numbered items. Each shows a few consecutive lines. For each line it gives
the line's key, Bhikkhu Sujato's English for that line (or the Pali, where he has none), and the
other translation's text on that line Before a change and After it. The change only moves where the
lines are cut: the words are the same, just placed on different lines.

For each item, judge whether After puts the translation's text on the right lines better than
Before, the same, or worse. A line's text should say what Sujato's line says, or translate its
Pali. Judge by meaning, not wording: the translations word things differently, sometimes order the
words of a sentence differently, may leave lines out or abbreviate (a line with no text), and may
render several of Sujato's lines as one sentence that sits on the first of them. When both versions
are equally acceptable or equally wrong, answer same.

Read the whole file first, in two or three parts. Then save your answers with the Write tool to
<answers path>, one line per item, in this form:

    1 better
    2 same
    3 worse: <a few words saying why>

Use only the Read and Write tools, and open no other file. Be economical: start no further agents
and keep your reasoning brief. Quote at most a few words at a time anywhere, your reasoning
included: a content filter stops replies that copy out long stretches of the translation. When
done, reply with one line: how many items are better, same and worse.
```

## The places prompt

The cuts prompt, with its first four paragraphs, down to the list of answers, replaced by these:

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

## The references prompt

For one subagent, with the texts in hand named by their IDs:

```
Add to data/<translator>/review/references.json every place in the texts <IDs> where <name>'s
translation points to another passage instead of giving it, or cites one: in the text, the
introductions, the notes and the "See also" lists, as data/<translator>/sutta/ and notes/ hold
them. Each is an object with:

    key      the line's key
    where    "text", "introduction", "note" or "see-also"
    words    the words that point or cite, copied exactly
    kind     "stands-in" where they stand in for text, "cites" where they only cite
    target   the sutta they point to, as the app's ID (as data/sujato/sutta names its files), or
             null if unsure

dhammatalks.org numbers some suttas differently from the app; data/upstream/thanissaro/sources.json
maps its pages to the app's IDs. Change nothing else.
```
