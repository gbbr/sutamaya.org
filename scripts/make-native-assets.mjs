// Regenerates web/assets/ — the source images @capacitor/assets crops into the iOS and Android
// icon and splash sets — from the production PWA icons under web/public/icons/. Run this, then
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
const icons = resolve(root, 'web/public/icons');
const out = resolve(root, 'web/assets');
mkdirSync(out, { recursive: true });

// The shell's dark ground (lib/themeColor.ts SHELL_DARK), used behind the icon and as the splash.
const GROUND = '#171513';
const src = (name) => resolve(icons, name);
const dst = (name) => resolve(out, name);

// Full-bleed icon (Android legacy) — the production mark upscaled, opaque.
await sharp(src('icon-512-v2.png')).resize(1024, 1024, { fit: 'cover' }).png().toFile(dst('icon-only.png'));

// iOS icon — the diagonal leaf an iOS home screen already shows for the web app (apple-touch-icon),
// which @capacitor/assets uses in place of icon-only on iOS. The artwork exists only at the home
// screen's 180px, so this master is an upscale: sharp on the device, soft on an App Store listing.
mkdirSync(dst('ios'), { recursive: true });
await sharp(src('apple-touch-icon.png')).resize(1024, 1024, { fit: 'cover' }).png().toFile(dst('ios/icon.png'));

// Android adaptive foreground — the maskable variant, which already carries the safe-zone padding —
// and a flat background in the shell's dark ground.
await sharp(src('icon-512-maskable-v2.png')).resize(1024, 1024, { fit: 'cover' }).png().toFile(dst('icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: GROUND } }).png().toFile(dst('icon-background.png'));

// Splash — a flat dark ground, nothing else: Android 12+ draws the launcher icon over its own
// splash background (capacitor.config.ts), and on iOS the app's own loading screen (App.tsx's
// <Splash>) paints within a frame of this one. A solid colour compresses to almost nothing. 2732²
// is the size @capacitor/assets requires.
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: GROUND } }).png().toBuffer();
await sharp(splash).toFile(dst('splash.png'));
await sharp(splash).toFile(dst('splash-dark.png'));

console.log('wrote web/assets/{icon-only,icon-foreground,icon-background,splash,splash-dark,ios/icon}.png');
