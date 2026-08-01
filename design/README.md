# Handoff: Sutamaya — Pali/English sutta reader PWA

## Overview

Sutamaya is a progressive web app for reading the Early Buddhist Texts (EBT) in English with
segment-aligned Pali. Mobile is the primary use case; the same design scales to iPad and desktop
browser. The app is offline-first: all UI and data (segmented sutta JSON, dictionary JSON) load up
front so navigation feels instant. User lists, notes and highlights sync per authenticated user
(Google auth) and are exportable as JSON from Settings.

Core sections: **Home** (recents + search), **Sutta Browser** (drill-down through the canon),
**List Viewer** (nested user lists), **Reader** (immersive, Apple Books-like), and the reader's
overlays (Typography, Highlights & Notes, Add to list, Pali dictionary).

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes that show intended
look and behaviour. They are **not production code to copy**. The task is to **recreate these
designs in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using
its established patterns, component library and state management. If no environment exists yet,
choose the most appropriate framework for a PWA (e.g. React + Vite + Workbox, or SvelteKit) and
implement the designs there.

The prototype file uses a streaming "Design Component" runtime (`support.js`, `<x-dc>`,
`{{ hole }}` templating, `<sc-if>`). **None of that runtime is part of the design** — ignore it and
read the markup and inline styles.

## Fidelity

**High-fidelity.** Colours, typography, spacing, radii and copy are final and should be matched
closely. Two caveats:

- Screens are drawn inside device frames (`ios-frame.jsx`, `browser-window.jsx`). The frames are
  scaffolding — only the screen content inside them is the design.
- Several screens are shown in a single static state (e.g. an overlay already open, a swipe action
  already revealed). Behaviour is described in **Interactions & Behavior** below.

## Design Tokens

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| `paper` | `#F6F3EC` | App background, reader background (light) |
| `surface` | `#FFFDF7` | Cards, rows in "current/selected" state, overlay panels |
| `surfaceAlt` | `#FBF9F2` | Secondary panel fills (note editor, sheet footers) |
| `bandGroup` | `#F1EDE4` | Group/folder row band, side pane, tab bar |
| `bandGroupSub` | `#F5F1E8` | Nested (second-level) group row band |
| `bandSelected` | `#E4DFD3` | Selected tree row; "My lists" button fill |
| `ink` | `#23201B` | Primary text |
| `ink2` | `#3C372F` | Dictionary body text |
| `ink3` | `#57514A` | Blob / secondary body text |
| `muted` | `#6B6459` | Sutta IDs, tertiary labels |
| `faint` | `#8A8378` | Inactive tab labels |
| `faint2` | `#9A9287` | Eyebrows, counts, placeholders |
| `faint3` | `#B3ABA0` | Keycap glyphs, dimmed metadata |
| `rule` | `#E5E0D4` | Primary hairline / borders |
| `ruleSoft` | `#EBE6DB` | Row separators inside lists |
| `guide` | `#DCD5C7` | Tree indent guide lines (1px) |
| `pali` | `#8A6B47` | **All Pali text** (tweakable) |
| `accent` | `#4B5F72` | Links, active affordances, cursor, progress |
| `accentBg` | `#E7EBEF` | List-tag chips background |
| `accentInk` | `#33475A` | Text on `accentBg` chips |
| `noteRule` | `#D8CFA8` | 2px left rule marking a user note |
| `swipeEdit` | `#5E6B57` | Swipe action: Edit |
| `swipeDelete` | `#A3453C` | Swipe action: Delete |

Highlight colours (user-selectable): pale yellow `#F2E7B3`, pale green `#CFE3D6`,
pale lilac `#E0DAF0`, plus **red underline** `#B4423A` (1.5px `border-bottom`, not a fill).
In the Highlights & Notes list, each entry is marked by a 3px colour bar using the stronger
variants `#E3D383` (yellow), `#A9C4B2` (green), `#B4423A` (red underline).

Dark (reader) theme: bg `#16150F`, panel `#1F1D16`, border `#302D24` / `#3A362C`,
control fill `#2A2720`, text `#DED8CB` / `#EFE9DC`, muted `#8B8578`, dim `#6E685C`.
Sepia swatch: `#F0E4CB` with text `#4A3B27`.

### Typography

Three families, loaded from Google Fonts:

- **Gentium Book Plus** (serif) — all sutta prose, sutta titles, Pali, and sutta IDs when inline
  with a title. Chosen for complete Pali diacritic coverage (ā ī ū ṁ ṇ ṭ ḍ ñ ṅ ḷ).
- **IBM Plex Sans** — all UI chrome, labels, blobs, notes in list contexts.
- **IBM Plex Mono** — sutta IDs in their own column, counts, keyboard hints, ranges, eyebrows.

Scale as used (px / line-height):

| Role | Font | Size | Weight | Notes |
| --- | --- | --- | --- | --- |
| Reader body (mobile) | Gentium | 18 / 1.72 | 400 | user-adjustable |
| Reader body (iPad, desktop) | Gentium | 19 / 1.75 | 400 | |
| Reader interlinear Pali | Gentium | 17 (mobile) · 18 (large) / same as body | 400 | colour `pali`, **not italic**, `margin-top: 2px` |
| Reader sutta title | Gentium | 29 (mobile) · 34 (iPad) · 36 (desktop) / 1.14–1.18 | 400 | |
| Reader Pali title | Gentium | 19 / 21 / 22 | 400 | colour `pali` |
| Reader eyebrow | Plex Mono | 10.5, `letter-spacing:.08em`, uppercase | 400 | colour `faint2` |
| Reader meta line | Plex Sans | 12 | 400 | colour `faint2` |
| Screen title | Plex Sans | 20 | 600 | |
| Row title (sutta) | Gentium | 17 / 1.3 | 400 | inline ID in `muted` |
| Row Pali title | Gentium | 14 | 400 | colour `pali` |
| Row blob / note | Plex Sans | 13.5 / 1.5 | 400 | blob `ink3`, note `ink` |
| Group row (level 1) | Plex Sans | 15 | 600 | |
| Group row (level 2) | Plex Sans | 14 | 600 | |
| Section eyebrow | Plex Sans | 10.5–11, `letter-spacing:.09em`, uppercase | 400 | colour `faint2` |
| Tag chip | Plex Sans | 11 | 400 | |
| Tab bar label | Plex Sans | 13.5 | 500 active / 400 inactive | |
| Keycap | Plex Mono | 10.5–11 | 400 | 1px `rule` border, radius 4, padding `1px 5px` |

### Spacing, radii, shadows

- Screen horizontal padding: **20px** (mobile), 18px (side pane), 30px (reader columns).
- Row vertical padding: 13–15px mobile list rows; 10–11px group rows; 6px side-pane rows.
- Radii: 5 (small chip / marker box) · 7 (segment, tree row) · 9–12 (fields, cards, chips) ·
  14 (overlay panel) · 20 (sheet top corners) · 19–24 (floating pill) · 9999 (circular).
- Shadows: floating pill `0 6px 20px rgba(0,0,0,.1)` (mobile) / `0 4px 14px rgba(0,0,0,.08)`
  (desktop); overlay panel `0 26px 64px rgba(0,0,0,.3)`; dictionary popover
  `0 12px 34px rgba(0,0,0,.14)`; bottom sheet `0 -8px 30px rgba(0,0,0,.1)`.
- Scrim behind overlays: `rgba(35,32,27,.32)` (lists overlay), `rgba(35,32,27,.3)` (generic).
- Glass pill: `background: rgba(255,253,247,.86)`, `backdrop-filter: blur(14px) saturate(180%)`,
  `border: 1px solid rgba(0,0,0,.07)`.

### Tree language (used everywhere a hierarchy is shown)

- **Group row**: tinted band (`bandGroup`, nested `bandGroupSub`), a **marker box** — 18×18px
  (16×16 in side panes), radius 5/4, fill `#E3DDCF` (`#D3CCBD` when open/selected) — containing
  `▾` open / `▸` closed, then optional emoji, then a **600-weight** name, then a Plex Mono count.
- **Leaf (sutta) row**: no marker, no band; indented, with a **1px `guide` vertical line** drawn at
  the parent's marker centre (implemented as a `linear-gradient` background stripe).
- This makes open/closed state and group-vs-sutta unambiguous at a glance.

## Screens / Views

### 1. Home (mobile)

Purpose: resume reading, jump into search, reach lists.

Layout, top to bottom:
1. Header (`padding: 60px 20px 12px`, baseline-aligned row): wordmark `sutamaya` in Gentium 23px
   lowercase; right, `SETTINGS` in Plex Sans 11.5 uppercase `letter-spacing:.06em`, colour `muted`.
2. Search field: 44px tall, `surface` fill, 1px `rule`, radius 12; magnifier glyph (circle r4.6 +
   45° line, stroke `faint2` 1.4px), placeholder "Suttas, lists, notes…" 15px `faint2`, trailing
   keycap `/`.
3. Eyebrow `CONTINUE`, then **2–3 recent cards** (gap 10px): `surface`, 1px `rule`, radius 12,
   padding `14px 15px`. Card content: Plex Mono ID 11px `muted`; Gentium 19px English title;
   Gentium 14.5px Pali title in `pali`.
   **There is deliberately no progress bar and no "n min left"** — reading progress is never
   surfaced on Home.
4. Eyebrow `LISTS`, then a wrapping row of list chips (gap 8px): `surface`, 1px `rule`, radius 9,
   padding `7px 12px`, emoji + name 13.5px + Plex Mono count in `faint3`.
5. Tab bar (see Navigation).

### 2. Sutta Browser — folder level (mobile)

Purpose: enter the canon. **Drill-down navigation, not an expanding tree.**

- Header: title `Browse` 20px/600; right, translation source `Sujato ▾` in Plex Mono 11 `muted`.
- Filter field (see §3).
- Rows, one per nikāya, `padding: 15px 20px`, separated by `ruleSoft`:
  a 20×16 radius-3 `guide`-coloured folder block; a two-line label (Plex Sans 15.5/600 name over
  Gentium 13.5 English gloss in `pali`); Plex Mono count; a 7×12 right chevron in `faint3`.
  The current/last-visited nikāya row uses the `surface` fill.
- Tapping a row pushes the next level.

### 3. Sutta Browser — opened folder (mobile)

- Back affordance replaces the title: a left chevron + **parent name** (`Majjhima Nikāya`) in
  `accent` 14px, top row. Below it, the **current folder name** as the 20px/600 title with a Plex
  Mono range beside it (`MN 1–10`). Translation source stays top-right.
- **Filter field** (persistent, 40px tall, radius 11): "Filter by ID, title, or note", keycap `/`.
  It matches sutta ID, English title, Pali title, blob and note simultaneously — there is **no
  scope selector UI**; matching is implicit.
- Sutta rows, full width (`padding: 13px 20px`), separated by `ruleSoft`:
  - Title line: Gentium 17/1.3, `<span colour=muted>MN 10</span> Mindfulness Meditation` — the ID
    is part of the title, same face, faded colour, **no dedicated ID column**.
  - Pali title: Gentium 14, colour `pali`.
  - Blob (Plex Sans 13.5/1.5 `ink3`) **or**, if the user has a note, the note in `ink` with a
    9px left padding and a 2px `noteRule` left border. The note replaces the blob.
  - List tags: `accentBg` chips, radius 5, `padding: 2px 7px`, 11px `accentInk`.
  - **Visited mark**: an 11×9 check path, `stroke: ink`, `opacity: .34`, right-aligned on the title
    line. Discreet by design — it must not read as a control.

### 4. List Viewer (mobile)

- Header: `Lists` 20px/600; right, `New list` 12.5px `accent`.
- Group rows follow the tree language above; nested lists (e.g. 🌿 Similes inside 📁 Jhāna) are
  indented 42px with the `guide` stripe at x=29.
- Sutta rows inside a list: indented 42px on the `guide` stripe, `surface` fill.
  Title `Snp 1.8 Loving-Kindness` (inline faded ID), Pali title, then the **note** (2px `noteRule`)
  — or the blob if there is no note.
- **"Also in" line**: `ALSO IN` eyebrow (10.5 uppercase `faint2`) followed by chips for every
  *other* list the sutta belongs to (emoji + name). The containing list is omitted.
- **Swipe actions**: swiping a row reveals two 64px-wide full-height buttons — `Edit` on
  `swipeEdit`, `Delete` on `swipeDelete`, white 12.5px labels.
- Footer hint: "Drag a row to reorder · swipe for edit & delete" 12.5px `faint2`.

### 5. Reader (mobile)

Immersive, no page chrome, scrolling (no pagination).

- Content padding `66px 26px 120px`.
- Eyebrow (collection · section) → title → Pali title → meta (`MN 10 · 18 min · trans. Sujato`) →
  1px `rule` divider → body paragraphs (18/1.72, `margin-bottom: 16px`).
- A tapped line shows its **Pali directly beneath**, 17px, colour `pali`, `margin-top: 2px`,
  upright, same family — **no italics, no quote rule, no indent**. It reads as an alternate voice
  of the same paragraph, not a citation.
- Highlights render as background fills with
  `box-decoration-break: clone`; the red variant is a 1.5px `border-bottom`.
- A 120px bottom gradient (`to top, paper 42%, transparent`) fades text under the toolbar.
- **Floating pill toolbar**, centred, `bottom: 44px`, height 48, radius 24, glass recipe above:
  `✕` (close, returns to origin) │ divider │ `aA` (Typography) │ hamburger (Highlights, Notes,
  Lists, source) │ divider │ progress `38%` in Plex Mono.

### 6. Reader overlays

**6a. Pali dictionary popover** — tapping a Pali word (word gets a `#EDE7DA` chip with a
`#DDD3C0` hairline) opens a card: `left/right: 18px`, `surface`, 1px `#E0D9CA`, radius 14.
Header: headword in Gentium 21 `pali`, grammar line Plex Sans 11 `faint2`, `esc` keycap.
Body: one row per source — Plex Mono 11 source tag (`PTS`, `DPD`, `CPD`) in `faint2` + the
definition (may contain HTML) in Plex Sans 13.5/1.6.
Paragraphs below the popover dim to `faint3` while it is open.

**6b. Typography sheet (shown in dark theme)** — bottom sheet, radius 20 top, 38×4 grabber.
Rows: font family (3 specimen buttons, each rendered in its own face); Text size (two-step A/A
segmented); Line height (1.5 / 1.7 / 2.0); theme (Light / Sepia / Dark swatch buttons, 46px tall,
selected gets a 2px `#C8BFA8` border).

**6c. Highlights & Notes sheet** — full-height sheet from `top: 96px`, radius 20 top.
Header `Highlights & Notes` + keycap `H`. First block is the **sutta's editable note** on
`surfaceAlt` with a caret. Then one row per highlight: a 3px colour bar, the quoted text in
Gentium 16/1.55, an optional attached note (2px `#E0D9CA` left rule), and `§4 · 6 Mar` in Plex Mono
10.5. Footer: `COLORS` label + four 26px circular swatches (three fills + the underline swatch).

**6d. Add to list sheet** — sheet from `top: 70px`, on-screen keyboard visible.
Header `Add to list` + keycap `L`, sub-line `MN 10 · Satipaṭṭhānasutta` in Gentium `pali`.
A focused text field (1.5px `accent` border) with typed text and caret; below it
`↵  Create "Body contemplation" and add`. Current memberships as removable chips.
Below a hairline, the existing list tree with a `✓` on lists the sutta is already in, and a final
`+ New list here` row in `accent`.

### 7. Navigation model (mobile)

Three options were explored; the built screens use **i**:

- **i. Word tab bar** *(used)* — `Home · Browse · Lists`, text only, no icons. Active label is
  500-weight `ink` with a 1.5px underline; inactive is `faint`. Bar: `padding: 12px 20px 30px`,
  `bandGroup` fill, 1px `rule` top.
- **ii. Search-first** — single screen, sheets for Browse/Lists, `/` as the primary verb.
- **iii. One Library with a Canon / My lists segmented control** — scales most directly to the
  desktop side pane.

### 8. Row anatomy (three variants explored)

- **i. Mono rail** — Plex Mono ID in a fixed 46px left column, everything indented 55px.
- **ii. Stacked eyebrow** — ID + tags on one thin line above the title; title and Pali on one line.
- **iii. Note-forward** *(used in production rows)* — when a note exists it replaces the blob, takes
  the `noteRule`, and the blob drops to a single faded 12.5px line.

The shipped browser/list rows use **iii** with the ID inline in the title (no mono column).

### 9. iPad & desktop

**Identical layout at both sizes**; desktop is simply wider (prototype uses a 1024×740 iPad frame
and a 1180×760 browser window).

- **Side pane (persistent, in-flow)**, default width **268px**, background `bandGroup`, 1px `rule`
  right border:
  - Header: `sutamaya` in Gentium 20 + a `«` collapse button (26px, radius 7, `bandSelected`).
  - Search field (36px, radius 9) with `/` keycap.
  - `CANON` eyebrow, then the tree: nikāyas as group rows, chapters nested with a `guide` stripe,
    suttas as leaves with inline faded IDs. Selected node gets `bandSelected` + radius 7.
  - Pinned above the footer: a **My lists** button — `bandSelected`, radius 9, `padding: 9px 12px`,
    🪷 + "My lists" 13.5/600 + keycap `L`.
  - Footer: 22px avatar circle, account email 12.5 `ink3`, `Settings` 11.5 `faint2`.
  - **Resize**: a 7px hit area on the right edge (`cursor: col-resize`) with a 3px × 34px
    `#D3CCBD` grip; drag clamps the pane to **200–520px**.
  - **Collapse**: `«` collapses to a **56px rail** with `»`, a search glyph and a 🪷 glyph.
- **Reader pane**: fills the rest, content column **620px** (iPad) / **680px** (desktop),
  `padding-top: 78px` so it clears the toolbar. Floating pill at `top: 20px; right: 22px`
  (height 38, radius 19): `aA` │ `H` │ `L` │ divider │ `38%`. A 26px bottom fade.
- **My lists overlay**: opened from the pane footer button or `L`. Full-frame scrim
  `rgba(35,32,27,.32)` + a panel inset 22px (iPad) / 40px (desktop), width 344 / 380, `surface`,
  1px `#E0D9CA`, radius 14, shadow `0 26px 64px rgba(0,0,0,.3)`.
  Panel: header `My lists` 16/600 + `New list` + `✕`; a "Filter lists" field; the nested list tree
  with sutta leaves; a footer hint "Drag to reorder or nest · right-click a list to change its
  emoji". Dismissed by the scrim or `✕`.
  **Rationale:** the canon tree can expand to great length, so the user's lists must not live below
  it in the same scroll — they are always one click away instead.

## Interactions & Behavior

### Reader
- **Tap a line** → toggle that line's Pali beneath it. On mobile, scrolling must **not** trigger
  this — only a tap without movement (guard on touchmove / pointer slop).
- **Tap a Pali word** → dictionary popover. `Esc` (or tap-away) closes it.
- **Selecting text**: selection must be possible on the **English only**, without triggering the
  Pali toggle. If any Pali is visible when a selection starts, hide it.
- **Highlight** the selection in one of three tints or the red underline; highlights are per-user
  and stored remotely.
- **Swipe left/right** (mobile) or **←/→** (keyboard) → previous/next sutta.
- **Tap** toggles the floating toolbar's visibility (Apple Books behaviour).
- `Esc` or `✕` closes the reader and returns to the exact origin (browser row, list row, or search
  result) with scroll position restored.
- Keyboard: `H` Highlights & Notes, `L` Lists, `/` search, `←`/`→` navigate, `Esc` close/dismiss.

### Search
- `/` from anywhere focuses search.
- With **no query typed**, the field shows the **history of visited pages** inline.
- Results appear **inline as you type** — never on Enter, never on a separate page.
- An inline dropdown scopes the search to specific folders or lists ("in: Daily ▾"); results are
  grouped (`SUTTAS`, `IN YOUR NOTES`) with the query highlighted in `#F2E7B3`.
- `Esc` dismisses search and restores the previous view.

### Browser & lists
- Browser is **drill-down**: tapping a folder pushes a level; the header's back control returns to
  the parent. Back must also respond to the browser's history (PWA: use the History API) and to an
  edge swipe.
- **Visited**: mark a sutta visited after a dwell threshold (e.g. >30s in the reader). Reflected as
  the faint check on browser and list rows.
- **Swipe a row** in lists → Edit / Delete.
- **Drag** to reorder suttas within a list and to reorder/nest lists.
- Adding to a list: focus the input immediately; typing filters existing lists; `↵` creates the
  list if it doesn't exist, adds the sutta, then **resets the input so more lists can be added** in
  the same pass. The tree below supports the same action by tapping.
- Lists take a folder emoji by default; any emoji can be chosen instead.

### Large screens
- Side pane: drag the right edge to resize (200–520px, persist the value); `«`/`»` collapses to and
  from the 56px rail (persist).
- My lists overlay: opens over a scrim, dismissed by scrim click, `✕` or `Esc`.

### Motion
Keep it restrained: 150–200ms `ease-out` for overlay/sheet entry and the Pali reveal (height +
opacity), 120ms for hover/press feedback. No decorative motion.

## State Management

Client state:
- `route` — section (home/browse/lists/reader), current folder path, current sutta ID, scroll
  offsets per view (for exact restore).
- `readerPrefs` — `fontFamily`, `fontSize`, `lineHeight`, `theme` (light/sepia/dark), persisted
  locally.
- `layoutPrefs` — `sidebarWidth` (200–520), `sidebarCollapsed`, persisted locally.
- `paliVisible: Set<segmentId>` — per-sutta, ephemeral.
- `dictionaryEntry` — currently open word, or null.
- `search` — query, scope (folders/lists), results, visit history (when query empty).
- `overlay` — which of {typography, highlightsNotes, addToList, myLists} is open.
- `visited: Map<suttaId, timestamp>` — written after the dwell threshold.

Remote (Firebase, per authenticated user): `lists` (nested, ordered, emoji), `listMembership`
(sutta → list ids, ordered within each list), `notes` (per sutta, and per highlight),
`highlights` (sutta id, segment range, colour/underline, created at).
All of it must be exportable as JSON from Settings.

Data (static, shipped/cached up front):
- Segmented sutta JSON per translation: `{ segmentId: text }` for English and the corresponding
  Pali file, keyed identically so segments align 1:1.
- Dictionary: one large array of `{ entry, definitions: [html, …] }`.
- Where multiple translations exist, the reader's source switcher swaps the English file while
  keeping the Pali and the segment keys.

Offline: precache the shell and all data with a service worker; the UI should never show a loading
state for canon content or dictionary lookups.

## Assets

No image assets. All glyphs in the prototype are inline SVG primitives (magnifier = circle +
line, chevrons and checks = single paths, hamburger = three rects) or text glyphs
(`✕ ▾ ▸ « » ↵ ✓ aA`). List icons are **emoji** (🪷 📁 🌿) — user-selectable per list, so they
should stay emoji rather than becoming a custom icon set. Substitute your codebase's icon set for
the SVG primitives if you have one.

Fonts: Gentium Book Plus, IBM Plex Sans, IBM Plex Mono (Google Fonts). Gentium is chosen for Pali
diacritics — verify any substitute covers Latin Extended Additional before swapping it.

## Files

- `Sutamaya.dc.html` — the full design: mobile screens (Home, Browser folder level, Browser opened
  level, List Viewer, Reader), reader overlays, the three navigation-model studies, the three
  row-anatomy studies, and the iPad + desktop layouts. Options are grouped in labelled blocks
  (`1a`–`1e`).
- `ios-frame.jsx`, `browser-window.jsx` — device/browser chrome used to present the screens.
  **Scaffolding only, not part of the product design.**
- `support.js` — prototype runtime. Ignore.
- `Sutamaya.pdf` — the original product requirements this design was drawn from.
- `screenshots/` — 2× renders of each block, for reference without opening the HTML:
  - `01-mobile-core-screens.png` — Home, Browser (folder level), Browser (opened level),
    List Viewer, Reader
  - `02-reader-overlays.png` — Pali + dictionary, Typography (dark), Highlights & Notes,
    Add to list
  - `03-navigation-models.png` — the three mobile navigation studies
  - `04-row-anatomy.png` — the three row-anatomy studies
  - `05-ipad-and-desktop.png` — iPad and desktop, both with the My lists overlay open

Open `Sutamaya.dc.html` in a browser to view everything; the side pane resize, the collapse
button and the lists overlay are live and clickable.
