"""Screen oversized translation rows in a frozen repository copy.

Word counts and character counts both matter: Pali compounds make word ratios
large without making the English unusually long. The union catches the named
SN 1.8 example, whose character ratio is large but word ratio is below eight.
"""
import argparse
import hashlib
import html
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent
ABBREVIATED = re.compile(r'…|\.\.\.|\bpe\b|peyyāla', re.I)


def plain(text):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', '', text)).split())


def scan(root):
    candidates, omitted = [], []
    for translator in ('thanissaro', 'bodhi'):
        base = root / 'data' / translator / 'sutta'
        reports = json.loads((root / 'data' / translator / 'report.json').read_text())
        for path in sorted(base.rglob('*.json')):
            relative = path.relative_to(base)
            pali = json.loads((root / 'data/pali/sutta' / str(relative).replace(
                f'_translation-en-{translator}', '_root-pli-ms')).read_text())
            sujato_path = root / 'data/sujato/sutta' / str(relative).replace(
                f'-en-{translator}', '-en-sujato')
            sujato = json.loads(sujato_path.read_text()) if sujato_path.exists() else {}
            translated = json.loads(path.read_text())
            keys = list(pali)
            for key, value in translated.items():
                if key.split(':')[1].startswith('0.'):
                    continue
                english, original = plain(value), plain(pali.get(key, ''))
                if not english or not original:
                    continue
                word_ratio = len(english.split()) / len(original.split())
                char_ratio = len(english) / len(original)
                if not ((len(english.split()) >= 35 and word_ratio >= 8)
                        or (len(english) >= 200 and char_ratio >= 6)):
                    continue
                uid = key.split(':')[0]
                sources = [row['file'] for row in reports if uid in row['uids'].split()]
                at = keys.index(key)
                row = {'translator': translator, 'key': key,
                       'translationFile': str(path.relative_to(root)),
                       'sources': sources, 'pali': original, 'english': english,
                       'wordRatio': word_ratio, 'characterRatio': char_ratio,
                       'englishWords': len(english.split()), 'englishCharacters': len(english),
                       'context': [{'key': k, 'pali': pali[k], 'sujato': sujato.get(k, ''),
                                    'english': translated.get(k, '')}
                                   for k in keys[max(0, at - 2):min(len(keys), at + 7)]]}
                (omitted if ABBREVIATED.search(original) else candidates).append(row)
    return {'criteria': 'English >=35 words and >=8x Pali words, OR English >=200 characters '
                        'and >=6x Pali characters; title rows and empty Pali excluded',
            'abbreviationRule': 'Pali containing ellipsis, pe, or peyyāla is excluded and saved separately',
            'root': str(root), 'candidates': candidates, 'abbreviatedExcluded': omitted}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/private/tmp/sutamaya-page-parsing'))
    args = parser.parse_args()
    result = scan(args.root)
    (OUT / 'scan.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    evidence = OUT / 'evidence'
    evidence.mkdir(exist_ok=True)
    lines = []
    for n, item in enumerate(result['candidates'], 1):
        item['number'] = n
        lines += [f'## {n}: {item["translator"]} {item["key"]}',
                  f'Ratios: words {item["wordRatio"]:.1f}; characters {item["characterRatio"]:.1f}',
                  'Sources: ' + ', '.join(item['sources'])]
        for source in item['sources']:
            source_path = args.root / 'data/upstream' / item['translator'] / source
            target = evidence / (item['translator'] + '-' + source.replace('/', '_'))
            if not target.exists():
                target.write_bytes(source_path.read_bytes())
        for row in item['context']:
            lines.append(f'{row["key"]} | P: {plain(row["pali"])} | '
                         f'S: {plain(row["sujato"])} | T: {row["english"]!r}')
        lines.append('')
    (OUT / 'scan.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'candidates.txt').write_text('\n'.join(lines) + '\n')
    for translator in ('thanissaro', 'bodhi'):
        count = sum(c['translator'] == translator for c in result['candidates'])
        excluded = sum(c['translator'] == translator for c in result['abbreviatedExcluded'])
        print(f'{translator}: {count} candidates; {excluded} abbreviated rows separately excluded')
