import { Loader2 } from 'lucide-react';
import type { ThemeColors } from '../lib/types';

// The spinner shown while the results on screen are the previous answer and the newest keystroke
// is still being scanned. Sized to sit inside a line of text — the results count, or the search
// field — and faded in a moment late, so a scan that answers in a blink shows no spinner at all.
// Decorative: the results region carries `aria-busy` for the same state.
export function SearchUpdating({
  // The reader's palette, where this is drawn over the reader's own background rather than the
  // library's.
  theme,
}: {
  theme?: ThemeColors;
}) {
  return (
    // Two elements because both animations are the `animation` shorthand: the fade is on the
    // wrapper, the spin on the icon.
    <span
      className={`inline-flex flex-none items-center animate-fadeIn${theme ? '' : ' text-ink-4'}`}
      style={{ animationDelay: '150ms', ...(theme ? { color: theme.dim } : null) }}
      aria-hidden
    >
      <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />
    </span>
  );
}
