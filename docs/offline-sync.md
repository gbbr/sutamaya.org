# Offline sync

Lists, notes, highlights, visits and the put-aside set are written to a mirror on the device first
and synced to the server afterwards. **The local write is the durable one**: work done with no
network, or with no account, is kept rather than held for the server's approval.

This is the design, and the reference for any change to the mirror, the flush or the Worker's data
routes.

## How it flows

```
the reader acts ──▶ mirror (IndexedDB) ──push──▶ POST /api/data/push ──▶ D1
                         ▲                                              │
                         └───────pull─── GET /api/data (snapshot) ◀─────┘
```

Every edit changes the mirror at once and marks what it touched. A **flush** pushes whatever the
server hasn't seen, then pulls a fresh snapshot and folds it back in. The UI only ever reads the
mirror.

## Built for one reader

One person, a handful of their own devices, usually one. The failure that matters is **silent
loss** — offline work that never arrives, or an old device overwriting newer work — not two devices
editing the same thing in the same instant. So the design has four mechanisms against loss, and
none of the machinery true concurrent editing needs: no merging, no conflict screens, no delta sync.

## The four mechanisms

### Ids made on the device

A new list or highlight gets its id where it's made, so it can be renamed, filled or deleted before
the server has heard of it, and sending its create twice changes nothing. If the id already belongs
to another account, the server refuses it and the device picks a new one.

### A timestamp on every row

Each row carries an `mtime`: when the reader acted, plus a device id to break ties. It is stamped
**when the reader acts, never when the flush sends it**, so a note written offline on Monday still
loses to an edit made elsewhere on Wednesday. The server keeps a write only if it is newer than what
it holds. That is the whole of conflict resolution: **the last edit wins, per row.**

### Tombstones

A delete marks a row deleted instead of removing it. Otherwise a device that was offline at the
time would push its copy back and resurrect it. So every read has to skip tombstones.

### Records and operations

Most changes travel as **records**: the state something should be in — a list's name and parent, a
note, a highlight, a visit, the put-aside set. A record means the same thing however late it
arrives.

Three changes travel as **operations** instead, because they combine rather than overwrite: adding
or removing a sutta, reordering a list, and reordering the lists in a group. Two devices filing
different suttas into one list both stick. A posted order is reconciled against what exists: ids
that are gone are dropped, and members it didn't mention stay, at the end.

## Highlights

A highlight is **immutable**. Recolouring one is a delete plus a new highlight; erasing is a delete.
The device works out which highlights a new selection displaces — always whole ones — and names them
in the write, so replaying it later means the same thing.

### Anchored on segment keys

A highlight is one span between two points, each a segment key (SuttaCentral's own line id, such as
`mn10:2.7`) and a character offset. Everything between the two ends is covered, so a middle line
reworded upstream can't open a gap.

Keys rather than positions, because a position points at a different line as soon as the corpus
gains or loses one. Document order is read from the keys alone, which lets the mirror work out
overlaps with no text loaded; the corpus build refuses a document whose keys are out of order.

- Only the two ends can drift, by a few characters, when upstream rewords those lines.
- A highlight on a line that no longer exists paints nothing, but stays in the account and paints
  again if the line comes back.
- Overlapping highlights made on two devices are both kept; the newer one paints on top.
- A mirror from an older build, holding highlights by position, is converted to keys as each
  sutta's text loads. That stays for good: a reader who never signed in has no server copy to fall
  back on.

## The put-aside set

The suttas a reader has set aside travel as **one record holding the whole ordered set**, one per
account, rather than a row per sutta. A sutta leaves the set by being absent from a newer one, so
the set needs no tombstones: an older device pushing a stale set loses on `mtime` and resurrects
nothing. The trade is that the last edit wins over the whole set rather than per sutta.

Each entry remembers where its sutta was left as a segment key rather than a scroll offset, which
would mean nothing on another screen or under other typography, plus a percentage, so the bar can
say how far in it was on a device that has never loaded the text.

The set holds at most five, a cap written on both sides. Neither side ever drops a member to make
room: at the cap the app asks which tab should go, and the server's trim only catches a set that
arrived over-full.

## Lists repair themselves on read

Deleting a group marks only that one row. The tree is repaired every time it's read, on the server
and on the device alike:

1. a list whose parent doesn't exist moves to the top level;
2. a cycle, which two devices' moves can form together, is broken by moving its least recently
   changed list to the top;
3. everything under a deleted group goes with it;
4. siblings are put in order.

Every step is deterministic, so devices converge without talking to each other.

## On the device

- **The mirror** is one IndexedDB record per user id. Everything the UI shows is derived from it,
  the three automatic lists (Visited, Highlights, Notes) included, so those work offline too.
- **Signed out**, a reader gets a local id and a mirror of their own, and nothing syncs. Signing in
  moves the whole local mirror onto the account, each record keeping its timestamp. Where this
  device also holds the account's note on the same sutta, the two are joined rather than one
  replacing the other.
- **Signing out** deletes this device's copy and starts a fresh local id. The account's data is on
  the server; only unsynced work would be lost, which the button warns about.
- **Identity** — the last confirmed account is remembered, so an offline relaunch opens the right
  mirror. It's a cached identity, not a credential.

## The flush

It runs on launch, two seconds after an edit, on reconnecting, on returning to the app, and every
five minutes. Only one tab flushes at a time.

Everything owed goes out as one ordered queue: list records (oldest first, parents before
children), then notes, highlights, visits and the put-aside set, then operations in the order they
were made. It is sent ten items per request until empty, then one full snapshot comes back. **A
sync costs a couple of requests, however much is queued.**

Each item gets its own answer, and the push is deliberately **not atomic**: a refused item neither
undoes the ones before it nor holds up the ones after.

| Answer | To | What happens |
|---|---|---|
| ok | an item | done |
| not found | an item | the row is gone, so the write is moot and dropped |
| id collision | an item | the device picks a new id and sends again |
| any other refusal | an item | dropped and logged; the pull restores the server's version |
| 401 | the request | syncing pauses, queue intact, until the reader signs in again |
| 410 | the request | the account was deleted elsewhere; the device drops its copy and starts signed out |
| no network, 429, 5xx | the request | stop; the rest goes next time |

Folding the result back never loses a newer edit: a record turns clean only if it hasn't changed
since it was sent. Operations still waiting are replayed over the pulled data, so offline changes
don't flicker. Work that never left the device cancels out before it's sent — a list created then
deleted, a sutta added then removed, an order replaced by a newer one.

## Sync state

Settings spells it out: synced, waiting or offline, and when the last sync finished. Nothing else
in the app shows it, since waiting work is already safe on the device.

The exception is a lapsed session, when the app looks normal while nothing reaches the server. The
Library then shows a "Changes not syncing" banner until the reader signs in again. A write the
server refuses outright is never shown to the reader: it's a bug for a developer, with nothing for
the reader to decide.

## Rules a change must keep

1. **Stamp `mtime` when the reader acts**, never at flush time.
2. **Every read skips tombstones** — except the list read, which needs them to repair the tree.
3. **Every query is scoped `AND user_id = ?`**, reads, writes and existence checks alike. Nothing
   else separates one account's rows from another's.
4. **Records flush before operations**, since an operation can name a list a record creates.
5. **A record turns clean only against the exact `mtime` that was pushed.**
6. **A highlight is never updated.**
7. **A highlight write always names its own id and the ids it erases.**
8. **Cancelling unsent work checks whether it was sent, not whether it's dirty.** A write stays
   dirty through its round trip, so cancelling on "dirty" drops a delete the server never gets.
9. **Queued reorders stay ahead of later local edits to the same rows**, which share one timestamp.
10. **Tree repair is deterministic**, whatever order the rows arrive in.
11. **The mirror is keyed by user id**, so switching accounts can't cross-write.
12. **The device's copies of the server's tree repair and automatic lists agree with the
    originals.** No module is shared between the two workspaces; `portParity.test.ts` and
    `autoLists.test.ts` catch drift.
13. **Changing what the mirror stores bumps its IndexedDB version**, in the same change. The
    upgrade wipes the store and re-pulls rather than migrating.
14. **The put-aside set stays one record.** Needing no tombstones rests on a removal being "the
    newer set doesn't list it"; a row per sutta would need a `deleted` column that every read skips.

## Accepted losses

- **A conflicting edit loses silently.** The later timestamp wins, with no merge and no conflict
  screen. The realistic case is one person editing the same note on two devices, where the losing
  side is almost always the stale one.
- **Order is last-edit-wins per list or group.** Two devices reordering the same thing offline
  means one order wins, and the reader drags again.
- **Adding and removing the same sutta resolves by arrival order**, not by timestamp.
- **The put-aside set collides as a whole.** Two devices each setting a sutta aside offline means
  one set wins and the other tab is gone; reopening that sutta is one tap.
- **A write to a row deleted elsewhere is dropped.**
- **The automatic lists show the newest 100 visits and 300 notes or highlights**, and say so at the
  foot. Nothing past the cap is lost.
- **Deleting the account discards what other devices hadn't synced yet.**
- **A device offline for months has to sign in again** (sessions last 90 days); its queue waits.
- **Signed-out work lives only on that device.** Clearing site data loses it, and so does leaving
  an iOS browser tab unopened for about a week — installed apps are exempt. The app says so.
- **A highlight's two ends can move a few characters** when upstream rewords those lines.

## Where to look

| Where | What |
|---|---|
| `web/src/lib/mirror.ts` | the mirror, and every change to it |
| `web/src/lib/sync.ts` | the flush |
| `web/src/lib/mirrorView.ts`, `listTree.ts` | what the UI sees; tree repair |
| `web/src/lib/mirrorDb.ts` | storage in IndexedDB |
| `web/src/lib/putAside.ts` | the put-aside set and its cap |
| `web/src/lib/highlights.ts`, `segmentKeys.ts` | overlaps and painting; key order |
| `web/src/context/UserDataContext.tsx` | when the flush runs; the sync state |
| `worker/src/routes/data.js` | the snapshot and the push |
| `worker/src/lib/writes.js` | every write |
| `worker/src/lib/userData.js`, `listTree.js` | shaping the snapshot; tree repair |
