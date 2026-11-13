# The web app

`web/` is a single-page React app in TypeScript, styled with Tailwind, built with Vite and routed
with React Router. It installs as a PWA, and the native apps wrap the same build
([native-apps.md](native-apps.md)). Browsers are pointed to the store apps instead: Safari shows the
App Store's banner, and the manifest prefers the Google Play app, so Chrome offers that on Android
and no install at all on a computer.

## The screens

**The Library** has two panes: a tree — the five collections, or the reader's own lists — and the
suttas in whatever is selected. Search results take the list's place, and recent searches the
tree's. Narrower than 860px, it shows one pane at a time.

A list shows its suttas newest first. The mirror and the server keep a list oldest first; the app
reverses it on screen.

**The Reader** shows one sutta: the English, with each line's Pali a tap away (or every line's, as
a setting), and a dictionary on every Pali word. Once the reader scrolls into a sutta's text, and
until they first look a word up or close it, a checklist sits in the dictionary's place — tap a line
for its Pali, then one of its words — and ticks off the first step once done. Each device keeps
track of it separately. The reader can highlight text in three colours, give the sutta keywords to
find it by (its note, in the code), and file the sutta into lists. A highlight can carry a note,
written in the highlight's popup on a wide screen and on a sheet of its own on a phone, marked by a
badge on the highlight's corner and shown under its quote in the side panel. A side panel holds the
sutta's highlights, its lists, and the display settings: theme, typeface, size and spacing. `?`
lists the keyboard shortcuts.
On a phone the header leaves the sutta's name to a slim bar beneath it, which slides out when the
reader scrolls back up and tucks away when they scroll on, when the Reader scrolls by itself, or
once the sutta's own title is in view. Tapping it returns to the top.

**Segment numbers** — SuttaCentral's line references, `15.4` in `SN 46.53:15.4` — are a setting,
off by default, for citing a line. They hang in the left margin where the reading pane, measured
inside a landscape phone's safe area, leaves room for the widest, and otherwise lead their line, so
they never narrow the text. They are never selectable, so copied text leaves them out. Tapping one
names its line in the address, and Shift-clicking another names the lines from it to that one.

**Other translations** — Bhikkhu Bodhi's and Ṭhānissaro Bhikkhu's, where either translates the
whole text — are chosen from a pill at the right of the header, beside search and the menu,
bearing the current translator's name without his title ("Sujato", "Bodhi") and a chevron. A
sutta only Sujato translates has none. Its menu lists only whole translations of that sutta, by
full name, with the current one checked.

Each has its own Pali under its lines, headings, verse line breaks, links and notes. The credit
under the title names the translator shown and links the page the text comes from; Help gives
their licences. A link in one opens the sutta it cites in the same translation where that has it,
and in Sujato's otherwise. Next and Prev, and search, stay with Sujato's text. Each translation
keeps its own highlights, place and open lines. The Highlights panel lists the current
translation's highlights, with the other translators' folded under one row below, and opening one
of those switches to its translation there. The badges count every translation's highlights.

**Settings** holds the account — sign-in, sync status, export and deletion — the offline download
and the app's own display settings. The theme is one setting, changed from either place; sepia
tints only the Reader, and the rest of the app shows it as light. **Help** is a page of annotated screenshots.

## How it's put together

One provider per concern wraps every page:

| Provider | Holds |
|---|---|
| Auth | who is signed in; signing in and out |
| Corpus | the browse tree and the sutta index (`corpus.json`) |
| UserData | lists, notes, highlights and visits — a view over the offline mirror ([offline-sync.md](offline-sync.md)) |
| UiPrefs | the theme, one for the whole app, and the UI scale |
| ReaderPrefs | the Reader's typeface, size, spacing, Pali display and segment numbers |
| Layout | the window width, phone or not, the pane widths |

Pages fetch what they need themselves. `lib/` holds the logic with no React in it, `hooks/` the
behaviour components share, and `components/` the pieces the pages are built from.

## Routing

| Path | Shows |
|---|---|
| `/` | wherever the reader was last — the Library, on a first visit |
| `/browse` | the Library with nothing selected |
| `/browse/<group>/<sutta>` | a group or list, optionally with a sutta selected in it |
| `/read/<sutta>` | the Reader |
| `/settings`, `/help` | Settings, Help |
| `/<sutta>` | a bare sutta id (`/dn9`), sent on to the Reader |

- **The address is where the reader is**: the group, the sutta, and the Library's search as `?q=`.
  So closing a search result returns to the results, and a relaunch returns to the last place.
- Router state carries what an arrival *means* — the pane it came from, the search behind it, a line
  to jump to and the lines whose Pali opens there. It survives a refresh, so each is used exactly
  once. The address names the lines as well, by segment key — `/read/sn46.53?at=15.4` — so a copied
  address, or a link opened anywhere else, lands there too. Lines in a batch are named under the
  inner sutta they belong to: `/read/dhp274?at=4`, not `/read/dhp273-289`.
- **The address names a translation other than Sujato's** as a query, `/read/mn1?by=bodhi&at=3.1`,
  it being the same sutta. Without one, or naming one the text lacks, the Reader shows Sujato's.
- **Choosing a translation keeps the line being read at the same height.** The anchor is the first
  English segment wholly in view below the reading pane's 20px inset. If the other text omits it,
  its nearest preceding segment takes that height; if none precedes it, its first segment does.
  When no whole segment fits, the first intersecting one anchors the switch. Above the text, the
  pane keeps its offset instead. Text and fonts settle before the position is applied, and scroll
  offsets account for the app's UI scale. The pane's scroll limits still apply near either end.
- **Consulting an alternative adds one history step above Sujato's text.** Choosing another
  alternative replaces that step. No return arrow appears for it, and Escape closes the Reader;
  Back, in the browser or the native apps, restores the Sujato entry's saved position and open
  lines. Choosing Sujato in the picker returns to that entry at the line now being read. A directly
  addressed alternative has no Sujato entry behind it, so the picker replaces that entry. The choice
  never becomes a default for another sutta.
- **A tapped segment number replaces the address** with its line's, adding no step to the history.
  The line is washed where it stands, as an arrival washes it, but not scrolled to. A Shift-click
  names the lines from the first one the address names to the one clicked, stopping at the edge of
  that first line's inner sutta, since an address names lines under one inner sutta alone. The
  installed apps have no address bar, so their Share button shares the lines the address names.
- The Reader restores its scroll position on a return (Back, a refresh, a relaunch) and opens at the
  top when the reader chooses somewhere new.
- **A sutta opened from the Reader's own search, or from a link in a translator's note, is a step
  in the history**, and so is a line of the sutta on screen. A return arrow appears beside the
  Reader's close button and goes back one step at a time, as the browser's Back does; Escape and
  Back in the native apps do the same, while close leaves the Reader from any depth. Turning with
  Next and Prev adds no step. The jump slides the text in from the right and the return from the
  left, as Next and Prev do; within one sutta both glide, and the return lands where the reader
  left off.
- Only a bottom-level group opens a list of suttas. A row with children expands in place, so an id
  like `dn` or `sn12` is never a destination ([corpus.md](corpus.md)).
- Static segments match exactly, which is what lets `/<sutta>` sit last without catching
  `/Settings`.
- A crash inside a page shows a fallback within the app, so the providers and Back in the native apps
  keep working.
- Import everything from `react-router`, never `react-router/dom`: outside a bundler the two resolve
  to separate copies, and the hooks then find no router.

Tests render pages through the same router setup as the app, so a page under test behaves as it
does in use.

## Screen transitions

A screen that takes the whole window animates as it arrives: the Reader, Help and Settings. On a
phone they are a stack and slide in from the right, Back sliding them away again, the way a pushed
screen moves in a native app; opening a collection slides its sutta list in over the tree the same
way. Nothing else animates between screens: tree rows open in place, and the Library/Lists tabs only
slide their underline.

- **A transition starts from the app's own control** — a row, Back, the Reader's close — never from
  the browser's Back and Forward, which Safari's swipe back already animates.
- **They are the browser's view transitions**, so a browser without them changes screens instantly
  (iOS before 18).
- **Only a phone slides.** A wider layout has no stack, both panes being on screen at once, so a
  screen arriving there crossfades instead — and a collection, which changes only the pane beside
  the tree, is instant.
- **Reduced motion turns the slides into crossfades.**

## Library search

A search is a place, not a mode: the query is in the address, so the reader can open a result and
come back to the list, scrolled where it was. It finds the reader's own lists as well as suttas.
How the search works is [search.md](search.md).

## Offline reading

A service worker serves the app from the device:

| What | Cached |
|---|---|
| the app shell, `corpus.json`, the Latin font subsets, the shard indexes | on install |
| each translation of a sutta, the dictionary shards | when first fetched, then refreshed in the background |
| the search text | on the first search; its file names carry a version, so it never goes stale |
| help screenshots, the other fonts | on first use |
| `/api/*` | never |

Opening a sutta preloads its other whole translations, including Sujato's when an address opens an
alternative. Each loads independently of the displayed text and enters the same session cache and
service-worker cache. Once loaded, switching needs no request and those translations remain
available on an offline return. Only the neighbours' Sujato texts are preloaded; their alternatives
wait until the reader opens them. A failed preload leaves the displayed text alone, and choosing
that translation tries loading it again.

Settings can download the whole canon in ~1 MB bundles, including every offered translation, with
the dictionary and the search text. A sutta counts as available only when all its translations are
cached, so a completed download supports switching even in texts never opened. The text cache's
entry limit fits the whole canon across translations, checked against the real corpus by a test.
A banner offers the download to readers using the installed app.

A download resumes by skipping bundles whose requested documents are all cached. When its recorded
version is stale or absent, it refetches each bundle and overwrites its documents in place, recording
the new version only on a clean finish; failure or cancellation leaves cached documents available.
A device with a completed older download gets the update banner even when it lacks translations
the current corpus offers.

A corrected sutta reaches a device one document at a time: the next visit shows the cached copy and
fetches the new one, which appears at the following launch. A device that downloaded everything is
told when a newer corpus is out.

## Worth knowing

- **Signing in is never required.** A signed-out reader has a local account kept on the device
  ([offline-sync.md](offline-sync.md)).
- **Drag and drop uses Pointer Events**, never HTML5 drag-and-drop, which is unreliable on touch.
- **A note's only markup is `*bold*`.** It renders wherever a note is shown, never in the box it's
  typed in.
- **The app is one main JavaScript chunk.** The service worker precaches every chunk anyway, and
  the native bundle is its own offline store, so splitting buys nothing. The build warns if the
  chunk grows past its current size.
- **`<StrictMode>` is off.** Turning it on means checking every effect against a double run first.
- **Analytics** is Cloudflare Web Analytics: cookie-less, loaded once the page has loaded, and left
  out of the native apps.

## Known gaps

- On a phone at the largest UI size, with Share and the return arrow both in the Reader's header,
  the translation's pill has less room than its first letter and chevron need, and spills over.
- Deleting a list or group is one confirmation with no undo, and takes everything inside it.
- A highlight on a line the loaded text doesn't have paints nothing, but still counts on the
  Reader and Library badges.
- Notes on highlights are a prototype, held in memory: a reload clears them, they don't sync,
  search doesn't find them, the side panel's bin removes a noted highlight without asking, and
  drawing a highlight over a noted one drops its note.

## Where to look

| Where | What |
|---|---|
| `web/src/App.tsx` | the route table and the app shell |
| `web/src/pages/` | Library, Reader, Settings, Help |
| `web/src/components/` | `TreePane` and `ListPane` for the Library; `SegmentedText`, `TranslationPicker`, `DictionaryDock`, `ReaderTip` and `HighlightPopup` for the Reader |
| `web/src/context/` | the six providers |
| `web/src/hooks/` | keyboard, scroll memory, dictionary lookup, the first-run tip, pointer drags |
| `web/src/hooks/useReaderOrigin.ts`, `web/src/lib/reader/{translationPlace,stepPlaces}.ts` | translation choices, reading anchors and history-entry positions |
| `web/src/lib/` | everything without React |
| `web/src/lib/corpus/offline.ts`, `cacheConfig.ts` | the bulk download, availability and text-cache capacity |
| `web/src/lib/ui/motion.ts`, `web/src/index.css` | screen transitions, and the Reader's step between suttas |
| `web/vite.config.ts` | the build, the service worker's caching, the dev server |
