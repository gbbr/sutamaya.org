"""Isolated application helpers for the verse-open and audit6 reviews.

All main-worktree writes are confined to data/thanissaro. This does not commit.
"""
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DIRECTIVE = re.compile(r'^(\S+:\S+) (?:starts: (.+)|none)$')


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def corpus_hashes(root):
    base = root / 'data/thanissaro'
    paths = sorted((base / 'sutta').rglob('*.json'))
    paths += sorted((base / 'notes').rglob('*.json'))
    paths += [base / name for name in ('cuts.json', 'covered.json')]
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


def isolate(destination):
    destination.mkdir(parents=True)
    for name in ('scripts', 'data'):
        shutil.copytree(ROOT / name, destination / name)
    for name in ('package.json', 'package-lock.json'):
        if (ROOT / name).exists():
            shutil.copy2(ROOT / name, destination / name)
    (destination / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    (destination / '.git').symlink_to(ROOT / '.git', target_is_directory=True)


def install_findings(destination, source, name, evidence):
    """Replace old directives for newly judged keys, retaining the old text as evidence."""
    directives = {}
    for line in source.read_text().splitlines():
        match = DIRECTIVE.fullmatch(line.strip())
        if match:
            if match[1] in directives and directives[match[1]] != line:
                raise ValueError(f'Conflicting accepted directive: {match[1]}')
            directives[match[1]] = line
    review = destination / 'data/thanissaro/review'
    superseded = []
    paths = [review / 'closing-lines.findings'] + sorted(review.glob('*/*.findings'))
    for path in paths:
        if not path.exists():
            continue
        lines = path.read_text().splitlines()
        changed = False
        for index, line in enumerate(lines):
            match = DIRECTIVE.fullmatch(line.strip())
            if match and match[1] in directives:
                if line.strip() == directives[match[1]].strip():
                    continue
                lines[index] = '# superseded: ' + line
                superseded.append({'file': str(path.relative_to(destination)),
                                   'directive': line, 'replacement': directives[match[1]]})
                changed = True
        if changed:
            path.write_text('\n'.join(lines) + '\n')
    target = review / 'hand' / name
    target.write_text('# Judged against original Pali; prior directives explicitly superseded.\n'
                      + '\n'.join(directives.values()) + '\n# done\n')
    save(evidence / 'superseded.json', superseded)
    return len(directives)


def copy_changes(destination, evidence):
    """Copy translator outputs and amended evidence, leaving concurrent sessions alone."""
    base = destination / 'data/thanissaro'
    changed = []
    for path in sorted(base.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(destination)
        target = ROOT / relative
        if target.exists() and target.read_bytes() == path.read_bytes():
            continue
        # Review trial outputs are copied explicitly by the caller. Do not overwrite
        # current progress or newly created packets with an older isolated snapshot.
        inner = path.relative_to(base)
        if inner.parts[0] == 'review' and path.suffix != '.findings':
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        changed.append(str(relative))
    save(evidence / 'copied-files.json', changed)
    return changed
