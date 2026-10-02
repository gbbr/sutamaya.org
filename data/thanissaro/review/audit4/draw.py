"""Draws the fourth audit's texts: about 2,500 of Thanissaro's lines from DN and MN, DN's up to half of them, none from a text an earlier audit drew."""
import glob, json, os, random, re
SEED = 20261004
# The lines `read --every` lists, by text: those with Sujato's English, Thanissaro's or the Pali, but the title lines.
listed, translated = {}, set()
for path in sorted(glob.glob('data/thanissaro/sutta/[dm]n/**/*.json', recursive=True)):
    sujato = path.replace('data/thanissaro/', 'data/sujato/').replace('-en-thanissaro.json', '-en-sujato.json')
    his = json.load(open(sujato)) if os.path.exists(sujato) else {}
    pali = json.load(open(path.replace('data/thanissaro/', 'data/pali/').replace('_translation-en-thanissaro.json', '_root-pli-ms.json')))
    for key, text in json.load(open(path)).items():
        uid, line = key.split(':')
        text = re.sub(r'<[^>]+>', '', text).strip()
        if line.startswith('0.') or not (text or his.get(key, '').strip() or pali.get(key, '').strip()):
            continue
        listed[uid] = listed.get(uid, 0) + 1
        if text:
            translated.add(uid)
# The texts the earlier audits drew.
drawn = {line[3:].split(',')[0].strip() for path in glob.glob('data/thanissaro/review/audit*/batch-*.txt') if '/audit4/' not in path for line in open(path) if line.startswith('## ')}
rng = random.Random(SEED)
# Each collection's texts in random order, taken until the lines drawn so far reach its mark: at least one text each.
total = 0
for c, mark in (('dn', 1250), ('mn', 2500)):
    pool = sorted(uid for uid in translated - drawn if re.match(c + r'\d', uid))
    rng.shuffle(pool)
    chosen = []
    for uid in pool:
        if chosen and total >= mark:
            break
        chosen.append(uid)
        total += listed[uid]
    print(c, len(pool), sum(listed[uid] for uid in chosen), ' '.join(chosen))
