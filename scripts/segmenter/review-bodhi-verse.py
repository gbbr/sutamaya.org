#!/usr/bin/env python3
"""Puts every Bodhi verse up for review, deciding equal-count spreads at source line breaks."""
import argparse
from collections import Counter
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def plain(value):
    """Returns words without layout markup, retaining the translator's line breaks."""
    return html.unescape(re.sub(r'<[^>]*>', '', value)).strip()


def normalized(value):
    """Returns words with insignificant whitespace collapsed."""
    return ' '.join(plain(value).split())


class SourceLines(HTMLParser):
    """Collects complete source verse lines inside blockquotes and preformatted verse."""
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.depth, self.pre, self.skip = 0, 0, 0
        self.stack, self.parts, self.lines = [], [], []
        self.feed(source)

    def flush(self):
        value = normalized(''.join(self.parts))
        if value:
            self.lines.append(value)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('blockquote', 'pre'):
            self.flush()
            self.depth += 1
            self.pre += tag == 'pre'
        if tag == 'br':
            if self.depth and not self.skip:
                self.flush()
            return
        if tag in ('meta', 'img', 'hr', 'link', 'input'):
            return
        skip = (tag == 'a' and 'ref' in attrs.get('class', '').split()) or self.skip > 0
        self.stack.append((tag, skip))
        self.skip += skip

    def handle_endtag(self, tag):
        if self.depth and tag in ('p', 'blockquote', 'pre'):
            self.flush()
        if tag in ('blockquote', 'pre'):
            self.depth -= 1
            self.pre -= tag == 'pre'
        if self.stack and self.stack[-1][0] == tag:
            self.skip -= self.stack.pop()[1]

    def handle_data(self, value):
        if not self.depth or self.skip:
            return
        if self.pre:
            pieces = value.split('\n')
            for i, piece in enumerate(pieces):
                if i:
                    self.flush()
                self.parts.append(piece)
        else:
            self.parts.append(value)


def verses(markup):
    """Returns verse-line keys grouped by their Pali paragraph, including empty verses."""
    current, found = [], []
    for key, template in markup.items():
        before, _, after = template.partition('{}')
        if re.search(r'<p\b', before) and current:
            found.append(current)
            current = []
        if 'verse-line' in template:
            current.append(key)
        elif current:
            found.append(current)
            current = []
        if '</p>' in after and current:
            found.append(current)
            current = []
    if current:
        found.append(current)
    return found


def build(rows_per_batch, output):
    """Writes all verse rows and conservative rule findings into a new review folder."""
    out = output if output.is_absolute() else ROOT / output
    if out.exists():
        raise ValueError(f'Review folder already exists: {out}')
    out.mkdir()
    report = json.loads((ROOT / 'data/bodhi/report.json').read_text())
    inputs, records, batches, blocks, findings = {}, [], [], [], []
    count = 0

    def read(path):
        data = path.read_bytes()
        inputs[str(path.relative_to(ROOT))] = hashlib.sha256(data).hexdigest()
        return json.loads(data)

    def flush():
        nonlocal count, blocks, findings
        if not blocks:
            return
        name = f'batch-{len(batches) + 1:03d}'
        (out / f'{name}.txt').write_text('\n\n'.join(blocks) + '\n')
        (out / f'{name}.rules.findings').write_text('\n'.join(findings) + '\n' if findings else 'none\n')
        batches.append({'name': name, 'rows': count, 'ruleFindings': len(findings)})
        count, blocks, findings = 0, [], []

    paths = sorted((ROOT / 'data/bodhi/sutta').rglob('*.json'))
    for path in paths:
        rel = path.relative_to(ROOT / 'data/bodhi/sutta')
        markup_path = ROOT / 'data/html/pli/ms/sutta' / str(rel).replace('_translation-en-bodhi', '_html')
        markup = read(markup_path)
        groups = verses(markup)
        if not groups:
            continue
        translated = read(path)
        pali = read(ROOT / 'data/pali/sutta' / str(rel).replace('_translation-en-bodhi', '_root-pli-ms'))
        sujato = read(ROOT / 'data/sujato/sutta' / str(rel).replace('_translation-en-bodhi', '_translation-en-sujato'))
        ids = {key.split(':')[0] for key in pali} | {path.name.split('_')[0]}
        sources = {r['file'] for r in report if ids.intersection(r['uids'].split())}
        source_lines = []
        for source in sorted(sources):
            p = ROOT / 'data/upstream/bodhi' / source
            inputs[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
            source_lines.extend(SourceLines(p.read_text()).lines)
        for keys in groups:
            pieces = [piece.strip() for key in keys for piece in plain(translated.get(key, '')).split('\n') if piece.strip()]
            gathered = any(not plain(translated.get(key, '')) for key in keys) and any('\n' in translated.get(key, '') for key in keys)
            rule = gathered and len(pieces) == len(keys) and all(normalized(piece) in source_lines for piece in pieces)
            proposed = {key: piece for key, piece in zip(keys, pieces)} if rule else {}
            fixes = [f'{key} starts: {" ".join(value.split()[:8])}' for key, value in proposed.items()]
            tag = 'RULE: one complete source line per Pali row' if rule else 'READER: judge placement and any gathered lines'
            block = [f'## Verse {keys[0]} | {len(keys)} Pali rows | {len(pieces)} English pieces | gathered={gathered} | {tag}']
            joined = normalized(' '.join(translated.get(key, '') for key in keys))
            matching = [line for line in source_lines if line in joined or any(
                len(piece.split()) >= 3 and normalized(piece) in line for piece in pieces)]
            if matching:
                block.append('Source line breaks (context; Pali decides verse boundaries): ' + ' ↵ '.join(matching))
            for key in keys:
                t = plain(translated.get(key, '')).replace('\n', ' ↵ ') or '(none)'
                block.append(f'{key} | P: {normalized(pali[key]) or "(none)"} | S: {normalized(sujato.get(key, "")) or "(none)"} | T: {t}')
            if blocks and count + len(keys) > rows_per_batch:
                flush()
            blocks.append('\n'.join(block))
            findings.extend(fixes)
            count += len(keys)
            records.append({'first': keys[0], 'keys': keys, 'collection': rel.parts[0], 'batch': len(batches) + 1,
                            'gathered': gathered, 'rule': rule, 'proposed': proposed})
    flush()
    summary = {'translator': 'bodhi', 'authority': 'original Pali; retain source line breaks and order',
               'verses': records, 'batches': batches, 'inputs': inputs,
               'totals': {'verses': len(records), 'rows': sum(len(v['keys']) for v in records),
                          'gathered': sum(v['gathered'] for v in records), 'ruleVerses': sum(v['rule'] for v in records),
                          'collections': dict(Counter(v['collection'] for v in records))}}
    (out / 'manifest.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary['totals']), f'in {len(batches)} batches: {out}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rows', type=int, default=300)
    parser.add_argument('--out', type=Path, default=Path('data/bodhi/review/verse'))
    args = parser.parse_args()
    build(args.rows, args.out)
