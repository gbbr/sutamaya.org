import { Circle, CircleCheck, GraduationCap, X } from 'lucide-react';
import type { ThemeColors } from '../../lib/types';

// The verb for the reader's pointer: "Tap" on a touch screen, "Click" elsewhere.
const VERB = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'Tap' : 'Click';

interface ReaderTipProps {
  // True once a line's Pali has been shown, which ticks the first step.
  paliDone: boolean;
  theme: ThemeColors;
  fontSize: number;
  onClose: () => void;
}

/**
 * Renders the first-run tip, in the DictionaryDock's place and dressed like it: a titled checklist
 * of the reader's two taps.
 */
export function ReaderTip({ paliDone, theme, fontSize, onClose }: ReaderTipProps) {
  const textSize = Math.max(13, fontSize - 3);
  return (
    <section
      data-component="ReaderTip"
      className="flex-none font-sans animate-sheetUp"
      style={{
        borderTop: `2px solid ${theme.fg}`,
        background: theme.panel,
        padding: '14px 22px',
        paddingBottom: 'max(14px, calc(var(--safe-bottom) + 9px))',
        fontSize: textSize,
        lineHeight: 1.5,
      }}
    >
      <div className="flex items-center gap-3">
        <GraduationCap size={28} strokeWidth={1.25} className="flex-none opacity-80" />
        <h2 className="flex-1 min-w-0 font-semibold" style={{ fontSize: textSize + 2 }}>
          Study the Pali
        </h2>
        <button
          aria-label="Close"
          title="Close"
          className="flex-none flex items-center opacity-60"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={19} strokeWidth={1.75} />
        </button>
      </div>
      <div role="status">
        <ol className="flex flex-col gap-[6px] mt-[8px]">
          <TipStep state={paliDone ? 'done' : 'current'} text={`${VERB} any sentence to see its Pali`} />
          <TipStep state={paliDone ? 'current' : 'upcoming'} text={`${VERB} a Pali word to look it up`} />
        </ol>
      </div>
    </section>
  );
}

/**
 * The look of a step in each of its states:
 *   done     – ticked, its wording struck through and faded
 *   current  – an empty circle, its wording at full strength
 *   upcoming – an empty circle, its wording faded
 */
const STEP_LOOK = {
  done: { icon: CircleCheck, iconClass: 'opacity-80', textClass: 'line-through opacity-70' },
  current: { icon: Circle, iconClass: 'opacity-60', textClass: '' },
  upcoming: { icon: Circle, iconClass: 'opacity-30', textClass: 'opacity-45' },
};

/** Renders one step of the tip. */
function TipStep({ state, text }: { state: keyof typeof STEP_LOOK; text: string }) {
  const { icon: Icon, iconClass, textClass } = STEP_LOOK[state];
  return (
    <li className="flex items-center gap-3">
      <Icon size={19} strokeWidth={1.75} className={`flex-none ${iconClass}`} />
      <span className={textClass}>
        {state === 'done' && <span className="sr-only">Done: </span>}
        {text}
      </span>
    </li>
  );
}
