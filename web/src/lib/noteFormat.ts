// One stretch of a note, marked bold or not — boldRuns' output, painted by components/MatchedText.
export interface NoteRun {
  text: string;
  bold: boolean;
}

// `*word*` in a note is bold everywhere the note is displayed. The note box itself never renders
// it: what the reader typed is what they see while writing, and the asterisks are the whole of the
// notation, so there is nothing to reveal or hide.
//
// One asterisk, not two — the chat convention (Slack, WhatsApp) rather than the Markdown one,
// since a note is a line or two and `**` is a lot of punctuation for it. Notes have no italic, so
// nothing is lost by not being Markdown.
//
// Two rules keep an asterisk that wasn't meant as emphasis literal: a marker with whitespace just
// inside it opens nothing, and a run never crosses a line. Together they leave `* item` bullets on
// consecutive lines alone, which is the way an asterisk is most likely to already appear in a note
// written before any of this existed.
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
