// Regenerates web/assets/ — the source images @capacitor/assets crops into the iOS and Android
// icon and splash sets — from the icon masters in design/. Run this, then
//   cd web && npx @capacitor/assets generate --ios --android
// whenever the mark changes. The `--ios --android` flags keep it off the PWA assets, which
// vite-plugin-pwa owns (web/vite.config.ts).
//
// web/assets/ is git-ignored: it is derived. The generated native resources under web/ios/ and
// web/android/ are what's committed.
//
// Uses `sharp`, which ships with the @capacitor/assets dev dependency.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const masters = resolve(root, 'design');
const out = resolve(root, 'web/assets');
mkdirSync(out, { recursive: true });

// The shell's dark ground (lib/ui/themeColor.ts SHELL_DARK), used behind the icon and as the
// splash.
const GROUND = '#171513';
const dst = (name) => resolve(out, name);

// Android legacy icon: the upright leaf, full bleed.
await sharp(resolve(masters, 'icon-android.jpg')).resize(1024, 1024, { fit: 'cover' }).png().toFile(dst('icon-only.png'));

// iOS icon: the diagonal leaf at 90%, its background stretched back to the edges
// (docs/native-apps.md's "Icons"), which @capacitor/assets uses in place of icon-only on iOS.
mkdirSync(dst('ios'), { recursive: true });
await sharp(resolve(masters, 'icon-ios.jpg'))
  .resize(920, 920)
  .extend({ top: 52, bottom: 52, left: 52, right: 52, extendWith: 'copy' })
  .png()
  .toFile(dst('ios/icon.png'));

// Android adaptive icon: the upright leaf at 90%, its background stretched back to the edges, over a
// flat background in the shell's dark ground (docs/native-apps.md's "Icons").
await sharp(resolve(masters, 'icon-android.jpg'))
  .resize(920, 920)
  .extend({ top: 52, bottom: 52, left: 52, right: 52, extendWith: 'copy' })
  .png()
  .toFile(dst('icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: GROUND } }).png().toFile(dst('icon-background.png'));

// Splash — a flat dark ground, nothing else: Android 12+ draws the launcher icon over its own
// splash background (capacitor.config.ts), and on iOS the app's own loading screen (App.tsx's
// <Splash>) paints within a frame of this one. A solid colour compresses to almost nothing. 2732²
// is the size @capacitor/assets requires.
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: GROUND } }).png().toBuffer();
await sharp(splash).toFile(dst('splash.png'));
await sharp(splash).toFile(dst('splash-dark.png'));

console.log('wrote web/assets/{icon-only,icon-foreground,icon-background,splash,splash-dark,ios/icon}.png');
