#!/usr/bin/env python3
"""Builds review packets with the Pali on every row of the texts named, and checks them.

Run from the repository root:

  scripts/segmenter/review-pali.py packet <translator> <document or page>… --out <new folder>
  scripts/segmenter/review-pali.py verify <folder>

Packets are review inputs only: this tool never applies findings or changes corpus data.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
# Characters a packet file holds, about.
BATCH = 60000
# The Pali markup opening a paragraph or a verse.
PARAGRAPH_START = re.compile(r'<(?:p|h[1-6]|li|blockquote)\b')


def digest(data):
    """Returns a SHA-256 digest for saved bytes."""
    return hashlib.sha256(data).hexdigest()


def load(path):
    """Returns a saved JSON document."""
    return json.loads(path.read_text(encoding='utf-8'))


def plain(text):
    """Returns a single readable line without layout markup."""
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', '', text)).split())


def inside(base, relative):
    """Returns a path within its declared evidence directory."""
    path = (base / relative).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError(f'Path leaves evidence directory: {relative}')
    return path


def expanded_uids(uids):
    """Returns document IDs and individual IDs within their numbered spans."""
    found = set(uids)
    for uid in uids:
        span = re.fullmatch(r'(.*?)(\d+)-(\d+)', uid)
        if span:
            prefix, first, last = span.groups()
            found.update(f'{prefix}{n}' for n in range(int(first), int(last) + 1))
    return found


def documents(name, index, reports):
    """Returns the documents a name stands for: the document of that ID, and those written from the
    page of that name."""
    found = [name] if name in index else []
    for report in reports:
        if Path(report['file']).stem == name:
            uids = expanded_uids(report['uids'].split())
            found += [doc for doc in index if doc not in found and uids & expanded_uids({doc})]
    return found


def packet(translator, names, output):
    """Writes every row of the named texts with the Pali, in files of about BATCH characters, and
    records their inputs."""
    if output.exists():
        raise ValueError(f'Output already exists; choose a fresh folder: {output}')
    base = ROOT / 'data' / translator
    index = {p.name.split('_')[0]: p for p in sorted((base / 'sutta').rglob('*.json'))}
    reports = load(base / 'report.json')
    selected = []
    for name in names:
        found = documents(name, index, reports)
        if not found:
            raise ValueError(f'No {translator} document or page named {name}.')
        selected += [doc for doc in found if doc not in selected]
    inputs, texts = {}, []

    def read_input(path):
        if not path.exists():
            raise ValueError(f'Missing review input: {path.relative_to(ROOT)}')
        data = path.read_bytes()
        inputs[str(path.relative_to(ROOT))] = {'bytes': len(data), 'sha256': digest(data)}
        return json.loads(data)

    covered = set(read_input(base / 'covered.json'))
    for doc in selected:
        translated = index[doc]
        relative = translated.relative_to(base / 'sutta')
        theirs = read_input(translated)
        pali = read_input(ROOT / 'data/pali/sutta' / str(relative).replace(
            f'_translation-en-{translator}.json', '_root-pli-ms.json'))
        sujato = read_input(ROOT / 'data/sujato/sutta' / str(relative).replace(
            f'_translation-en-{translator}.json', '_translation-en-sujato.json'))
        if set(theirs) != set(pali):
            raise ValueError(f'{doc}: translation and Pali key sets differ.')
        html_path = ROOT / 'data/html/pli/ms/sutta' / str(relative).replace(
            f'_translation-en-{translator}.json', '_html.json')
        markup = read_input(html_path) if html_path.exists() else {}
        note_path = base / 'notes' / str(relative).replace('_translation-', '_comment-')
        notes = read_input(note_path) if note_path.exists() else {}
        uids = expanded_uids({key.split(':')[0] for key in pali} | {doc})
        sources = sorted({r['file'] for r in reports
                          if uids.intersection(expanded_uids(r['uids'].split()))})
        if not sources:
            raise ValueError(f'{doc}: no source page found in report.json; resolve mapping first.')
        for source in sources:
            path = ROOT / 'data/upstream' / translator / source
            data = path.read_bytes()
            inputs[str(path.relative_to(ROOT))] = {'bytes': len(data), 'sha256': digest(data)}
        rows = []
        for key in pali:
            # A verse line of the translator's starting inside the line shows as ⏎.
            text = plain(theirs[key].replace('\n', ' ⏎ '))
            row = (f'{key} | P: {plain(pali[key]) or "(none)"} | '
                   f'S: {plain(sujato.get(key, "")) or "(none)"} | T: {text or "(none)"}')
            if 'verse-line' in markup.get(key, ''):
                row += ' | verse'
            if key in covered:
                row += ' | covered'
            if plain(notes.get(key, '')):
                row += f' | N: {plain(notes[key])}'
            rows.append((row, bool(PARAGRAPH_START.search(markup.get(key, '')))))
        texts.append({'document': doc, 'rows': rows, 'sourcePages': sources})
    # Short texts share a file; a long one continues in the next, at the start of a paragraph or verse.
    files, lines, size = [], [], 0
    for text in texts:
        lines += [f'## {text["document"]}', 'Source pages: ' + ', '.join(text['sourcePages'])]
        for row, starts in text['rows']:
            if size > BATCH and starts:
                files.append(lines)
                lines, size = [f'## {text["document"]}, continued'], 0
            lines.append(row)
            size += len(row)
        lines.append('')
        if size > BATCH - 10000:
            files.append(lines)
            lines, size = [], 0
    if lines:
        files.append(lines)
    packets, contents = [], []
    for n, lines in enumerate(files, 1):
        name = f'batch-{n:03d}.txt'
        data = ('\n'.join(lines) + '\n').encode('utf-8')
        contents.append((name, data))
        held = [line[3:].removesuffix(', continued') for line in lines if line.startswith('## ')]
        packets.append({'path': name, 'documents': held, 'bytes': len(data), 'sha256': digest(data)})
    head = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'],
                          check=True, capture_output=True, text=True).stdout.strip()
    manifest = {'translator': translator, 'baselineCommit': head, 'status': 'unreviewed inputs',
                'authority': 'original Pali; Sujato is secondary context',
                'inputs': inputs,
                'texts': [{'document': t['document'], 'rows': len(t['rows']),
                           'sourcePages': t['sourcePages']} for t in texts],
                'packets': packets,
                'note': 'Source mapping follows the current report; known numbering/range '
                        'limitations still require direct source review. A hash check is not '
                        'semantic verification. Original markup and notes remain in the inputs.'}
    output.mkdir(parents=True)
    for name, data in contents:
        (output / name).write_bytes(data)
    (output / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(texts)} texts, {sum(len(t["rows"]) for t in texts)} rows, '
          f'in {len(packets)} files: {output}')


def verify_packet(folder):
    """Checks packet bytes and whether the corpus inputs still match their saved hashes."""
    manifest = load(folder / 'manifest.json')
    for relative, item in manifest['inputs'].items():
        data = inside(ROOT, relative).read_bytes()
        if len(data) != item['bytes'] or digest(data) != item['sha256']:
            raise ValueError(f'Review input changed: {relative}; rebase affected review work.')
    for item in manifest['packets']:
        data = inside(folder, item['path']).read_bytes()
        if len(data) != item['bytes'] or digest(data) != item['sha256']:
            raise ValueError(f'Review packet changed: {item["path"]}')
    print('Packet bytes verified; all recorded corpus inputs still match.')


def main():
    """Runs the selected packet build or check."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('packet', help='write packets with the Pali on every row')
    build.add_argument('translator', choices=['bodhi', 'thanissaro'])
    build.add_argument('documents', nargs='+',
                       help='document IDs, such as dhp1-20, or page names, such as an5.254-271')
    build.add_argument('--out', type=Path, required=True, help='a new, unused output folder')
    check = commands.add_parser('verify', help='check a packet folder and its current inputs')
    check.add_argument('folder', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'packet':
            packet(args.translator, args.documents, args.out)
        else:
            verify_packet(args.folder)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
