# Per MN/DN text: reads so far (fullread*, audit*, round*) and line count as --every shows them.
import glob, json, os, re, sys
t = sys.argv[1]
R = f'data/{t}/review'
reads = {}
for d in sorted(glob.glob(f'{R}/fullread*/') + glob.glob(f'{R}/audit*/') + glob.glob(f'{R}/round*/')):
    seen = set()
    for b in glob.glob(d + 'batch-*.txt'):
        if not os.path.exists(b[:-4] + '.findings') and '/round' not in d: continue
        for m in re.finditer(r'^## (\S+?)(,| |$)', open(b).read(), re.M): seen.add(m[1])
    for u in seen: reads.setdefault(u, []).append(os.path.basename(d[:-1]))
lines = {}
for path in glob.glob(f'data/{t}/sutta/dn/**/*.json', recursive=True) + glob.glob(f'data/{t}/sutta/mn/**/*.json', recursive=True):
    theirs = json.load(open(path))
    beside = path.replace(f'data/{t}/', 'data/sujato/').replace(f'-en-{t}.json', '-en-sujato.json')
    his = json.load(open(beside)) if os.path.exists(beside) else {}
    pali = json.load(open(path.replace(f'data/{t}/', 'data/pali/').replace(f'_translation-en-{t}.json', '_root-pli-ms.json')))
    by = {}
    for k, v in theirs.items():
        if k.split(':')[1].startswith('0.'): continue
        w = re.sub(r'<[^>]+>', '', v).strip()
        by.setdefault(k.split(':')[0], []).append((his.get(k,'').strip() or w or pali.get(k,'').strip(), w))
    for u, ls in by.items():
        if any(w for _, w in ls): lines[u] = sum(1 for s, _ in ls if s)
rows = sorted(lines, key=lambda u: (len(reads.get(u, [])), {'mn':0,'dn':1}[u[:2]], int(re.findall(r'\d+', u)[0])))
for u in rows: print(u, lines[u], len(reads.get(u, [])), ','.join(reads.get(u, [])))
