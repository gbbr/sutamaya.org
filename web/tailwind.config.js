/** @type {import('tailwindcss').Config} */
export default {
  // Compiles every `hover:` utility inside `@media (hover: hover)`, so none of them apply on a
  // touch screen. Without it iOS Safari's tap-lingers-as-hover quirk leaves the hover state stuck
  // on whichever element ends up under the tap point — most visibly when a row is removed from a
  // list and the row that slides up into its place inherits the red delete-icon hover.
  // index.css does the same thing by hand for `.pw`, which this doesn't cover (a raw CSS rule,
  // not a Tailwind utility).
  future: { hoverOnlyWhenSupported: true },
  // Toggled by adding/removing a `dark` class on <html> — see lib/uiPrefs.ts's applyTheme().
  // Not 'media': the app has its own explicit Settings > Theme control (light/dark/system), and
  // 'system' resolves to the OS preference itself rather than relying on Tailwind's built-in
  // media-query variant, so the toggle needs to be class-driven either way.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // rgb(var(--x) / <alpha-value>) (rather than a plain hex/rgb literal) is what makes every
        // existing bg-ink/text-ink/[.NN]/border-ink-style utility class across the app respond to
        // the `dark` class with zero component changes — see index.css for the light/dark value
        // pairs. `accent`/`accent2` are deliberately the *same* value in both themes (see the
        // comment on --accent in index.css for why) but still var-backed for consistency.
        ink: 'rgb(var(--ink) / <alpha-value>)',
        // The text ramp below full-strength ink — `text-ink-2` … `text-ink-5` in place of the
        // `text-ink/70`-style alphas these replaced, so each rung can hold its own value per
        // theme. See the comment on --ink-2 in index.css for the roles and why alpha couldn't.
        // Surfaces (`border-ink/[.09]`, `bg-ink/[.08]`) still use alpha, deliberately.
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',
        'ink-4': 'rgb(var(--ink-4) / <alpha-value>)',
        'ink-5': 'rgb(var(--ink-5) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        treepane: 'rgb(var(--treepane) / <alpha-value>)',
        listpane: 'rgb(var(--listpane) / <alpha-value>)',
        field: 'rgb(var(--field) / <alpha-value>)',
        chip: 'rgb(var(--chip) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accent2: 'rgb(var(--accent2) / <alpha-value>)',
        'accent-text': 'rgb(var(--accent-text) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        'danger-text': 'rgb(var(--danger-text) / <alpha-value>)',
        'warning-text': 'rgb(var(--warning-text) / <alpha-value>)',
        'staging-text': 'rgb(var(--staging-text) / <alpha-value>)',
        selection: 'rgb(var(--selection) / <alpha-value>)',
        'hl-amber': '#F0E3A8',
        'hl-green': '#CBE0C2',
        'hl-blue': '#CFDCEE',
      },
      // The app's UI type scale, resolved from the custom properties index.css defines — one
      // place to retune every size, instead of the arbitrary `text-[13px]` values these replaced.
      // Values only, no line-height: call sites that need one set their own `leading-[…]`.
      fontSize: {
        'ui-2xs': 'var(--ui-text-2xs)',
        'ui-xs': 'var(--ui-text-xs)',
        'ui-sm': 'var(--ui-text-sm)',
        'ui-base': 'var(--ui-text-base)',
        'ui-md': 'var(--ui-text-md)',
        'ui-lg': 'var(--ui-text-lg)',
        'ui-xl': 'var(--ui-text-xl)',
        'ui-2xl': 'var(--ui-text-2xl)',
        'ui-3xl': 'var(--ui-text-3xl)',
      },
      fontFamily: {
        // `font-serif` is a misnomer kept for now: it no longer selects a serif, it selects the
        // shell's own face — the same Inter `body` sets in index.css. It stays as a utility
        // because a handful of call sites sit inside the reader, which paints its own face onto
        // its subtree, and need to opt back out to the shell's (ReaderMenuPanel's note field,
        // ReaderSearchOverlay's Pali, DictionaryDock's headword).
        serif: ['Inter', 'system-ui', 'sans-serif'],
        georgia: ['Georgia', 'Times New Roman', 'serif'],
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        field: '9px',
        chip: '11px',
        sheet: '16px',
      },
      boxShadow: {
        popup: '0 8px 24px rgba(0,0,0,.18)',
        sheet: '0 -8px 30px rgba(0,0,0,.1)',
      },
      keyframes: {
        fadeUp: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        sheetUp: { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        popIn: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        fadeUp: 'fadeUp .18s ease both',
        sheetUp: 'sheetUp .2s ease both',
        fadeIn: 'fadeIn .18s ease both',
        popIn: 'popIn .12s ease both',
      },
    },
  },
  plugins: [],
};
