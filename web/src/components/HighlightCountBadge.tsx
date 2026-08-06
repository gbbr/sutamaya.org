interface HighlightCountBadgeProps {
  color: string;
  count: number;
  onClick?: (e: React.MouseEvent) => void;
}

// One per highlight colour present on a sutta — shared by ListPane, PreviewPane, and
// ReaderPage's header so a size/colour tweak in one place stays consistent everywhere. Renders
// as a <button> (clickable, e.g. ReaderPage opening the Highlights side-panel tab) when `onClick`
// is passed, otherwise a plain <span> (ListPane/PreviewPane, where the row itself isn't
// interactive). The background layers a faint black tint over the raw highlight colour — dimmer
// than the swatch used for actually painting a highlight — rather than baking a second, darker
// hex per colour.
export function HighlightCountBadge({ color, count, onClick }: HighlightCountBadgeProps) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className="inline-flex items-center justify-center h-[18px] rounded-full font-sans text-[11px] font-extrabold"
      style={{
        background: `linear-gradient(rgba(0,0,0,.07), rgba(0,0,0,.07)), ${color}`,
        color: 'rgba(27,25,23,.62)',
        minWidth: 18,
        padding: '0 4px',
      }}
      onClick={onClick}
    >
      {count}
    </Tag>
  );
}
