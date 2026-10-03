"""Build a disposable, read-only probe of the current parser's remaining page prose."""
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = Path('/private/tmp/sutamaya-page-parsing')
source = (ROOT / 'scripts/segmenter/segment-translations.mjs').read_text()
source = source.split('// Words: what two translations')[0]
source += r'''
const suspects = [];
for (const file of walk(path.join(UPSTREAM, 'sutta')).filter(f => f.endsWith('.html'))) {
  for (const unit of parsePage(file)) {
    for (const root of unit.roots) {
      const paragraphs = [...root.querySelectorAll('p')];
      for (const [index, p] of paragraphs.entries()) {
        if (p.closest('[data-skip], .note, .verse') || !p.textContent.trim()) continue;
        const text = p.textContent.replace(/\s+/g, ' ').trim();
        const size = p.textContent.replace(/\s/g, '').length;
        const share = [...p.querySelectorAll('em, i')].map(e => e.textContent).join('').replace(/\s/g, '').length / size;
        const reasons = [];
        if (/^(?:Note:|See also\b|For (?:more|further)\b|\[Because\b)/i.test(text)) reasons.push('commentary opening');
        if (/alternative (?:translation|rendering)|can also be translated|following (?:translation|sutta)/i.test(text)) reasons.push('translation commentary');
        if (!/^[“‘"']/.test(text) && /(?:this|following) (?:sutta|discourse|translation)|(?:Thai|Pali|other) edition|[Cc]ommentary|[Aa]ppendix|[Ff]or an explanation|[Ff]or a discussion/.test(text)) reasons.push('editorial vocabulary');
        if (share >= 0.65) reasons.push('mostly italic prose');
        if (/\bsee\b.*\balso\b|smallcaps|dblock/i.test(p.className)) reasons.push('commentary style');
        if (reasons.length) suspects.push({ translator, file: path.relative(UPSTREAM, file), index, reasons, share, html: p.outerHTML, text,
          previous: paragraphs[index - 1]?.textContent.replace(/\s+/g, ' ').trim(),
          next: paragraphs[index + 1]?.textContent.replace(/\s+/g, ' ').trim() });
      }
    }
  }
}
fs.writeFileSync(path.join(ROOT, 'scripts/segmenter/proposals/page-parsing', `${translator}-commentary-candidates.json`), JSON.stringify(suspects, null, 2) + '\n');
for (const [n, s] of suspects.entries()) console.log(`${n + 1} ${s.file} [${s.reasons.join(', ')}] ${s.text.slice(0, 500)}`);
'''
(ROOT / 'scripts/segmenter/page-parsing-probe.mjs').write_text(source)
print('Created read-only page probe in isolated copy')
