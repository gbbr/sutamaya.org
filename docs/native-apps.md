# Native apps

The iOS and Android apps are the web build wrapped in [Capacitor](https://capacitorjs.com). There is
one codebase: every difference from the web app is a runtime branch on `isNativeApp()`
(`web/src/lib/platform.ts`), never a parallel implementation. The whole corpus is in the bundle, so
the app reads offline from its first launch, with no service worker.

`web/ios/` and `web/android/` are committed Capacitor projects, configured by
`web/capacitor.config.ts` (app id `org.sutamaya.app`).

## How it differs from the web app

| | Web | Native |
|---|---|---|
| Offline store | the service worker's caches | the bundle itself; no service worker |
| API | the same origin | `https://app.sutamaya.org`, or staging's |
| Session | an HttpOnly cookie | a signed token, kept in the app's preferences and sent as a bearer header |
| Google sign-in | a page redirect | the system browser, returning through a `sutamaya://auth` link |
| Offline download | offered | hidden — the corpus is already bundled |
| Data export | a download | the OS share sheet |
| Reader's Share button | the installed app only | always |
| Updates | the service worker | over-the-air bundles (below) |
| Android back button | — | closes what's open, then leaves Settings and Help, then backgrounds the app |

The app runs edge to edge on both platforms, keeping its bars inside the safe-area insets, and sets
the status bar's text colour from its own theme. On Android the highlight popup opens from the
selection itself, since the WebView reports no usable end to the touch.

## Signing in

The token lasts 90 days and is re-issued by the server once it's past halfway, so an app in use
stays signed in. A sign-in flow asks for one with `?app=1`; without it, nothing changes for the web.
The Google return is handled whenever it lands — even after the browser sheet was closed, or after
the OS killed the app mid-flow — so a sign-in can't be lost to timing.

## Over-the-air updates

The bundle, web code and corpus alike, can be replaced without a store release:

1. `npm run release:ota -- --env staging|production` builds the bundle, uploads its zip to that
   environment's R2 bucket, points `OTA_VERSION` and `OTA_CHECKSUM` in `wrangler.jsonc` at it, and
   deploys. The zip goes up first, so no device is ever told about a bundle that isn't there.
2. Each time the app comes to the foreground, it asks the Worker for the current version. When that
   differs, it downloads the zip in the background, checks its hash, and swaps it in the next time
   the app is backgrounded — the reader meets it on the next launch.
3. On every launch the app confirms the bundle started: `notifyBundleReady()` is the first thing
   `main.tsx` does. A bundle that hasn't confirmed within 10 seconds is rolled back.

A plain web deploy leaves the native apps on their bundle, and says so; they move when
`release:ota` runs. Staging and production are separate channels, and what is live is a committed
line in `wrangler.jsonc`.

### The native floor

Some web changes need a matching native change — a new plugin, a permission, a new link path — and
would break an older binary. So:

- `native-release.json` records the build in the stores: its number, the commit it was built from,
  and the **floor**, the oldest build able to run bundles from that commit.
- `release:ota` copies the floor into `OTA_MIN_NATIVE`, and the Worker withholds the bundle from any
  binary below it.
- `release:ota` refuses to publish when the native projects have changed since that commit — the
  Capacitor config, the manifests, the Xcode project, the Gradle build, the plugin list — unless run
  with `--allow-native-drift` for a change that can't reach the bundle.

A store release updates `native-release.json`: always the build and the commit, and the floor too
when it adds a native piece.

## Links into the app

- `sutamaya://auth` carries a Google sign-in back to the app.
- Links to `/`, `/browse/*`, `/read/*`, `/settings` and `/help` on `https://app.sutamaya.org` are
  verified to open the app; `/api/*` isn't, so sign-in finishes in the browser that started it. The
  path list is written twice, in the Android manifest and in `worker/src/wellKnown.js`, which serves
  the verification files. iOS's is served only once `APPLE_TEAM_ID` is set.

## Building and running

```
npm run build:native                     # corpus and bundle, synced into web/ios and web/android
npm run build:native -- --env staging    # the same, calling staging's Worker
npm run build:native -- --no-sync        # the bundle only; no Xcode or Android SDK needed
npm run dev:ios                          # the app with live reload, against local servers
npm run dev:android                      # the same on Android; dev:native runs both
npm run devices                          # every simulator, emulator and device, numbered
```

`build:native` has to have run once before the dev commands, which reuse its projects.

- **Which device:** a booted simulator or running emulator, by default. `IOS_DEVICE` and
  `ANDROID_DEVICE` name another, by its number in `npm run devices` or part of its name; an Android
  emulator that isn't running gets booted.
- **Signing in during development:** simulators and emulators load `localhost:5173`, where Google
  sign-in works. A physical iPhone or iPad loads this machine's LAN address, which Google refuses —
  sign in there with an emailed code.
- **A physical iPhone** is built and installed with `xcodebuild` and `devicectl` rather than
  `cap run`, which can't see a phone paired over the network.
- **A bundled build calls production** unless built with `--env staging`, or `SUTAMAYA_API_BASE`
  names another Worker, such as a local one. Whichever it calls needs the current auth code, or
  native sign-in returns to the website.

## Icons

Each app's icon is the artwork the web app already shows on that platform's home screen: iOS takes
the diagonal leaf of the web app's `apple-touch-icon`, Android the upright leaf of its manifest
icons, with the maskable one as the adaptive icon's foreground. Both are generated from
`web/public/icons/`, never drawn by hand; `scripts/make-native-assets.mjs` says how.

The diagonal leaf exists only at home-screen size, so the large master iOS asks for is an upscale:
sharp on the device, soft on an App Store listing.

## Rules that bite

- **A Capacitor plugin used at startup is imported statically**, never with `await import()`, which
  can deadlock the WebView. Only plugins reached from a tap — the browser sheet, sharing, files —
  load dynamically.
- **The WebView's origins** (`capacitor://localhost` on iOS, `https://localhost` on Android) must be
  allowed by the Worker's CORS, or every signed-in request fails.
- **`/.well-known/*` stays in `assets.run_worker_first`**, or the verification files come back as
  the app shell.
- **`notifyBundleReady()` runs first on every launch.** Put it behind anything that can stall, and
  every update rolls back.

## Not done yet

- **Store submission:** developer accounts, signing, listings, privacy questionnaires, screenshots,
  a reviewer account, the iOS icon at full resolution. Budget for one Apple rejection under
  guideline 4.2; the app already reads offline from launch and signs in through the system browser.
  Sign in with Apple only if a reviewer asks — the emailed code already meets guideline 4.8.
- **Verified links in production:** add the Play signing certificate to `worker/src/wellKnown.js`
  and check App Links on a device; set `APPLE_TEAM_ID` and add the Associated Domains entitlement
  for iOS. The Google return can then use a verified link instead of `sutamaya://auth`.
- **Release plumbing:** native builds in CI, one script bumping the version across web, iOS and
  Android (the floor assumes their build numbers move together), and a staged rollout for updates.
- **macOS:** the iOS app can run on Apple-silicon Macs as "Designed for iPad" at no extra cost; a
  real Mac app is a later decision.

## Known gaps

- **An update is the whole bundle — about 23 MB — never a delta.** A one-line fix re-ships
  everything, as one background download.
- **The bundle carries the offline-download shards**, over a quarter of its unpacked size, which
  only the web app uses.
- **The session token goes into device backups.** It sits in the app's preferences beside the mirror
  it protects, so a restore carries both; the token's 90-day life bounds it.
