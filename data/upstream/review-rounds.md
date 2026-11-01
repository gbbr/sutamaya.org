# Answering a review round

Instructions for a session, Claude Code or Codex, asked to answer a review round of one translation,
`bodhi` or `thanissaro`. [README.md](README.md)'s "Reviewing new and revised texts" says what the
rounds are and puts them up. The session only hands batches to subagents and saves their answers;
it judges nothing itself.

## Rounds

| Round | Batches | Subagent's model | Prompt | Answers saved as |
|---|---|---|---|---|
| Reading against the Pali | `review/<folder>/` | `opus`, or Codex at effort high | the reading prompt | `batch-NNN.findings` |
| Fixes by hand | `review/<folder>-flagged/` | `opus`, or Codex at effort high | the flagged prompt | `hand/<folder>-NNN.findings` |
| Check of the changes | `review/<folder>-check/` | the model the readers weren't | the check prompt | `batch-NNN.verdicts` |
| References | — | `opus` | the references prompt | `references.json` |

The check is the work of a judge from another model than the readers': Codex, in a session of
its own, where Claude read, and Claude where Codex did, or, without Codex, Claude's `sonnet` where
`opus` read.

## What to do

1. Take the batches whose answers file doesn't yet end with the line `# done`, in number order.
   This lists them for a read; for a check, put `verdicts` in place of `findings`, and for fixes
   by hand, look for the answers in `hand/`:
   `for b in data/<translator>/review/<folder>/batch-*.txt; do tail -1 "${b%.txt}.findings" 2>/dev/null | grep -qx '# done' || echo "$b"; done`
2. Give each batch to one subagent with the round's prompt: on Claude, the Agent tool, type
   `line-reader` for a read and `general-purpose` with the round's model otherwise, three at a
   time; on Codex, its own subagents at effort high, up to six at a time.
3. As they finish, say in one line what each reported.
4. Stop when every batch is done, or when a usage limit is near, and say which batch comes next.

The saved answers are the progress: commit nothing unless asked.

## Rules

- Only the round's answers are saved: files beside its batches or in `hand/`, or
  `references.json`. Nothing else in the repository changes, and no script is run.
- Never read a batch or an answers file yourself: they are large, and the listing above says all
  that is needed.
- An answers file that doesn't end with `# done` was cut short: give its batch to a new subagent,
  which writes the file again whole.

## The line rules

Every prompt below includes this block where it says `<the line rules>`. It is what the README's
"Building them into the app" asks of each line, put for a reader.

```
The Pali decides. S is context only: Sujato words things his own way, and gives some verses' lines
in a different order from the Pali's. A line's text renders its Pali, by these rules:

- Prose: each sentence, question, answer or list item sits on the Pali line it renders, however
  short: a refrain such as "Or he might say:" stays on its own line, and a speaker's name goes with
  the speech it introduces. A sentence that renders several Pali lines together sits whole on the
  first of them, with nothing on the rest; a line never holds just the opening of a sentence that
  runs on into the next. A list whose items are parted by ellipses is not one sentence: each item
  that renders a Pali line of its own sits on that line. Where the Pali abbreviates (…pe…) and the
  translation gives the passage in full, it sits on the Pali line that abbreviates it, not on the
  next one the Pali gives in full.
- Verse: the translator's own lines stay whole and in his order, the first on the verse's first
  Pali line, the rest spread over its Pali lines in order, one on each where he has as many lines
  as the Pali. A line needn't translate the Pali it sits on; the verse must. Where his lines cross
  from one verse into the next, the two are spread as one. A spread that keeps to this is right
  even where his order differs from the Pali's: never move a line to match its meaning.
- A note standing for a passage he doesn't give ("As in AN8.46, including the verses", "The rest
  as in …", "This sutta is identical with the preceding one") sits whole on the first Pali line of
  the passage it stands for. A note standing for part of a sentence or a list item sits where that
  sentence starts.
- A passage he prints at a different point from the Pali stays where his page puts it, on the
  nearest line: his words and their order never change.
- Commentary is not translation: an introduction, a closing remark or an alternative rendering of
  his belongs in the notes, never in the text, and the notes hold nothing he translates. A
  bracketed aside inside his sentence, such as "[literally: otherness]", is part of his text.

These are not errors: different wording; a line he leaves out or abbreviates, with nothing on its
Pali; a heading or a number he adds at the start of a line; a passage his edition of the Pali gives
differently from this one.
```

## The reading prompt

For one subagent per batch of a round put up by `review-pali.py packet`. Fill in the translator's
name (Bhikkhu Bodhi or Ṭhānissaro Bhikkhu), the batch's absolute path and the line rules.

```
You are checking a Buddhist sutta translation, by <name>, cut into lines that match the lines of
the Pali original. Find the lines whose text is in the wrong place.

The file lists whole texts, each under its "## <text>" heading (a long one goes on in the next
file, under "## <text>, continued"), every Pali line included:

    <key> | P: the Pali line | S: Bhikkhu Sujato's English for it | T: <name>'s text on that line

with (none) where a line has nothing, and after it " | verse" for a line of a Pali verse,
" | covered" for a line with no text whose Pali shows under the text above, as that text renders
it, and " | N: …" for a note of the translator's on the line. In T, ⏎ marks where one of his own
verse lines starts.

<the line rules>

A line's text runs from its first words to the first words of the next line that has text, so
every fix says where a line starts. Write one line for each line to change:

    <key> starts: <the first six to eight words it should start with, copied exactly from T>
    <key> none        it should hold no text

Words that belong on the line below: report that line, starting at those words. Words that belong
on the line above: report the line they leave, starting at the words that stay. A line can start
after a space or a punctuation mark, an ellipsis included, never inside a word. Quote only words
that will be on that line.

Report these too, one a line:

    <key> covered        a prose line with no text, not marked covered, whose own content the
                         text above renders in full; never a repetition the text abbreviates or
                         compresses, a passage rendered earlier than its Pali, or a line you are
                         unsure of (a verse's lines are covered by rule, so leave them)
    <key> not covered    a line marked covered that should not be: in prose, one the text above
                         doesn't render so; in a verse, one he shortens ("…") or gives only as a
                         note pointing elsewhere
    # <key>: <a few words>   anything a line's start can't mend: commentary in T, translation in
                         N, a note on the wrong line

Report only when you are sure.

Your share: <path>. Read all of it, in parts, then save your findings with the Write tool as the
same path with .findings in place of .txt, ending with the line "# done" (a batch with nothing to
report holds that line alone). Be token-efficient: use only the Read and Write tools, open no file
but your batch, run no commands, start no agents, and keep your reasoning brief. Quote at most a few
words at a time anywhere, your reasoning included: a content filter stops replies that copy out
long stretches of the translation.

When done, reply with one line: how many lines you reported.
```

## The flagged prompt

For one subagent per batch of `review-rounds.py flagged`: each batch holds the findings the
segmenter couldn't apply, each with the stretch of its text around it. The fixes go to `hand/`,
where they override the readers'. Fill in the name, the batch's path, its number of stretches, the
answers path and the line rules.

```
You are fixing where a Buddhist sutta translation, by <name>, is cut into lines that match the
lines of the Pali original. A reader reported the places in this file as misplaced, but the fixes
could not be applied as written: most need a neighbouring line changed too.

The file <path> holds <n> places, each a short stretch of one text under its "## <text>" heading,
line by line:

    <key> | P: the Pali line | S: Bhikkhu Sujato's English for it | T: the translation's text on
    that line now, or (none)

followed by what was reported for it:

    Reported: <key> starts: <words>      the line should start with these words
    Reported: <key> none                 the line should hold no text

In T, ⏎ marks where one of the translator's own verse lines starts.

<the line rules>

For each stretch, work out where each line's text should start so that the stretch reads right,
and write the fix in full:

    <key> starts: <the first six to eight words it should start with, copied exactly from T>
    <key> none        it should hold no text

A line's text runs from its first words to the first words of the next line that has text. Every
line that has text now and that you don't name keeps exactly the words it starts with now, and a
line with (none) that you don't name stays empty. So name each line whose first words must change,
and each line that must lose all its text. Name only lines shown in the stretch. Quote only words
that will be on that line: where it will hold fewer than six words, quote just those, never the
next line's. A line can start after a space or a punctuation mark, an ellipsis included, never
inside a word: where words are joined by a hyphen or an apostrophe, as in "well-taught", leave
such a place as it is.

The reports point to the problem but may be wrong: follow a report only where it is right, and
write nothing for a stretch that already reads right. Where two Pali lines say similar things, the
translation belongs on the one whose words it renders, not the later one by default.

Read all of the file, in parts, then save your fixes with the Write tool as <answers path>, one per
line, ending with the line "# done". Be token-efficient: use only the Read and Write tools, open no
file but your batch, run no commands, start no agents, and keep your reasoning brief. Quote at most
a few words at a time anywhere, your reasoning included: a content filter stops replies that copy
out long stretches of the translation. When done, reply with one line: how many stretches you
fixed and how many lines you named.
```

## The check prompt

For one subagent per batch of `review-rounds.py check`, in a session of the model the readers
weren't: every change since the round's starting point, each line whose text, note or place in
`covered.json` changed, in the stretch of lines around it. Fill in the name, the batch's path, its
number of items and the line rules. A change judged worse comes out of the round, or is fixed by
hand and judged again, once the session has looked at it whole, with the lines around it.

```
You are judging changes to where a Buddhist sutta translation, by <name>, is cut into lines that
match the lines of the Pali original. Judge each by the Pali.

The file <path> holds <n> numbered items, each a few consecutive lines of one text:

    <key> | P: the Pali line | S: Bhikkhu Sujato's English for it
      Before: the translation's text on that line before the change, or (none)
      After: its text after the change

with " | verse" after a line of a Pali verse. ⏎ marks where one of the translator's own verse
lines starts. A change moves where the lines are cut: the words and their order stay the same.
Under a line it may also show:

      Covered: Before no, After yes    a line with no text whose Pali now shows under the text
                                       above it (or the other way round: no longer shows)
      Note before: … / Note after: …   the translator's note on that line, changed

<the line rules>

A line with no text shows its Pali under the text above in two cases. In prose, only where that
text renders the line's own content in full: never a repetition the text abbreviates or
compresses, a passage rendered earlier than its Pali, or a line one can't be sure of. In a verse
the translator gives, every Pali line shows, whatever its order against his lines, unless he
shortens the verse ("…") or gives it only as a note pointing elsewhere.

For each item, judge whether After is better than Before, the same, or worse. When both versions
are equally right or equally wrong, answer same.

Read the whole file first, in parts. Then save your answers with the Write tool as the same path
with .verdicts in place of .txt, one line per item, in this form, ending with the line "# done":

    1 better
    2 same
    3 worse: <a few words saying why>

Use only the Read and Write tools, and open no other file. Be economical: start no further agents
and keep your reasoning brief. Quote at most a few words at a time anywhere, your reasoning
included: a content filter stops replies that copy out long stretches of the translation. When
done, reply with one line: how many items are better, same and worse.
```

## The references prompt

For one subagent, with the texts in hand named by their IDs:

```
Add to data/<translator>/references.json every place in the texts <IDs> where <name>'s
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
