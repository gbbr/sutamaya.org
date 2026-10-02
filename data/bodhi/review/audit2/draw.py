"""Draws the second audit's texts: 12 of Bodhi's, spread over his collections in proportion to their size, none the first audit drew."""
import glob, json, random, re
SEED = 20261002
texts = {}
for path in sorted(glob.glob('data/bodhi/sutta/**/*.json', recursive=True)):
    coll = path.split('/')[3]
    for key, text in json.load(open(path)).items():
        if key.split(':')[1].startswith('0.') or not re.sub(r'<[^>]+>', '', text).strip():
            continue
        texts.setdefault(coll, set()).add(key.split(':')[0])
# The texts the first audit drew.
drawn = {line[3:].split(',')[0].strip() for path in glob.glob('data/bodhi/review/audit/batch-*.txt') for line in open(path) if line.startswith('## ')}
texts = {c: v - drawn for c, v in texts.items()}
total = sum(len(v) for v in texts.values())
quota = {c: 12 * len(v) / total for c, v in texts.items()}
n = {c: int(q) for c, q in quota.items()}
for c in sorted(quota, key=lambda c: -(quota[c] - n[c]))[:12 - sum(n.values())]:
    n[c] += 1
rng = random.Random(SEED)
for c in sorted(texts):
    pool = sorted(texts[c])
    print(c, len(pool), f'{quota[c]:.2f}', n[c], ' '.join(rng.sample(pool, n[c])))
