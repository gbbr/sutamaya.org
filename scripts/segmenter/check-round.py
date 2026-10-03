"""Checks a review round's changes to a translation against a commit, the last one by default.

Lists the verse lines it changed that aren't whole lines of the translator's pages, and the Pali
lines it newly hides from the reader, by the reveal rule in data/upstream/README.md's "Building
them into the app".

    python3 scripts/segmenter/check-round.py <translator> [--base <revision>]
"""
import html
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINE_END = re.compile(r'<br\s*/?>|</(?:p|h[1-6]|li|div|blockquote|dd|dt|tr)>', re.I)
# References and footnote markers, which the translations leave out.
MARKER = re.compile(r"<a\b[^>]*class=['\"][^'\"]*(?:ref|footnote)[^'\"]*['\"][^>]*>.*?</a>"
                    r"|<span\b[^>]*class=['\"][^'\"]*\bfn\b[^'\"]*['\"][^>]*>.*?</span>", re.I | re.S)
TAG = re.compile(r'<[^>]+>')


def clean(line):
    return re.sub(r'\s+', ' ', line).strip()


def source_lines(translator):
    """Returns every line of the translator's pages."""
    lines = set()
    for page in (ROOT / 'data/upstream' / translator / 'sutta').rglob('*.html'):
        for line in LINE_END.split(MARKER.sub('', page.read_text())):
            line = clean(html.unescape(TAG.sub('', line)))
            if line:
                lines.add(line)
    return lines


def paragraph(key):
    doc, seg = key.split(':', 1)
    return doc + ':' + seg.split('.', 1)[0]


def hidden(pali, english):
    """Returns the Pali lines the reader never sees: a line with no English joins the line above
    in its paragraph when it is alone, and is hidden otherwise."""
    out, above, pending = set(), None, None
    for key, text in pali.items():
        if key.split(':', 1)[1].split('.', 1)[0] == '0':
            out.update([pending] if pending else [])
            above = pending = None
        elif english.get(key, '').strip():
            above, pending = key, None
        elif text.strip():
            out.update([pending] if pending else [])
            joins = above is not None and paragraph(key) == paragraph(above)
            if not joins:
                out.add(key)
            above, pending = None, key if joins else None
    out.update([pending] if pending else [])
    return out


def at(revision, path):
    result = subprocess.run(['git', '-C', str(ROOT), 'show', f'{revision}:{path}'],
                            capture_output=True, text=True)
    return json.loads(result.stdout) if result.returncode == 0 else None


def main():
    translator = sys.argv[1]
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else 'HEAD'
    lines = source_lines(translator)
    covered = set(json.loads((ROOT / f'data/{translator}/covered.json').read_text()))
    suffix = f'_translation-en-{translator}.json'
    partial, newly_hidden, shown, changed = [], [], 0, 0
    for path in sorted((ROOT / f'data/{translator}/sutta').rglob(f'*{suffix}')):
        relative = path.relative_to(ROOT)
        old, new = at(base, relative), json.loads(path.read_text())
        if old is None or old == new:
            continue
        inner = path.relative_to(ROOT / f'data/{translator}/sutta')
        pali = json.loads((ROOT / 'data/pali/sutta' / str(inner).replace(suffix, '_root-pli-ms.json')).read_text())
        markup_path = ROOT / 'data/html/pli/ms/sutta' / str(inner).replace(suffix, '_html.json')
        markup = json.loads(markup_path.read_text()) if markup_path.exists() else {}
        keys = [key for key in new if new[key] != old.get(key)]
        changed += len(keys)
        for key in keys:
            if 'verse-line' in markup.get(key, ''):
                partial += [(key, line) for line in map(clean, new[key].split('\n'))
                            if line and line not in lines]
        before, after = hidden(pali, old), hidden(pali, new)
        order = list(pali)
        newly_hidden += sorted(after - before - covered, key=order.index)
        shown += len(before - after)

    print(f'{translator}: {changed} lines changed since {base}')
    print(f'{len(partial)} verse lines that aren\'t whole lines of the page')
    for key, line in partial:
        print(f'  {key}: {line}')
    print(f'{shown} Pali lines newly shown; {len(newly_hidden)} newly hidden, outside covered.json')
    for key in newly_hidden:
        print(f'  {key}')


if __name__ == '__main__':
    main()
