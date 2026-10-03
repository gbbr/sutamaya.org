"""Persist the judgments of the frozen 126-row scan; never change translation data."""
import json
from collections import Counter
from pathlib import Path

OUT = Path(__file__).resolve().parent
scan = json.loads((OUT / 'scan.json').read_text())
judgments = {}


def keep(numbers, cause, explanation, destinations=None):
    for n in numbers:
        assert n not in judgments, n
        c = scan['candidates'][n - 1]
        judgments[n] = dict(number=n, translator=c['translator'], key=c['key'],
                            cause=cause, explanation=explanation, sources=c['sources'],
                            destinations=destinations or [], repair='report only')


keep([43], 'marked introduction', 'The initial paragraph begins and ends in em; its roman Pali terms reduce the italic share to 0.874. The following narrative is sutta text.')
keep([26], 'closing note continuation', 'The three prose paragraphs follow the closing note containing an alternative verse. They explain that verse and its parallels; they are not translated Pali.')
keep([3], 'labelled alternative rendering', 'The italic Alternative translation: heading explicitly starts a second rendering of the same sutta. Move the heading and all four following paragraphs together into notes.')
for n in (3, 26, 43):
    judgments[n]['repair'] = 'move to notes, preserve all words and order'

keep([14], 'closing note continuation', 'The final dblock smallcaps Note: paragraph describes the following three discourses, after the sutta closes. It is separately labelled translator commentary and moves intact into notes.')
keep([60], 'labelled alternative rendering', 'The italic bracketed explanation about loka meaning cosmos introduces a second complete rendering. Its closing sentence corresponds to 2.9, and its repeated narrative to 1.1–2.9. Move its heading and complete rendering intact into notes.', ['sn35.82:1.1–2.9'])

for n in (14, 60):
    judgments[n]['repair'] = 'move to notes, preserve all words and order'

keep([1], 'Pali elsewhere', 'The separate quoted assessment and elder/middle/newcoming-monks sentence begins in 8.1; 8.2 is only the final newcoming-monks clause. The adjacent ellipsis does not explain placing the printed assessment here.', ['an10.18:8.1–8.2'])
keep([5], 'Pali elsewhere', 'The second prose paragraph is printed after the first verse on his page but before both verses in the Pali. Preserve source order; list its Pali for the Reader.', ['an4.19:2.1–2.4'])
keep([7], 'Pali elsewhere', 'The first sentence starts on the right row, but the separate He desires/He resolves/He speaks/He makes an effort sentences render the next Pali row. The verbal/mental repetitions in that row are abbreviated.', ['an6.45:9.2'])
keep([22], 'Pali elsewhere', 'His source lists pleasant-now/painful-future before painful-now/painful-future; the Pali puts those in the opposite order with another item between. Keep the source list order.', ['dn33:1.11.143 (pleasant/painful)', 'dn33:1.11.141 (painful/painful)'])
keep([76], 'Pali elsewhere', 'The closing Then Māra the Evil One narrative is printed at the end of his SN4.24, while its Pali begins SN4.25. Preserve source order; no alignment repair.', ['sn4.25:1.1'])
keep([97], 'Pali elsewhere', 'The separate numbered items 21–43 are on the preceding row with items 11–20, while 14.5 holds only item 44. Numbered list items are not one sentence spanning rows.', ['mn8:14.5 (items 21–44)'])
keep([101], 'Pali elsewhere', 'The source paragraph holds ten different suttas as a shortened list. The first nine formulations belong to SN35.43–51 rather than the terminal SN35.52. This is source-range ownership/alignment, not page furniture.', [f'sn35.{n}:1.1' for n in range(43, 53)])

keep([28], 'source edition addition', 'His translation note explicitly says the Thai MN10 includes DN22’s extended four-truths section, in double braces. Preserve it as translation text; it has no corresponding block in the app’s MN10 Pali.', ['parallel dn22:18.1–21.39'])
keep([34], 'source edition addition', 'Source note 2 states that this braced passage is absent from the editions underlying MLS/MLDB. The repeated form admonition parallels 3.2; the five-element and earth-property openings are extra here.', ['parallel mn62:3.2; remaining opening absent locally'])
keep([41], 'source edition addition', 'Source note 1 explicitly says the preceding three sentences occur here only in the Thai edition and below in all editions. This is a source-edition repetition, not a parser spill.', ['parallel mn82:8.6–8.8 and 8.18–8.20'])
keep([42], 'source edition addition', 'The parents’ request to the friends is its own source paragraph; source note 3 says it is absent in the Thai edition. The app Pali goes straight from the third silence to the friends’ arrival.', ['no local Pali between mn82:9.1 and 10.1; request quotes 10.2–10.7'])
keep([96], 'source edition addition', 'Bodhi also prints the parents’ request to the friends as a separate paragraph (SC18). The app Pali omits that transition. Keep his words; this is an edition difference, not page furniture.', ['no local Pali between mn82:9.1 and 10.1; request quotes 10.2–10.7'])
keep([61], 'source edition addition', 'The page’s italic introduction explicitly identifies the braced block as Thai-only. Much of the inserted monk dialogue parallels SN35.72; it is not in the app’s SN35.88 Pali.', ['parallel sn35.72:2.1–11.2; Thai-only connecting sentence has no local Pali'])

keep(list(range(63, 76)), 'shared opening expanded', 'Every source page prints the full Sāriputta/Nāla/Jambukhādaka opening before its question. The app prints that shared nidāna only in SN38.1; this source opening is retained, not an introduction or note.', ['parallel sn38.1:1.1–1.2'])
keep([82], 'shared opening expanded', 'The page prints the standard Sāvatthī nidāna before its speech, while the app Pali starts with the speech. Preserve the source opening; no local nidāna row exists.')

keep([4, 92, 93, 99], 'lexical explanation', 'The English expands the Pali’s compounds or names. The source prints the explanatory wording in the same list/item; nothing is page furniture or displaced to another Pali passage.')
keep([27, 29, 44, 49, 80], 'short Pali formula expanded', 'The source spells out a conventional formula that the Pali states briefly (divine-eye description or Sāvatthī nidāna). The long rendering belongs to this formula; no page-parsing repair.')

keep([2, 6, 8, 9, 10, 15, 16, 17, 18, 23, 24, 25, 30, 31, 32, 33, 35,
      45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 62,
      78, 79, 81, 84, 85, 86, 87, 88, 89, 94, 98, 100, 102],
     'abbreviated surrounding passage expanded',
     'The current row has no explicit abbreviation marker, but the surrounding Pali contains pe/ellipsis, an instruction to expand a referenced passage, or a compressed conventional dialogue. The source gives that passage more fully. This is not page furniture; keep its words/order. The packet records the exact neighboring Pali.')

keep([11, 12, 13, 19, 20, 21, 36, 37, 38, 39, 40, 77, 83, 90, 91, 95],
     'whole sentence or compressed passage',
     'The source’s sentence begins on this row and continues through following Pali rows, or compresses the repeated passage into one sentence/item. Its words remain together, in source order, by the app’s prose rule; empty following rows are not parser errors.')
keep(list(range(103, 124)), 'whole sentence or compressed passage',
     'The source prints the attention/food statement as one sentence. This row translates its first clause; the immediately following .4 translates the rest and is empty. Whole prose sentences stay on their first Pali row.')
keep([124, 125, 126], 'whole sentence or compressed passage',
     'Bodhi prints the confidence assertion and its that-clause as one sentence. The sentence begins here; the following Pali row carries the subordinate clause and correctly remains empty.')

assert sorted(judgments) == list(range(1, 127)), sorted(set(range(1, 127)) - set(judgments))
rows = [judgments[n] for n in sorted(judgments)]
(OUT / 'judgments.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
counts = Counter(r['cause'] for r in rows)
lines = ['# Oversized-row judgments', '', '126/126 judged against Pali, source paragraphs and page structure. All source HTML snapshots are in evidence/. Exact Pali/English/context are in scan.json; original paragraphs are in source-contexts.json.', '']
for cause, count in counts.items():
    group = [r for r in rows if r['cause'] == cause]
    lines += [f'## {cause}: {count}', '', '| Translator | Key | Judgment / Pali location |', '|---|---|---|']
    for r in group:
        desc = r['explanation'] + (' Locations: ' + '; '.join(r['destinations']) if r['destinations'] else '')
        lines.append(f'| {r["translator"]} | {r["key"]} | {desc} |')
    lines.append('')
lines.append('# done')
(OUT / 'cases.md').write_text('\n'.join(lines) + '\n')
(OUT / 'cases.findings').write_text('\n'.join(f'{r["translator"]} {r["key"]} | {r["cause"]} | {r["repair"]}' for r in rows) + '\n# done\n')
for cause, count in counts.items():
    print(count, cause)
