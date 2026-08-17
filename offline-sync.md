# Offline sync

Sutamaya is offline-first for *reading* — the corpus, the app shell and (optionally) every sutta's
text are cached locally, so browsing and reading work with no network. It was not offline-first for
*writing*: list, note and highlight mutations fired straight at `/api/*`, and when the network was
down the optimistic local edit stood while the write was lost with nothing but a `console.error`.
This document is the plan for closing that gap.

It sets out what breaks today, the design, the compromises taken deliberately, the order to build
it in, and a reference appendix. Steps 1 through 4 are built (see each step's own notes and
CLAUDE.md); step 5, the UI that makes sync state legible, is not.

## Scale, and what follows from it

This is a personal application: one user, a handful of their own devices. That is not an aside —
it decides most of the design.

The failure that matters is **silent data loss**: something written offline that never arrives, or
newer work destroyed by an older device reconnecting. The failure that does *not* matter is
contention — two devices racing to edit the same object within the same instant, which needs
sequence cursors, logical clocks and merge algebra to resolve properly, and which will not happen
here.

So the plan buys exactly four things, each of which prevents real loss, and deliberately declines
the apparatus that would guard against contention. "Considered and rejected" at the end records
what was left out and why, because the omissions are as much a decision as the inclusions.

## How to work through this

"What breaks today" is reference material — the catalogue of everything that can currently go
wrong, to check a decision against. It is not a task list. The work is "Implementation order", and
the "Reference" appendix holds the concrete schema, formats and algorithms.

Take one numbered step per branch — 2a and 2b are two branches, not one. Each is independently
shippable and leaves the app working and the suite green. Steps 1 through 3 change no user-visible
behaviour except one highlight improvement; step 4 is where offline writing arrives, and step 5 is
what makes it legible to the user.
Each step's own client and server must agree, but nothing older than that has to keep working: the
app is deployed and not released, so an endpoint is free to change shape outright rather than grow
a compatibility branch for a stale PWA shell.

Run the suite with `npm test` from the repo root, never `npx vitest` directly.

Where this document doesn't specify something, ask rather than inventing a convention.

## What breaks today

Organised by entity. All of it describes the current code, and remains true until the step that
addresses it.

### Notes — `PUT /notes/:suttaId`

A last-writer-wins full-body replace keyed `(user_id, sutta_id)`.

- Two devices editing the same sutta's note offline: the later flush wins the whole body and the
  other is destroyed silently.
- A stale offline note flushed days later overwrites a newer edit made online in the meantime.
- Blank text *deletes the row* — deliberately, so `assembleUserData`'s "row exists means has a
  note" rule stays true. A queued clear replayed after a remote rewrite therefore destroys it.
- `updated_at` is stamped at flush, so the Notes auto-list orders by sync time rather than
  authoring time.
- `text.slice(0, NOTE_MAX_LENGTH)` truncates server-side without an error, so local and server
  state diverge silently unless the client applies the identical cap.

### Highlights — `PUT /highlights/ranges`, `DELETE /highlights/:id`

The one entity with a live data-loss bug, because the write's effect depends on server state when
it runs.

- `DELETE_OVERLAPS_SQL` removes every stored highlight overlapping a posted range — the **whole
  row**, not the overlapping sub-range. A replayed range op deletes highlights another device
  created in the meantime, even where the user only meant to touch a few characters.
- Recolours don't commute: A colours `[10,20)` yellow while B colours `[15,25)` green, and whichever
  lands second erases the first outright rather than clipping it.
- An erase (`color: null`) replayed after a remote recolour silently removes it.
- A replayed multi-segment selection gets a fresh `g` and fresh row ids, so two devices highlighting
  the same span produce two groups that `groupHighlights()` (`web/src/lib/highlights.ts`) renders
  and counts as two separate highlights.
- `DELETE /highlights/:id` needs an id that only exists after sync, so an offline create-then-erase
  requires local-to-server id mapping. It also returns 200 for a row that isn't there, so "already
  replaced by another device" is indistinguishable from success.
- Offsets are content coordinates, not anchors: `(i, s, e)` index into segment text. An
  `update-data` corpus refresh, or a device holding a stale `CacheFirst` copy of
  `data/text/{uid}.json` (1-year TTL, no cache-busting — a known gap, see `CLAUDE.md`), means
  offsets computed on one device can denote different text on another. Orthogonal to
  device-versus-device conflict, and out of scope here.

### Visited — `POST /visited/:suttaId`

- `visited_at` is stamped server-side, so a batch of offline visits collapses to flush time and an
  *old* offline visit can jump ahead of a *newer* visit made online elsewhere. Recent goes visibly
  wrong. The endpoint accepts no client timestamp, so this can't be corrected from the client today.
- `RECENT_AUTO_LIST_CAP` (20) means a bulk flush can evict genuinely recent entries.

Otherwise `visited` is monotonic and never deleted — the one entity with no real conflict class.

### Lists

- **Identity.** `POST /lists` mints the id with `crypto.randomUUID()` inside the handler, so an
  offline client cannot name what it creates, and every queued reference to it needs remapping.
  `createList`'s duplicate check is purely client-local, so two devices offline both creating
  "Favourites" produce two rows. A `POST` whose response is lost, then retried, creates a second
  row — there is no idempotency key.
- **Label.** Concurrent renames are last-writer-wins with silent loss; `LIST_NAME_MAX_LENGTH`
  truncates server-side. An edit to a list deleted remotely 404s and is discarded.
- **Membership.** `ADD_ITEM_SQL` is `EXISTS`-guarded and `REMOVE_ITEM_SQL` is a set subtraction, so
  each commutes with itself; add-on-A versus remove-on-B is order-dependent. An add or remove
  targeting a remotely-deleted list 404s via `suttaListRow` and is dropped, so a sutta filed offline
  vanishes with no signal.
- **Item order.** `reconcileItemOrder` (`lib/listItemOrder.js`) already handles reorder-versus-
  concurrent-add/remove well — ids that arrived after the client's snapshot are appended rather
  than dropped, ids removed since are left out rather than resurrected. It does not handle reorder
  versus reorder; the later flush replaces the array wholesale.
- **Tree shape.** `PUT /lists/order` sets `parent_id` unconditionally on every id in `order`, so a
  stale offline reorder drags a remotely-moved list back into its old parent. Unlike item order,
  list order has no reconcile step, so lists created remotely while a device was offline keep their
  negative positions (`firstPosition` prepends) while the stale array renumbers `0..n-1`. Two
  devices can each make a valid move that together form a cycle, and the second is rejected 400 by
  `wouldCreateCycle`. Reparenting into a remotely-deleted group is rejected 400.
- **Deletion.** Deleting a group re-parents its children to their grandparent, so deleting G on one
  device while another adds a child to G yields different trees depending on flush order. A delete
  is unconditional and unversioned, destroying remote edits along with the whole `items` array, with
  no tombstone and no recovery. The children/siblings `SELECT`s sit outside the handler's
  `db.batch()` — already documented there as an accepted race.

The three synthesized auto-lists (`auto-recent`, `auto-highlights`, `auto-notes`) are never rows in
`lists` and must never be written to.

### Session, transport, environment

- The session cookie's 90-day max age means a long-offline device can return to a 401 on every
  queued write, so the queue has to survive re-authentication.
- `requireAuth` reads only the signed cookie, so a queue built under one account and flushed while
  signed in as another would write the first user's data into the second.
- A large flush will hit the per-IP `/api/*` rate limiter.
- `request()` in `web/src/lib/api.ts` collapses every failure into `new Error(message)`, discarding
  the status code — so nothing can distinguish retryable (429, 5xx, offline) from permanent (400,
  404) from needs-re-auth (401).
- Multiple tabs or PWA instances on one device would share a persisted queue with no coordination.
- A user row deleted server-side while a cookie remains valid leaves writes failing against the
  `users` foreign key, since `requireAuth` never touches D1.

`ReaderPrefsContext` and `UiPrefsContext` are `localStorage`-only by design and out of scope.

## Design

Four mechanisms, and nothing else.

### 1. Client-generated ids

`POST /lists` and the highlight write accept an id minted by the client instead of the server. This
is what makes offline creation possible at all: the client names the thing, so every later reference
to it — rename, move, add an item, delete — is valid before it has ever reached the server.

It also makes creation idempotent, but only if the insert says so: a re-sent create carries the same
primary key, and a bare `INSERT` on a key collision raises a constraint error rather than passing
harmlessly. `CREATE_LIST_SQL` needs `ON CONFLICT(id) DO NOTHING` — after which a retry whose response
was lost is a no-op instead of either a duplicate row or a spurious failure.

`lists.id` is a global primary key, though, not `(user_id, id)`, so that conflict clause also
absorbs a row belonging to *another account* — and sign-in is open to any Google account. The
handler therefore inspects `meta.changes`: a skipped insert is followed by a user-scoped read that
separates the retry (row is mine, answer 201) from the collision (row is someone else's, answer
`409 id_collision` so the client mints a fresh id). Returning 201 for the second case would hand the
client an id it does not own, and every later write against it would 404 under the `AND user_id = ?`
scope. UUID clients will never collide by chance; the check is what keeps the failure legible if one
ever does.

### 2. Tombstones

Deleting sets `deleted = 1` rather than removing the row. Without this, a device that was offline
when a delete happened elsewhere pushes its still-live copy on reconnect, which against a
hard-deleted row is indistinguishable from a creation and silently resurrects it. This applies to
lists, notes and highlights alike — including notes, where a blank note currently deletes the row.

Consequently **every read path must filter tombstones.** `buildUserData` (`routes/data.js`) and
`assembleUserData` (`lib/userData.js`) currently treat row existence as meaningful, most sharply
for notes where "a row exists" *is* "this sutta has a note". Miss one and deleted notes reappear in
the Notes auto-list, deleted highlights render, deleted lists show as membership chips.

### 3. A timestamp, and a conditional write

Every mutable row gains an `mtime` supplied by the client (appendix A2 — an ISO 8601 string with a
device tiebreak, not a logical clock). The server never stores it unconditionally: every write is an
upsert that updates **only if the incoming `mtime` is greater than the stored one**, expressed as a
`WHERE` clause on `ON CONFLICT ... DO UPDATE` (A3).

**Capture it when the edit happens, not when the flush happens.** The timestamp is taken at the
moment the user acts, written into the mirror alongside the change, and carried through the flush
unmodified. Stamping it in the flush loop instead would look correct, pass every test listed below,
and silently reinstate the exact bug the timestamp exists to prevent: a week-old offline edit
arriving with today's time and beating work done since.

This one clause is what stops a device that has been offline for a week from destroying newer work
on reconnect. It is the whole of conflict resolution: last writer wins, per row, deterministically,
with no merge algebra. Where two offline edits collide, the later one wins and the earlier is lost —
accepted deliberately, and discussed under compromises.

The existing timestamp columns take the client's value too, not just `mtime`. `notes.updated_at`,
`highlights.created_at` and `visited.visited_at` are what `latestIds` orders the Notes, Highlights
and Recent auto-lists by, so leaving them server-stamped would fix the merge while leaving those
lists still sorted by sync time — the exact complaint in "What breaks today". They are already
meant to record when the user acted; the client is simply now the one who knows.

### 4. Records for most things, operations for membership

The client's queue holds two kinds of entry, and the split matters.

**Records** — a list, a note, a highlight group, a visit — are pushed as *desired state*, never as
the operation that produced it. Replaying an operation is unsafe when its effect depends on server
state at execution time (`PUT /highlights/ranges` deletes whatever currently overlaps), because an
hour later it means something different than it did when the user acted. A record states what should
be true, so replay is idempotent and order-independent.

The test is whether an operation can be made to mean the same thing on replay, not whether it is an
operation. `PUT /lists/order` originally failed it — it reassigned parents wholesale over whatever
ids it was handed — and was given a reconcile step (`reconcileSiblingOrder`) precisely so it would
pass, because as records a sibling reorder cost one request per sibling. See below.

**Membership** is the exception, and stays operation-based: `POST /lists/:id/items` and
`DELETE /lists/:id/items/:suttaId` queue and replay exactly as they are. They are already safe to
replay — the add is `EXISTS`-guarded and the remove is a set subtraction, so both are idempotent and
they commute — and keeping them avoids giving `items` per-entry metadata and a merge algorithm just
to express what two idempotent statements already express. The only thing given up is that
add-on-one-device versus remove-on-another resolves by arrival order rather than by timestamp, which
at this scale is not worth a line of code to prevent.

A list's own **item order** (`PUT /lists/:id/items/order`) went in the same queue rather than into
the list's record, because it edits the same `items` column those two do and the server already
reconciles a posted order against what is actually stored. Kept as a record it would have needed a
second clock on the row: the record's `mtime` guards one conditional `UPDATE`, and pushing a rename
and a reorder under the same one means whichever goes second is rejected for not being strictly
newer. As an op it carries its own `mtime` and the ordering falls out of the queue.

The hybrid brings back one thing pure records would have removed, and it has to be handled rather
than assumed away: **a flush must push records before operations.** A list created offline and then
filled with suttas produces one record and several operations, and an operation naming a list the
server has never seen 404s via `suttaListRow` and is dropped — losing the add silently. Records
first, in one pass, then operations, is enough; there is no deeper dependency graph than that,
because operations only ever reference lists.

`suttaListRow` must also **accept a tombstoned list** rather than treating `deleted = 1` as
not-found. An add arriving for a list deleted elsewhere should land on the dead row, where it is
invisible to every read path but returns with the list if it is ever resurrected. Rejecting it would
throw the add away, which is the loss this plan exists to prevent; the row is already filtered out of
`GET /api/data`, so nothing surfaces either way.

### Highlights become immutable groups

This is the one place a mechanism has to change rather than just gain a column, because the current
write is the design's only genuine data-loss bug.

A highlight group is immutable and keyed by a client-generated `g`. A recolour is a tombstone plus a
new group; an erase is a tombstone; the client computes which existing groups a new selection
displaces (`displacedGroupIds`) and names them in the write's `erase` list. A group is atomic there:
a selection touching any part of one displaces the whole thing, rather than leaving the segments it
missed behind as a stranded remnant. Immutability makes the
server side trivial: there is no update case, so a create is `INSERT OR IGNORE` (re-pushing a group
you already sent is a no-op) and an erase is a conditional `UPDATE ... SET deleted = 1` across the
group's rows. The table keeps one row per segment; only the *record* is the group.

`DELETE_OVERLAPS_SQL` is gone outright, with no server-side overlap path left behind: `g` and
`erase` are required on every write, so a request that doesn't name what it displaces is rejected
rather than half-applied. Nothing has to keep working across this change — the app is deployed but
not released.

`DELETE /highlights/:id` goes with it. It was already dead — removing a highlight has gone through
`PUT /highlights/ranges` for a while — and it is the wrong shape besides: it needs a row id, which
only exists after a sync, where the group's own `g` is knowable the moment the user acts.

The residue is that two devices highlighting overlapping spans offline both survive, so stored
ranges can overlap. That resolves deterministically at render time (`paintSegmentHighlights` in
`lib/highlights.ts`, which `SegmentedText.tsx` renders from), ordering by `(mtime, g)` so the later
group wins the contested characters — strictly better than today, where one side is destroyed
outright. A group overlapped in the middle comes back as two pieces, each still carrying the
group's own stored range, so a click on either resolves to the whole highlight. This is also why
`GET /api/data` now sends each highlight's mtime (as `m`): the client needs it to render, not just
to order the auto-lists.

One ordering trap, since create and tombstone are different statements: a group created and then
erased *before either ever synced* must be dropped from the queue entirely, not pushed as a create
followed by a tombstone. Pushed as a pair they are fine in order, but the tombstone's
`UPDATE ... WHERE g = ?` matches nothing if it somehow lands first, and the create then resurrects a
highlight the user already erased. Collapsing the pair locally is both simpler and cheaper than
defending the order.

### Tree repair at read time

Deleting a group deletes what is inside it — the folder convention, and what the client's own
blocked-delete already assumed the server should do. That is expressed as a cascade at read time
rather than a subtree rewrite at delete time: one `UPDATE` tombstones the group, and the read drops
every list with a tombstoned ancestor (A4). Doing it on read is what makes it converge — a child
added on another device while this one was offline is hidden by the same rule, where a delete-time
walk would have missed it entirely and left it stranded at the top level. The same walk cheaply
breaks cycles, covering the two-devices-moving-groups-into-each-other case without a special path.
This retires the server's delete-time re-parenting in `routes/lists.js` along with its non-atomic
read-then-write.

Re-homing to the root survives only for a `parentId` that points at **no row at all** — a client
pushing a child before its parent. That is a dangling reference, not a delete, and dropping it would
lose a list with no tombstone to explain why.

### Client

`UserDataContext` is a view over an **IndexedDB mirror**: mutators write locally and mark the record
dirty, and a flush pushes dirty records and queued membership operations through the existing
endpoints. It holds no optimistic edit to discard, because the local write *is* the durable write —
which is what retired `syncUserData`, `mutateThenSync` and `resyncAfterFailure`.

Pulling stays `GET /api/data`, unchanged: a full snapshot, applied after a flush. At this scale the
payload is small enough that a delta protocol would be pure cost.

**The auto-lists move to the client.** `assembleUserData` synthesizes `Recent`, `Highlights` and
`Notes` server-side, which works only while the server is the source of truth. Now that the mirror
is, a sutta highlighted offline has to appear under `Highlights` immediately with no network, so the
same derivation runs client-side over the mirror (`web/src/lib/mirrorView.ts`) — ported rather than
reimplemented, since it is already a pure function of fetched rows, `latestIds` and the caps
included, and the ids and labels were already duplicated in `web/src/lib/autoLists.ts`. The same goes
for `repairListTree` (`web/src/lib/listTree.ts`), for the same reason: a group deleted offline only
takes its contents with it if the cascade runs where the UI reads from. The server keeps both copies,
which still shape the pull.

Supporting work: the mirror is namespaced by `userId` so an account switch can't cross-write; a 401
pauses the flush and prompts re-authentication rather than dropping records; and a Web Lock elects a
single flushing tab.

## Deliberate compromises

### Colliding offline edits resolve by last-writer-wins, and the loser is lost

There is no merging of two concurrent edits to the same thing — no three-way note merge, no conflict
copies, no conflict-resolution UI. The later `mtime` wins the row.

This is the central simplification and everything else follows from it. It is right here because the
realistic collision is one person editing the same note on a phone and a laptop, where the losing
side is nearly always the stale one they had forgotten about — and where a conflict dialog would be
a cost paid on every edit to serve a case that approximately never arises.

Membership is the one place given better treatment, since it stays operation-based and so genuinely
merges: two devices each filing a different sutta into the same list both stick.

### Ordering is last-writer-wins per container

Merging user-controlled order properly requires fractional ranks per row, which in turn forces
`items` out of its JSON column into a table. Not worth it. Sibling order and item order each move as
a unit on the row's own `mtime`: two devices reordering the same list offline means one ordering wins
and the user re-drags; two devices reordering different lists both survive.

Nothing changes for the user — drag-to-reorder and nested groups stay exactly as they are, and
`usePointerDragSession`, `useListTreeDrag`, `ListRow` and `ListPane` need no changes. A lost reorder
is visible and one drag to repair, which is the opposite of the silent loss this plan exists to
prevent.

### Out of scope

Highlight anchoring. Offsets remain content coordinates, so a corpus refresh still invalidates them;
fixing that needs anchoring on segment text (a short quoted prefix and suffix, re-anchored on
mismatch) and is separate work.

### Considered and rejected

**Hybrid logical clocks.** Would guard against device clock skew deciding merges. Rejected: the
devices in question all NTP-sync, the skew is milliseconds, and the cost is a module plus two
implementations that must sort identically in SQL and JavaScript. A plain ISO timestamp with a
device tiebreak (A2) is a string concat.

**A sequence cursor and delta pull.** Would let the client fetch only what changed. Rejected: the
dataset is tens of kilobytes, so `GET /api/data` is already cheap, and the cursor brings a counter
table, a per-batch sequence-assignment trap, delta queries and cursor state for a saving nobody
would measure.

**A dedicated `POST /api/sync` batch endpoint.** Would make a flush one atomic request. Rejected:
the existing endpoints work, and the flush's failure modes are handled by retry and the conditional
write regardless. This also avoids a new rate-limit binding.

**Per-field clocks on `lists`.** Would let a rename on one device and a move on another both survive.
Rejected: that requires both devices to be offline simultaneously and editing the same list in
different ways, and it costs three clock columns and three separate conditional updates per record.
One `mtime` per row.

**Per-entry metadata on `items`.** Would make membership merge by timestamp rather than arrival
order. Rejected as unnecessary once membership stays operation-based — the existing idempotent
add/remove statements already deliver the property that matters.

**Requiring a network to delete a list.** Considered as a way to avoid delete-versus-edit resolution.
Rejected: once tombstones exist, a delete is just another field on the same clock, so the case
resolves itself and the restriction would buy nothing while being the only thing a user could notice.

**Flattening the list tree.** Would remove the cycle case and the re-parenting semantics. Rejected
outright: nested groups are a settled feature and arbitrary-depth nesting is a fixed requirement.

## Implementation order

One step per branch, each independently shippable, each ending with `npm test` green.

1. **Status codes in `api.ts`.** Attach the HTTP status to the thrown error (`request()`) and add an
   `isRetryable(status)` helper that `retryWithBackoff` (`web/src/lib/retry.ts`) consults — it
   currently retries any rejection, so it burns its schedule on a 400 or 404 that will never
   succeed. The request timeout (`REQUEST_TIMEOUT_MS`) is a third class alongside HTTP status and
   network failure, and is retryable — it also arrives as a bare `Error`, so classification needs to
   survive it. *Tests:* a 4xx rejects immediately without sleeping; a 500, a network error and a
   timeout each exhaust the schedule.

2a. **Server: timestamps, conditional writes, client ids.** Run the whole of A1 here, including the
   `deleted` columns and the highlights unique index — one migration file, even though nothing reads
   `deleted` until 2b and nothing relies on the index until step 3. Splitting it in two buys nothing
   and doubles the chances of a botched deploy. Then: every write in `routes/annotations.js` and
   `routes/lists.js` accepts an optional client `mtime` and becomes a conditional write (A3), and
   `POST /lists` accepts an optional client-supplied id. Existing columns (`notes.updated_at`,
   `highlights.created_at`, `visited.visited_at`) take the client's value too, so the auto-lists
   order by when the user acted rather than when the write arrived. All new fields are optional, so
   the deployed client keeps working untouched. *Tests:* an older `mtime` does not overwrite a newer
   row; an equal `mtime` does not either; an absent `mtime` still writes; a re-sent create with the
   same id is a no-op rather than a duplicate *or* an error; the auto-lists order by the client's
   timestamp rather than by arrival.

2b. **Server: tombstones.** Deletes set `deleted = 1` instead of removing the row, across lists,
   notes and highlights. Every read path then has to filter them — `buildUserData`,
   `assembleUserData`, and the membership derivation — and `suttaListRow` has to *accept* a
   tombstoned list rather than 404, since a membership operation may arrive after the list's own
   delete. The tree repair in A4 takes over from the delete handler's re-parenting: deleting a group
   tombstones only that one row, and its descendants are cascaded out at read time rather than
   re-parented at delete time.

   Do the read filtering in the same commit as the delete change, not after. Between the two, every
   deleted row is live again to the client — a visible data-corruption window on a deployed app. The
   note case is the one to watch: row existence *is* "has a note", so any tombstone that slips past
   the filter puts a deleted note straight back into the Notes auto-list.

   *Tests:* a deleted row persists in D1 with `deleted = 1`; tombstoned rows are absent from `GET
   /api/data` — notes especially; an add targeting a tombstoned list still lands; a tombstoned
   group's whole subtree is absent from `GET /api/data` while its descendants' own rows stay
   untouched; a list whose parent is absent entirely is re-homed rather than dropped; a cycle
   resolves identically from either input order.

3. **Highlights as immutable groups.** Client-generated `g`, tombstones instead of
   `DELETE_OVERLAPS_SQL`, group-level writes, and render-time overlap resolution ordering by
   `(mtime, g)`. The only user-visible change in the plan, and an improvement. *Tests:* overlapping
   groups render with the later one winning the contested characters; an erase tombstones rather
   than deletes; re-pushing a group is a no-op.

   The group's `g`, its `mtime` and the `erase` list are minted in `UserDataContext`'s
   `setHighlightRanges` rather than in `useHighlightPopup.ts`: working out what a selection
   displaces needs the sutta's stored highlights, which is the same state the optimistic update
   edits, and splitting the two would have duplicated the overlap logic across both. The popup hook
   still owns everything about the selection itself. The mtime comes from `web/src/lib/mtime.ts`,
   A2's client-side generator — this is its first caller; step 4 is where the rest of the entities
   start using it.

4. **Client mirror.** IndexedDB store, dirty-record tracking, the membership operation queue, flush
   triggers (A5), tab election, client-side auto-list derivation ported from
   `worker/src/lib/userData.js`, and the rewrite of `UserDataContext` into a view over the mirror.
   Retire `syncUserData`, `mutateThenSync` and `resyncAfterFailure`. Largest step by a wide margin —
   consider splitting the mirror-and-read-path from the flush path if it gets unwieldy.

   This is the step that starts sending client-minted ids in earnest, so the flush needs a branch for
   `409 id_collision` from `POST /lists` (see step 1 — it is not retryable): mint a fresh id, rewrite
   the local record and every queued reference to it, and flush again. Without it a collision becomes
   a dirty record that can never drain, which is exactly the stuck queue step 5 has to surface. A v4
   UUID will not collide by chance, so this is about the failure being legible rather than likely.

   *Tests:* a mutation with the network down survives a reload; a flush after reconnect lands every
   queued change; a 401 pauses rather than drops; a 409 on create re-mints the id and the retried
   flush lands, with queued references following the new id.

   Where it landed (`web/src/lib/mirror.ts`, `mirrorView.ts`, `mirrorDb.ts`, `sync.ts`,
   `listTree.ts`):

   - **`PUT /lists/order` stayed the sibling-reorder path, with a reconcile step added.** Pushing a
     reorder as a record per moved row — one conditional `PATCH` each — was tried first and doesn't
     scale: dragging the 50th list of a group to the top rewrites all 50 positions, which exhausts
     the `/api/*` rate limit in a couple of gestures and takes `GET /api/auth/me` down with it, so
     the app renders as signed out. The bulk endpoint's actual defect was that it reassigned
     `parentId` wholesale over whatever ids it was handed; `reconcileSiblingOrder`
     (`worker/src/lib/listSiblingOrder.js`) fixes that directly — a posted id that is no longer live
     is dropped, and a live child the posted order never mentioned is appended — which is the same
     treatment `reconcileItemOrder` already gave item order. So sibling order joins membership as an
     **operation**, queued by `parentId`.
   - **Read-time tree repair had to be ported too**, not just the auto-lists. Once the mirror is what
     the UI renders, a group deleted offline only takes its contents with it if the cascade runs
     client-side. `lib/listTree.ts` is a straight port of the worker's, so both sides agree.
   - **Applying a pull is "replace clean, keep dirty"**, plus two rules the record model alone
     doesn't give: still-queued item ops are replayed over the pulled `items` (or a membership change
     made offline blinks out of the UI on every pull), and a group named by a still-pending `erase` is
     dropped from the snapshot (or an erase made offline visibly undoes itself on every pull).
   - **A dirty flag clears against the exact `mtime` that was pushed**, rather than on the request
     succeeding. The user goes on editing while a flush is out, so an ack for a version the mirror has
     already moved past has to leave the record dirty.
   - **`mirrorDb.ts` stores one IndexedDB record per user id** — the whole mirror as a single value.
     At tens of kilobytes a per-record store buys only partial-write hazards.
   - **A 404 retires a write** rather than leaving it dirty forever: the row is gone (deleted
     elsewhere, or cascaded out), so the write is moot rather than failed. Only a genuinely permanent
     rejection (a 400) stays dirty, which is the stuck queue step 5 surfaces.
   - **`markVisited` skips re-marking whatever is already the most recent visit.** It changes nothing
     anyone can see, and it would churn the state reference every consumer keyed on `lists` rebuilds
     from.

5. **Making it legible.** Offline writing that the user cannot see the state of is worse than
   useless — they cannot tell "saved locally, will sync" from "lost", which is the very uncertainty
   the feature removes. Three affordances, and no more:

   - **Sync state**, in the persistent chrome beside the account badge in `TreePane` (already the
     signed-in indicator, and visible on both surfaces): synced, pending with a count, or offline.
     Settings can carry a fuller "last synced" line next to the existing offline-download action.
   - **Re-authentication**, for the 401 pause in step 4. `promptGoogleSignIn()` already exists; it
     needs a trigger and a non-modal surface, since interrupting someone mid-sutta with a sign-in
     dialog is hostile.
   - **A stuck-queue signal.** Not a conflict dialog — see the compromises — but if the queue cannot
     drain because some record is permanently rejected, retrying forever in silence is the present
     failure mode in new clothes. It has to surface eventually.

   Deliberately absent: any notification that a last-writer-wins collision discarded an edit. That
   is the accepted cost of the compromise, and surfacing it would mean building the conflict UI the
   design rules out. The sync indicator is what makes it tolerable — the user can at least see that
   everything they wrote arrived.

   Its own step rather than part of step 4, which is already the largest by a wide margin, and
   because UI work expands to fill whatever branch it is given. *Tests:* the indicator reflects a
   queued write, a drained queue and a lost connection; a 401 surfaces the re-auth prompt without
   discarding the queue.

---

## Reference

### A1 — Migration `0002_offline_sync.sql`

```sql
-- SQLite requires a non-null default when adding a NOT NULL column. '' sorts below every real
-- timestamp, so an un-backfilled row always loses a merge rather than winning by accident.
ALTER TABLE lists      ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE lists      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notes      ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE highlights ADD COLUMN mtime   TEXT    NOT NULL DEFAULT '';
ALTER TABLE highlights ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

-- `visited` needs neither: visited_at already is the timestamp, and it is never deleted.

-- Backfill so existing rows carry a real, ordered mtime rather than ''.
UPDATE lists      SET mtime = created_at WHERE mtime = '';
UPDATE notes      SET mtime = updated_at WHERE mtime = '';
UPDATE highlights SET mtime = created_at WHERE mtime = '';

-- A group is written as one row per segment; (user_id, g, i) is its natural key and what makes
-- re-pushing a group an INSERT OR IGNORE no-op. Load-bearing, not an optimisation.
CREATE UNIQUE INDEX highlights_user_group_seg ON highlights(user_id, g, i);
```

**Check the unique index against real data before applying.** One range per segment per group is how
the app behaves today — `buildCrossSegmentRanges` (`web/src/lib/highlights.ts`) emits exactly one
range per segment, and the single-selection path emits one — but nothing has ever *enforced* it, and
`PUT /highlights/ranges` accepts whatever array it is handed. A duplicate would abort the migration:

```sql
SELECT user_id, g, i, COUNT(*) FROM highlights GROUP BY user_id, g, i HAVING COUNT(*) > 1;
```

### A2 — Timestamp format

```
`${new Date().toISOString()}|${deviceId}`
```

ISO 8601 is fixed-width, so lexicographic string comparison is chronological comparison — which
means the same ordering holds in SQLite `TEXT` and in JavaScript `<` without any special handling,
and backfilled bare-ISO values compare correctly against new suffixed ones. `deviceId` is a random
UUID generated once per device and persisted; it only breaks ties between two devices writing in the
same millisecond, so that the outcome is deterministic rather than dependent on arrival order.

One line guards against a backwards clock adjustment producing a timestamp that sorts below the
device's own previous write:

```js
const now = new Date(Math.max(Date.now(), lastMtimeMs + 1)).toISOString();
```

Nothing in the app parses these columns as dates — `visited` values are used only for truthiness
(`ListPane.tsx`), and no timestamp is formatted for display — so the suffix is safe to add.

### A3 — Conditional write

The shape every entity follows: insert when absent, update only when strictly newer.

```sql
INSERT INTO notes (user_id, sutta_id, text, updated_at, deleted, mtime)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT(user_id, sutta_id) DO UPDATE SET
  text = excluded.text, updated_at = excluded.updated_at,
  deleted = excluded.deleted, mtime = excluded.mtime
WHERE excluded.mtime > notes.mtime;
```

The `WHERE` on `DO UPDATE` is the entire conflict resolution. Without it a stale push overwrites
newer state, silently — no test catches it unless one is written for it specifically.

`visited` has no separate clock, so its guard is `WHERE excluded.visited_at > visited.visited_at`.

Highlights are immutable, so they never take the update path: a create is `INSERT OR IGNORE` on
`(user_id, g, i)`, and an erase is
`UPDATE highlights SET deleted = 1, mtime = ?3 WHERE user_id = ?1 AND g = ?2 AND mtime < ?3`.

When a write arrives with no `mtime` — every write from a pre-step-4 client — the server generates
one in the same format, using a fixed server `deviceId`.

### A4 — Tree repair

Run over the list set on read — **tombstones included**, since the cascade needs them — on both
server and client, producing the tree the UI renders:

1. Collect every row into a map by id, tombstoned ones too.
2. **Re-home danglers** — a `parentId` pointing at no row *at all* gets `parentId = null`. This is a
   safety net, not delete semantics: `parent_id` has no foreign key, so a client that pushes a child
   before its parent would otherwise leave a list that exists but renders nowhere. A `parentId`
   pointing at a *tombstoned* row is the different case step 4 handles.
3. **Break cycles** — walk each list's ancestor chain; on revisiting a node, re-home the member with
   the **lowest** `mtime` to the root. Lowest, so the most recent intent survives. Deterministic
   given identical input, which is what makes two devices agree without communicating. Must run
   before step 4, whose walk would otherwise never terminate.
4. **Cascade deletes** — drop every tombstoned list, and every list with a tombstoned ancestor.
   Deleting a group deletes what is inside it, the way deleting a folder does; children are *not*
   re-homed. So one `UPDATE` on the group makes its whole subtree disappear here, with no descendant
   walk at write time, and a child added on another device while this one was offline is hidden by
   the same rule instead of surfacing as a stray at the top level. Survivors form a closed forest —
   a live list can never point at a dropped parent — because anything whose parent went, went too.
5. Order siblings by `position`, tie-breaking on `id` so equal positions — which the negative-prepend
   scheme can produce — still render stably.

### A5 — Flush triggers

The flush runs on: app load once authenticated; a debounced ~2s after any local mutation; the
`online` event; `visibilitychange` to visible; and a slow periodic poll (a few minutes) as a
backstop. Never per keystroke — note editing already commits on Enter/blur (`NoteEditor`), which is
the natural granularity.

A flush pushes every dirty record **first**, then every queued membership operation (see "Records
for most things, operations for membership" — an operation naming a list the server has not yet seen
is dropped), then pulls `GET /api/data` and applies it. Clear a dirty flag only for the exact version
that was acknowledged — a record edited again while the flush was out stays dirty, since the newer
version is still unsent — and leave dirty anything the server rejected, so the next flush recomputes
against merged state rather than retrying blindly.

Collapse the queue before pushing: a record superseded by a later edit to the same row pushes once,
with the final state; a create-then-erase highlight pair pushes as nothing at all; an add-then-remove
of the same sutta in the same list cancels. This is a local tidy, not a correctness requirement,
except for the highlight pair noted above.
