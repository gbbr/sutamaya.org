"""Regression checks for full and shortened source passages with identical endings."""
from pathlib import Path
import importlib.util
import json
import tempfile

ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location('check_round', ROOT / 'scripts/segmenter/check-round.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

with tempfile.TemporaryDirectory() as folder:
    base = Path(folder)
    page = base / 'data/upstream/bodhi/sutta/example.html'
    page.parent.mkdir(parents=True)
    page.write_text('<article><p>Full opening.<br>Repeated closing.</p>'
                    '<p>Short opening …<br>Repeated closing.</p>'
                    '<p>The remainder is identical. Verses 906–7 = 904–5.</p></article>')
    check.ROOT = base
    text = {'full:1': 'Full opening.', 'full:2': 'Repeated closing.',
            'short:1': 'Short opening …', 'short:2': 'Repeated closing.',
            'note:1': 'Verses 906–7 = 904–5.', 'unknown:1': 'Absent words.'}
    assert check.source_shortened_keys('bodhi', ['sutta/example.html'], text) == {
        'short:1', 'short:2', 'note:1'}
    assert check.source_shortened_keys('bodhi', [], text) == set()
    assert check.source_shortened_keys('bodhi', ['sutta/example.html'],
                                       {'unknown:1': 'Absent words.'}) == set()
check.ROOT = ROOT
path = next((ROOT / 'data/bodhi/sutta').rglob('sn35.95_translation-en-bodhi.json'))
text = json.loads(path.read_text())
shortened = check.source_shortened_keys('bodhi', ['sutta/sn/sn35/sn35.95.html'], text)
assert 'sn35.95:13.5' not in shortened and 'sn35.95:13.6' not in shortened
assert {'sn35.95:23.5', 'sn35.95:23.6', 'sn35.95:35.5', 'sn35.95:35.6'} <= shortened
print('Source contexts: repeated full and shortened endings distinguished; notes recognised; unmatched text not exempted.')
