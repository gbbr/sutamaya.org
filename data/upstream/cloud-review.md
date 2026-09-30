# Reviewing cuts in a cloud session

Instructions for a Claude Code cloud session asked to review one translation's cuts, `bodhi` or
`thanissaro`. [README.md](README.md) explains what the cuts are. The session only hands batches to
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
- Only answers files are added, and only under `band3/`. Nothing else in the repository changes, and
  no script is run.
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
