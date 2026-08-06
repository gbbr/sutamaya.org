/** @type {import('tailwindcss').Config} */
export default {
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
        paper: 'rgb(var(--paper) / <alpha-value>)',
        treepane: 'rgb(var(--treepane) / <alpha-value>)',
        listpane: 'rgb(var(--listpane) / <alpha-value>)',
        field: 'rgb(var(--field) / <alpha-value>)',
        chip: 'rgb(var(--chip) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accent2: 'rgb(var(--accent2) / <alpha-value>)',
        'accent-text': 'rgb(var(--accent-text) / <alpha-value>)',
        'accent-hover': '#6B5230',
        selection: 'rgb(var(--selection) / <alpha-value>)',
        'hl-amber': '#F0E3A8',
        'hl-green': '#CBE0C2',
        'hl-blue': '#CFDCEE',
      },
      fontFamily: {
        // Routed through --ui-serif (set from Settings > UI font, see lib/uiPrefs.ts) so the
        // app-wide "UI font" preference can override every use of `font-serif` at once; the
        // var()'s own fallback is today's default, so nothing changes until it's actually set.
        serif: ['var(--ui-serif, Newsreader)', 'Georgia', 'serif'],
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
