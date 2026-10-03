"""Save xhigh judge decisions; does not modify corpus or run segmenter."""
import json,re
from pathlib import Path
R=Path(__file__).resolve().parents[4]
O=Path(__file__).resolve().parent
S={x['id']:x for x in json.loads((O/'source-lines.json').read_text())}
J=[]

def load(uid,kind):
 suffix={'pali':'_root-pli-ms.json','thanissaro':'_translation-en-thanissaro.json','html':'_html.json'}[kind]
 base=R/'data'/('html/pli/ms/sutta' if kind=='html' else kind+'/sutta')
 return json.loads(next(base.rglob(uid+suffix)).read_text())

def case(uid,key,verses,assign,rationale,status='repair-ready',active=None,extra=None):
 p=load(uid,'pali');t=load(uid,'thanissaro'); rows=[]
 for k,nums in assign.items():
  lines=[S[uid]['lines'][i-1]['text'] for i in nums]
  quote=' '.join(lines[0].split()[:8]) if lines else None
  rows.append({'key':k,'pali':p[k],'sourceLines':nums,'wholeSourceLines':lines,'starts':quote,'none':not nums,'current':t[k]})
 entry={'key':key,'text':uid,'status':status,'effort':'xhigh','source':S[uid]['path'],'groupVerses':verses,'groupPaliRows':list(assign),'assignments':rows,'rationale':rationale,'activeDirectives':active or []}
 if extra:entry.update(extra)
 J.append(entry)
 (O/'judgments.json').write_text(json.dumps({'rules':'Whole source lines in source order; neighboring crossed verses form one group; lone empty rows reveal their Pali; moving prose must preserve the source under current verification.','cases':J},ensure_ascii=False,indent=2)+'\n')
 (O/'progress.md').write_text('# Verse-open judge progress\n\nDirect original-source and Pali inspection completed for all 14 cases, at xhigh. No corpus or scripts edited.\n\n'+ '\n'.join('- '+x['key']+': '+x['status']+'. '+x['rationale'] for x in J)+'\n\nNext: finish saved case judgments and active findings, then root trials in isolated copy.\n')

def rows(uid,vs,ns):
 keys=[f'{uid}:{v}.{i}' for v,n in vs for i in range(1,n+1)]
 assert len(keys)==len(ns)
 return dict(zip(keys,ns))

case('sn3.19','sn3.19:7.1',[7],rows('sn3.19',[(7,4)],[[8,9],[10,11],[12,13],[14,15]]),'The first true verse line is source 8. Start 7.1 there. The source-only speech bridge (source 7) has no corresponding Pali row; retain it after the existing translated prose on 6.6, immediately before the verse. This is an edition addition, not translated verse.',active=['sn3.19:7.1 starts: “Like water'],extra={'sourceAddition':{'sourceLines':[7],'destination':'sn3.19:6.6','paliCorrespondence':'none; preceding translated prose is the nearest antecedent'}})
case('sn4.24','sn4.24:10.4',[10],rows('sn4.24',[(10,4)],[[52],[53],[54],[55]]),'Verse 10 is already four whole source lines. Source 56 is the single following narrative sentence, and its exact Pali begins at sn4.25:1.1. Move that prose across the text boundary; current monotonic per-page cuts cannot transfer ownership while check-upstream and plain regeneration preserve each source page.',status='deferred-segmenter',extra={'desiredProseMoves':[{'sourceLines':[56],'destination':'sn4.25:1.1','starts':'Then Māra the Evil One, having recited these','pali':load('sn4.25','pali')['sn4.25:1.1']}],'segmenterNeeded':'Cross-text ownership transfer of source paragraph 56 from sn4.24 source to sn4.25:1.1; word-for-word checker must recognize that same transfer.'})
case('an3.39','an3.39:10.3',[10,11],rows('an3.39',[(10,4),(11,4)],[[20],[21,22],[23],[24],[25],[26],[27],[28]]),'Verses 10–11 form one group because source 23 renders the next verse before source 24 finishes the earlier one. Keep health/youth/life together as source 24; put source 25 and 26 separately on 11.1 and 11.2. Nine whole source lines occupy all eight Pali rows in source order.',active=['an3.39:11.1 starts: as one who sees','an3.39:11.2 starts: renunciation as rest.'])
case('an4.19','an4.19:4.1',[3,4],rows('an4.19',[(3,4),(4,4)],[[2],[3,4,5,6,7],[8],[9,10],[12],[13,14,15,16,17],[18],[19,20]]),'Both verse spreads are already whole and show every Pali line. Source 11 is the second prose paragraph; its sentences correspond to Pali 2.1, 2.2, 2.3 and 2.4, but it follows verse 3 in the source and precedes it in the Pali. User permits moving prose; existing monotonic cuts cannot make this move while preserving source-page word order and regeneration.',status='deferred-segmenter',extra={'desiredProseMoves':[{'sourceLines':[11],'destinations':[{'key':'an4.19:2.1','starts':'“There are these four ways of not going'},{'key':'an4.19:2.2','starts':'Which four?'},{'key':'an4.19:2.3','starts':'One doesn’t go off course through desire.'},{'key':'an4.19:2.4','starts':'These are the four ways of not going'}]}],'segmenterNeeded':'Explicit prose reordering across the first verse, keeping each prose sentence intact and checking source words in their source order rather than Pali row order.'})
case('an5.36','an5.36:3.1',[2,3],rows('an5.36',[(2,4),(3,6)],[[2,3],[4],[5],[6],[7],[8],[9],[10],[11],[12]]),'Source 6 combines inspired hearts (verse 3) and noble recipients (verse 2) in one line, and source 7 completes the recipients. Verses 2–3 therefore form one group. Current layout already preserves all eleven source lines over all ten Pali rows. Keep it.',status='settled-with-group')
case('an5.57','an5.57:14.3',[14,15],rows('an5.57',[(14,4),(15,4)],[[25],[26,27],[28],[29],[30],[31],[32],[33]]),'The same crossing as AN 3.39 requires one group spanning verses 14–15. Restore the whole health/youth/life line at 14.4 and separate source 30 and 31 on 15.1 and 15.2; nine source lines occupy all eight Pali rows.',active=['an5.57:15.1 starts: as one who sees','an5.57:15.2 starts: renunciation as rest.'])
case('an6.45','an6.45:21.3',[21,22],rows('an6.45',[(21,4),(22,6)],[[64],[65,66],[67,68,69],[70],[71],[],[72],[73],[74],[75]]),'Source 68 renders the householder of verse 22 before source 69–70 finish the gift/wealth of verse 21. Group 21–22. Move 21.4 to source 70 so the whole source line “making gifts of his belongings,” stays on 21.3. Keep existing 22.2 empty: it is a lone empty Pali row revealed under 22.1, so no Pali line is hidden.',active=['an6.45:21.4 starts: righteously-gained,'],extra={'revealWithoutCoverage':['an6.45:22.2']})
case('an8.54','an8.54:18.2',[17,18],rows('an8.54',[(17,4),(18,4)],[[25],[26],[27],[28],[29],[30],[31],[32]]),'Source 28 renders both lives (verse 18) before source 29–30 render the declaration (verse 17). Group 17–18. Exactly eight source lines and eight Pali lines require one whole source line per row, filling 17.3 and shifting the following starts through 18.2.',active=['an8.54:17.3 starts: leading to welfare & happiness','an8.54:17.4 starts: both in this life & in lives to','an8.54:18.1 starts: have been declared by the one','an8.54:18.2 starts: who is truly named.'])
case('snp3.1','snp3.1:6.4',[6,7],rows('snp3.1',[(6,4),(7,4)],[[20],[21],[22],[23,24],[25],[26],[27],[28]]),'Source 23 renders verse 7’s mindful/downcast opening before source 24 finishes verse 6’s plow-length gaze. Group verses 6–7. Current nine whole source lines already occupy all eight Pali rows in source order; retain them.',status='settled-with-group')
case('snp3.12','snp3.12:25.1',[25,26],rows('snp3.12',[(25,4),(26,6)],[[109,110],[111],[112],[113],[114],[115,116,117],[118,119,120,121],[122],[123],[124,125]]),'Source 109 renders the knowing in verse 26 before the feelings list of verse 25. Group verses 25–26. Present seventeen whole source lines are already spread over all ten Pali rows, first source line on 25.1; retain the layout.',status='settled-with-group')
case('thag17.2','thag17.2:22.3',[22,23],rows('thag17.2',[(22,4),(23,4)],[[109],[110],[111],[112],[113],[114],[115],[116]]),'The wage-ending stanza precedes the mindful/alert stanza in the source, reversing the Pali’s distinguishing endings. Group verses 22–23; the present eight whole source lines already occupy eight Pali rows. “I await my time” in place of the Pali body-laying is a source edition/translation difference, not a boundary repair.',status='settled-with-group')
case('thig6.7','thig6.7:3.1',[3,4],rows('thig6.7',[(3,4),(4,4)],[[13,14],[15],[16],[17],[18],[],[19],[]]),'Source 13 renders the abandoning of verse 4 before verse 3’s fetter list. Group 3–4. Current seven source lines are whole and ordered. Empty 4.2 and 4.4 are each lone empty rows and reveal under 4.1 and 4.3, so all eight Pali lines show; retain layout.',status='settled-with-group',extra={'revealWithoutCoverage':['thig6.7:4.2','thig6.7:4.4']})
case('ud7.8','ud7.8:4.6',[4],rows('ud7.8',[(4,6)],[[3,4],[5,6],[7,8,9],[10,11],[12,13],[14,15,16]]),'The verse ends at source 16 “attachment.” Sources 17–19 are translator’s editorial commentary outside the HTML note box and have no Pali counterpart. Preserve that text; do not invent a correspondence with the closing Aṭṭhamaṁ row. Separating it into notes needs source/notes parsing and independent upstream-check support, which current scripts do not supply.',status='deferred-segmenter',extra={'desiredEditorialMove':{'sourceLines':[17,18,19],'destination':'note on ud7.8:4.6','paliCorrespondence':'none; translator editorial commentary'},'segmenterNeeded':'Treat post-note editorial paragraphs as commentary and preserve their original text/links in notes; update the independent check-upstream parser to classify those same paragraphs as commentary. Existing verse lines remain whole, but editorial stays attached pending that support.'})
case('snp3.6','snp3.6:46.1',[45,46],rows('snp3.6',[(45,4),(46,4)],[[215],[216],[217],[218],[219],[220],[221],[222]]),'Source 218 combines the self-awakened ending with “You have”; source 219 combines the absence of hindrances (verse 45) with despairs (verse 46). Group verses 45–46. Exactly eight true source lines on eight Pali lines restores three internal starts, including the whole steadfast/enduring-in-truth line. Keep already corrected verse 47 untouched.',active=['snp3.6:45.4 starts: self-awakened. You have','snp3.6:46.1 starts: no hindrances. Your despairs','snp3.6:46.4 starts: steadfast, enduring in truth:'])

active=[line for x in J for line in x['activeDirectives']]
keys={line.split()[0] for line in active}
sup=[]
for f in (R/'data/thanissaro/review').rglob('*.findings'):
 if O in f.parents:continue
 for n,line in enumerate(f.read_text().splitlines(),1):
  if line.split(' ',1)[0] in keys and not line.startswith('#'):
   new=next(s for s in active if s.split()[0]==line.split()[0])
   if new!=line:sup.append({'file':str(f.relative_to(R)),'line':n,'old':line,'replacement':new,'required':True,'reason':'New xhigh whole-source-line group judgment replaces incompatible old boundary.'})
(O/'superseded.json').write_text(json.dumps(sup,ensure_ascii=False,indent=2)+'\n')
final=json.loads((O/'judgments.json').read_text());final.update({'activeDirectiveCount':len(active),'repairReadyCases':6,'settledWithGroupCases':5,'deferredCases':3,'requiredSupersededDirectives':sup,'deferredDirectivesAreNotActive':True})
(O/'judgments.json').write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n')
(O/'batch-001.findings').write_text('# xhigh judge: fourteen open cases; deferred cases are described in judgments.json.\n'+ '\n'.join(active)+'\n# done\n')
(O/'deferred.json').write_text(json.dumps([x for x in J if x['status']=='deferred-segmenter'],ensure_ascii=False,indent=2)+'\n')
(O/'progress.md').write_text('# Verse-open judge progress\n\nAll 14 direct original-source/Pali judgments complete at effort xhigh. batch-001.findings ends with # done. judgments.json records exact source lines, target Pali rows, rationales, and required superseded directives.\n\n'+ '\n'.join('- '+x['key']+': '+x['status'] for x in J)+'\n\n13 active boundary directives in six cases; five other cases settled by grouped ownership without recuts; three require segmenter/source support and remain explicitly deferred. No corpus or script writes; no segmenter run by judge. Next: root trial, verification, copying, audit6.\n')
