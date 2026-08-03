# Handoff: Sutamaya — sutta reader (interactive prototype)

## Overview
Sutamaya is an offline-first reader for the Early Buddhist Texts. Three surfaces:

1. **Library** — a corpus tree (nikāyas → chapters → suttas), user-created lists, and full-text search.
2. **Preview pane** (tablet/desktop, ≥ 880px) — reads the selected sutta in place, with note and list
   controls, and can be expanded to full screen or closed entirely.
3. **Immersive reader** — full-screen reading with inline Pali, a docked word dictionary,
   text-range highlighting, notes, lists, and typography controls.

This bundle supersedes `design_handoff_sutamaya/` (which covered the earlier wireframes). This one is the
high-fidelity, fully interactive version.

## About the Design Files
The files here are **design references created in HTML** — a working prototype of the intended look and
behaviour, not production code to paste in. The task is to **recreate this design in the target codebase**
(React, Vue, SwiftUI, native…) using its established patterns, libraries, and data layer. If no environment
exists yet, choose the framework that best fits the product and implement the design there.

`Sutamaya.dc.html` is a single self-contained file: markup, inline styles, and a logic class. All copy,
colours, and measurements in it are intentional and final. The sutta corpus inside it is a ~12-sutta
excerpt used for demonstration; real data comes from SuttaCentral/Bilara-style JSON.

## Fidelity
**High-fidelity.** Colours, typography, spacing, states, motion, and interaction are final. Recreate the UI
faithfully using the codebase's existing primitives. The only deliberately unfinished parts are the data
layer (corpus, dictionary, sync/auth) and the "change translation source" control.

## Layout & breakpoints

| Width | Layout |
|---|---|
| < 860px | **Mobile.** One pane at a time: browse tree ⇄ sutta list (drill-in), reader as a full-screen overlay. |
| 860–879px | Two panes: tree + list side by side. No preview. |
| ≥ 880px | **Three panes:** tree · list · preview. |

Pane widths are user-draggable and persisted. Constraints: tree ≥ 210px, list ≥ 280px, preview ≥ 300px;
the tree is clamped so the other two never drop below their minimums. Double-click a divider to reset
(tree 264px, list 404px). Dividers are 7px invisible hit areas — no visible grip; the 1px pane border is
the only mark. Cursor is `col-resize` on hover.

Pane surfaces are tinted in three steps, darkest on the left:
tree `#F0ECE4` · list `#F8F6F2` · preview/app `#FDFCFA`.

## Screens / Views

### 1. Browse pane (left)
- Header (16px 18px 14px, bottom border `rgba(27,25,23,.12)`): wordmark **Sutamaya** 22px/600,
  letter-spacing -.01em; `Hide` text button on the right (≥860px) collapses the pane to a 12px strip;
  on mobile, `Settings` / `Sign in` instead. Below: search input, 38px tall, 9px radius,
  1px `rgba(27,25,23,.22)` border, `#FFFDFA` fill, placeholder "Search ID, title, blurb, note, text".
- `BROWSE` and `MY LISTS` section labels: IBM Plex Sans 10.5px/700, .12em tracking, uppercase,
  `rgba(27,25,23,.58)`.
- Rows: flex, 11px gap, 11px/18px padding, 1px bottom border `rgba(27,25,23,.07)`, hover
  `rgba(27,25,23,.035)`, selected `rgba(27,25,23,.06)`. A fixed 11px column holds the `+`/`–`
  expand marker (only for nodes with children). Title 16px/600; subtitle IBM Plex Sans 12.5px/500 at
  `rgba(27,25,23,.6)`; count right-aligned 11.5px/500 at `rgba(27,25,23,.5)`.
- DN, MN, AN expand straight to suttas. SN expands to chapters (SN 1, SN 12, SN 22, SN 56), which open lists.
- `MY LISTS` heading carries a discreet dashed `+` button; it opens an inline input, Return creates.

### 2. Sutta list (middle)
- Header: back affordance on mobile, node title 19px/600, meta line ("N suttas · M read"), and — only
  while the preview is closed — a bordered `Preview` button (eye icon) that restores the third pane.
  **Deviation:** no sort toggle — suttas are always in ID order, never re-sortable.
- Rows (15px/20px padding, 1px bottom border): ID 11.5px/700 `rgba(27,25,23,.6)` · English title 16px/600 ·
  Pali title 13.5px italic `#8A6A3B` · then **the user's note if present, else the blurb** (note = 14.5px
  italic with a 2px left rule; blurb = 14px at `rgba(27,25,23,.72)`) · then list-membership chips
  (11px, 10px radius, 1px border). Read state is the low-contrast word `read` at 11px — never an icon.
- **Deviation:** selected row (desktop, preview open) inverts to the warm accent `#8A6A3B` / `#FBFAF7`,
  not near-black `#1B1917` — product direction is to avoid black backgrounds anywhere in the UI.
- Search: typing anywhere in the field replaces the tree and the list with inline results across ID, title,
  Pali, blurb, notes, and segment text; clearing restores the browse tree.

### 3. Preview pane (right, ≥ 880px)
- Header bar: sutta meta on the left; `Read` (opens the immersive reader, book icon) and `Close`
  (hides the pane, panel icon) as 12.5px text+icon buttons. **Deviation:** originally labelled
  `Full screen`.
- Body: title 27px/600, Pali 16px italic `#8A6A3B`, blurb, rule, then **the sutta text itself**, rendered
  with the reader's current face/size/line-height (one step smaller). Selecting text highlights exactly as
  in the reader. Below the text: note field and list chips.
- Empty state: centred "Select a sutta", 13.5px.
- Closing sets `previewHidden`; the list pane then flexes to fill, and the `Preview` button in the list
  header brings it back. Persisted.

### 4. Immersive reader (full-screen overlay)
- Top bar is **always visible**: `Close` · sutta ref + Pali title (centred, 75% opacity) · `Prev` · `Next` ·
  `Menu`. 12px/20px padding, 1px bottom rule, 13px IBM Plex Sans.
- Measure: `fontSize × 34` px, centred, 44px top / 120px bottom padding.
- Title `fontSize × 1.72`/600; Pali subtitle; meta line "REF · N min · tap a line for Pali · select text to
  highlight"; then a 1px rule.
- **Segments.** Each English paragraph is clickable; clicking reveals its Pali directly beneath — same font
  family, same size, same line-height, coloured `#8A6A3B` (sepia `#8C6222`, dark `#C9A86F`), no rule, no
  indent, fading in over 180ms. Clicking a Pali word opens the docked dictionary.
- **Dictionary dock**: pinned to the bottom of the reader, 2px top border in the ink colour, panel fill,
  headword 20px/600, grammatical gloss 12.5px, body 14.5px/1.55, `Close · esc`. Slides up over 200ms.
- **Menu panel**: bottom sheet on mobile (74% max height, 16px top radii, drag grabber), right rail
  (340px) on desktop, over a scrim. Three tabs — **Notes** (sutta note + highlight list with swatches and
  Remove), **Lists** (create-and-add input, current chips, full list picker with checkmarks),
  **Text** (theme, size 15–24, line height 1.40–2.00, face, Pali always-on toggle, translation source).
- Keyboard: `←`/`→` prev/next sutta, `Esc` closes dictionary → panel → reader, `h` notes, `l` lists.
  Touch: horizontal swipe > 70px changes sutta. Tapping the page no longer toggles chrome — it only
  dismisses the highlight popup.

### 5. Highlighting (reader and preview)
- Select any run of text inside one segment. On mouseup a **popup floats above the selection**: three
  colour swatches (20px circles, `#F0E3A8` · `#CBE0C2` · `#CFDCEE`) and `Remove` (only over an existing
  highlight). 11px radius, panel fill, 1px rule border, `0 8px 24px rgba(0,0,0,.18)` shadow,
  120ms opacity fade. It measures itself after render and nudges inside the viewport, flipping below the
  selection when it would clip the top. **Deviation:** no `Note` control in this popup — notes are global
  to the sutta, not per-highlight, so they don't belong here; use the Notes tab / note field instead.
- Picking a colour highlights **exactly the selected characters** (background + 2px box-shadow spread,
  2px radius, ink forced to `#1B1917` so colours stay legible in dark mode). Overlapping highlights in the
  same segment are replaced.
- Clicking an existing highlight reopens the popup anchored to it, to recolour or remove.

## State

```
w                 viewport width (resize listener)
expanded {}       which tree nodes are open
node, view        current corpus node; mobile pane ('tree' | 'list')
selected          sutta id shown in the preview
query, sortAlpha  search + sort
creating, draftList   inline list creation
reading           sutta id open in the immersive reader (null = closed)
openSegs {}       per-segment Pali disclosure
allPali           always show Pali
dict              { word, gloss, body } | null
panel, tab        reader menu
pop               { i, s, e, x, y, on } — highlight popup: segment index, char range, anchor, current colour
treeW, listW, treeHidden, previewHidden      layout
theme, fs, lh, face, notes, highlights, visited, lists, membership
```

**Highlight model:** `highlights[suttaId] = [{ i, s, e, c }]` — segment index, start/end character offsets
into the segment's English text, colour. Entries without `s`/`e` mean the whole segment (legacy).
Offsets are computed from the DOM with a Range against the `[data-seg]` paragraph, so the paragraph is
rendered as a run of spans split on highlight boundaries.

**Persistence:** everything except transient UI (`reading`, `pop`, `dict`, `panel`, `query`) is written to
`localStorage` under `sutamaya.v1` on every update. In production this is the local cache that syncs to
the user's account.

## Design tokens

**Library (always light)**
- Ink `#1B1917`; surfaces `#F0ECE4` (tree) / `#F8F6F2` (list) / `#FDFCFA` (app) / `#FFFDFA` (fields)
- Accent / Pali `#8A6A3B`, hover `#6B5230`; selection `#EADFC6`
- Ink alphas: .72 body · .6 meta · .5 counts · .22 field borders · .12 pane borders · .07 row borders

**Reader themes**

| | bg | ink | dim | rule | panel | Pali |
|---|---|---|---|---|---|---|
| light | #FBFAF7 | #1B1917 | ink .5 | ink .16 | #FFFDFA | #8A6A3B |
| sepia | #F3E7D3 | #3A2E1E | ink .55 | ink .2 | #F8EEDD | #8C6222 |
| dark | #191A1C | #E7E3DC | ink .5 | ink .18 | #212325 | #C9A86F |

**Highlights** `#F0E3A8` (amber) · `#CBE0C2` (green) · `#CFDCEE` (blue)

**Type** — Newsreader (reading + titles), Georgia and IBM Plex Sans as alternates; IBM Plex Sans for all
chrome, labels, and meta. Reader size 15–24px (default 18), line-height 140–200% (default 165%).

**Radii** 8–9px (buttons, fields) · 10–11px (chips, popup) · 16px (sheet top) · 50% (swatches)
**Motion** `fadeIn` 180ms · `fadeUp` 180ms (Pali reveal) · `sheetUp` 200–220ms · `popIn` 120ms, all `ease`.
Note: the highlight popup must **not** use a keyframe that animates `transform` — it relies on
`translate(-50%,-100%)` for placement.

## Assets
None. No icons, no images, no emoji — every affordance is a word or a coloured shape. Fonts load from
Google Fonts (Newsreader 400/600, IBM Plex Sans 400/500/600); Georgia is a system face.

## Data the implementation needs
- **Corpus**: nikāya/chapter tree + per-sutta `{ id, ref, en, pali, min, blurb, segs: [[english, pali], …] }`.
  Segments are the alignment unit for both Pali disclosure and highlight offsets — keep them stable, since
  highlight ranges are stored against segment index + character offset.
- **Dictionary**: headword → `[grammatical gloss, definition]`. The prototype ships a tiny offline map and
  falls back to "No entry … try the stem".
- **User data**: notes, highlights, lists, membership, read state — per account, offline-first.

## Files
- `Sutamaya.dc.html` — the full interactive prototype (open it in a browser).
- `support.js` — the runtime the prototype file needs; not part of the design.
- `../design_handoff_sutamaya/` — the earlier lo-fi wireframe handoff, for background only.
