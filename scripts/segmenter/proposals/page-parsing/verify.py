"""Verify exact movement of commentary, remaining translation order, and changed-file scope."""
import difflib
import hashlib
import html
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = Path('/private/tmp/sutamaya-page-parsing')


def plain(s):
    s = re.sub(r'</(?:p|div)>', ' ', s)
    return ' '.join(unicodedata.normalize('NFKC', html.unescape(re.sub(r'<[^>]+>', '', s))).split())


def stream(doc, body=False):
    return plain(' '.join(v for k, v in doc.items() if not body or not k.split(':')[1].startswith('0.')))


baseline = json.loads((OUT / 'corpus-baseline-hashes.json').read_text())
moved = json.loads((OUT / 'moved-passages.json').read_text())
changed = []
current = {}
for translator in ('thanissaro', 'bodhi'):
    for kind in ('sutta', 'notes'):
        for f in sorted((ROOT / 'data' / translator / kind).rglob('*.json')):
            rel = str(f.relative_to(ROOT))
            current[rel] = hashlib.sha256(f.read_bytes()).hexdigest()
            if current[rel] != baseline.get(rel):
                changed.append(rel)
assert not set(baseline) - set(current), 'Corpus files disappeared'
uids = {row['uid'] for row in moved}
assert len(changed) == 18, changed
assert all('/thanissaro/' in f and f.split('/')[-1].split('_')[0] in uids for f in changed), changed
checks = []
for row in moved:
    uid = row['uid']
    rel = next(f for f in changed if '/sutta/' in f and Path(f).name == f'{uid}_translation-en-thanissaro.json')
    old = json.loads((OUT / 'baseline' / rel).read_text())
    new = json.loads((ROOT / rel).read_text())
    before, after = stream(old, True), stream(new, True)
    removed = plain(' '.join(p['text'] for p in row['passages']))
    assert before.count(removed) == 1, (uid, 'Movement must be one exact, unique source span', removed)
    expected = plain(before.replace(removed, '', 1))
    assert expected == after, (uid, 'Remaining translation words or order changed', expected, after)
    nr = next(f for f in changed if '/notes/' in f and Path(f).name == f'{uid}_comment-en-thanissaro.json')
    old_note = json.loads((OUT / 'baseline' / nr).read_text()) if (OUT / 'baseline' / nr).exists() else {}
    new_note = json.loads((ROOT / nr).read_text())
    old_words, new_words = stream(old_note).split(), stream(new_note).split()
    removed_words = removed.split()
    assert Counter(new_words) - Counter(old_words) == Counter(removed_words), (uid, 'Added note words differ')
    assert not Counter(old_words) - Counter(new_words), (uid, 'Existing note words lost')
    assert removed in stream(new_note), (uid, 'Moved passage order changed')
    if row['cause'] == 'alternative rendering':
        assert stream(new_note).index(removed) < stream(new_note).index('See also:'), (uid, 'Alternative follows references')
    row['translationFile'] = rel
    row['sourceKeys'] = [k for k in old if old[k] != new[k]]
    row['notesFile'] = nr
    row['destinationKeys'] = [k for k, v in new_note.items() if removed in plain(v)]
    checks.append({'uid': uid, 'passages': len(row['passages']), 'movedWords': len(removed_words),
                   'remainingTranslationExact': True, 'movedPassageExact': True, 'allNoteWordsPreserved': True})

patch = []
for rel, digest in json.loads((OUT / 'baseline-hashes.json').read_text()).items():
    live = OUT.parents[3] / rel
    assert hashlib.sha256(live.read_bytes()).hexdigest() == digest, f'Current script changed: {rel}'
    patched = ROOT / rel
    if live.read_bytes() != patched.read_bytes():
        patch.extend(difflib.unified_diff(live.read_text().splitlines(True), patched.read_text().splitlines(True),
                                        fromfile='a/' + rel, tofile='b/' + rel))
(OUT / 'page-parsing.patch').write_text(''.join(patch))
(OUT / 'verification.json').write_text(json.dumps({'changedFiles': changed, 'checks': checks,
                                                 'bodhiUnchanged': True, 'allOtherCorpusFilesExact': True,
                                                 'corpusFilesCompared': len(current)}, ensure_ascii=False, indent=2) + '\n')
(OUT / 'moved-passages.json').write_text(json.dumps(moved, ensure_ascii=False, indent=2) + '\n')
(OUT / 'post-regeneration-hashes.json').write_text(json.dumps(current, indent=2) + '\n')
print(f'{len(current)} corpus files checked; {len(changed)} changed in {len(checks)} texts; all movements exact; all remaining translation words/order exact; Bodhi unchanged')
