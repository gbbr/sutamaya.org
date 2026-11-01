import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useBackHandler } from '../../hooks/useBackHandler';
import { TRANSLATOR_NAMES, TRANSLATOR_SHORT_NAMES } from '../../lib/corpus/corpus';
import type { Sutta, ThemeColors, Translator } from '../../lib/types';

interface TranslationPickerProps {
  by: Translator;
  alternatives: Sutta['by'];
  theme: ThemeColors;
  onChoose: (by: Translator) => void;
}

/** TranslationPicker offers only the whole translations available for the open sutta. */
export function TranslationPicker({ by, alternatives, theme, onChoose }: TranslationPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const choices = (['sujato', 'bodhi', 'thanissaro'] as const).filter((id) => id === 'sujato' || alternatives?.[id]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  useBackHandler(open, close);

  useEffect(() => setOpen(false), [by]);

  useEffect(() => {
    if (!open) return;
    const items = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    items.find((item) => item.getAttribute('aria-checked') === 'true')?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        close();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (choices.length === 1) return null;

  return (
    // Shrinks with the header, the name giving way to an ellipsis before any of the header's icons
    // do. Its menu hangs from the nearest positioned ancestor, the header's right-hand group, so it
    // opens under the bar's right edge and stays on screen however wide it grows.
    <div ref={ref} data-component="TranslationPicker" className="flex min-w-0">
      {/* A pill like the Reader's list chips, its 44px touch area reaching past it as the header's
          icons' do, with the negative margin keeping the bar's height. */}
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Translation: ${TRANSLATOR_NAMES[by]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex min-w-0 items-center py-[7px] -my-[7px] rounded-full hover:opacity-70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-6px]"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {/* Filled while a translation other than Sujato's shows, so the change can't go unseen. */}
        <span
          className="flex min-w-0 items-center gap-1 h-[30px] pl-3 pr-2 rounded-full text-ui-sm leading-none whitespace-nowrap"
          style={{
            border: `1px solid ${theme.rule}`,
            color: theme.fg,
            background: by === 'sujato' ? undefined : `color-mix(in srgb, ${theme.fg} 20%, ${theme.bg})`,
          }}
        >
          {/* At least a whole first letter, where the name gives way to its ellipsis. */}
          <span className="min-w-[0.8em] truncate">{TRANSLATOR_SHORT_NAMES[by]}</span>
          <ChevronDown size={14} strokeWidth={1.75} className="flex-none" aria-hidden />
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Translation"
          className="absolute right-0 top-full z-50 mt-1 w-max max-w-[calc(100vw-2rem)] rounded-lg border p-1 shadow-popup"
          style={{ background: theme.bg, borderColor: theme.rule }}
        >
          {choices.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === by}
              tabIndex={-1}
              className="flex w-full min-h-11 items-center gap-3 rounded-md px-3 text-left text-ui-sm hover:opacity-70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px]"
              style={{ background: id === by ? theme.tint : undefined }}
              onClick={() => {
                close();
                onChoose(id);
              }}
            >
              <span className="flex-1">{TRANSLATOR_NAMES[id]}</span>
              <Check size={15} className="flex-none" style={{ visibility: id === by ? undefined : 'hidden' }} aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
