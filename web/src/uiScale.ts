// Scales the entire UI uniformly. Not a user-facing setting — edit this constant directly and
// reload to change it. 1 = 100% (default), 1.15 = 15% larger, 0.9 = 10% smaller, etc.
//
// Uses CSS `zoom` (applied to <html> in main.tsx) rather than a root font-size trick, because
// this app leans heavily on literal px values in Tailwind arbitrary classes (`text-[16px]`,
// `w-[11px]`, ...) which don't scale with a rem-based root font-size — `zoom` rescales
// everything uniformly (px, rem, flex/grid layout, `dvh`-based panes) the way a browser's own
// page-zoom does. Supported in Chromium and Safari; no effect in Firefox.
export const UI_SCALE = 1.0;
