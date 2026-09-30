#!/usr/bin/env python3
"""Moves review batches between the segmenter and the folders reviewers answer.

Run from the repository's root:

  scripts/review-rounds.py <translator> put <folder> <segmenter flags…>
      runs the segmenter with the flags and moves the batches it writes to review/<folder>/,
      100 items to a file
  scripts/review-rounds.py <translator> keep <folder>…
      keeps the answers in each review/<folder>/ in cuts.json, one folder after another
  scripts/review-rounds.py <translator> keep-agreed <folder>
      keeps the answers a first pass (.answers) and a second opinion (.opus) agree on
  scripts/review-rounds.py <translator> read [<folder> <text>…]
      writes each text's lines beside Sujato's to review/<folder>/ (read/ by default), for a
      read-through: the texts named, or every one, those with the most lines left empty first,
      about 60,000 characters to a file
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

translator, command, *rest = sys.argv[1:]
REVIEW = f'data/{translator}/review'
BATCHES = f'{REVIEW}/batches'


def segment(*flags):
    """Runs the segmenter and prints the lines that say what it kept, put up or left unwritten."""
    out = subprocess.run(['node', 'scripts/segment-translations.mjs', translator, *flags], capture_output=True, text=True)
    told = ('kept', 'up for review', 'places:', 'not written', 'no longer', 'rror')
    print(''.join(f'{line}\n' for line in (out.stdout + out.stderr).split('\n') if any(w in line for w in told)), end='')


def answers(prefix, ext):
    """Returns a batch's answers by item, from its files with the extension."""
    found = {}
    for f in sorted(glob.glob(f'{prefix}.{ext}.*'), key=lambda f: int(f.rsplit('.', 1)[1])):
        for line in open(f):
            parts = line.split()
            if len(parts) >= 2:
                found[parts[0]] = parts[1]
    return found


def mark(answer, item):
    """Returns the number of the mark an answer chooses, or None for "?" or no such mark."""
    if answer == '=':
        return item['current']
    return int(answer) if answer and answer.isdigit() and 1 <= int(answer) <= len(item['candidates']) else None


if command == 'put':
    folder, *flags = rest
    segment(*flags)
    items = {}
    for txt in sorted(glob.glob(f'{BATCHES}/batch-*.txt')):
        meta = json.load(open(txt[:-4] + '.json'))
        for block in open(txt).read().rstrip('\n').split('\n\n'):
            key = block.split('\n')[0]
            items.setdefault(key, (block, meta[key]))
    os.makedirs(f'{REVIEW}/{folder}')
    keys = list(items)
    for n, at in enumerate(range(0, len(keys), 100), 1):
        chunk = keys[at:at + 100]
        open(f'{REVIEW}/{folder}/batch-{n:03d}.txt', 'w').write('\n\n'.join(items[k][0] for k in chunk) + '\n')
        open(f'{REVIEW}/{folder}/batch-{n:03d}.json', 'w').write(json.dumps({k: items[k][1] for k in chunk}, ensure_ascii=False) + '\n')
    for f in glob.glob(f'{BATCHES}/batch-*'):
        os.remove(f)
    print(f'{folder}: {len(keys)} items')
elif command == 'keep':
    for folder in rest:
        for meta in glob.glob(f'{REVIEW}/{folder}/batch-*.json'):
            name = os.path.basename(meta)[:-5]
            shutil.copy(meta, f'{BATCHES}/{folder}-{name}.json')
            for f in glob.glob(f'{REVIEW}/{folder}/{name}.answers.*'):
                shutil.copy(f, f'{BATCHES}/{folder}-{name}.answers.{f.rsplit(".", 1)[1]}')
        segment('--answers')
elif command == 'keep-agreed':
    (folder,) = rest
    left = 0
    for meta in glob.glob(f'{REVIEW}/{folder}/batch-*.json'):
        name = os.path.basename(meta)[:-5]
        first, second = answers(meta[:-5], 'answers'), answers(meta[:-5], 'opus')
        agreed = []
        for key, item in json.load(open(meta)).items():
            chosen = mark(first.get(key), item)
            if chosen is not None and chosen == mark(second.get(key), item):
                agreed.append(f'{key} {chosen}')
            else:
                left += 1
        shutil.copy(meta, f'{BATCHES}/{folder}-{name}.json')
        open(f'{BATCHES}/{folder}-{name}.answers.1', 'w').write('\n'.join(agreed) + '\n')
    print(f'{left} left for a final look')
    segment('--answers')
elif command == 'read':
    folder, *only = rest or ['read']
    texts = []
    for path in sorted(glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True)):
        theirs = json.load(open(path))
        beside = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
        his = json.load(open(beside)) if os.path.exists(beside) else {}
        pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
        by_text = {}
        for key, text in theirs.items():
            # Title lines hold the translator's title and introduction, which no line of Sujato's matches.
            if key.split(':')[1].startswith('0.'):
                continue
            # A reader sees the words alone: without their markup, and on one line.
            words = re.sub(r'<[^>]+>', '', text).replace('\n', ' ').strip()
            by_text.setdefault(key.split(':')[0], []).append((key, his.get(key, '').strip(), words))
        for uid, lines in by_text.items():
            if (only and uid not in only) or not any(text for _, _, text in lines):
                continue
            shown = [f'{key} | {"S: " + s if s else "P: " + pali.get(key, "").strip()} | T: {text or "(none)"}' for key, s, text in lines if s or text]
            wanted = [text for _, s, text in lines if s]
            texts.append((wanted.count('') / max(1, len(wanted)), uid, shown))
    texts.sort(key=lambda t: -t[0])
    os.makedirs(f'{REVIEW}/{folder}')
    batch, size, n = [], 0, 0

    def flush():
        global batch, size, n
        if batch:
            n += 1
            open(f'{REVIEW}/{folder}/batch-{n:03d}.txt', 'w').write('\n'.join(batch) + '\n')
        batch, size = [], 0

    for _, uid, shown in texts:
        batch.append(f'## {uid}')
        for line in shown:
            if size > 60000:
                flush()
                batch.append(f'## {uid}, continued')
            batch.append(line)
            size += len(line)
        batch.append('')
        if size > 50000:
            flush()
    flush()
    print(f'{folder}: {len(texts)} texts in {n} files')
else:
    sys.exit(__doc__)
