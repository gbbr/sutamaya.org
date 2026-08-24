// Shared presentation for the `update-data` commands. They're read as a sequence — plan, then
// apply, then accept — rather than in isolation, so they share one frame: a banner naming the step
// you're in, aligned status rows, and a closing line naming the one command to run next. Nobody
// should have to remember the order.
//
// Colour carries meaning and is never decoration:
//
//   ✓  green   passed, nothing to do
//   ✗  red     must be fixed before going on
//   !  yellow  needs a decision from you
//   ·  dim     accepted as-is, recorded so it isn't invisible
//
// Everything is indented off the left margin so a wall of output still has a spine, and detail
// blocks sit one level deeper than the row they belong to.
import { red, green, yellow, blue, bold, dim } from './dataSync.js';

export const PAD = '  ';
// Status rows align their detail into one column, so the marks and labels read as a list rather
// than as prose of varying length.
const LABEL_WIDTH = 12;

export const MARKS = {
  ok: () => green('✓'),
  fail: () => red('✗'),
  warn: () => yellow('!'),
  note: () => dim('·'),
};

export function n(value) {
  return value.toLocaleString('en-US');
}

// The step you're in, plus whatever identifies this run (the sc-data commit, a file count).
export function banner(step, meta) {
  const left = `${bold('update-data')} ${dim('·')} ${bold(blue(step))}`;
  console.log(`\n${PAD}${left}${meta ? `   ${dim(meta)}` : ''}\n`);
}

export function row(kind, label, detail) {
  const mark = MARKS[kind]();
  const name = kind === 'note' ? dim(label.padEnd(LABEL_WIDTH)) : label.padEnd(LABEL_WIDTH);
  console.log(`${PAD}${mark}  ${name}  ${kind === 'fail' ? detail : dim(detail)}`);
}

// A row's supporting detail: indented one level past the row, blank-line separated so consecutive
// blocks don't run together. `text` may be multi-line and may carry its own colour.
export function block(text) {
  console.log();
  for (const line of String(text).split('\n')) console.log(line ? `${PAD}${PAD}${PAD}${line}` : '');
}

// The closing line — the whole point of the frame. `command` is what to run; `why` is the one-line
// reason, which is usually the more useful half.
export function next(command, why) {
  console.log(`\n${PAD}${bold('Next')}  ${dim('→')}  ${green(command)}`);
  if (why) console.log(`${PAD}${' '.repeat(9)}${dim(why)}`);
  console.log();
}

// For a step that ends the sequence rather than pointing at another command.
export function done(message) {
  console.log(`\n${PAD}${green(message)}\n`);
}

// Hard-wraps a paragraph into lines, for prose the pipeline prints verbatim rather than composes —
// a retranslation rule's `why` runs to a few hundred words, and one unwrapped line of it is the
// least readable thing any of these commands emit. Capped well below a wide terminal's full width,
// since a 200-column line is no easier to read than an unwrapped one.
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
