# The web app

`web/` is a single-page React app in TypeScript, styled with Tailwind, built with Vite and routed
with React Router. It installs as a PWA, and the native apps wrap the same build
([native-apps.md](native-apps.md)).

## The screens

**The Library** has two panes: a tree — the five collections, or the reader's own lists — and the
suttas in whatever is selected. Search results take the list's place. Narrower than 860px, it shows
one pane at a time.

**The Reader** shows one sutta: the English, with each line's Pali a tap away (or every line's, as
a setting), and a dictionary on every Pali word. The reader can highlight text in three colours,
write a note, and file the sutta into lists. A side panel holds the sutta's highlights, its lists,
and the display settings: theme, typeface, size and spacing. `?` lists the keyboard shortcuts.

**The put-aside bar** runs along the foot of both screens whenever the reader has set suttas aside,
like tabs ([below](#put-aside)).

**Settings** holds the account — sign-in, sync status, export and deletion — the offline download
and the app's own display settings. **Help** is a page of annotated screenshots.

## How it's put together

One provider per concern wraps every page:

| Provider | Holds |
|---|---|
| Auth | who is signed in; signing in and out |
| Corpus | the browse tree and the sutta index (`corpus.json`) |
| UserData | lists, notes, highlights and visits — a view over the offline mirror ([offline-sync.md](offline-sync.md)) |
| ReaderPrefs | the Reader's theme, typeface, size, spacing and Pali display |
| UiPrefs | the app's own theme and scale |
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
  to jump to. It survives a refresh, so each is used exactly once.
- The Reader restores its scroll position on a return (Back, a refresh, a relaunch) and opens at the
  top when the reader chooses somewhere new. The Library's panes always restore theirs.
- Only a bottom-level group opens a list of suttas. A row with children expands in place, so an id
  like `dn` or `sn12` is never a destination ([corpus.md](corpus.md)).
- Static segments match exactly, which is what lets `/<sutta>` sit last without catching
  `/Settings`.
- A crash inside a page shows a fallback within the app, so the providers and Android's back button
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

## Put aside

The ⤓ beside Close in the Reader sets the sutta aside: it becomes a tab in a bar along the foot of
the app, in the Reader and the Library alike. In a sutta that already has a tab, ⤓ stands in Close's
place and puts the reading back down into it — Close leaves for the same place under an icon that
promises the tab goes with it. The bar behaves like browser tabs:

- A tab remembers where its sutta was left, and that line is where the sutta opens however the
  reader reaches it — the bar, a Library row, a link, a Prev/Next step. What outranks it is a line
  the route names itself, a search hit's passage, and coming back to a reading rather than opening
  one: a refresh, a relaunch or Back keeps the place this device left, the tab's line only moving
  as a reading is left.
- Only the reader changes the set: setting a sutta aside adds a tab, and the tab's ✕ removes it.
  Closing the Reader, stepping to the next sutta and switching tabs leave it as it is, and reading a
  sutta never gives it a tab — that would make it the Visited list.
- It holds five, and nothing is dropped to make room: at the cap, setting another aside opens a
  sheet asking which tab should go.
- On a phone the bar shows the last tab left plus a count that opens the sheet; on a desktop it lays
  the tabs out, folding what doesn't fit into "+N". Keys `1` to `5` open them.

The set syncs as one record ([offline-sync.md](offline-sync.md#the-put-aside-set)).

## Library search

A search is a place, not a mode: the query is in the address, so the reader can open a result and
come back to the list, scrolled where it was. It finds the reader's own lists as well as suttas.
How the search works is [search.md](search.md).

## Offline reading

A service worker serves the app from the device:

| What | Cached |
|---|---|
| the app shell, `corpus.json`, the Latin font subsets, the shard indexes | on install |
| each sutta's text, the dictionary shards | when first fetched, then refreshed in the background |
| the search text | on the first search; its file names carry a version, so it never goes stale |
| help screenshots, the other fonts | on first use |
| `/api/*` | never |

Settings can download the whole canon in ~1 MB bundles, with the dictionary and the search text. A
banner offers it to readers using the installed app.

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

- There is no choice of translation — each collection has one English translation — so the Reader
  names its source instead ("Source: SuttaCentral, modified").
- Deleting a list or group is one confirmation with no undo, and takes everything inside it.
- A highlight on a line the loaded text doesn't have is left out of the Reader, but still counted
  on the Library's badge.

## Where to look

| Where | What |
|---|---|
| `web/src/App.tsx` | the route table and the app shell |
| `web/src/pages/` | Library, Reader, Settings, Help |
| `web/src/components/` | `TreePane` and `ListPane` for the Library; `SegmentedText`, `DictionaryDock` and `HighlightPopup` for the Reader; `PutAsideBar` |
| `web/src/context/` | the six providers |
| `web/src/hooks/` | keyboard, scroll memory, dictionary lookup, pointer drags |
| `web/src/lib/` | everything without React |
| `web/src/lib/motion.ts`, `web/src/index.css` | screen transitions, and the Reader's step between suttas |
| `web/vite.config.ts` | the build, the service worker's caching, the dev server |
