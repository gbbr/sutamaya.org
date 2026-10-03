#!/usr/bin/env python3
"""Put every saved Ṭhānissaro verse in Pali-inclusive batches (about 300 rows).

Only writes review/verse/. A gathered verse with equal English/Pali line counts,
without speaker or heading complications, has one English line per Pali line.
Moved starts must also be explicit newlines, rather than old app row cuts.
Its automatic findings are shown in the packet; readers check verse identity and
the remaining cases. English line breaks are displayed as ⏎, never flattened.
"""
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BOOKS = ['dn', 'mn', 'sn', 'an', 'dhp', 'iti', 'snp', 'thag', 'thig', 'ud']


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def plain(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', '', value)).split())


def displayed(value):
    return ' ⏎ '.join(plain(part) for part in value.split('\n')) or '(none)'


def natural(value):
    return [int(part) if part.isdigit() else part
            for part in re.split(r'(\d+)', str(value))]


def paragraphs(markup):
    """Keep HTML paragraph boundaries, including non-verse speaker rows."""
    group = []
    for key, template in markup.items():
        if re.search(r'<p(?:\s|>)', template):
            if group:
                yield group
            group = []
        if 'verse-line' in template or group:
            group.append(key)
        if '</p>' in template and group:
            yield group
            group = []
    if group:
        yield group


def automatic(keys, translated, markup):
    """An equal-count gathered verse has a unique one-line-per-row spread."""
    if any('speaker' in markup[k] or '<span class="heading">' in translated[k]
           for k in keys):
        return {}, 'speaker or heading requires a reader'
    pieces = [(key, index, plain(part)) for key in keys
              for index, part in enumerate(translated[key].split('\n')) if plain(part)]
    parts = [part for _, _, part in pieces]
    if any(re.fullmatch(r'[^.!?]+:', part) for part in parts):
        return {}, 'possible speaker requires a reader'
    if len(parts) != len(keys):
        return {}, 'unequal counts require a reader'
    if any(origin != key and index == 0
           for key, (origin, index, _) in zip(keys, pieces)):
        return {}, 'moving an old app row cut requires source-break review'
    return {key: 'starts: ' + ' '.join(part.split()[:8])
            for key, part in zip(keys, parts)}, 'equal counts: one line per row'


def build(rows):
    out = ROOT / args.out
    if out.exists():
        raise ValueError(f'Review folder already exists: {out}')
    inputs, verses, counts = {}, [], Counter()

    def read(path):
        data = path.read_bytes()
        inputs[str(path.relative_to(ROOT))] = {
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        return json.loads(data)

    paths = list((ROOT / 'data/thanissaro/sutta').rglob('*.json'))

    def order(path):
        rel = path.relative_to(ROOT / 'data/thanissaro/sutta')
        book = rel.parts[1] if rel.parts[0] == 'kn' else rel.parts[0]
        return BOOKS.index(book), natural(rel)

    for path in sorted(paths, key=order):
        rel = path.relative_to(ROOT / 'data/thanissaro/sutta')
        book = rel.parts[1] if rel.parts[0] == 'kn' else rel.parts[0]
        translated = read(path)
        markup = read(ROOT / 'data/html/pli/ms/sutta' /
                      str(rel).replace('_translation-en-thanissaro', '_html'))
        pali = read(ROOT / 'data/pali/sutta' /
                    str(rel).replace('_translation-en-thanissaro', '_root-pli-ms'))
        sujato = read(ROOT / 'data/sujato/sutta' /
                      str(rel).replace('_translation-en-thanissaro', '_translation-en-sujato'))
        assert set(translated) == set(pali)
        all_keys = list(pali)

        def row(key, context=False):
            prefix = 'CONTEXT ' if context else ''
            return (f'{prefix}{key} | P: {plain(pali[key]) or "(none)"} | '
                    f'S: {displayed(sujato.get(key, ""))} | '
                    f'T: {displayed(translated[key])}')

        for group in paragraphs(markup):
            keys = [key for key in group if 'verse-line' in markup[key]]
            if not keys:
                continue
            gathered = (any(not plain(translated[k]) for k in keys) and
                        any('\n' in translated[k] and len(translated[k].split('\n')) > 1
                            for k in keys))
            starts, reason = automatic(keys, translated, markup) if gathered else ({}, '')
            # Speaker rows belong to the paragraph but never count as verse lines.
            if len(group) != len(keys):
                starts, reason = {}, 'paragraph has speaker/context rows'
            before = all_keys[max(0, all_keys.index(group[0]) - 2):all_keys.index(group[0])]
            after = all_keys[all_keys.index(group[-1]) + 1:all_keys.index(group[-1]) + 3]
            before = [k for k in before if 'verse-line' not in markup[k]]
            after = [k for k in after if 'verse-line' not in markup[k]]
            lines = [f'## {keys[0]}–{keys[-1]} ({book})' +
                     (' GATHERED; ' + reason if gathered else '')]
            lines += [row(k, True) for k in before]
            lines += [row(k, k not in keys) for k in group]
            lines += [row(k, True) for k in after]
            if starts:
                lines += ['AUTO ' + k + ' ' + value for k, value in starts.items()]
            verses.append({'book': book, 'document': path.name.split('_')[0],
                           'keys': keys, 'gathered': gathered, 'automatic': starts,
                           'rows': len(group) + len(before) + len(after),
                           'text': '\n'.join(lines)})
            counts[book] += 1
    out.mkdir(parents=True)
    batches, current, size = [], [], 0

    def save():
        nonlocal current, size
        if not current:
            return
        name = f'batch-{len(batches) + 1:03d}'
        header = ('Pali decides the VERSE, not a word-for-word row mapping.\n'
                  'T uses ⏎ for explicit translator line breaks. Old app row cuts may split a source line.\n'
                  'Confirm any moved row-start piece against the saved source before using it.\n'
                  'Keep his order; never gather lines while a verse row is empty.\n'
                  'AUTO fixes equal counts only when every moved start is an explicit newline; copy its findings.\n'
                  'Check AUTO verse identity, but judge other cuts yourself.\n'
                  'CONTEXT rows are read-only; report only verse keys.\n\n')
        data = (header + '\n\n'.join(v['text'] for v in current) + '\n').encode('utf-8')
        (out / (name + '.txt')).write_bytes(data)
        batches.append({'name': name, 'rows': size, 'verses': len(current),
                        'books': sorted({v['book'] for v in current}, key=BOOKS.index),
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                        'items': [{k: v[k] for k in ['book', 'document', 'keys', 'gathered', 'automatic']}
                                  for v in current]})
        current, size = [], 0

    for verse in verses:
        if current and size + verse['rows'] > rows:
            save()
        current.append(verse)
        size += verse['rows']
    save()
    head = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'],
                          capture_output=True, text=True, check=True).stdout.strip()
    manifest = {'translator': 'thanissaro', 'baselineCommit': head,
                'status': 'unreviewed working-tree inputs', 'inputs': inputs,
                'verses': len(verses), 'verseRows': sum(len(v['keys']) for v in verses),
                'collections': dict(counts),
                'gatheredVerses': sum(v['gathered'] for v in verses),
                'automaticVerses': sum(bool(v['automatic']) for v in verses),
                'batches': batches}
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'{manifest["verses"]} verses; {manifest["verseRows"]} verse rows; '
          f'{len(batches)} batches; {manifest["gatheredVerses"]} gathered; '
          f'{manifest["automaticVerses"]} automatic')
    print(json.dumps(dict(counts)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='data/thanissaro/review/verse',
                        help='fresh review directory; an existing directory is never overwritten')
    parser.add_argument('--rows', type=int, default=300)
    args = parser.parse_args()
    build(args.rows)
