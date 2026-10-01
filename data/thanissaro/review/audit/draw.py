"""Draws the audit's texts: 12 of Thanissaro's, spread over his collections in proportion to their size."""
import glob, json, random, re
SEED = 20261001
texts = {}
for path in sorted(glob.glob('data/thanissaro/sutta/**/*.json', recursive=True)):
    coll = path.split('/')[3]
    for key, text in json.load(open(path)).items():
        if key.split(':')[1].startswith('0.') or not re.sub(r'<[^>]+>', '', text).strip():
            continue
        texts.setdefault(coll, set()).add(key.split(':')[0])
total = sum(len(v) for v in texts.values())
quota = {c: 12 * len(v) / total for c, v in texts.items()}
n = {c: int(q) for c, q in quota.items()}
for c in sorted(quota, key=lambda c: -(quota[c] - n[c]))[:12 - sum(n.values())]:
    n[c] += 1
rng = random.Random(SEED)
for c in sorted(texts):
    pool = sorted(texts[c])
    print(c, len(pool), f'{quota[c]:.2f}', n[c], ' '.join(rng.sample(pool, n[c])))
