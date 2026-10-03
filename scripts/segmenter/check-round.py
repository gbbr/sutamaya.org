"""Checks a review round's changes to a translation against a commit, the last one by default.

Lists the verse lines it changed that aren't whole lines of the translator's pages, the Pali lines
it newly hides from the reader, and every Pali line still hidden in the verses he translates, by
the reveal rule in data/upstream/README.md's "Building them into the app".

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
# A verse he shortens to "…" or gives only as a note pointing elsewhere, whose Pali stays hidden.
SHORTENED = re.compile(r'…|\.\.\.|<a href|\[\d|identical|repeats', re.I)
# A <pre> block, whose lines end at its newlines.
PRE = re.compile(r'<pre\b.*?</pre>', re.I | re.S)
PARAGRAPH_START = re.compile(r'<(?:p|h[1-6]|li|blockquote)\b')


def clean(line):
    return re.sub(r'\s+', ' ', line).strip()


def source_lines(translator):
    """Returns every line of the translator's pages."""
    lines = set()
    for page in (ROOT / 'data/upstream' / translator / 'sutta').rglob('*.html'):
        text = PRE.sub(lambda pre: pre.group(0).replace('\n', '<br>'), page.read_text())
        for line in LINE_END.split(MARKER.sub('', text)):
            line = clean(html.unescape(TAG.sub('', line)))
            if line:
                lines.add(line)
    return lines


def source_shortened_keys(translator, pages, english):
    """Recognises excerpts whose ellipsis or repeat note sits on another Pali paragraph.

    Match the English in page order, so a repeated closing line is judged in its own source
    passage rather than in an earlier full rendering of the same verse. Unmatched text is
    never exempted. Saved pages are read without changing their words or line breaks.
    """
    passages, stream, cursor = [], '', 0
    for page in pages:
        text = (ROOT / 'data/upstream' / translator / page).read_text()
        article = re.search(r'<article\b[^>]*>(.*?)(?:<footer\b|</article>)', text, re.S | re.I)
        if not article:
            continue
        for paragraph in article[1].split('</p>'):
            words = clean(html.unescape(TAG.sub('', MARKER.sub('', paragraph))))
            if not words:
                continue
            start = len(stream)
            stream += words + ' '
            passages.append((start, len(stream), bool(SHORTENED.search(words))))
    shortened = set()
    for key, value in english.items():
        words = clean(html.unescape(TAG.sub('', value)))
        if not words:
            continue
        start = stream.find(words, cursor)
        if start < 0:
            continue
        cursor = start + len(words)
        context = [short for lo, hi, short in passages if lo < cursor and hi > start]
        if context and all(context):
            shortened.add(key)
    return shortened


def paragraphs(pali, markup):
    """Returns each line's paragraph, from the Pali's markup where there is any (the line keys make
    each of the Dhammapada's verse lines a paragraph of its own), else from the key."""
    if not markup:
        return {key: key.split(':', 1)[0] + ':' + key.split(':', 1)[1].split('.', 1)[0] for key in pali}
    out, n = {}, 0
    for key in pali:
        n += bool(PARAGRAPH_START.search(markup.get(key, '')))
        out[key] = n
    return out


def hidden(pali, english, markup):
    """Returns the Pali lines the reader never sees: a line with no English joins the line above
    in its paragraph when it is alone, and is hidden otherwise."""
    paragraph = paragraphs(pali, markup)
    out, above, pending = set(), None, None
    for key, text in pali.items():
        if key.split(':', 1)[1].split('.', 1)[0] == '0':
            out.update([pending] if pending else [])
            above = pending = None
        elif english.get(key, '').strip():
            above, pending = key, None
        elif text.strip():
            out.update([pending] if pending else [])
            joins = above is not None and paragraph[key] == paragraph[above]
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
    sources = {}
    if translator == 'bodhi':
        for entry in json.loads((ROOT / 'data/bodhi/report.json').read_text()):
            for uid in entry['uids'].split():
                sources.setdefault(uid, []).append(entry['file'])
    partial, newly_hidden, shown, changed, verse_hidden = [], [], 0, 0, []
    for path in sorted((ROOT / f'data/{translator}/sutta').rglob(f'*{suffix}')):
        relative = path.relative_to(ROOT)
        new = json.loads(path.read_text())
        inner = path.relative_to(ROOT / f'data/{translator}/sutta')
        pali = json.loads((ROOT / 'data/pali/sutta' / str(inner).replace(suffix, '_root-pli-ms.json')).read_text())
        markup_path = ROOT / 'data/html/pli/ms/sutta' / str(inner).replace(suffix, '_html.json')
        markup = json.loads(markup_path.read_text()) if markup_path.exists() else {}
        # Hidden lines of the verses he translates.
        paragraph, order = paragraphs(pali, markup), list(pali)
        english = {}
        for key in pali:
            english[paragraph[key]] = english.get(paragraph[key], '') + new.get(key, '')
        source_shortened = source_shortened_keys(translator, sources.get(path.name.split('_')[0], []), new)
        holders = {}
        for key in pali:
            if new.get(key, '').strip():
                holders.setdefault(paragraph[key], []).append(key)
        shortened_paragraphs = {p for p, keys in holders.items()
                                if all(key in source_shortened for key in keys)}
        verse_hidden += sorted((key for key in hidden(pali, new, markup) - covered
                                if 'verse-line' in markup.get(key, '')
                                and english[paragraph[key]].strip()
                                and paragraph[key] not in shortened_paragraphs
                                and not SHORTENED.search(english[paragraph[key]])), key=order.index)
        old = at(base, relative)
        if old is None or old == new:
            continue
        keys = [key for key in new if new[key] != old.get(key)]
        changed += len(keys)
        for key in keys:
            if 'verse-line' in markup.get(key, ''):
                partial += [(key, line) for line in map(clean, new[key].split('\n'))
                            if line and line not in lines]
        before, after = hidden(pali, old, markup), hidden(pali, new, markup)
        newly_hidden += sorted(after - before - covered, key=order.index)
        shown += len(before - after)

    print(f'{translator}: {changed} lines changed since {base}')
    print(f'{len(partial)} verse lines that aren\'t whole lines of the page')
    for key, line in partial:
        print(f'  {key}: {line}')
    print(f'{shown} Pali lines newly shown; {len(newly_hidden)} newly hidden, outside covered.json')
    for key in newly_hidden:
        print(f'  {key}')
    print(f'{len(verse_hidden)} Pali lines hidden in the verses he translates, in the whole translation')
    for key in verse_hidden:
        print(f'  {key}')


if __name__ == '__main__':
    main()
