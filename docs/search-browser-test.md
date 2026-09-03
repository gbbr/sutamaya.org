# Testing full-text search in the browser

A scratch document for the manual pass before this ships. Delete it once search has shipped and
settled — `docs/search.md` is the lasting record.

Everything below is done in **Chrome DevTools**, on `http://app.local.sutamaya.org:5173` with
`npm run dev` running. Safari matters too and gets its own section at the end.

## First, see the download

The blobs are only fetched when a search field is first focused, so an idle app should show
nothing.

1. DevTools → **Network**, filter `search`, tick **Disable cache**.
2. Load the app. **Nothing under `/data/search/` should appear** — a reader who never searches
   pays nothing.
3. Click the library's search box. Three requests appear: `en.<version>.txt`, `pa.<version>.txt`,
   `map.<version>.json`.
4. Right-click the column headers and add **Content-Encoding**, then read **Size** — the top
   number is what came over the wire, the grey one underneath is the decompressed size.

What to expect. The Vite dev server does **not** compress, so locally you will see the raw
8.8 MB and 10.7 MB. To see the real figures, either build and preview:

```
npm run build && npx vite preview --host   # from web/, still uncompressed
```

…or measure them directly, which is what the numbers in `docs/search.md` are:

```
cd web/public/data/search
for f in en.*.txt pa.*.txt map.*.json; do printf "%s  " "$f"; brotli -c -q 11 "$f" | wc -c; done
```

Production compresses, but not that hard. `brotli -q 11` is the best case; Cloudflare compresses on
the fly at something nearer q5. Measured against what it already serves:

```
curl -sS -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}\n' \
  https://app.sutamaya.org/data/corpus.json      # 194809 on the wire
curl -sS --compressed -o /dev/null -w '%{size_download}\n' \
  https://app.sutamaya.org/data/corpus.json      # 948267 decoded
```

948 KB down to 195 KB, against 152 KB at q11 — so expect **about 1.28× the q11 figures**, which
puts the three search files near **1.1 MB + 1.2 MB + 48 KB, call it 2.4 MB**.

**One thing only the deploy can answer:** whether Cloudflare compresses a response this large at
all. Everything it serves today is under 1 MB, and the search blobs are 8.8 MB and 10.7 MB. If it
declines them, the first search costs 19.5 MB instead of 2.4 MB. So on the first deploy, check
Content-Encoding on `en.<version>.txt` before anything else — `br` means it worked, its absence
means these files need pre-compressing at build time and serving with an explicit
`Content-Encoding`.

## Then, the network speeds

DevTools → Network → the throttling dropdown (**No throttling** by default). Add a profile with
**⋮ → Add custom profile** if you want something between the presets.

For each, load the app fresh (`⌘⇧R`), then search:

| Profile | What to check |
|---|---|
| **No throttling** | Results appear as you type, and the spinner beside the count never appears at all. |
| **Fast 4G** | Metadata hits appear instantly; a spinner and "Searching sutta text…" sit beside the result count; text hits and their snippets append a moment later without the list jumping under your cursor. |
| **Slow 4G** | The same, but the wait is long enough to read. Type a second query while it loads — it must stay responsive and keep answering from the metadata. |
| **Offline** | See the next section. |

The thing to watch for in all of them: **no result you already have may disappear, and none may
drop below the text hits that arrive.** New rows append below. Rows already on screen can swap
places among themselves, which is expected — the tie-break inside a rank is how often the word
occurs in the sutta's text, and that is zero for everyone until the text lands.

## Offline, and coming back

1. Load the app, do **not** search.
2. Network → **Offline**. Search for `sariputta`.
   Expect: normal results, and underneath, "Search covers sutta numbers, titles, summaries and
   your own notes — not the text of the suttas."
3. Network → **No throttling**. Clear the box and search again.
   Expect: the text loads and the note goes away. This is the retry that was broken — before the
   fix it stayed degraded until you reloaded the tab.
4. Now the offline path proper: **Settings → Download all suttas for offline**, wait for it to
   finish, then go **Offline** and reload. Search should work fully, with snippets, from the cache.

## The memory release

The blobs are ~34 MB and are dropped a minute after the app goes out of sight.

1. Search once, so the text is loaded.
2. DevTools → **Memory** → **Heap snapshot**. Note the total.
3. Switch to another tab and leave it for **over a minute**.
4. Come back, take a second snapshot. It should be ~34 MB lighter.
5. Search again: the three requests reappear in the Network panel, served **(from disk cache)** —
   no bytes over the wire, a brief pause, then results.

## What to look at in the results themselves

- A hit found in the text shows a **paragraph behind a left rule**, with the query words marked.
- A hit found in the **Pali** shows the Pali line and its English underneath, inside the one rule.
- A hit found only by title or description shows the description, **no rule**.
- A sutta you have written a note on shows the note behind an **em dash**, never a rule.
- The matched word is **visible inside the clamp**, not scrolled off — that is what the windowing
  is for. Try `poisoned arrow`, whose match sits deep inside a long paragraph.

Queries worth typing: `poisoned arrow`, `lump of foam`, `elephant's footprint`, `pabhassara`,
`maha kassapa`, `truths`, `truth`, `loving-kindness`, `mind is luminous`.

## The three places results are drawn

They are separate components and must all be checked:

1. **Library, desktop** — the tree pane beside the list pane.
2. **Library, mobile** — narrow the window until the layout switches; the tree pane draws the rows
   itself.
3. **The reader's search overlay** — open a sutta, then the search icon.

## Safari

Worth its own pass, because Safari is the iOS engine and the one with the storage limits:

- Develop → **Show Web Inspector** → Network for the same download check.
- **Storage** tab → Cache Storage → `search-text` should hold exactly **three** entries.
- On an iPhone, install to the home screen and repeat the offline section; a PWA that has been
  backgrounded for a while is exactly the case the memory release is for.
