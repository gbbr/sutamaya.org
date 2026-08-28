import { navigate, type RouteComponentProps } from '@reach/router';

// Rendered both as the Router's `default`, for any path with no matching route, and directly by
// RedirectToReader in App.tsx, for a single-segment path that isn't a known sutta uid — so it takes
// no props beyond RouteComponentProps.
export function NotFoundPage(_props: RouteComponentProps) {
  return (
    <div data-component="NotFoundPage" className="flex flex-col items-center justify-center gap-4 h-full bg-paper px-6 text-center">
      <div className="text-ui-2xl text-ink-2" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
      <div className="font-serif text-ui-xl text-ink-2">This page doesn't exist.</div>
      <button
        className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]"
        onClick={() => navigate('/app')}
      >
        Back to the library
      </button>
    </div>
  );
}
