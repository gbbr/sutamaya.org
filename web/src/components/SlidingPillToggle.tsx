import type { ReactNode } from 'react';

interface SlidingPillToggleProps {
  active: 'left' | 'right';
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  leftIcon: ReactNode;
  rightIcon: ReactNode;
  // Colour classes for each side's icon; the layout and transition are applied here.
  leftIconClassName: string;
  rightIconClassName: string;
  // Icon slot size in px, shared by both sides.
  slotSize: number;
  // The thumb's whole appearance — background, border, shadow and transition.
  thumbClassName: string;
  onMouseDown?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

// A two-state pill toggle, its thumb sliding behind whichever icon is active. Colour is left to
// the caller: this is a choice inside a form field rather than navigation, so the thumb stays
// neutral and only the icon is tinted.
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
      data-component="SlidingPillToggle"
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
