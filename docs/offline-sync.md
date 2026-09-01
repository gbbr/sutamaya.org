# Offline sync

Sutamaya is offline-first for reading *and* writing. The corpus, app shell and (optionally) every
sutta's text are cached locally; user data — lists, notes, highlights, visits — is written to a local
mirror first and synced afterwards. **The local write is the durable write.** Nothing is held as an
optimistic edit awaiting a server blessing, so a list made, a note typed or a highlight painted with
no network is kept rather than logged and lost.

This document specifies how that works: the mechanisms, the invariants a change must not break, and
the losses accepted on purpose.

## Scale

One user, a handful of their own devices, usually one. That decides the design.

The failure that matters is **silent data loss** — something written offline that never arrives, or
newer work destroyed by an older device reconnecting. The failure that does not matter is
**contention**: two devices racing to edit the same object in the same instant, which needs sequence
cursors, logical clocks and merge algebra to resolve properly. So the design buys four mechanisms
that prevent real loss and declines the apparatus that would guard against contention. Where a
conflict does happen, one side wins and the other is gone — see "Accepted losses".

## The four mechanisms

### 1. Client-generated ids

A `list.create` and a `highlight` write carry an id minted by the client. That is what makes offline
creation possible at all: the client names the thing, so every later reference to it — rename, move,
file a sutta into it, delete it — is valid before the server has ever heard of it. It also makes a
create idempotent, since a re-sent create carries the same primary key.

`lists.id` is a global primary key rather than `(user_id, id)`, so `CREATE_LIST_SQL`'s
`ON CONFLICT(id) DO NOTHING` can absorb a row belonging to *another account*. `createList` inspects
`meta.changes` and, on a skipped insert, does a user-scoped read to tell a retry (row is mine → `ok`)
from a genuine collision (row is someone else's → `409 id_collision`, and the client mints a fresh id
and re-pushes every reference to it). Reporting success for the second case would hand the client an
id it does not own, and every later write against it would be refused under the `AND user_id = ?`
scope.

### 2. Tombstones

A delete sets `deleted = 1`; the row stays. Without this, a device that was offline when a delete
happened elsewhere pushes its still-live copy on reconnect, which against a missing row is
indistinguishable from a fresh creation — and silently resurrects it. Applies to `lists`, `notes` and
`highlights`. `visited` needs none: it is monotonic and never deleted.

**Every read path therefore filters tombstones.** `notes`/`highlights` filter `deleted = 0` in SQL,
`GET /api/lists` likewise, and `buildUserData`'s `lists` read deliberately *fetches* them so
`repairListTree` can cascade, dropping them itself. Miss one and deleted notes reappear in the Notes
auto-list, deleted highlights render, deleted lists show as membership chips. The note case is the
sharpest: "a row exists" *is* "this sutta has a note".

Two write paths deliberately don't filter. `suttaListRow` accepts a tombstoned list, because a
membership add queued offline may arrive after the list's own delete and must land on the dead row
rather than be refused and discarded. `invalidParentReason` likewise accepts a deleted parent, which the
read-time cascade then removes anyway. The cycle check in `invalidReparentReason` *does* filter, so a
dead row can't manufacture a cycle out of a chain nothing renders.

### 3. An mtime, and a conditional write

Every mutable row carries `mtime`: `${ISO}|${deviceId}` (see A1). ISO 8601 is fixed-width, so
lexicographic comparison is chronological comparison in both SQLite `TEXT` and JavaScript `<`, with
no parsing anywhere. Every mutable write is conditional on it — an upsert whose `DO UPDATE` carries
`WHERE excluded.mtime > <table>.mtime`, or an `UPDATE ... AND mtime < ?`.

That clause is the whole of conflict resolution: **last writer wins, per row, no merge algebra.**

**The client stamps it when the user acts, never when the flush reaches the network.** A note edited
offline on Monday and flushed on Friday has to lose to a Wednesday edit made elsewhere, which it only
does if it still carries Monday's timestamp. Stamping in the flush loop would look correct, pass
every obvious test, and reinstate the exact bug the timestamp exists to prevent.

`resolveMtime` (`worker/src/lib/mtime.js`) generates one with a `server` deviceId when a write
arrives without, monotonically clamped so two writes in the same millisecond can't tie — and a tie
loses a conditional write. `web/src/lib/mtime.ts`'s `nextMtime()` clamps the same way on the client,
which also guards against a backwards clock adjustment sorting below the device's own last write.

The pre-existing timestamp columns (`notes.updated_at`, `highlights.created_at`,
`visited.visited_at`) take the client's value too, so the auto-lists order by when the user acted
rather than by when the write arrived. `visited` has no `mtime` of its own — `visited_at` already is
its clock.

### 4. Records for most things, operations for order and membership

The mirror holds two kinds of pending work.

**Records** are desired state — a list row, a note, a visit, a highlight. The flush pushes what
should be true, so replaying one means the same thing an hour later as when the user acted.

**Operations** are the exception, for everything that edits a list's `items` and for sibling order:

| Operation | Push item | Why an op |
|---|---|---|
| add / remove a sutta | `item.add`, `item.remove` | Already idempotent and commuting (`ADD_ITEM_SQL` is `EXISTS`-guarded, `REMOVE_ITEM_SQL` is a set subtraction), so two devices each filing a different sutta into one list both stick |
| a list's item order | `item.order` | Edits the same `items` column, and the server reconciles a posted order against what is stored |
| sibling order | `sibling.order` | As per-row records a single drag cost one write per sibling — dragging the 50th list of a group to the top produced 50 of them |

The test is whether an operation can be made to mean the same thing on replay. Both order endpoints
**reconcile** rather than overwrite (`reconcileItemOrder`, `reconcileSiblingOrder`): a posted id that
is no longer a live row is dropped, and a live member the posted order never mentioned is appended
rather than silently lost. For sibling order, an id belonging to a *different* parent is deliberately
kept — that is a cross-parent drop, and moving it in is the point.

Two consequences the hybrid forces:

- **A flush pushes records before operations.** A list created offline and then filled with suttas
  produces one record and several ops, and an op naming a list the server has never seen is refused
  and discarded. Records first, then ops, is the whole dependency graph — ops only ever reference
  lists. A push applies its items strictly in the order they arrive, which is what lets both this
  and the ops' own order survive being batched into one request.
- **Order ops are guarded against the row's own `mtime`**, the same column a rename or reparent
  writes. There is one clock on the row, and records flush ahead of ops, so a reorder queued before a
  rename would arrive behind it and match nothing — while the write still answers `{ok: true}`, so
  the flush would retire the op as landed and the pull would restore the order the user had just
  dragged away from. `editList` therefore re-stamps any queued order op naming the row it stamps
  (`restampOrderOps`). This only moves an op ahead of *this* device's later edits; against another
  device's it still carries the time the user acted.

## Highlights are immutable spans

The one place the mechanism is shaped differently, because "delete whatever currently overlaps" is
unsafe to replay: an hour later it means something else, and it took whole highlights another device
had created in between.

A highlight is keyed by a client-minted id and never updated. A recolour is a tombstone plus a brand
new highlight; an erase is a tombstone alone. The **client** works out which existing highlights a
new selection displaces (`displacedIds` in `web/src/lib/highlights.ts`) and names them in the write's
`erase` list. A highlight is atomic there — a selection touching any part of one displaces the whole
thing, rather than stranding the part it missed.

`g` and `erase` are both **required**. The server never infers what a selection displaces, so a write
that doesn't say is a bug rather than a silent half-write, and a create without its own `g` would
lose the idempotence the scheme rests on.

### Endpoints, not one row per segment

One row holds the whole highlight: the half-open span from `(i0, o0)` to `(i1, o1)`, where `i` is a
segment index and `o` a character offset into that segment's English text. Everything between the two
ends is covered by definition, and `highlightRanges` resolves that into per-segment ranges at render
time, against the text the device currently holds.

This is what an earlier per-segment layout got wrong. An interior row stored `e` = that segment's
length *at the time of highlighting*, so when SuttaCentral reworded the segment longer, the tail of
that line went unhighlighted — a gap in the middle of a highlight. Upstream rewords on the order of
20,000 segments every couple of years, touching most suttas, so it recurs.

What still drifts: the two endpoint segments carry offsets a rewording moves, so a highlight's first
and last few characters can shift. That is accepted — there is no text anchoring and no fuzzy
re-anchoring. Both ends are also **clamped** to what exists, since a device can hold an older,
shorter copy of a sutta than the one the highlight was made against (text files revalidate in the
background): an end anchor past the last segment stops at the last segment, an offset past a
segment's length stops at its end, and a start anchor past the end of the document paints nothing.

A `highlight` write inserts under `INSERT OR IGNORE` on the primary key `(user_id, id)` — so
re-sending one (a flush retried after a lost response) lands on the same row rather than duplicating
the highlight — and tombstones the displaced ones in the same `db.batch()`, tombstones first. The key
leads with `user_id`, so one account's ids can never reach another's rows.

A mirror written by a build that stored per-segment ranges is collapsed to endpoints on the way out
of IndexedDB (`upgradeStoredMirror`, called by `loadMirror`). It has no removal date: a reader who
has never signed in has no server copy to re-pull, so that mirror is their only one.

### Overlaps

Two devices can both highlight overlapping spans offline and both survive, so **stored spans may
overlap**. The reader settles which one paints the contested characters, by `(mtime, id)`
(`paintSegmentRanges`), which is why `GET /api/data` sends each highlight's `mtime` as `m`. One
overlapped in the middle renders as two spans, both carrying its own id, so clicking either half acts
on the whole highlight.

## Tree repair at read time

Deleting a list or group tombstones that one row and nothing else. The tree is then repaired on
**read** — `repairListTree`, in `worker/src/lib/listTree.js` and ported to `web/src/lib/listTree.ts`
— which is where the delete actually takes effect. The algorithm is A3.

Repairing on read rather than at delete time is what lets two devices converge without
communicating: whichever delete or move lands second never saw the other, and every step is
deterministic given identical input, never dependent on row order. A child added on one device while
another was deleting its parent group is hidden by the cascade, where a delete-time subtree walk
would have missed it and stranded it at the top level.

## The client mirror

`UserDataContext` is a view over the mirror, not over the server. Nothing in `lib/mirror.ts` talks to
the network; every mutator is a pure state transition that marks what it touched dirty and stamps
`mtime`.

| Module | Role |
|---|---|
| `lib/mirror.ts` | The `MirrorState` — `lists`/`notes`/`highlights`/`visited` records plus an `ops` queue — namespaced by `userId`, and every mutator over it |
| `lib/mirrorView.ts` | Derives what the UI renders, including the three auto-lists. A port of the worker's `assembleUserData` |
| `lib/listTree.ts` | Read-time tree repair. A port of the worker's `repairListTree` |
| `lib/mirrorDb.ts` | Persists the whole mirror as one IndexedDB value per user id, versioned by `DB_VERSION`; runs `upgradeStoredMirror` on the way out |
| `lib/sync.ts` | The flush |
| `lib/mtime.ts` | `nextMtime()` |
| `lib/lastUser.ts` | Who was signed in, in `localStorage` |
| `lib/localAccount.ts` | This device's id for a reader who hasn't signed in, and the iOS-storage-policy test |

### Deferred sign-in

A reader who has never signed in gets a `local-…` id (`lib/localAccount.ts`) and a mirror of their
own, so making a highlight makes a highlight rather than raising a sign-in wall. That works because
the mirror is already namespaced by user id and the local write is already the durable one — the
only thing signing out of the model was an id to file under.

Two things differ from a real account, and only two. The flush stands down (`isLocalUserId` guards
it: there is no session, so every request would 401). And on sign-in, `adoptMirror` moves the whole
local mirror onto the account — every record marked dirty, lists and highlights reset to
`pendingCreate`/`sent: false` since that account's server has genuinely never seen them — after
which the ordinary flush carries it up. Adoption keeps each record's own `mtime` rather than
re-stamping: that timestamp is when the user acted, and a fresh one would let a week-old local note
beat yesterday's edit from their phone.

Notes are the only thing that can collide, being keyed by sutta rather than by a minted id. Where
the device can see both texts, they are concatenated (`ADOPTED_NOTE_SEPARATOR`) rather than one
replacing the other — a note is prose, and appending is lossless where last-writer-wins is not.
Where it can't (a first sign-in on a device with no prior copy of the account's data), the ordinary
`mtime` merge decides, exactly as between any two devices.

Signing out retires this device's copy of the account's data and mints a fresh local id. Leaving it
in place would keep a departed account's notes readable and writable by whoever signs in next, and
would push them back to the server the moment they did. Nothing is lost — the account's data is on
the server — except anything still queued, which is what the sign-out button warns about.

`mirrorView.ts` and `listTree.ts` exist twice on purpose — no module is shared between the two npm
workspaces — and the server's copies still shape the pull.

**Deriving the auto-lists client-side is why every pulled row carries the timestamp they order by.** A
sutta noted or highlighted offline has to appear under Notes/Highlights with no round trip, so the
wire sends each note as `{text, m}` (not a bare string) and each highlight's `m`; `visited` is its
own clock. Without it the entries compare equal and the list falls back to whatever order the
server's `SELECT` returned. The server still synthesizes its own copies, and `applySnapshot` drops
them.

**Identity is the one thing the mirror can't answer for itself.** It stores everything under a user
id, but only `GET /api/auth/me` ever said what that id is. `lib/lastUser.ts` remembers the last
confirmed user and `AuthContext` seeds `user` from it, because relaunching with no network otherwise
left that fetch failing, `user` null, and `UserDataProvider` mounting an empty mirror over a full
one: every list, note and highlight on the device invisible, and unwritable too. It caches an
identity, not a credential — the signed session cookie still authorizes everything, so a stale entry
costs at most a 401 on the next flush, which is already the re-auth path.

### The flush

Order, and what each outcome means, is A4. In summary: everything owed goes to `POST /api/data/push`
as one ordered array — list records in `mtime` order, then notes, highlights and visits, then the ops
in the order the user made them — chunked at 10 items a request and looped until the queue drains,
then `GET /api/data`, a full snapshot with no delta protocol. **One sync is a couple of requests
however much is queued.** Per-edit requests were the earlier shape, and they scaled sync cost with
the number of edits rather than the number of syncs: a first sign-in after using the app signed out
fired hundreds of them in a couple of seconds, tripping the 60/min per-IP rate limit and converging
slowly with most of its requests refused.

Nothing in the flush mutates state directly. It reports what landed, and `applyFlushOutcome` folds
that into whatever the mirror looks like *by then*, matched on the exact `mtime` pushed — so a record
edited mid-flush stays dirty. One flusher at a time across tabs, via a Web Lock (`ifAvailable`, so a
losing tab skips the round rather than queueing).

### Local collapses

All in `lib/mirror.ts`. A highlight created and erased before either left the device is dropped
rather than pushed as a create-then-tombstone pair (whose order can't be guaranteed); a list deleted
before its create ever left goes outright along with its queued ops; an add and a remove of the same
sutta in the same list cancel; only the latest order per list (and per parent) is kept.

**"Before it left" is `createSent`/`sent`, not `dirty`/`pendingCreate`.** The latter stay set for the
whole round trip and past a response lost on the way home, so collapsing on them drops a delete the
server never receives — and the pull at the end of that same flush hands the row straight back.
`markDispatched` marks the records a flush is about to send, *before* its first request, and the
collapses key off that.

### Sync state

`syncCounts()` reports how many records/ops are dirty; `UserDataContext` combines that with the
browser's `online`/`offline` events into `'synced' | 'pending' | 'offline'`. `'offline'` wins over
everything, then a plain `'pending'` count. `SettingsPage` spells it out in words along with
`lastSyncedAt` (set only when a flush fully drains and pulls), and that is the only place any of it
is shown.

The app's chrome deliberately carries none of it. `'pending'` drains in a couple of seconds and
implying doubt about a write that is already durable locally works against the whole local-first
model; `'offline'` is something the device already says, and changes nothing about whether the work
is safe. `needsReauth` is the exception and gets a banner of its own — see below.

**A write the server permanently refuses is given up on, not surfaced.** A refused item is permanent
by definition, so no later attempt would answer differently: the flush drops the write with a
`console.error` and the pull hands back the account's own version of that row — the same rebase a
write losing last-writer-wins already gets. That the two sides disagreed about validity at all is a
bug in one of them, which is a developer's problem; the reader has nothing to decide, and there is
no sync state, warning or discard action anywhere in the UI for them to decide it with. There is no
`rejected` state and no `'stuck'` status: a per-item refusal retires the item, it never re-queues it.

This is also why the push is **not atomic** — per-item results, like CouchDB's `_bulk_docs`. One item
the server won't take must not hold up everything queued behind it, and the items before it in the
same request are not rolled back.

A 401 sets `needsReauth` and pauses the flush with the queue intact. It deliberately does *not* call
`promptGoogleSignIn()` itself: that navigates to Settings, and firing it from a background flush
would yank the reader away mid-sutta for a lapse they haven't noticed. It fires from a real click
instead — on the banner `TreePane` shows below its header, sharing the slot the two offline nudges
use and taking priority over both.

That banner is the only sync state the app's chrome shows, because a lapsed session is the only one
the UI otherwise misrepresents: `AuthContext` seeds `user` from `lib/lastUser.ts`, so the account
badge still shows a signed-in user, and every list, note and highlight still reads and writes
against the local mirror. Nothing looks wrong while nothing reaches the server, and it stays that
way indefinitely — the pause stands every automatic trigger down, and only a fresh sign-in (the
`[user]` effect in `UserDataContext`, keyed on object identity so re-authing the same account still
counts) clears it.

## Invariants

Things a change here must not break:

1. **Stamp `mtime` when the user acts.** Not at flush time. See mechanism 3.
2. **Every read path filters tombstones.** The one exception is `buildUserData`'s `lists` read, which
   hands them to `repairListTree`.
3. **Every query is scoped `AND user_id = ?`.** These are flat tables with no structural per-user
   isolation; that predicate is the only thing separating one account's data from another's, on
   reads, writes and existence checks alike.
4. **Records flush before operations.**
5. **A dirty flag clears only against the exact `mtime` that was pushed.**
6. **A highlight is never updated.** Recolour = tombstone + new highlight.
7. **`g` and `erase` are required on a highlight write.**
8. **A local collapse keys off `createSent`/`sent`, never `dirty`/`pendingCreate`.**
9. **Both order ops stay ahead of local edits to the rows they name** (`restampOrderOps`).
10. **Tree repair is deterministic given identical input** — never dependent on row order — because
    that is what makes two devices converge without communicating.
11. **The mirror is keyed by user id**, so an account switch cannot cross-write.
12. **`mirrorView.ts`/`listTree.ts` and their worker originals must agree.** They are ports; a fix to
    one belongs in both.
13. **Bump `DB_VERSION` (`lib/mirrorDb.ts`) in the same change as any alteration to `MirrorState`'s
    persisted shape — including the shape of anything `GET /api/data` writes into it.** A record
    saved under the old shape is not valid input for code written against the new one, and IndexedDB
    has no reason to touch it on its own. `onupgradeneeded` wipes and recreates the store rather than
    migrating, which is safe because the mirror is a cache of the server plus whatever is still
    dirty; the cost is a re-pull. Skip the bump and a device carrying a stale record crashes on read
    — which is exactly what changing the notes payload to `{text, m}` did to a mirror that had
    already persisted the bare-string form.

## Accepted losses

- **A colliding edit loses silently.** No three-way merge, no conflict copies, no conflict UI. The
  later `mtime` takes the row. The realistic collision is one person editing the same note on two of
  their own devices, where the losing side is nearly always the stale one they had forgotten about,
  and a conflict dialog is a cost paid on every edit to serve a case that approximately never arises.
  There is deliberately **no notification** that a merge discarded something — surfacing it means
  building the UI the design rules out. The sync indicator is what makes this tolerable: the user can
  at least see that everything they wrote arrived.
- **Order is last-writer-wins per container.** Merging user-controlled order properly needs
  fractional ranks per row, which forces `items` out of its JSON column into a table. Two devices
  reordering the same thing offline means one ordering wins and the user re-drags — visible, and one
  drag to repair.
- **Membership resolves add-versus-remove by arrival order**, not by timestamp, since it stays
  operation-based. Giving `items` per-entry metadata to fix that would be a merge algorithm for a
  case worth less than it costs.
- **A `not_found` result retires a write.** The row is gone (deleted elsewhere, or cascaded out with
  an ancestor), so the write is moot rather than failed.
- **Cross-parent order and reparent share the row's one clock.** `restampOrderOps` widens local
  precedence slightly: an order op re-stamped after a local rename can beat another device's edit
  made in between. One clock per row is the deliberate simplification (per-field clocks cost three
  columns and three conditional updates to serve two devices being offline simultaneously).
- **Auto-list caps evict.** `Visited` keeps 100, `Highlights`/`Notes` 300 each, so a large flush can
  push genuinely recent entries out. Nothing is lost — the rows are all still there, and a note or
  highlight past the cap still renders in its sutta — but the list stops naming them, and says so
  at its foot.
- **A long-offline device meets a lapsed cookie.** The session cookie's 90-day max age means the
  queue must survive re-auth, which is what `needsReauth` and the pause are for.
- **Work made signed out lives only on that device.** There is no server copy until the user signs
  in, so clearing site data loses it — and on iOS in a browser tab, so does not visiting for about
  a week (WebKit evicts script-writable storage; a home-screen install is exempt). This is stated
  to the user rather than engineered around: the header banner prompts once there is something
  worth keeping, and Settings says it permanently where the eviction policy actually applies.
- **Highlight offsets are content coordinates, not anchors.** `(i, s, e)` index into segment text, so
  an `update-data` corpus refresh — or a device still holding the pre-refresh copy of a sutta — can
  leave a stored range denoting different text. Out of scope here; fixing it needs anchoring on a
  quoted prefix/suffix.
- **No hybrid logical clocks, no delta pull, no batch sync endpoint.** Device clocks all NTP-sync and
  the skew is milliseconds; the dataset is tens of kilobytes, so `GET /api/data` is already cheap;
  the existing endpoints work and their failure modes are handled by retry plus the conditional
  write.

---

## Reference

### A1 — Schema

`worker/migrations/0002_offline_sync.sql`, on top of `0001_init.sql`:

```sql
ALTER TABLE lists      ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE lists      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes      ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE highlights ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE highlights ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
```

`worker/migrations/0004_highlight_endpoints.sql` then rebuilds `highlights` as one row per highlight
— `(i0, o0, i1, o1)` in place of `(i, s, e)`, the client-minted id as the row id, and
`PRIMARY KEY (user_id, id)` doing the job the old `(user_id, g, i)` unique index did.

`''` sorts below every real timestamp, so an un-backfilled row always loses a merge rather than
winning by accident; the migration backfills from each table's existing timestamp column anyway. The
unique index is **load-bearing, not an optimisation**: it is what makes re-pushing a group an
`INSERT OR IGNORE` no-op.

Adding a migration means applying it to your local D1 by hand — see CLAUDE.md. `npm test` applies the
full set to a fresh database every run, so the suite never catches a stale local schema.

### A2 — mtime format

```
`${new Date(ms).toISOString()}|${deviceId}`
```

`deviceId` is a random id minted once per device and persisted (`sutamaya.deviceId`). It only breaks
ties between two devices writing in the same millisecond, so the outcome is deterministic rather than
dependent on arrival order. `ms` is `Math.max(Date.now(), lastMs + 1)`, which both guards a backwards
clock adjustment and keeps two writes in the same millisecond from tying.

Nothing parses these as dates — `visited` values are used for truthiness and ordering only, and no
mtime is formatted for display — so the suffix is safe.

### A3 — Tree repair

Run over the whole list set on read, **tombstones included**, on both server and client:

1. Collect every row into a map by id, tombstoned ones too.
2. **Re-home danglers** — a `parentId` pointing at no row *at all* gets `parentId = null`. A dangling
   reference is not a delete (`parent_id` has no foreign key, so a client that pushes a child before
   its parent produces one), and dropping it would lose a list with no tombstone to explain why.
3. **Break cycles** — walk each list's ancestor chain; on revisiting a node, re-home the member with
   the **lowest** `mtime`, so the most recent move survives. Must run before the cascade, whose
   ancestor walk would otherwise never terminate. (`wouldCreateCycle` in `lib/listParent.js` carries
   its own visited set for the same reason: cycles are repaired on read and never written back, so
   storage can hold one indefinitely.)
4. **Cascade deletes** — drop every tombstoned list, and every list with a tombstoned ancestor.
   Deleting a group deletes what is inside it, the way deleting a folder does; children are *not*
   re-homed. So one `UPDATE` retires a whole subtree, it all comes back if the group is un-deleted,
   and survivors form a closed forest — a live list can never point at a dropped parent.
5. **Order siblings** by `position`, tie-breaking on `id`, since the negative-prepend scheme can
   produce equal positions.

`position`/`mtime`/`deleted` feed the repair only; `shapeList` drops all three, so none reach the
client.

### A4 — Flush

Triggers: app load once the mirror is read, ~2s debounced after any mutation, the `online` event,
`visibilitychange` to visible, and a 5-minute poll as a backstop. Never per keystroke — note editing
commits on Enter/blur.

`buildQueue` (`lib/sync.ts`) assembles one ordered array, which goes to `POST /api/data/push` in
chunks of `CHUNK_SIZE` (10, matching the Worker's `PUSH_MAX_ITEMS`, which is sized against the
Workers subrequest budget — every D1 query the handler makes counts against it) until it drains:

1. **List records, in `mtime` order** — so a parent reaches the server before the child naming it
   (a create naming an unknown parent is refused), and so the server's own prepend reproduces the
   order the user created them in. Each record is a `list.delete`, a `list.create` or a
   `list.update` depending on `deleted`/`pendingCreate`.
2. Notes, highlights, visits.
3. **Ops, by `seq`** — the order the user made them, so an add and a later remove of the same sutta
   mean what they should. The server applies a push's items strictly in order, so batching preserves
   this.
4. `GET /api/data`, once, after the last chunk — applied by `applySnapshot`.

Per-item results (`results[i]` answers `items[i]`):

| Result | Handling |
|---|---|
| `{ok: true}` | Acked; the dirty flag clears if the record's `mtime` still matches what was pushed |
| `not_found` (404) | Write retired — the row is gone, so it is moot rather than failed |
| `id_collision` (409) on `list.create` | Re-mint the id, rewrite every reference still queued behind it (children, ops, the ack), and re-send from that item. `MAX_ID_ATTEMPTS` fresh ids, then it is given up on |
| any other refusal | Write given up on and logged; the pull rebases the row onto the server's version |

Whole-request outcomes, which say nothing about any individual item and so retire nothing:

| Result | Handling |
|---|---|
| `401` | Flush pauses, queue intact, `needsReauth` set |
| retryable (429/5xx/network/timeout) | Flush stops partway; the unsent remainder goes next time |
| any other failure | A malformed push — a bug in this client. Logged; the queue is kept |

Applying a pull is **replace clean, keep dirty**, plus two rules the record model alone doesn't give:
still-queued ops are replayed over the pulled rows (or a change made offline blinks out of the UI on
every pull until it lands), and a group named by a still-pending `erase` is dropped from the snapshot
(or an erase made offline visibly undoes itself on every pull).
