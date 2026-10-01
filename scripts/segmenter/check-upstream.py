#!/usr/bin/env python3
"""Checks a translation's segmented text against its upstream pages, word for word.

Run from the repository's root, before committing a change to data/<translator>/:

  scripts/segmenter/check-upstream.py <bodhi|thanissaro>

It reads each page in data/upstream/<translator>/sutta/ with its own parser, sharing nothing with
the segmenter, joins the lines of the texts made from that page in order, and compares the two
word by word. Two differences are expected and only counted: a reference shown in the app's form,
and a heading's number that the title lines leave out. Anything else is printed, and the exit status
is 1. dhammatalks.org's pages, whose introductions and notes the segmenter writes apart from the
text, are not read correctly yet.
"""
import difflib
import glob
import json
import re
import sys
from html.parser import HTMLParser

translator = sys.argv[1]
# Elements whose text is not the page's text at all.
SKIP = {'head', 'footer', 'script', 'style'}
# Elements with no closing tag.
VOID = ('br', 'meta', 'img', 'hr', 'link', 'input')
# Access to Insight's page furniture around its text.
FURNITURE = ('H_billboard', 'H_altFormat', 'F_colophon', 'F_sourceEdition', 'bcbs-footer', 'F_newCopyrightSymbol', 'F_toenail')


class Page(HTMLParser):
    """Collects a page's text: its title and body, without references, note markers, notes or furniture."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skipping, self.open, self.in_header = [], 0, [], False

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        if tag == 'header':
            self.in_header = True
        a = dict(attrs)
        cls = (a.get('class') or '').split()
        skip = (
            tag in SKIP
            # A page's header keeps only its title, not the collection and division above it.
            or (self.in_header and tag == 'ul')
            or (tag == 'a' and ('ref' in cls or any('footnote' in c for c in cls)))
            or (tag in ('div', 'section') and any('note' in c for c in cls))
            or (tag == 'span' and 'fn' in cls)
            or a.get('id') in FURNITURE
        )
        self.open.append(skip)
        self.skipping += skip

    def handle_endtag(self, tag):
        if tag in VOID or not self.open:
            return
        if tag == 'header':
            self.in_header = False
        self.skipping -= self.open.pop()

    def handle_data(self, data):
        if not self.skipping:
            self.out.append(data)


def tokens(s):
    """Returns a text's words and punctuation marks, so spacing never counts."""
    return re.findall(r'\w+|[^\w\s]', s)


# Every text's lines, in file order, by the sutta ID before each key's colon.
lines = {}
for path in glob.glob(f'data/{translator}/sutta/**/*_translation-en-{translator}.json', recursive=True):
    for key, text in json.load(open(path, encoding='utf-8')).items():
        lines.setdefault(key.split(':')[0], []).append(text)


def texts_of(uid):
    """Returns the texts a report entry's ID covers: its own, or each sutta of a span ("sn12.83-92")."""
    if uid in lines:
        return [uid]
    m = re.fullmatch(r'([a-z]+[\d.]*?\.?)(\d+)-(\d+)', uid)
    if m:
        found = [m[1] + str(n) for n in range(int(m[2]), int(m[3]) + 1) if m[1] + str(n) in lines]
        if found:
            return found
    return [k for k in lines if k.startswith(uid.split('-')[0] + '-')][:1]


pages = {}
for entry in json.load(open(f'data/{translator}/report.json')):
    for uid in entry['uids'].split(','):
        for text in texts_of(uid.strip()):
            if text not in pages.setdefault(entry['file'], []):
                pages[entry['file']].append(text)

clean = references = numbers = differing = 0
for file, texts in sorted(pages.items()):
    page = Page()
    page.feed(open(f'data/upstream/{translator}/{file}', encoding='utf-8').read())
    theirs = tokens(''.join(page.out))
    ours = []
    for text in texts:
        for line in lines[text]:
            ours += tokens(re.sub(r'<[^>]+>', ' ', re.sub(r'<a [^>]*>.*?</a>', ' REFMARK ', line)))
    odd = []
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, ours, theirs, autojunk=False).get_opcodes():
        if op == 'equal':
            continue
        a, b = ours[a1:a2], theirs[b1:b2]
        # A reference in the app's form, where the page cites it its own way.
        if 'REFMARK' in a and len(b) <= 12 and all(x in ('REFMARK', 'AN', 'SN', 'MN', 'DN') or not x.isalpha() for x in a):
            references += 1
        # A heading's number, which title lines leave out.
        elif not a and all(x.isdigit() or x in '.–-' for x in b):
            numbers += 1
        else:
            odd.append(f"{op}: ours {' '.join(a)[:80]!r} / upstream {' '.join(b)[:80]!r}")
    if odd:
        differing += 1
        print(file, *odd[:4], sep='\n   ')
    else:
        clean += 1
print(f'{translator}: {clean} pages match word for word, apart from {references} references and {numbers} heading numbers; {differing} differ')
sys.exit(1 if differing else 0)
