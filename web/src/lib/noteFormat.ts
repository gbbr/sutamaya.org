// A note's only markup: `*word*` renders bold wherever the note is displayed, though never in the
// box it is written in, the asterisks being the whole of the notation. One asterisk rather than
// Markdown's two, since notes have no italic to distinguish.

// One stretch of a note, bold or not, painted by components/MatchedText.
export interface NoteRun {
  text: string;
  bold: boolean;
}

// Splits a note into its bold and plain runs. Two rules keep an asterisk that wasn't meant as
// emphasis literal — a marker with whitespace just inside it opens nothing, and a run never
// crosses a line — which together leave `* item` bullets alone.
export function boldRuns(text: string): NoteRun[] {
  const marked = /\*([^*\n]+)\*/g;
  const runs: NoteRun[] = [];
  let at = 0;
  for (let m = marked.exec(text); m; m = marked.exec(text)) {
    if (/^\s|\s$/.test(m[1])) {
      // Not emphasis. Resume one character in, so a real pair later on the line still opens.
      marked.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > at) runs.push({ text: text.slice(at, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), bold: false });
  return runs;
}
