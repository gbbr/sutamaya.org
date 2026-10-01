#!/usr/bin/env python3
"""Checks a translation's segmented texts for what must hold in every one of them.

Run from the repository's root, after check-upstream.py:

  scripts/segmenter/check-integrity.py <bodhi|thanissaro>

check-upstream.py checks the words; this checks where they sit and what they carry, against the
Pali's line roles in data/html/pli/ms/sutta/:
  written   – every page with text gave a segmented text
  title     – the first sutta of every page has a title: on its title lines, or opening its text
  heading   – a heading of the translator's never ends a line of text, and a Pali heading line holds a heading
  closing   – a closing line holds only the translator's colophon or summary verse
  notes     – every note sits on a line of its text
  links     – every link names a sutta the app has
  markup    – only the segmenter's tags, each closed
Anything found is printed, and the exit status is 1.
"""
import glob
import json
import re
import sys

translator = sys.argv[1]
OUT = f'data/{translator}'
# The Pali's closing line roles.
CLOSING = {'endsutta', 'endvagga', 'endbook', 'endsection', 'endkanda', 'uddana-intro'}
# A colophon's words, which a closing line may hold.
COLOPHON = re.compile(r'\b(finished|Here ends|concluded|elaborated)\b')
# Words a Pali heading line's English may hold.
HEADING_WORDS = 15
# The tags the segmenter writes.
TAGS = re.compile(r'</?(span|a|i|p|j)(\s[^>]*)?/?>')

problems = []


def found(kind, key, what):
    """Records one problem."""
    problems.append(f'{kind:8} {key}  {what}')


def words(html):
    """Returns a line's text without its markup, on one line."""
    return ' '.join(re.sub(r'<[^>]+>', '', html).split())


pali_files = glob.glob('data/pali/sutta/**/*_root-pli-ms.json', recursive=True)
# The texts and suttas the app has, by ID.
uids = {key.split(':')[0] for path in pali_files for key in json.load(open(path))} | {path.split('/')[-1].split('_')[0] for path in pali_files}
# The first sutta of each page that has a title heading.
titled = set()

for entry in json.load(open(f'{OUT}/report.json')):
    if not entry.get('segments') and not entry.get('empty'):
        found('written', entry['file'], 'no segmented text')
    if re.search(r'<h1\b', open(f"data/upstream/{translator}/{entry['file']}").read()):
        titled.add(entry['uids'].split()[0])

for path in sorted(glob.glob(f'{OUT}/sutta/**/*.json', recursive=True)):
    text = json.load(open(path))
    roles = json.load(open(path.replace(f'{OUT}/sutta', 'data/html/pli/ms/sutta').replace(f'_translation-en-{translator}', '_html')))
    pali = json.load(open(path.replace(f'{OUT}/', 'data/pali/').replace(f'_translation-en-{translator}', '_root-pli-ms')))
    spoken = {key.split(':')[0] for key, html in text.items() if words(html) and not key.split(':')[1].startswith('0.')}
    for key, role in roles.items():
        html, line = text.get(key, ''), words(text.get(key, ''))
        classes = set(re.findall(r"class='([^']*)'", role))
        uid = key.split(':')[0]
        if 'sutta-title' in classes and uid in titled & spoken and not any(words(text.get(k, '')) for k in roles if k.startswith(uid + ':0.')) and not any(text.get(k, '').strip().startswith('<span class="heading">') for k in roles if k.startswith(uid + ':')):
            found('title', key, 'no title')
        if re.search(r'<span class="heading">[^<]*</span>\s*$', html) and not re.match(r'\s*<span class="heading">[^<]*</span>\s*$', html):
            found('heading', key, 'a heading that ends its line: ' + line[-60:])
        if re.match(r"<h[2-6]", role) and 'sutta-title' not in classes and not key.split(':')[1].startswith('0.') and len(line.split()) > HEADING_WORDS:
            found('heading', key, 'body text on a heading line: ' + line[:60])
        if line and classes & CLOSING and not COLOPHON.search(line):
            found('closing', key, line[:70])
    for key in text:
        if key not in pali:
            found('markup', key, 'a line the Pali lacks')
    for key, html in text.items():
        tags = re.findall(r'<[^>]+>', html)
        if any(not TAGS.fullmatch(tag) for tag in tags):
            found('markup', key, 'unknown tag: ' + next(t for t in tags if not TAGS.fullmatch(t)))
        for name in ('span', 'a', 'i', 'p'):
            if len(re.findall(f'<{name}[\\s>]', html)) != html.count(f'</{name}>'):
                found('markup', key, f'<{name}> not closed')

for path in sorted(glob.glob(f'{OUT}/notes/**/*.json', recursive=True)):
    notes = json.load(open(path))
    sutta = path.replace(f'{OUT}/notes', f'{OUT}/sutta').replace('_comment-', '_translation-')
    pali_path = sutta.replace(f'{OUT}/', 'data/pali/').replace(f'_translation-en-{translator}', '_root-pli-ms')
    pali = json.load(open(pali_path)) if glob.glob(pali_path) else {}
    for key in notes:
        if key not in pali:
            found('notes', key, 'a note on a line the Pali lacks')

for kind in ('sutta', 'notes'):
    for path in glob.glob(f'{OUT}/{kind}/**/*.json', recursive=True):
        for key, html in json.load(open(path)).items():
            for target in re.findall(r"href=['\"]https://suttacentral\.net/([^'\"#]+)", html):
                if target not in uids:
                    found('links', key, 'a link to ' + target)

for problem in problems:
    print(problem)
print(f'{translator}: {len(problems)} problems')
sys.exit(1 if problems else 0)
