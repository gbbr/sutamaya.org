import { Loader2 } from 'lucide-react';
import { SEARCH_TEXT_LOADING_NOTE } from '../lib/search/text';

// The line saying the sutta text is still on its way, drawn at the foot of the results, where the
// hits it brings will append.
export function TextSearchProgress() {
  return (
    <div className="font-sans flex items-center justify-center gap-[7px] text-ui-sm text-ink-4 py-5 px-6">
      <Loader2 size={13} strokeWidth={2.25} className="flex-none animate-spin" aria-hidden />
      {SEARCH_TEXT_LOADING_NOTE}
    </div>
  );
}
