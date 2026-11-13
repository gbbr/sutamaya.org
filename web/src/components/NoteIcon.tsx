import type { CSSProperties } from 'react';
import { KeyRound } from 'lucide-react';

interface NoteIconProps {
  className?: string;
  style?: CSSProperties;
}

// NoteIcon marks a line of text as the reader's own note with the Keywords list's icon, sized to
// the surrounding type and centred on its first line.
export function NoteIcon({ className = '', style }: NoteIconProps) {
  return (
    <span aria-hidden className={`flex flex-none h-[1lh] items-center ${className}`} style={style}>
      <KeyRound className="size-[1em]" strokeWidth={2.25} />
    </span>
  );
}
