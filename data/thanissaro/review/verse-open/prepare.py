"""Build direct-source evidence for the fourteen open verse cases (read-only corpus)."""
import json,re
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parent
class Source(HTMLParser):
 def __init__(self):
  super().__init__();self.stack=[];self.p=None;self.blocks=[];self.suppress=0
 def handle_starttag(self,t,a):
  a=dict(a);cls=a.get('class',''); inherited=self.stack[-1][2] if self.stack else False
  excluded=inherited or (t in ('div','section') and 'note' in cls.split()) or (t=='span' and 'fn' in cls.split())
  verse=any(x[0]=='div' and 'verse' in x[1].get('class','').split() for x in self.stack)
  self.stack.append((t,a,excluded)) if t not in ('br','hr','meta','link','img') else None
  if t in ('p','pre') and not excluded:self.p={'kind':'verse' if verse else 'prose','text':'','class':cls,'italic':False}
  if t in ('em','i') and self.p and not self.p['text'].strip():self.p['italic']=True
  if t=='br' and self.p and not excluded:self.p['text']+='\n'
 def handle_endtag(self,t):
  if t in ('p','pre') and self.p:
   p=self.p;self.p=None
   p['text']='\n'.join(re.sub(r'\s+',' ',x).strip() for x in p['text'].split('\n'))
   if p['text'] and not ('stars' in p['class'] or 'notetitle' in p['class']):self.blocks.append(p)
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i][0]==t:self.stack=self.stack[:i];break
 def handle_data(self,s):
  if self.p and not (self.stack and self.stack[-1][2]):self.p['text']+=s
ids=['sn3.19','sn4.24','an3.39','an4.19','an5.36','an5.57','an6.45','an8.54','snp3.1','snp3.12','thag17.2','thig6.7','ud7.8','snp3.6']
verse_ranges={'sn3.19':(6,8),'sn4.24':(8,11),'an3.39':(9,12),'an4.19':(1,4),'an5.36':(1,4),'an5.57':(13,16),'an6.45':(20,24),'an8.54':(16,19),'snp3.1':(5,8),'snp3.12':(23,28),'thag17.2':(21,24),'thig6.7':(2,5),'ud7.8':(1,4),'snp3.6':(43,48)}
all=[]
for uid in ids:
 src=next((ROOT/'data/upstream/thanissaro/sutta').rglob(uid+'.html'))
 parser=Source();parser.feed(src.read_text())
 lines=[]
 for b in parser.blocks:
  if b['italic'] and b['kind']=='prose' and not lines:continue
  for x in b['text'].split('\n'):
   if x:lines.append({'kind':b['kind'],'text':x})
 sources={'id':uid,'path':str(src.relative_to(ROOT)),'lines':lines}
 all.append(sources)
 pali=json.loads(next((ROOT/'data/pali/sutta').rglob(uid+'_root-pli-ms.json')).read_text())
 sujato=json.loads(next((ROOT/'data/sujato/sutta').rglob(uid+'_translation-en-sujato.json')).read_text())
 th=json.loads(next((ROOT/'data/thanissaro/sutta').rglob(uid+'_translation-en-thanissaro.json')).read_text())
 lo,hi=verse_ranges[uid]
 selected=[k for k in pali if lo<=int(k.split(':')[1].split('.')[0])<=hi]
 text=['# '+uid,'Source: '+sources['path'],'']
 for n,b in enumerate(lines,1):text.append(f"SOURCE {n:03d} {b['kind']}: {b['text']}")
 text+=['','## Pali and present cuts','']
 for k in selected:text.append(f"{k} | P: {pali[k]} | S: {sujato.get(k,'')} | T: {th.get(k,'').replace(chr(10),' ⏎ ')}")
 (OUT/(uid+'.evidence.txt')).write_text('\n'.join(text)+'\n')
(OUT/'source-lines.json').write_text(json.dumps(all,ensure_ascii=False,indent=2)+'\n')
