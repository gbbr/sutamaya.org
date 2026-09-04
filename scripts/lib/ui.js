// The frame every `update-data` command prints in: a banner naming the step, aligned status rows,
// and a closing line naming the command to run next.
//
// Colour carries meaning and is never decoration:
//
//   ✓  green   passed, nothing to do
//   ✗  red     must be fixed before going on
//   !  yellow  needs a decision from you
//   ·  dim     accepted as-is, recorded so it isn't invisible
//
// Everything is indented off the left margin, and a detail block sits one level deeper than its row.
import { red, green, yellow, blue, bold, dim } from './dataSync.js';

// One level of indentation.
export const PAD = '  ';
// Width a status row's label is padded to, so every row's detail starts in the same column.
const LABEL_WIDTH = 12;

export const MARKS = {
  ok: () => green('✓'),
  fail: () => red('✗'),
  warn: () => yellow('!'),
  note: () => dim('·'),
};

// A number with thousands separators.
export function n(value) {
  return value.toLocaleString('en-US');
}

// Prints the heading for a step, with `meta` naming whatever identifies this run.
export function banner(step, meta) {
  const left = `${bold('update-data')} ${dim('·')} ${bold(blue(step))}`;
  console.log(`\n${PAD}${left}${meta ? `   ${dim(meta)}` : ''}\n`);
}

// Prints one status row: its mark (see MARKS), its label, and its detail.
export function row(kind, label, detail) {
  const mark = MARKS[kind]();
  const name = kind === 'note' ? dim(label.padEnd(LABEL_WIDTH)) : label.padEnd(LABEL_WIDTH);
  console.log(`${PAD}${mark}  ${name}  ${kind === 'fail' ? detail : dim(detail)}`);
}

// Prints a row's supporting detail, indented a level past it. `text` may be multi-line and carry
// its own colour.
export function block(text) {
  console.log();
  for (const line of String(text).split('\n')) console.log(line ? `${PAD}${PAD}${PAD}${line}` : '');
}

// Prints the closing line: the command to run next, and the one-line reason to run it.
export function next(command, why) {
  console.log(`\n${PAD}${bold('Next')}  ${dim('→')}  ${green(command)}`);
  if (why) console.log(`${PAD}${' '.repeat(9)}${dim(why)}`);
  console.log();
}

// Prints the closing line for a step that ends the sequence rather than naming another command.
export function done(message) {
  console.log(`\n${PAD}${green(message)}\n`);
}

// Hard-wraps a paragraph into lines, for prose the pipeline prints verbatim — a rule's `why`, which
// runs to a few hundred words. Capped below a wide terminal's full width.
export function wrap(text, width = Math.min((process.stdout.columns || 100) - PAD.length * 2, 96)) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
