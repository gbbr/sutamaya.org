import type { SuttaRowChip } from '../lib/lists';
import { HighlightCountBadge } from './HighlightCountBadge';

interface SuttaRowChipsProps {
  chips: SuttaRowChip[];
  hlCount: number;
}

// List-membership chips + highlight-count badge for one sutta row — shared by ListPane's desktop
// rows and TreePane's mobile search results (see lib/lists.ts's suttaRowMeta for how the props
// are computed) so the two stay visually and behaviourally identical rather than drifting apart.
export function SuttaRowChips({ chips, hlCount }: SuttaRowChipsProps) {
  if (chips.length === 0 && hlCount === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 mt-2">
      {chips.map((c) => (
        <span key={c.id} className="inline-flex items-center h-5 whitespace-nowrap rounded-[10px] px-[9px] font-sans text-[11px] border border-ink/25">
          {c.breadcrumb}
        </span>
      ))}
      {hlCount > 0 && <HighlightCountBadge count={hlCount} />}
    </span>
  );
}
