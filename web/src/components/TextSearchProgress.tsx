import { Loader2 } from 'lucide-react';
import { SEARCH_TEXT_LOADING_NOTE } from '../lib/search/text';
import type { ThemeColors } from '../lib/types';

// The line saying the sutta text is still being fetched or scanned, drawn where the results will
// be once it answers, and sized as the empty state it stands in place of. It takes its place at
// once but fades in a moment later, so a scan that answers in a blink shows no spinner at all.
export function TextSearchProgress({
  // The reader's palette, where this is drawn over the reader's own background rather than the
  // library's.
  theme,
}: {
  theme?: ThemeColors;
}) {
  return (
    <div
      className={`font-sans flex items-center justify-center gap-[9px] text-ui-base py-10 px-6 animate-fadeIn${theme ? '' : ' text-ink-3'}`}
      style={{ animationDelay: '150ms', ...(theme ? { color: theme.dim } : null) }}
    >
      <Loader2 size={16} strokeWidth={2.25} className="flex-none animate-spin" aria-hidden />
      {SEARCH_TEXT_LOADING_NOTE}
    </div>
  );
}
