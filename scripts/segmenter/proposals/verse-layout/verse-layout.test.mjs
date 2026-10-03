import assert from 'node:assert/strict';
import test from 'node:test';
process.argv = ['node','test','bodhi','--only','__fixtures__'];
const {layoutVerse,spreadVerses,streamOf,segmentsOf}=await import('../scripts/segmenter/verify-prototype.mjs');
const rows=n=>Array.from({length:n},(_,i)=>({key:`test:1.${i+1}`,doc:'test',pali:'verse',en:'',verse:true,paraStart:i===0}));
const source=lines=>streamOf(lines.map((text,i)=>({kind:i?'v':'vs',text,marks:[]})));
const layout=(lines,n)=>{const s=source(lines);return {s,r:layoutVerse(s,rows(n),0,s.text.length)};};
test('uses all rows and only whole source lines when English has more lines',()=>{
 const lines=['one word','two words','three words','four words','five words','six words'];
 const {s,r}=layout(lines,4);assert.ok(r.results);
 const pieces=segmentsOf(r.results,s.text).segText;
 assert.equal(pieces.filter(Boolean).length,4);
 assert.equal(pieces.join(' '),lines.join(' '));
 for(const v of r.results) assert.ok(s.blocks.some(b=>b.at===v.start));
});
test('one source line per row at equal counts',()=>{
 const lines=['word one','word two','word three','word four'];
 const {s,r}=layout(lines,4);assert.deepEqual(segmentsOf(r.results,s.text).segText,lines);
});
test('fewer source lines leave gaps without combining lines',()=>{
 const lines=['first line','second line'];const {s,r}=layout(lines,4);
 assert.deepEqual(segmentsOf(r.results,s.text).segText.filter(Boolean),lines);
});
test('speaker stays with speech',()=>{
 const s=streamOf([{kind:'spk',text:'The Buddha:',marks:[]},{kind:'vs',text:'first line',marks:[]},{kind:'v',text:'second line',marks:[]}]);
 const r=layoutVerse(s,rows(2),0,s.text.length);
 assert.deepEqual(segmentsOf(r.results,s.text).segText,['The Buddha: first line','second line']);
});
test('does not cut inside source lines or invent breaks in prose',()=>{
 const s=source(['first whole line','second whole line']);
 assert.equal(layoutVerse(s,rows(2),3,s.text.length).reason,'starts inside a source line');
 assert.equal(layoutVerse(s,rows(2),0,s.text.length-3).reason,'ends inside a source line');
 const prose=source(['all one paragraph']);
 assert.equal(layoutVerse(prose,rows(4),0,prose.text.length).reason,'no source line breaks');
});
test('keeps a reviewed grouping and reports disagreement',()=>{
 const s=source(['first line','second line','third line','fourth line']);
 const body=rows(4);const current=body.map((line,i)=>({key:line.key,start:i? s.text.length:0,end:s.text.length,empty:i>0,merged:false}));
 const original=structuredClone(current);const entry={};
 spreadVerses(s,body,current,entry,{'test:1.2':{empty:'up'}});
 assert.deepEqual(current,original);assert.equal(entry.verseLayouts[0].status,'reviewed layout kept');
 spreadVerses(s,body,current,{},{});
 assert.deepEqual(segmentsOf(current,s.text).segText,['first line','second line','third line','fourth line']);
});
test('never distributes across Pali paragraph boundaries, including integer keys',()=>{
 const s=source(['a first','a second','b first','b second']);
 const body=rows(4);body.forEach((r,i)=>r.key=`dhp1:${i+1}`);body[2].paraStart=true;
 const current=body.map((line,i)=>({key:line.key,start:s.blocks[i<2?0:2].at,end:i<2?s.blocks[2].at:s.text.length,empty:i%2===1,merged:false}));
 current[1].start=current[1].end;current[3].start=current[3].end;
 spreadVerses(s,body,current,{},{});
 assert.deepEqual(segmentsOf(current,s.text).segText,['a first','a second','b first','b second']);
});

test('does not gather a whole multi-line verse even when lexical evidence favors one row',()=>{
 const s=source(['banana orchard','mango harvest','apple vineyard']);
 const body=rows(3);body[0].en=s.text;body[0].pali='banana mango apple';
 const r=layoutVerse(s,body,0,s.text.length);assert.ok(r.results);
 assert.ok(segmentsOf(r.results,s.text).segText.filter(Boolean).length>=2);
});

test('completed round protects an unchanged layout even without cuts.json',()=>{
 const s=source(['first line','second line','third line','fourth line']);
 const body=rows(4);const current=body.map((line,i)=>({key:line.key,start:i?s.text.length:0,end:s.text.length,empty:i>0,merged:false}));
 const original=structuredClone(current),entry={};
 spreadVerses(s,body,current,entry,{},new Set(body.map(l=>l.key)));
 assert.deepEqual(current,original);assert.equal(entry.verseLayouts[0].status,'reviewed layout kept');
});
test('first row stays occupied with fewer source lines',()=>{
 const s=source(['banana orchard','mango harvest']);const body=rows(4);
 body[3].en=s.text;const r=layoutVerse(s,body,0,s.text.length);
 assert.ok(segmentsOf(r.results,s.text).segText[0]);
 assert.deepEqual(segmentsOf(r.results,s.text).segText.filter(Boolean),['banana orchard','mango harvest']);
});
