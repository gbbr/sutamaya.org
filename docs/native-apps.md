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
| Status bar / safe area | edge-to-edge | see below |
| Android back button | handled | see below |
| Reader text selection (Android) | `selectionchange`-driven | see below |

### Session token

`signSessionToken` (`worker/src/session.js`) mints an HMAC-signed `{ uid, t }` on the same primitive
as the OAuth state, checked against a 90-day max age with **sliding re-issue** — a token past
halfway comes back re-minted on the `X-Session-Token` response header. `/email/verify` returns the
token in its JSON body; `/google/start?app=1` marks the flow native and its callback returns
`sutamaya://auth?token=…` instead of setting a cookie. No database, no revocation table; an expired
token falls into the existing `needsReauth` path. Web is untouched — still the browser-enforced
cookie.

`AuthContext.signInWithGoogleNative` drives `@capacitor/browser` + the `@capacitor/app` `appUrlOpen`
deep link; `forgetAccount` clears the stored token, covering sign-out, deletion and the 410 reset.
Every native branch is gated on `isNativeApp()` and inert on web.

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

## The shell

- **Plugins:** `@capacitor/{app,browser,preferences,status-bar,splash-screen,filesystem,share}`.
- **Deep link:** custom scheme `sutamaya://auth`, registered in `web/ios` (`CFBundleURLTypes`) and
  `web/android` (an `intent-filter` on the singleTask activity). Android also has an `autoVerify`
  App Links `intent-filter` for `https://app.sutamaya.org`, verified against
  `/.well-known/assetlinks.json` (`worker/src/wellKnown.js`, listed in `run_worker_first`), so
  shared reader links open the app.
- **Icons and splash:** `scripts/make-native-assets.mjs` derives `web/assets/` (git-ignored) from
  the production PWA icons; `npx @capacitor/assets generate --ios --android` crops them into the
  committed native resources. The splash is a flat `#171513` screen — `main.tsx` calls
  `SplashScreen.hide()` on first paint, handing over to the app's own `<Splash>`.

## Build and run

```
npm run build:native       # corpus + web bundle (service worker off), then cap sync into ios/android
npm run build:native -- --no-sync   # stop at the bundle — no Xcode / Android SDK needed (CI, OTA)
npm run dev:ios            # Worker + web dev server, then the app in live-reload against them
npm run dev:android        # same, Android
npm run dev:native         # both at once (heavy)
```

`dev:ios` / `dev:android` load the WebView from `localhost:5173`, so `/api/*` is same-origin and
rides Vite's proxy to the Worker — no CORS, and Google sign-in works because the round trip stays on
`localhost` (Android maps it with `adb reverse` via `--forwardPorts`). They pass `--no-sync` to
`cap run` and never rebuild the bundle, so `build:native` has to have run once. They auto-pick the
booted simulator/emulator; with none booted they print the available names.

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
  the SPA shell.

## Status

Phases 0–3 are done: the platform seam, the bearer-token auth path, the two native projects, and
the shell (back button, safe area, splash, icons, offline UI, text selection). Both projects build;
all of it was checked on the simulator and emulator. `assetlinks.json` is live and valid on staging;
the prod deploy, the Play-signing fingerprint and the on-device App Links check are Phase 5 (below).
One pass of the whole app offline against a bundled build is still worth doing.

## Remaining work

### Phase 4 — Over-the-air updates

Self-host `@capgo/capacitor-updater` on Cloudflare (an R2 bucket plus a version-check endpoint) to
push web and corpus changes without a store release; rollback-on-failed-boot comes with it. It
ships in the first binary so it can be tested before submission. Bundle format and check cadence:
decide with Gabriel.

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
- iOS (needs the enrolled Apple Team ID): serve `/.well-known/apple-app-site-association` —
  `applinks` with `<TeamID>.org.sutamaya.app`, `components` excluding `/api/*`; sketch is in
  `wellKnown.js`, not served until the Team ID is real since iOS caches a wrong association.
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

CI native build jobs; a version-bump script across web + iOS + Android; the OTA update channel's
build and staged-rollout controls.

## Left open

- Whether `text-shards/` (the bulk-download shard bundles) stays excluded from the native bundle.
- CI runner for native builds — GitHub-hosted macOS, self-hosted, or a cloud build service.
- The OTA updater's bundle format and version-check shape — with Gabriel in Phase 4.
- Splash and icon art beyond the current derived set.
