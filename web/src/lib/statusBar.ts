import { StatusBar, Style } from '@capacitor/status-bar';
import { isNativeApp } from './platform';

// Keeps the native status bar's text and icons legible against whatever currently sits behind them —
// the shell's light/dark theme, or the reader's own background (lib/themeColor.ts drives both). The
// app's theme is its own setting, independent of the OS's, so the bar can't be left to follow the
// system. Inert on web, where `<meta name="theme-color">` governs the OS chrome instead.
//
// The plugin is imported statically: a Capacitor plugin behind a dynamic import can deadlock in the
// WebView when it is reached on the startup path, which this is (main.tsx applies the theme before
// React mounts).

let current: boolean | null = null;

export function setNativeStatusBarDark(dark: boolean): void {
  if (!isNativeApp() || dark === current) return;
  current = dark;
  // Style.Dark is light-on-dark text; Style.Light is dark-on-light.
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {
    // The bar keeps its current style; a later theme change tries again.
    current = null;
  });
}
