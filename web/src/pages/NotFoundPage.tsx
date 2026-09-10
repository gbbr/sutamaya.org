import { useNavigate } from 'react-router';

// The page for an unrecognized path: the route table's catch-all, and what App.tsx's
// RedirectToReader falls back to for a single-segment path that isn't a known sutta uid.
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div data-component="NotFoundPage" className="flex flex-col items-center justify-center gap-4 h-full bg-paper px-6 text-center">
      <div className="text-ui-2xl text-ink-2" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>sutamaya</div>
      <div className="font-serif text-ui-xl text-ink-2">This page doesn't exist.</div>
      <button
        className="font-sans text-ui-md px-4 py-2 rounded-md border border-ink/25 hover:bg-ink/[.06]"
        onClick={() => navigate('/')}
      >
        Back to the library
      </button>
    </div>
  );
}
