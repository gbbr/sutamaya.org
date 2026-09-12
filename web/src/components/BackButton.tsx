import { ChevronLeft } from 'lucide-react';

interface BackButtonProps {
  onClick: () => void;
}

// The one way back out of a screen on a phone: a round chevron chip at the head of the screen,
// the same shape and size wherever it appears, so leaving a collection, Settings or Help is the
// same gesture in the same place. Its `after` pseudo-element pads the tap target to ~44px
// without growing the circle.
export function BackButton({ onClick }: BackButtonProps) {
  return (
    <button
      data-component="BackButton"
      className="relative flex-none w-[34px] h-[34px] rounded-full flex items-center justify-center border border-ink/[.12] bg-chip/40 text-ink-3 hover:text-ink active:bg-ink/[.08] after:content-[''] after:absolute after:-inset-[5px]"
      aria-label="Back"
      onClick={onClick}
    >
      <ChevronLeft size={23} strokeWidth={2} />
    </button>
  );
}
