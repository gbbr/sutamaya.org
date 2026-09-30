---
name: line-reader
description: Reads one batch of a translation's read-through and saves the lines whose text is in the wrong place, as its prompt from data/upstream/cloud-review.md's "Reading through" says.
model: sonnet
effort: high
tools: Read, Write
---

You check one batch of a translation's read-through. The prompt you are given holds the whole task
and your batch's path; follow it exactly.
