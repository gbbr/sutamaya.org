# Sutamaya on iOS and Android

The native apps are the web build wrapped in a [Capacitor](https://capacitorjs.com) shell. One
codebase serves web, iOS and Android; the whole corpus is bundled, so the app reads offline from
first launch with no service worker. The recurring cost is release mechanics — two native projects,
two store listings, Apple's fee — not divergent app code.

`web/ios/` and `web/android/` are committed. `web/capacitor.config.ts` (`appId org.sutamaya.app`,
`webDir dist`) configures both; `npx cap sync` copies the latest `web/dist` into them.

## Where the native build differs from web

Every difference is a runtime branch inside a shared file, never a parallel implementation. The one
new module is `web/src/lib/platform.ts`.

| Concern | Native | How |
|---|---|---|
| Content (`/data/*`, fonts, shell) | identical | Capacitor serves the bundle at the same relative paths |
| Service worker | off | `SUTAMAYA_NATIVE=1` build flag disables `vite-plugin-pwa`; `registerSW()` is a no-op |
| API base URL | `https://app.sutamaya.org` | `API_BASE` in `lib/platform.ts` — `''` on web, consumed by the one `request()` in `lib/api.ts` |
| Session credential | bearer token | server reads `Authorization: Bearer` or the cookie via `readSession`; client keeps the token in `@capacitor/preferences` (`lib/nativeAuth.ts`) |
| `isNativeApp()` / `platformName()` | true / `'ios'`\|`'android'` | `lib/platform.ts`, off the injected `Capacitor` global |
| Offline download UI | hidden | `HeaderBanner` drops both nudges; `SettingsPage`'s Offline card is a one-line placeholder |
| Data export | OS share sheet | `lib/exportData.ts` fetches the payload with the token, writes it to the cache directory and shares the file; the browser downloads `dataApi.exportUrl` as a link |
| Reader's Share button | shown | `lib/share.ts` opens `@capacitor/share` with the sutta's `https://app.sutamaya.org/read/…` link; an installed PWA shows it too, through `navigator.share`; a browser tab hides it, its address bar already shares |
| Status bar / safe area | edge-to-edge | see below |
| Android back button | handled | see below |
| Reader text selection (Android) | `selectionchange`-driven | see below |
| App updates | over-the-air bundle | `@capgo/capacitor-updater` pulls new web + corpus bundles from the Worker; the browser updates through the service worker. See below |

### Session token

`signSessionToken` (`worker/src/session.js`) mints an HMAC-signed `{ uid, t }` on the same primitive
as the OAuth state, checked against a 90-day max age with **sliding re-issue** — a token past
halfway comes back re-minted on the `X-Session-Token` response header. `?app=1` is what marks a flow native, on both
routes: `/email/verify?app=1` returns the token in its JSON body, and `/google/start?app=1` has its
callback return `sutamaya://auth?token=…` instead of setting a cookie. No database, no revocation
table; an expired token falls into the existing `needsReauth` path. Without that signal no token is
issued, so web is untouched — still the browser-enforced cookie.

`AuthContext.signInWithGoogleNative` only opens `@capacitor/browser`. The return is owned by an
`appUrlOpen` listener registered for the app's whole life, plus an `App.getLaunchUrl()` check —
the token is valid whenever it lands, so a return that arrives after the sheet has closed, or that
cold-starts an app the OS killed mid-flow, still signs the reader in. The sheet closing decides
nothing; it only drops the button out of its pending state. `forgetAccount` clears the stored token,
covering sign-out, deletion and the 410 reset. Every native branch is gated on `isNativeApp()` and
inert on web.

### Status bar and safe area

Both platforms run edge-to-edge. iOS populates `env(safe-area-inset-*)` under `viewport-fit=cover`;
Capacitor's built-in `SystemBars` injects `--safe-area-inset-*` on `<html>` for older Android
WebViews. `index.css` folds the two into `--safe-top/right/bottom/left`, and every top bar and
full-screen surface reads those. `@capacitor/status-bar` sets the bar's text colour from the app
theme (`lib/statusBar.ts`, driven from `lib/themeColor.ts`) — the app's theme is its own setting,
not the OS's.

### Android back button

`web/src/lib/backButton.ts` is a stack of dismiss actions; overlays and sub-views push onto it
while open via `useBackHandler(active, onBack)` — the reader's layered close, the shortcuts modal
and mobile list→tree step, the library search, the list-membership popover. `useAndroidBackButton`
(mounted once in `App`) runs the top action, then routes Settings/Help to `/`, then
`App.minimizeApp()`. Never `exitApp()`. The stack is inert on web and iOS.

### Android reader text selection

Android's WebView commits a selection through its own `ActionMode` bar and fires no usable
`touchend`, so `useHighlightPopup` opens the colour popup from `selectionchange` once the pointer is
up. The native Copy/Share bar shows alongside it.

### Over-the-air updates

The native binary carries the whole app — web bundle and corpus — but that bundle is replaceable
without a store release. `@capgo/capacitor-updater`, configured in `capacitor.config.ts`, POSTs to
`/api/updates/check` on the Worker each time the app foregrounds; when the returned `version`
differs from the running bundle it downloads the zip in the background and swaps it in the next
time the app is backgrounded (`autoUpdate: 'atBackground'`), so the reader meets it on the next
cold start with no visible reload. The download is verified against the SHA-256 the check returned.
`statsUrl` is emptied so nothing is sent to Capgo's hosted backend — only `updateUrl`, which is
ours, is used.

`main.tsx` calls `notifyBundleReady()` (`lib/otaUpdate.ts`) at first paint. This is load-bearing:
until it runs the plugin treats the running bundle as provisional, and if `appReadyTimeout`
(10 s) elapses first it rolls the device back to the previous bundle. It guards the built-in
bundle too, so it runs on every native launch.

Worker side: `worker/src/routes/updates.js` serves the check and streams the bundle from an R2
bucket (`OTA_BUCKET`) at `/api/updates/bundle/*`, `immutable`-cached since the filename carries
the version. The live bundle is named by the `OTA_VERSION` / `OTA_CHECKSUM` vars in
`wrangler.jsonc`, one pair per environment — so staging and production are separate channels, and
"what is live" is a line in a committed diff. Empty vars mean the check reports no update.

**Native-version floor.** A third var, `OTA_MIN_NATIVE`, is the native build number below which
the current bundle is withheld — the check reads `version_code` from the request (the plugin sends
it as the build number on both platforms) and returns nothing when the device is under the floor
or sends no readable version. It exists for the one case OTA can't safely cover on its own: a web
change that needs a matching native piece — a new Capacitor plugin, a permission, a new
deep-link path. That release bumps the native build number *and* `OTA_MIN_NATIVE` together, so
binaries without the native half stop pulling bundles they can't run and wait for a store update.
An OTA-only release never touches it; empty means no floor. It assumes iOS and Android build
numbers move in lockstep — Phase 6's version-bump script is what keeps them there.

Publishing is `npm run release:ota -- --env production|staging`: it builds the bundle
(`build-native.mjs --ota` → `web/ota/`), uploads the zip to R2 **first**, rewrites the two vars,
then runs the environment's deploy — so a device is never pointed at a bundle that isn't there
yet. It is a superset of `deploy:prod`; a plain `deploy:prod` ships the web app and leaves native
readers on the current bundle until a `release:ota` follows.

## The shell

- **Plugins:** `@capacitor/{app,browser,preferences,status-bar,splash-screen,filesystem,share}`,
  `@capgo/capacitor-updater`.
- **Deep link:** custom scheme `sutamaya://auth`, registered in `web/ios` (`CFBundleURLTypes`) and
  `web/android` (an `intent-filter` on the singleTask activity).
- **Verified links:** `/`, `/browse/*`, `/read/*`, `/settings` and `/help` on
  `https://app.sutamaya.org` open in the app; `/api/*` is outside the set, so the OAuth round trip
  finishes in the browser that started it. The set is written twice — as the `autoVerify`
  `intent-filter`'s path list in `web/android/app/src/main/AndroidManifest.xml`, and as
  `DEEP_LINK_PATHS` in `worker/src/wellKnown.js`, which serves both
  `/.well-known/assetlinks.json` (Android, live) and `/.well-known/apple-app-site-association`
  (iOS, answered only once `APPLE_TEAM_ID` is set). Both are listed in `run_worker_first`.
- **Icons and splash:** `scripts/make-native-assets.mjs` derives `web/assets/` (git-ignored) from
  the production PWA icons; `npx @capacitor/assets generate --ios --android` crops them into the
  committed native resources. The splash is a flat `#171513` screen — `main.tsx` calls
  `SplashScreen.hide()` on first paint, handing over to the app's own `<Splash>`.

## Build and run

```
npm run build:native       # corpus + web bundle (service worker off), then cap sync into ios/android
npm run build:native -- --no-sync   # stop at the bundle — no Xcode / Android SDK needed (CI, OTA)
npm run build:native -- --ota       # also zip the bundle to web/ota/ for an OTA release (implies --no-sync)
npm run release:ota -- --env staging      # build, upload to R2, point wrangler.jsonc at it, deploy
npm run release:ota -- --env production   # the same, to production
npm run dev:ios            # Worker + web dev server, then the app in live-reload against them
npm run dev:android        # same, Android
npm run dev:native         # both at once (heavy)
```

All three run through `scripts/dev-native.mjs`, which picks the target **before** starting anything,
then runs the Worker, the web dev server and one launcher per platform under `concurrently`. The order
matters: `SUTAMAYA_API_BASE` is a build-time define fixed when Vite boots, and which address the app
has to call depends on the target. Picking first also means an ambiguous or unreachable target fails
with a picklist rather than after two servers have come up. They pass `--no-sync` to `cap run` and
never rebuild the bundle, so `build:native` has to have run once.

**A booted simulator/emulator is the default**, so the everyday run needs no arguments. Anything else
is named with `IOS_DEVICE` — an index, or enough of the name to be unambiguous — which also wins over
a booted simulator, so a simulator stays one variable away on a day of device testing:

```
npm run devices                       # every target, indexed, both platforms — starts nothing
IOS_DEVICE=0 npm run dev:ios          # by index, as listed
IOS_DEVICE="Gabriel's iPhone" npm run dev:ios    # by name; a fragment matching one target is enough
```

A fragment matching several targets (`IOS_DEVICE=iPad`, or a name shared by a phone and a tablet)
prints the ones it matched and stops, rather than guessing. With nothing booted and no variable set,
the whole list is printed and nothing starts.

**A simulator or emulator loads `localhost:5173`** — both reach this machine's loopback (Android
through `adb reverse`, via `--forwardPorts`) — and Google sign-in works there, `localhost` being the
one host Google accepts as an OAuth redirect. One dev server serves the whole session, so a
`dev:native` run that includes a physical device puts *both* platforms on the LAN address below.

**A physical iPhone or iPad loads this machine's current LAN IP**, read on every run, so no address is
ever hardcoded and moving between networks costs nothing; it needs the device on the same network as
the Mac, as Xcode does. Google sign-in does *not* work there — Google rejects a bare IP as a redirect
host, and a `.local` name too — so sign in with an emailed code instead (`RESEND_API_KEY` in
`.dev.vars`). A real hostname is the only fix, and that is the Caddy setup in `docs/deploy.md`'s
"Testing on mobile".

**A device is built and installed by the launcher itself** — `xcodebuild`, then `xcrun devicectl` to
install and launch — not by `cap run`. Capacitor hands device installs to `native-run`, whose path is
the legacy usbmux one (DeveloperDiskImage mount, AFC upload, `installation_proxy`) that modern iOS has
moved off: it cannot see a device paired only over the network, and is several times slower when it
can. `devicectl` is the CoreDevice path Xcode itself uses. It builds into the same derived-data
directory `cap run` uses, so both paths share one incremental build. Simulators still go through
`cap run`, which handles them well.

A bundled build under test (not live-reload) points `SUTAMAYA_API_BASE` at a Worker that has the
current auth code — `http://localhost:8787` for local, or a staging/prod deploy. Without it the app
talks to production and native sign-in returns to the website instead of the app.

## Constraints that bite

- **A Capacitor plugin reached on the startup path is imported statically, never behind
  `await import()`** — such a chunk deadlocks in the WebView. `nativeAuth.ts`, `statusBar.ts`,
  `splash.ts` and `AuthContext` (`@capacitor/app`) import at the top; only `@capacitor/browser`,
  reached from a user gesture, stays dynamic.
- **The Android WebView's origin is `https://localhost`, iOS's `capacitor://localhost`.** Both,
  plus `http://localhost`, are in the Worker's `NATIVE_ORIGINS`; a missing one fails every
  authenticated request as an opaque CORS error.
- **`.well-known` paths must be in `assets.run_worker_first`** or the asset router answers them with
  the SPA shell. `/api/*` already is, so the OTA check and bundle routes need nothing added.
- **`notifyBundleReady()` must run on every native launch.** Skip it — or move it behind async work
  that can stall — and `@capgo/capacitor-updater` rolls every update back after `appReadyTimeout`,
  not just broken ones.
- **`OTA_VERSION` and `OTA_CHECKSUM` are set together or not at all.** The check treats either one
  missing as "nothing published"; `release:ota` always writes both. `OTA_MIN_NATIVE` is separate —
  it moves only with a store release that adds a native piece, and `release:ota` leaves it alone.

## Status

Phases 0–4 are done: the platform seam, the bearer-token auth path, the two native projects, the
shell (back button, safe area, splash, icons, offline UI, text selection), and the over-the-air
update channel (self-hosted on R2, silent, rollback on a bundle that never signals ready). Both
projects build; all of it was checked on the simulator and emulator. `assetlinks.json` is live and
valid on staging; the prod deploy, the Play-signing fingerprint and the on-device App Links check
are Phase 5 (below). Still worth doing: one pass of the whole app offline against a bundled build,
and the on-device OTA update + rollback check (needs the R2 buckets created and a staging deploy).

## Remaining work

### Phase 5 — Store submission

Developer accounts, signing, listings, privacy and data-safety questionnaires, screenshots, a
reviewer demo account (an emailed code). Budget one Apple rejection under guideline 4.2 and a
written reply; the mitigations are already in place (whole canon at first launch, works in airplane
mode, sign-in in a native browser sheet, no browser chrome).

The **deep-link tail** lands here:

- Android: deploy the Worker to prod so `/.well-known/assetlinks.json` is reachable at the host the
  manifest claims, append the Play-managed signing cert's SHA-256 to `ANDROID_CERT_FINGERPRINTS`
  (`wellKnown.js`), then on a device `adb shell pm verify-app-links --re-verify org.sutamaya.app` /
  `pm get-app-links` should report `verified`, and a `https://app.sutamaya.org/read/…` link should
  open the app.
- iOS: set `APPLE_TEAM_ID` in `wrangler.jsonc` once the account is enrolled, which is all that
  `/.well-known/apple-app-site-association` waits on, and add the Associated Domains entitlement
  (`applinks:app.sutamaya.org`) to the Xcode project.
- Switch the OAuth return from `sutamaya://auth` to a verified Universal/App Link on both platforms.
- Real-device checks: `/read/…` links opening the installed iOS app; whether the mirror survives
  OS-level eviction (iOS offload, Android archive) + reinstall.

Sign in with Apple only if a reviewer requires it — the emailed-code sign-in already meets
guideline 4.8 (name + email only, email can be kept private, no ad tracking).

**macOS** rides along free: "Designed for iPad" is Apple's name for running the unmodified iOS
binary on Apple-Silicon Macs in a resizable iPad-style window — left enabled at submission, the app
appears on the Mac App Store with no extra work. A proper Mac Catalyst app — menu bar, window
management, pointer and keyboard — is a separate post-launch decision. `lib/platform.ts`'s
`Platform` type is left open for `'macos'`.

### Phase 6 — Release plumbing

CI native build jobs; a version-bump script across web + iOS + Android; staged-rollout control for
the OTA channel (another `wrangler.jsonc` var plus bucketing on a stable device id in
`updates.js` — still no KV).

## Known gaps / deliberate simplifications

- **An OTA bundle is the whole app — web build and corpus, ~15 MB compressed — never a delta.**
  The plugin supports partial downloads via a `manifest`; the check endpoint doesn't emit one.
  A corpus typo fix therefore re-ships everything. Accepted: it is one background download per
  update, on Wi-Fi or cell at the OS's discretion, and the bundle swaps atomically rather than
  draining document-by-document the way the browser's revalidating cache does.
- **A web change that needs a matching native change must not go out as OTA alone.** A new
  Capacitor plugin, a permission, a deep-link path — push the web half to an old binary and the
  app breaks. Those go through a store release first, then OTA. `release:ota` ships whatever the
  working tree holds and can't detect this; the `OTA_MIN_NATIVE` floor (above) is the guard, but
  it's opt-in — you have to remember to raise it in the same release, and until you do a bad
  bundle reaches every device. A store update always resets a device to its built-in bundle, so a
  bad OTA stays recoverable.
- **The session token rides a device backup.** It is kept in `@capacitor/preferences` —
  UserDefaults on iOS, SharedPreferences on Android under `allowBackup="true"` — so an iCloud or
  Auto Backup restore carries it. The Keychain is not the answer: the mirror it authenticates sits
  unencrypted in that same container, so a credential held apart from it protects nothing the data
  does not already expose. What a backup adds is reach rather than exposure — a restored token
  reaches the live account, not just a snapshot — bounded by the token's 90-day expiry and by the
  backup being the reader's own. Excluding the store from backup is the fix if that stops holding.

## Left open

- Whether `text-shards/` (the bulk-download shard bundles) stays excluded from the native bundle.
- CI runner for native builds — GitHub-hosted macOS, self-hosted, or a cloud build service.
- Splash and icon art beyond the current derived set.
