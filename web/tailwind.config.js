/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(27 25 23 / <alpha-value>)',
        paper: '#FDFCFA',
        treepane: '#F0ECE4',
        listpane: '#F8F6F2',
        field: '#FFFDFA',
        accent: '#927243',
        'accent-hover': '#6B5230',
        selection: '#EADFC6',
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
