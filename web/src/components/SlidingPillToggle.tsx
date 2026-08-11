import type { ReactNode } from 'react';

interface SlidingPillToggleProps {
  active: 'left' | 'right';
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  leftIcon: ReactNode;
  rightIcon: ReactNode;
  // Just the color (and any extra) classes for that side's icon — `transition-colors` and layout
  // are already applied by this component to both sides, since every caller wants those anyway.
  leftIconClassName: string;
  rightIconClassName: string;
  // Icon slot size in px, shared by both sides (each caller only ever needs one size for itself).
  slotSize: number;
  // The thumb's own bg/border/shadow/transition/duration — the one part that's genuinely
  // different per caller (see this component's own comment below), so it's supplied whole rather
  // than broken into more granular props.
  thumbClassName: string;
  onMouseDown?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

// A two-state pill toggle with a sliding thumb behind whichever icon is active — shared by
// TreePane's Library/My-lists pane switch and ListsTreeView's List/Group draft-kind picker
// (previously two near-identical copies of the same track/thumb/icon-span markup and position
// math, differing only in size and color scheme). `thumbClassName`/`*IconClassName` are left to
// the caller rather than folded into more props here, since that's the one thing that genuinely
// differs between the two homes: TreePane tints the thumb itself (an accent color) to signal the
// view switch, while ListsTreeView keeps the thumb neutral and only tints the icon.
export function SlidingPillToggle({
  active,
  onClick,
  ariaLabel,
  title,
  leftIcon,
  rightIcon,
  leftIconClassName,
  rightIconClassName,
  slotSize,
  thumbClassName,
  onMouseDown,
}: SlidingPillToggleProps) {
  const slotStyle = { width: slotSize, height: slotSize };
  return (
    <button
      type="button"
      className="relative flex flex-none items-center rounded-full p-[2px] bg-ink/[.09]"
      aria-label={ariaLabel}
      title={title}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <div
        className={`absolute top-[2px] bottom-[2px] rounded-full ${thumbClassName}`}
        style={{ left: active === 'left' ? 2 : '50%', width: 'calc(50% - 2px)' }}
      />
      <span className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${leftIconClassName}`} style={slotStyle}>
        {leftIcon}
      </span>
      <span className={`relative z-10 flex items-center justify-center rounded-full transition-colors ${rightIconClassName}`} style={slotStyle}>
        {rightIcon}
      </span>
    </button>
  );
}
