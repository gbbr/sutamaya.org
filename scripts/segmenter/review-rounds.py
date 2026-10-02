#!/usr/bin/env python3
"""Moves review batches between the segmenter and the folders reviewers answer.

Run from the repository's root:

  scripts/segmenter/review-rounds.py <translator> put <folder> <segmenter flags…>
      runs the segmenter with the flags and moves the batches it writes to review/<folder>/,
      100 items to a file
  scripts/segmenter/review-rounds.py <translator> keep <folder>…
      keeps the answers in each review/<folder>/ in cuts.json, one folder after another
  scripts/segmenter/review-rounds.py <translator> keep-agreed <folder>
      keeps the answers a first pass (.answers) and a second opinion (.opus) agree on
  scripts/segmenter/review-rounds.py <translator> read [<folder> [--every] <text>…]
      writes each text's lines beside Sujato's to review/<folder>/ (read/ by default), for a
      read-through: the texts named, or every one, those with the most lines left empty first,
      about 60,000 characters to a file; --every lists the lines with only Pali too, for an audit
  scripts/segmenter/review-rounds.py <translator> flagged [<folder>]
      writes the findings the segmenter's last --findings run couldn't apply, each in the stretch
      of its text around it, line by line beside Sujato's, to review/<folder>/ (flagged/ by
      default), about 60,000 characters to a file
  scripts/segmenter/review-rounds.py <translator> disputed [<folder>]
      writes the lines readers disagree on, as flagged does, each with every reader's finding, to
      review/<folder>/ (disputed/ by default)
  scripts/segmenter/review-rounds.py <translator> empty [<folder>]
      writes each line a read-through leaves out, with Pali but no English of Sujato's or the
      translation's, in the stretch of its text around it, to review/<folder>/ (empty/ by
      default), about 60,000 characters to a file
  scripts/segmenter/review-rounds.py <translator> cross [<folder>]
      writes each line the translation leaves empty where the other translation suggests its text
      runs on from the line next door, in the stretch around it with both translations, to
      review/<folder>/ (cross/ by default), about 60,000 characters to a file; a line an earlier
      batch in review/cross*/ showed is left out
  scripts/segmenter/review-rounds.py <translator> lists [<folder>]
      writes each line holding a list parted by ellipses, followed by lines the translation leaves
      empty where Sujato gives the items one a line, to review/<folder>/ (lists/ by default); a
      line an earlier batch in review/lists*/ showed is left out
  scripts/segmenter/review-rounds.py <translator> check <path> [<seed>]
      writes 50 of the passing groups in review/findings.json to <path>, for Opus to judge: an even
      share from each collection, all of one that has fewer, the rest drawn from the others
"""
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys

translator, command, *rest = sys.argv[1:]
REVIEW = f'data/{translator}/review'
BATCHES = f'{REVIEW}/batches'
# The passing groups a check draws for Opus to judge.
CHECKED = 50


def write_stretches(folder, stretches):
    """Writes stretches of text to review/<folder>/, about 60,000 characters to a file, and returns how many files."""
    if stretches:
        os.makedirs(f'{REVIEW}/{folder}')
    batch, size, n = [], 0, 0
    for stretch in stretches + [None]:
        if batch and (stretch is None or size + len(stretch) > 60000):
            n += 1
            open(f'{REVIEW}/{folder}/batch-{n:03d}.txt', 'w').write('\n\n'.join(batch) + '\n')
            batch, size = [], 0
        if stretch:
            batch.append(stretch)
            size += len(stretch)
    return n


def shown_before(round_name):
    """Returns the lines the earlier batches of a round showed, in every review/<round_name>*/ folder."""
    return {m[1] for path in glob.glob(f'{REVIEW}/{round_name}*/batch-*.txt') for m in re.finditer(r'^(\S+:\S+) \| ', open(path).read(), re.M)}


def segment(*flags):
    """Runs the segmenter and prints the lines that say what it kept, put up or left unwritten."""
    out = subprocess.run(['node', 'scripts/segmenter/segment-translations.mjs', translator, *flags], capture_output=True, text=True)
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
    every = '--every' in only
    only = [uid for uid in only if uid != '--every']
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
            shown = [f'{key} | {"S: " + s if s else "P: " + pali.get(key, "").strip()} | T: {text or "(none)"}' for key, s, text in lines if s or text or (every and pali.get(key, '').strip())]
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
elif command in ('flagged', 'disputed'):
    (folder,) = rest or [command]
    found = json.load(open(f'{REVIEW}/findings.json'))
    if command == 'flagged':
        todo = [(o['key'], o['starts']) for o in found['others'] if o['status'] == 'not found']
        todo += [(f['key'], f['starts']) for g in found['groups'] if g['verdict'] != 'passes' for f in g['findings']]
    else:
        todo = [(d['key'], starts) for d in found['disputed'] for starts in d['starts']]
    words = lambda s: re.sub(r'[^\w\s]', ' ', s).lower().split()
    files = {key: path for path in glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True) for key in json.load(open(path))}
    docs = {}

    def rows_of(path):
        """Returns a document's lines that have Sujato's English or the translation's, or for disputed any Pali, but its title lines."""
        if path not in docs:
            theirs = json.load(open(path))
            beside = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
            his = json.load(open(beside)) if os.path.exists(beside) else {}
            pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
            docs[path] = []
            for key, text in theirs.items():
                s, text = his.get(key, '').strip(), ' '.join(re.sub(r'<[^>]+>', '', text).split())
                if not key.split(':')[1].startswith('0.') and (s or text or (command == 'disputed' and pali.get(key, '').strip())):
                    docs[path].append((key, f'S: {s}' if s else f'P: {pali.get(key, "").strip()}', text))
        return docs[path]

    # Each finding still off, as a window of its document's lines: its own line and the nearest
    # holding its words, with two lines either side.
    windows = {}
    for key, starts in todo:
        rows = rows_of(files[key])
        keys = [row[0] for row in rows]
        if key not in keys:
            continue
        i = j = keys.index(key)
        now, opening = words(rows[i][2]), words(starts or '')[:4]
        if command == 'flagged' and ((starts is None and not now) or (starts is not None and now[:len(opening)] == opening)):
            continue
        if starts:
            quoted = ' '.join(words(starts)[:5])
            near = [x for x in range(max(0, i - 12), min(len(rows), i + 13)) if quoted in ' '.join(words(rows[x][2]))]
            if near:
                j = min(near, key=lambda x: abs(x - i))
        windows.setdefault(files[key], []).append([max(0, min(i, j) - 2), min(len(rows) - 1, max(i, j) + 2), [f'Reported: {key} ' + (f'starts: {starts}' if starts else 'none')]])
    # Overlapping windows join into one stretch.
    stretches = []
    for path, ws in windows.items():
        ws.sort()
        joined = []
        for w in ws:
            if joined and w[0] <= joined[-1][1] + 1:
                joined[-1][1] = max(joined[-1][1], w[1])
                joined[-1][2] += w[2]
            else:
                joined.append(w)
        rows = docs[path]
        for lo, hi, reports in joined:
            shown = [f'{key} | {said} | T: {text or "(none)"}' for key, said, text in rows[lo:hi + 1]]
            stretches.append('\n'.join([f'## {os.path.basename(path).split("_")[0]}', *shown, *dict.fromkeys(reports)]))
    n = write_stretches(folder, stretches)
    print(f'{folder}: {sum(len(w[2]) for ws in windows.values() for w in ws)} findings in {len(stretches)} stretches, in {n} files')
elif command == 'empty':
    (folder,) = rest or ['empty']
    stretches, hidden = [], 0
    for path in sorted(glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True)):
        theirs = json.load(open(path))
        beside = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
        his = json.load(open(beside)) if os.path.exists(beside) else {}
        pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
        if not any(theirs.values()):
            continue
        # The lines a read-through shows, and those it leaves out: no English of either, but Pali.
        rows = []
        for key, text in theirs.items():
            s, text, p = his.get(key, '').strip(), ' '.join(re.sub(r'<[^>]+>', '', text).split()), pali.get(key, '').strip()
            if key.split(':')[1].startswith('0.') or not (s or text or p):
                continue
            rows.append((key, f'S: {s}' if s else f'P: {p}', text, not (s or text)))
        # A sutta's closing, after its last line with English: its number, and a chapter's summary verse.
        last = {row[0].split(':')[0]: i for i, row in enumerate(rows) if not row[3]}
        rows = [row for i, row in enumerate(rows) if i <= last.get(row[0].split(':')[0], -1)]
        # Each left-out line, with two lines either side; overlapping windows join into one stretch.
        joined = []
        for i, row in enumerate(rows):
            if not row[3]:
                continue
            hidden += 1
            lo, hi = max(0, i - 2), min(len(rows) - 1, i + 2)
            if joined and lo <= joined[-1][1] + 1:
                joined[-1][1] = hi
            else:
                joined.append([lo, hi])
        for lo, hi in joined:
            shown = [f'{key} | {said} | T: {text or "(none)"}' for key, said, text, _ in rows[lo:hi + 1]]
            stretches.append('\n'.join([f'## {os.path.basename(path).split("_")[0]}', *shown]))
    n = write_stretches(folder, stretches)
    print(f'{folder}: {hidden} lines in {len(stretches)} stretches, in {n} files')
elif command == 'cross':
    (folder,) = rest or ['cross']
    other = 'thanissaro' if translator == 'bodhi' else 'bodhi'
    words = lambda html: ' '.join(re.sub(r'<[^>]+>', '', html).split())
    # A sentence's end and the next one's start, inside a line.
    BREAK = re.compile(r'\S{2,}[.?!][’”\']*\s+[“‘"]*[A-Z(]')
    stretches, marked, seen = [], 0, shown_before('cross')
    for path in sorted(glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True)):
        beside = path.replace(f'data/{translator}/', f'data/{other}/').replace(f'-en-{translator}.json', f'-en-{other}.json')
        if not os.path.exists(beside):
            continue
        theirs, others = json.load(open(path)), json.load(open(beside))
        sujato = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
        his = json.load(open(sujato)) if os.path.exists(sujato) else {}
        pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
        keys = [key for key in theirs if not key.split(':')[1].startswith('0.')]
        count = lambda lines, key: len(words(lines.get(key, '')).split())
        both = {key.split(':')[0] for key in keys if count(theirs, key)} & {key.split(':')[0] for key in keys if count(others, key)}
        # Each line this translation leaves empty and the other fills, where this translation's line
        # next door holds about as much as the other's two lines and a sentence break.
        marks = []
        for i, key in enumerate(keys):
            if key in seen or key.split(':')[0] not in both or count(theirs, key) or count(others, key) < 5:
                continue
            for j in (i - 1, i + 1):
                if 0 <= j < len(keys) and keys[j].split(':')[0] == key.split(':')[0]:
                    here, there = count(theirs, keys[j]), count(others, keys[j])
                    if there >= 3 and here >= 0.75 * (there + count(others, key)) and here > 1.4 * there and BREAK.search(words(theirs[keys[j]])):
                        marks.append(i)
                        break
        marked += len(marks)
        # Each marked line, with two lines either side; overlapping windows join into one stretch.
        joined = []
        for i in marks:
            lo, hi = max(0, i - 2), min(len(keys) - 1, i + 2)
            if joined and lo <= joined[-1][1] + 1:
                joined[-1][1] = hi
            else:
                joined.append([lo, hi])
        for lo, hi in joined:
            shown = []
            for key in keys[lo:hi + 1]:
                said = f'S: {his[key].strip()}' if his.get(key, '').strip() else f'P: {pali.get(key, "").strip()}'
                shown.append(f'{key} | {said} | T: {words(theirs.get(key, "")) or "(none)"} | O: {words(others.get(key, "")) or "(none)"}')
            stretches.append('\n'.join([f'## {os.path.basename(path).split("_")[0]}', *shown]))
    n = write_stretches(folder, stretches)
    print(f'{folder}: {marked} lines in {len(stretches)} stretches, in {n} files')
elif command == 'lists':
    (folder,) = rest or ['lists']
    words = lambda html: ' '.join(re.sub(r'<[^>]+>', '', html).split())
    stretches, marked, seen = [], 0, shown_before('lists')
    for path in sorted(glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True)):
        theirs = json.load(open(path))
        sujato = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
        his = json.load(open(sujato)) if os.path.exists(sujato) else {}
        pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
        keys = [key for key in theirs if not key.split(':')[1].startswith('0.')]
        # Each line holding three or more items parted by ellipses, followed by two or more lines it
        # leaves empty and Sujato fills, with a line either side.
        for i, key in enumerate(keys):
            if key in seen or len([part for part in re.split(r'\s*…\s*', words(theirs[key])) if part.strip()]) < 3:
                continue
            j = i + 1
            while j < len(keys) and keys[j].split(':')[0] == key.split(':')[0] and not words(theirs[keys[j]]) and his.get(keys[j], '').strip():
                j += 1
            if j - i - 1 < 2:
                continue
            marked += 1
            shown = []
            for line in keys[max(0, i - 1):min(len(keys), j + 1)]:
                said = f'S: {his[line].strip()}' if his.get(line, '').strip() else f'P: {pali.get(line, "").strip()}'
                shown.append(f'{line} | {said} | T: {words(theirs.get(line, "")) or "(none)"}')
            stretches.append('\n'.join([f'## {os.path.basename(path).split("_")[0]}', *shown]))
    n = write_stretches(folder, stretches)
    print(f'{folder}: {marked} lines in {len(stretches)} stretches, in {n} files')
elif command == 'check':
    out, *seed = rest
    name = {'bodhi': 'Bhikkhu Bodhi', 'thanissaro': 'Ṭhānissaro Bhikkhu'}[translator]
    passing = [g for g in json.load(open(f'{REVIEW}/findings.json'))['groups'] if g['verdict'] == 'passes']
    # The passing groups by collection; the Khuddaka Nikāya's books count as one.
    by = {}
    for group in passing:
        collection = re.match(r'[a-z]+', group['text'])[0]
        by.setdefault(collection if collection in ('dn', 'mn', 'sn', 'an') else 'kn', []).append(group)
    rng = random.Random(int(seed[0]) if seed else None)
    # An even share from each collection, all of one that has fewer, the rest from the others.
    drawn, share = [], CHECKED // max(1, len(by))
    for collection in sorted(by):
        rng.shuffle(by[collection])
        drawn += by[collection][:share]
    left = [g for c in sorted(by) for g in by[c][share:]]
    drawn += rng.sample(left, min(len(left), CHECKED - len(drawn)))
    items = []
    for i, group in enumerate(drawn, 1):
        lines = [f'## {i} ({name}, {group["text"]})']
        for line in group['lines']:
            said = f'S: {line["sujato"]}' if line.get('sujato') else f'P: {line.get("pali", "")}'
            lines += [f'{line["key"]} | {said}', f'  Before: {line["before"] or "(none)"}', f'  After: {line["after"] or "(none)"}']
        items.append('\n'.join(lines))
    open(out, 'w').write('\n\n'.join(items) + '\n')
    print(f'check: {len(drawn)} of {len(passing)} passing groups, ' + ', '.join(f'{c} {sum(g in by[c] for g in drawn)}' for c in sorted(by)))
else:
    sys.exit(__doc__)
