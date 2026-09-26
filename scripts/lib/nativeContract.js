// The version fields, dropped before comparing: they move on every store release and say nothing
// about what a bundle may call, so left in they would fire release:ota's drift guard as a matter of
// routine.
const VERSION_FIELDS = [
  [/\b(versionCode|CURRENT_PROJECT_VERSION)\b\s*=?\s*\d+/g, '$1'],
  [/\b(versionName|MARKETING_VERSION)\b\s*=?\s*("[^"]*"|[\d.]+)/g, '$1'],
];

// The comments, dropped before comparing so that rewording one never fires the drift guard.
const COMMENTS = [
  [/<!--[\s\S]*?-->/g, ''], // XML comments
  [/^[ \t]*\/\/.*$/gm, ''], // `//` comments on a line of their own, since a URL in a string has `//` too
  [/^[ \t]*\n/gm, ''], // blank lines, the ones those leave included
];

// comparableContract returns a native contract file's text without its version fields and
// comments, which never change what a bundle may call.
export function comparableContract(text) {
  return [...VERSION_FIELDS, ...COMMENTS].reduce((t, [re, to]) => t.replace(re, to), text);
}
