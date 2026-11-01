#!/usr/bin/env python3
"""Writes a round's stretches for fixes by hand, and the judge's packets.

Run from the repository's root:

  scripts/segmenter/review-rounds.py <translator> flagged [<folder>]
      writes the findings the segmenter's last --findings run couldn't apply, each in the stretch
      of its text around it, line by line beside the Pali and Sujato's, to review/<folder>/
      (flagged/ by default), about 60,000 characters to a file
  scripts/segmenter/review-rounds.py <translator> check [<folder>] [--base <revision>]
      writes every change to the translation since a commit, the last one by default: each line
      whose text, note or place in covered.json changed, in the stretch from the line with text
      above it to the one below, each line with its Pali, Sujato's English and the translation
      before and after, to review/<folder>/ (check/ by default), 50 to a file, for a judge from
      another model
"""
import glob
import json
import os
import re
import subprocess
import sys

translator, command, *rest = sys.argv[1:]
REVIEW = f'data/{translator}/review'
# The changes a check writes to a file.
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


if command == 'flagged':
    (folder,) = rest or ['flagged']
    found = json.load(open(f'{REVIEW}/findings.json'))
    todo = [(o['key'], o['starts']) for o in found['others'] if o['status'] == 'not found']
    todo += [(f['key'], f['starts']) for g in found['groups'] if g['verdict'] != 'passes' for f in g['findings']]
    words = lambda s: re.sub(r'[^\w\s]', ' ', s).lower().split()
    files = {key: path for path in glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True) for key in json.load(open(path))}
    docs = {}

    def rows_of(path):
        """Returns a document's lines but its title lines, each with its Pali and Sujato's English."""
        if path not in docs:
            theirs = json.load(open(path))
            beside = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
            his = json.load(open(beside)) if os.path.exists(beside) else {}
            pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
            docs[path] = []
            for key, text in theirs.items():
                p, s = pali.get(key, '').strip(), his.get(key, '').strip()
                # A ⏎ where a verse line of the translator's starts inside the line.
                text = ' '.join(re.sub(r'<[^>]+>', '', text.replace('\n', ' ⏎ ')).split())
                if not key.split(':')[1].startswith('0.') and (p or s or text):
                    docs[path].append((key, f'P: {p or "(none)"} | S: {s or "(none)"}', text))
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
        if (starts is None and not now) or (starts is not None and now[:len(opening)] == opening):
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
elif command == 'check':
    args = list(rest)
    base = 'HEAD'
    if '--base' in args:
        at = args.index('--base')
        base = args[at + 1]
        del args[at:at + 2]
    (folder,) = args or ['check']
    name = {'bodhi': 'Bhikkhu Bodhi', 'thanissaro': 'Ṭhānissaro Bhikkhu'}[translator]
    if subprocess.run(['git', 'rev-parse', '--verify', '--quiet', f'{base}^{{commit}}'], capture_output=True).returncode:
        sys.exit(f'No commit named {base}')
    # A line as a reader sees it: its words, a ⏎ where a verse line of the translator's starts.
    shown = lambda text: ' '.join(re.sub(r'<[^>]+>', '', text.replace('\n', ' ⏎ ')).split()) or '(none)'
    # A note as a reader sees it, with where each of its links goes.
    noted = lambda text: shown(re.sub(r"<a\b[^>]*href=['\"]([^'\"]*)['\"][^>]*>(.*?)</a>", r'\2 [\1]', text))

    def committed(path):
        """Returns a file's JSON at the base revision, or an empty one where it has none."""
        out = subprocess.run(['git', 'show', f'{base}:{path}'], capture_output=True, text=True)
        return json.loads(out.stdout) if out.returncode == 0 else {}

    def git_paths(*command):
        out = subprocess.run(['git', *command], capture_output=True, text=True)
        if out.returncode:
            sys.exit(out.stderr)
        return out.stdout.split()

    covered = set(json.load(open(f'data/{translator}/covered.json')))
    was_covered = set(committed(f'data/{translator}/covered.json') or [])
    # The texts whose lines, notes or coverage changed since the base.
    places = [f'data/{translator}/sutta', f'data/{translator}/notes']
    paths = set(git_paths('diff', '--name-only', base, '--', *places) + git_paths('ls-files', '--others', '--exclude-standard', '--', *places))
    texts = {p.replace('/notes/', '/sutta/').replace('_comment-', '_translation-') for p in paths}
    if covered != was_covered:
        uids = {key.split(':')[0] for key in covered ^ was_covered}
        texts |= {p for p in glob.glob(f'data/{translator}/sutta/**/*.json', recursive=True) if uids & {k.split(':')[0] for k in json.load(open(p))}}
    items = []
    for path in sorted(texts):
        theirs, before = json.load(open(path)) if os.path.exists(path) else {}, committed(path)
        notes_path = path.replace('/sutta/', '/notes/').replace('_translation-', '_comment-')
        notes, notes_before = json.load(open(notes_path)) if os.path.exists(notes_path) else {}, committed(notes_path)
        beside = path.replace(f'data/{translator}/', 'data/sujato/').replace(f'-en-{translator}.json', '-en-sujato.json')
        his = json.load(open(beside)) if os.path.exists(beside) else {}
        pali = json.load(open(path.replace(f'data/{translator}/', 'data/pali/').replace(f'_translation-en-{translator}.json', '_root-pli-ms.json')))
        markup_path = path.replace(f'data/{translator}/sutta/', 'data/html/pli/ms/sutta/').replace(f'_translation-en-{translator}.json', '_html.json')
        markup = json.load(open(markup_path)) if os.path.exists(markup_path) else {}
        # Every line either version has, a line the text has lost among them.
        keys = list(dict.fromkeys([*before, *theirs]))
        moved = lambda k: (k not in theirs or theirs[k] != before.get(k, '') or notes.get(k, '') != notes_before.get(k, '')
                           or (k in covered) != (k in was_covered))
        holds = lambda x: bool(theirs.get(keys[x], '').strip() or before.get(keys[x], '').strip())
        # Each change, from the nearest line above with text to the nearest below; overlapping ones join.
        spans = []
        for x in (x for x, k in enumerate(keys) if moved(k)):
            lo, hi = x - 1, x + 1
            while lo > 0 and not holds(lo):
                lo -= 1
            while hi < len(keys) - 1 and not holds(hi):
                hi += 1
            lo, hi = max(lo, 0), min(hi, len(keys) - 1)
            if spans and lo <= spans[-1][1]:
                spans[-1][1] = max(spans[-1][1], hi)
            else:
                spans.append([lo, hi])
        for lo, hi in spans:
            lines = [f'({name}, {os.path.basename(path).split("_")[0]})']
            for k in keys[lo:hi + 1]:
                said = f'{k} | P: {pali.get(k, "").strip() or "(none)"} | S: {his.get(k, "").strip() or "(none)"}'
                after = shown(theirs[k]) if k in theirs else '(the line is gone from the text)'
                lines += [said + (' | verse' if 'verse-line' in markup.get(k, '') else ''),
                          f'  Before: {shown(before.get(k, ""))}', f'  After: {after}']
                if (k in covered) != (k in was_covered):
                    lines.append(f'  Covered: Before {"yes" if k in was_covered else "no"}, After {"yes" if k in covered else "no"}')
                if notes.get(k, '') != notes_before.get(k, ''):
                    lines += [f'  Note before: {noted(notes_before.get(k, ""))}', f'  Note after: {noted(notes.get(k, ""))}']
            items.append(lines)
    os.makedirs(f'{REVIEW}/{folder}')
    n = 0
    for n, at in enumerate(range(0, len(items), CHECKED), 1):
        chunk = [f'## {i} ' + '\n'.join(lines) for i, lines in enumerate(items[at:at + CHECKED], 1)]
        open(f'{REVIEW}/{folder}/batch-{n:03d}.txt', 'w').write('\n\n'.join(chunk) + '\n')
    print(f'{folder}: {len(items)} changes since {base}, in {n} files')
else:
    sys.exit(__doc__)
