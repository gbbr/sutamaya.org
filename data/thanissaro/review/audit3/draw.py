"""Draws the third audit's texts: 2 of Thanissaro's from each collection, none an earlier audit drew."""
import glob, json, random, re
SEED = 20261003
texts = {}
for path in sorted(glob.glob('data/thanissaro/sutta/**/*.json', recursive=True)):
    coll = path.split('/')[3]
    for key, text in json.load(open(path)).items():
        if key.split(':')[1].startswith('0.') or not re.sub(r'<[^>]+>', '', text).strip():
            continue
        texts.setdefault(coll, set()).add(key.split(':')[0])
# The texts the earlier audits drew.
drawn = {line[3:].split(',')[0].strip() for path in glob.glob('data/thanissaro/review/audit*/batch-*.txt') for line in open(path) if line.startswith('## ')}
rng = random.Random(SEED)
for c in sorted(texts):
    pool = sorted(texts[c] - drawn)
    print(c, len(pool), ' '.join(rng.sample(pool, min(2, len(pool)))))
