#!/usr/bin/env python3
"""Checks a translation's segmented text against its upstream pages, word for word.

Run from the repository's root, before committing a change to data/<translator>/:

  scripts/segmenter/check-upstream.py <bodhi|thanissaro>

It reads each page in data/upstream/<translator>/sutta/ with its own parser, sharing nothing with
the segmenter, and compares it word by word with what was written from it: the page's text with the
lines of the texts made from it, joined in order, and a dhammatalks.org page's introduction, "See
also" and notes with the notes written beside those lines. Two differences are expected and only
counted: a reference shown in the app's form, and the number of a heading or a note, which the
title lines leave out and a note may keep. Anything else is printed, and the exit status is 1.
"""
import difflib
import glob
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

translator = sys.argv[1]
# Elements whose text is not the page's text at all.
SKIP = {'head', 'footer', 'script', 'style'}
# Elements with no closing tag.
VOID = ('br', 'meta', 'img', 'hr', 'link', 'input')
# Access to Insight's page furniture around its text.
FURNITURE = ('H_billboard', 'H_altFormat', 'F_colophon', 'F_sourceEdition', 'bcbs-footer', 'F_newCopyrightSymbol', 'F_toenail')
# Elements a browser closes an open <p> before.
BLOCKS = {'p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr'}
# Elements that sit inside a line of text.
INLINE = {'a', 'abbr', 'b', 'br', 'cite', 'em', 'i', 'mark', 'q', 'small', 'span', 'strong', 'sub', 'sup', 'u'}


class Page(HTMLParser):
    """Collects a SuttaCentral or Access to Insight page's text: its title and body, without
    references, note markers, notes or furniture."""

    def __init__(self, others=()):
        super().__init__(convert_charrefs=True)
        self.out, self.skipping, self.open, self.in_header = [], 0, [], False
        # The suttas on the page that another page's text is written from.
        self.others = set(others)

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
            or (tag == 'article' and a.get('id') in self.others)
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


class Node:
    """An element of a parsed page, its children elements and strings."""

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []
        self.cls = (self.attrs.get('class') or '').split()
        self.id = self.attrs.get('id') or ''


class Tree(HTMLParser):
    """Parses a page into Nodes, closing an open <p> where a browser would."""

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = self.at = Node('#root', {}, None)
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag in BLOCKS and self.inside('p'):
            self.handle_endtag('p')
        node = Node(tag, attrs, self.at)
        self.at.children.append(node)
        if tag not in VOID:
            self.at = node

    def handle_startendtag(self, tag, attrs):
        self.at.children.append(Node(tag, attrs, self.at))

    def handle_endtag(self, tag):
        node = self.at
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.at = node.parent

    def handle_data(self, data):
        self.at.children.append(data)

    def inside(self, tag):
        node = self.at
        while node is not self.root:
            if node.tag == tag:
                return True
            node = node.parent
        return False


def walk(node):
    """Yields a node and every element under it, in document order."""
    yield node
    for child in node.children:
        if isinstance(child, Node):
            yield from walk(child)


def marker(node):
    """Returns whether an element is a note marker or a note's link back to it."""
    return (node.tag == 'span' and 'fn' in node.cls) or (node.tag == 'a' and ('footnote-ref' in node.cls or 'footnote-back' in node.cls))


def text(node, br='\n'):
    """Returns an element's text without its note markers, each <br> as `br`."""
    if isinstance(node, str):
        return node
    if node.tag == 'br':
        return br
    return '' if marker(node) else ''.join(text(child, br) for child in node.children)


def styled(node, tags):
    """Returns how much of an element's text, spaces aside, sits in the given tags."""
    if isinstance(node, str):
        return 0
    if node.tag in tags:
        return len(re.sub(r'\s', '', text(node)))
    return sum(styled(child, tags) for child in node.children)


def wholly(node, tags, share):
    """Returns whether at least `share` of an element's text sits in the given tags."""
    size = len(re.sub(r'\s', '', text(node)))
    return size > 0 and styled(node, tags) >= size * share


def italic_introduction(node):
    """Recognises introductory italic prose with roman terms inside it.

    The paragraph must begin and end in italic markup to use the lower share;
    the caller still requires it to occur before the translation's body.
    """
    if wholly(node, ('em', 'i'), 0.9):
        return True
    content = [child for child in node.children if text(child).strip()]
    return (bool(content)
            and all(isinstance(child, Node) and child.tag in ('em', 'i')
                    for child in (content[0], content[-1]))
            and wholly(node, ('em', 'i'), 0.85))


def title(h1):
    """Returns a heading's title: its text before any <br>, the Pali name and number after it."""
    return text(h1, '\x00').split('\x00')[0]


def blocks(node):
    """Yields the blocks inside an element in order: each element holding text, inside the <div>s
    that only wrap them, and each run of loose text and inline elements, as a <p> of its own."""
    run = []
    for child in node.children + [None]:
        if child is not None and (isinstance(child, str) or child.tag in INLINE):
            run.append(child)
            continue
        loose = Node('p', {}, node)
        loose.children = run
        if text(loose).strip():
            yield loose
        run = []
        if child is None:
            break
        if child.tag == 'div' and not child.cls:
            yield from blocks(child)
        else:
            yield child


# The note id of a page's footnote keyed by an asterisk.
ASTERISK_NOTE = 'asterisk-note'


def asterisk_note(page):
    """Makes a page's footnote keyed by an asterisk, as SN 5.9's alternative reading is, a note box,
    and each asterisk closing a word of its text that note's marker."""
    label = next((n for n in walk(page) if n.tag == 'p' and re.match(r'\s*\*[^\W\d_]', text(n))), None)
    if label is None:
        return
    footnote = label.parent if label.parent.tag == 'div' and 'verse' in label.parent.cls else label
    box = Node('div', {'class': 'note'}, footnote.parent)
    siblings = footnote.parent.children
    siblings[siblings.index(footnote)] = box
    box.children = [label] if footnote is label else footnote.children
    for child in box.children:
        if isinstance(child, Node):
            child.parent = box
    label.id = ASTERISK_NOTE

    def unstar(node):
        """Drops the asterisk opening a node's first words, returning whether it found them."""
        for i, child in enumerate(node.children):
            if isinstance(child, Node):
                if unstar(child):
                    return True
            elif child.strip():
                node.children[i] = re.sub(r'^\s*\*', '', child)
                return True
        return False

    unstar(label)
    in_box = {id(n) for n in walk(box)}
    for node in [n for n in walk(page) if id(n) not in in_box]:
        children = []
        for child in node.children:
            if isinstance(child, str) and re.search(r'\S\*', child):
                for i, part in enumerate(re.split(r'(?<=\S)\*', child)):
                    if i:
                        mark = Node('span', {'class': 'fn'}, node)
                        mark.children = [Node('a', {'href': f'#{ASTERISK_NOTE}'}, mark)]
                        children.append(mark)
                    children.append(part)
            else:
                children.append(child)
        node.children = children


def dhammatalks(doc, name):
    """Returns a dhammatalks.org page's words: its text, and its introduction, "See also" and notes."""
    roots = [n for n in walk(doc) if n.id == 'sutta']
    for root in roots:
        asterisk_note(root)
    headings = [n for n in walk(roots[0]) if n.tag == 'h1']
    # A page of several suttas, each under its own <h1>, is read for the sutta the file is named for.
    own = next((h for h in headings if h.id.lower() == name.lower()), None) if len(headings) > 1 else None
    order = {id(n): i for i, n in enumerate(walk(doc))}
    starts = [order[id(h)] for h in headings]

    def mine(block):
        """Returns whether a block is the named sutta's, on a page of several."""
        if own is None:
            return True
        node = next((c for c in block.children if isinstance(c, Node)), block) if id(block) not in order else block
        while id(node) not in order:
            node = node.parent
        before = [s for s in starts if s <= order[id(node)]]
        return bool(before) and before[-1] == order[id(own)]

    body, intro, see_also, boxes, marks = [], [], [], [], []
    stars = any('stars' in n.cls for n in walk(doc) if n.tag == 'p')
    started = False
    continuing_box = None
    continuations = {}

    def marked(block):
        """Returns the notes a block's markers point to, in order."""
        return [n.attrs.get('href', '').split('#')[-1] for n in walk(block) if n.tag == 'a' and (marker(n) or (n.parent and marker(n.parent)))]

    def handle(block):
        """Puts a block's words with the text, the introduction, "See also" or the notes."""
        nonlocal started, continuing_box
        cls = block.cls
        # The notes' box, and a note the box closed before.
        if ('note' in cls and block.tag in ('div', 'section')) or (block.tag == 'p' and re.search(r'note\d+$|^fn\d+$', block.id)):
            boxes.append(block)
            continuing_box = (block if started and block.tag != 'p'
                              and any('verse' in n.cls for n in walk(block)) else None)
        elif not mine(block):
            pass
        elif block.tag == 'h1':
            continuing_box = None
            body.append(title(block))
        elif 'seealso' in cls or ('see' in cls and 'also' in cls) or (block.tag == 'p' and re.match(r'\s*See also\b', text(block))):
            continuing_box = None
            # dhammatalks.org styles some headings as a "See also": those wholly in bold.
            (body if wholly(block, ('strong', 'b'), 1.0) else see_also).append(text(block))
        elif (started and block.tag == 'p' and italic_introduction(block)
              and (re.fullmatch(r'\s*Alternative translation:\s*', text(block), re.I)
                   or re.fullmatch(r'\s*\[.*\b(?:discourse|sutta)\b.*\btranslated as follows:\]\s*', text(block), re.I))):
            continuing_box = Node('div', {'class': 'note alternative'}, block.parent)
            continuing_box.children = [block]
            boxes.append(continuing_box)
        elif started and block.tag in ('p', 'div') and re.match(r'\s*Note:\s', text(block)):
            continuing_box = Node('div', {'class': 'note'}, block.parent)
            continuing_box.children = [block]
            boxes.append(continuing_box)
        elif (continuing_box is not None and block.tag not in ('h2', 'h3', 'h4', 'h5', 'h6')
              and 'stars' not in cls):
            continuations.setdefault(id(continuing_box), []).append(block)
        elif 'stars' in cls:
            continuing_box = None
            started = True
        elif 'suttaCite' in cls:
            # The Dhammapada's verse numbers, linking to its endnotes.
            marks.extend(n.attrs['href'].split('#')[1] for n in walk(block) if n.tag == 'a' and 'endnotes.html#' in n.attrs.get('href', ''))
        elif 'verse_stars' in cls or 'notetitle' in cls:
            pass
        elif not started and (stars or 'intro' in cls or 'iblock' in cls or (block.tag == 'p' and italic_introduction(block))):
            intro.append(text(block))
        else:
            continuing_box = None
            started = True
            if block.tag in ('div', 'section'):
                for part in blocks(block):
                    handle(part)
            else:
                body.append(text(block))
                marks.extend(marked(block))

    for root in roots:
        for block in blocks(root):
            handle(block)

    # The notes by id, each without its number, with the paragraphs that follow it; anything in a
    # box before its first note is a note of its own.
    notes = {}
    alternatives = []
    for box in boxes:
        last = None
        if 'alternative' in box.cls:
            last = f'@alternative{len(notes)}'
            notes[last] = ''
            alternatives.append(last)
        for part in [box] if box.tag == 'p' else box.children + continuations.get(id(box), []):
            if isinstance(part, Node) and 'notetitle' in part.cls:
                continue
            if isinstance(part, Node) and part.id:
                last = part.id
                notes[last] = re.sub(r'^\s*\d+\.\s*', '', text(part))
            elif text(part).strip():
                if last is None:
                    last = f'#{len(notes)}'
                    notes[last] = ''
                notes[last] += ' ' + text(part)
    notes.update((k, v) for k, v in ENDNOTES.items() if k in marks)
    # Each marker's note goes where its marker is, so a note marked twice is written twice; a marker
    # naming no note takes the unused one numbered the same. The notes no marker in the text points
    # to go first, beside the introduction, but on a page of several suttas, where they are the others'.
    written, used = [], set()
    for mark in marks:
        if mark not in notes:
            number = re.search(r'note\d+$', mark)
            mark = next((k for k in notes if number and k.endswith(number[0]) and k not in marks and k not in used), mark)
        used.add(mark)
        written.append(notes.get(mark, ''))
    unused = [v for k, v in notes.items() if k not in used and k not in alternatives] if own is None else []
    alternative_text = [notes[k] for k in alternatives] if own is None else []
    return body, intro + alternative_text + see_also + unused + written


def endnotes():
    """Returns the Dhammapada's endnotes by id, each with the paragraphs that follow it."""
    found, last = {}, None
    path = f'data/upstream/{translator}/notes/kn/dhp/endnotes.html'
    try:
        doc = Tree(open(path, encoding='utf-8').read()).root
    except FileNotFoundError:
        return found
    for p in (n for n in walk(doc) if n.tag == 'p'):
        if p.id:
            last = p.id
            found[last] = text(p)
        elif last:
            found[last] += ' ' + text(p)
    return found


ENDNOTES = endnotes()


def tokens(s):
    """Returns a text's words and punctuation marks, so spacing never counts."""
    return re.findall(r'\w+|[^\w\s]', s)


# Every text's lines and notes, in file order, by the sutta ID before each key's colon.
lines, comments = {}, {}
for kind, into in (('sutta', lines), ('notes', comments)):
    suffix = 'translation' if kind == 'sutta' else 'comment'
    for path in glob.glob(f'data/{translator}/{kind}/**/*_{suffix}-en-{translator}.json', recursive=True):
        for key, value in json.load(open(path, encoding='utf-8')).items():
            into.setdefault(key.split(':')[0], []).append(value)


def texts_of(uid):
    """Returns the texts a report entry's ID covers: its own, or each sutta of a span ("sn12.83-92")."""
    if uid in lines:
        return [uid]
    m = re.fullmatch(r'([a-z]+[\d.]*?\.?)(\d+)-(\d+)', uid)
    if m:
        found = [m[1] + str(n) for n in range(int(m[2]), int(m[3]) + 1) if m[1] + str(n) in lines]
        if found:
            return found
    return [k for k in lines if k.startswith(uid.split('-')[0] + '-') and k not in named][:1]


report = json.load(open(f'data/{translator}/report.json'))
# The texts a page is named for whole, as an older copy's grouped "an5.257-263" is.
named = {entry['uids'] for entry in report}
pages = {}
for entry in report:
    for uid in re.split(r'[,\s]+', entry['uids'].strip()):
        for text_id in texts_of(uid):
            if text_id not in pages.setdefault(entry['file'], []):
                pages[entry['file']].append(text_id)


def compare(ours, theirs):
    """Returns the differences between our tokens and the page's, counting the expected ones."""
    global references, numbers
    odd = []
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, ours, theirs, autojunk=False).get_opcodes():
        if op == 'equal':
            continue
        a, b = ours[a1:a2], theirs[b1:b2]
        # A reference in the app's form, where the page cites it its own way.
        if 'REFMARK' in a and len(b) <= 12 and all(x in ('REFMARK', 'AN', 'SN', 'MN', 'DN') or not x.isalpha() for x in a):
            references += 1
        # A heading's number, which title lines leave out, or a note's, which a note may keep.
        elif (not a and all(x.isdigit() or x in '.–-' for x in b)) or (not b and len(a) == 2 and a[0].isdigit() and a[1] == '.'):
            numbers += 1
        else:
            odd.append(f"{op}: ours {' '.join(a)[:80]!r} / upstream {' '.join(b)[:80]!r}")
    return odd


layout_path = Path(f'data/{translator}/page-layouts.json')
whole_pages = json.loads(layout_path.read_text()).get('wholePages', {}) if layout_path.exists() else {}
for file, replicas in whole_pages.items():
    if (not isinstance(replicas, list) or len(replicas) < 2
            or len(set(replicas)) != len(replicas)
            or set(pages.get(file, [])) != set(replicas)):
        sys.exit(f'{file}: whole-page layout must have every expected text in the report and corpus')

# Read the original page independently for every replica. Joining replicas could let a missing
# passage in one text be supplied by another text, which is precisely what this layout forbids.
comparisons = []
for file, texts in sorted(pages.items()):
    if file in whole_pages:
        comparisons.extend((file, [uid], f'{file} [{uid}]') for uid in whole_pages[file])
    else:
        comparisons.append((file, texts, file))

clean = references = numbers = differing = 0
for file, texts, label in comparisons:
    source = open(f'data/upstream/{translator}/{file}', encoding='utf-8').read()
    ours = []
    for text_id in texts:
        for line in lines[text_id]:
            ours += tokens(re.sub(r'<[^>]+>', ' ', re.sub(r'<a [^>]*>.*?</a>', ' REFMARK ', line)))
    if 'id="sutta"' in source:
        body, notes = dhammatalks(Tree(source).root, file.rsplit('/', 1)[-1][:-5])
        odd = compare(ours, tokens(' '.join(body)))
        # A note's paragraphs part its words; its links and italics don't.
        ours_notes = [t for text_id in texts for note in comments.get(text_id, []) for t in tokens(html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'</?p>', ' ', note))))]
        odd += [f'note {d}' for d in compare(ours_notes, tokens(' '.join(notes)))]
    else:
        page = Page(others=(t for t in lines if t not in texts))
        page.feed(source)
        odd = compare(ours, tokens(''.join(page.out)))
    if odd:
        differing += 1
        print(label, *odd[:4], sep='\n   ')
    else:
        clean += 1
print(f'{translator}: {clean} page/text comparisons match word for word, apart from {references} references and {numbers} heading numbers; {differing} differ')
sys.exit(1 if differing else 0)
