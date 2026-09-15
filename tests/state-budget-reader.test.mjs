import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readerValue,validateReader,validateReaderSnapshot,readerShare,readerCalculationText} from '../src/lib/reports/state-budget-reader.ts';
const report=JSON.parse(await readFile(new URL('../src/content/reports/state-budget-reader.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(report);
const cells=[['GF01',17041400000000,770],['GF02',2830100000000,130],['GF03',3909400000000,180],['GF04',11238080000000,510],['GF05',1982800000000,90],['GF06',1697270000000,80],['GF07',14607500000000,660],['GF08',1877360000000,90],['GF09',8917990000000,400],['GF10',46813500000000,2130],['TOTAL',110915400000000,5040]].map(([fn,amountCents,shareOfGdpHundredths])=>({geo:'IT',year:2024,function:fn,amountCents,shareOfGdpHundredths}));
test('canonical reader: 25 cases, ten functions, preserved original case identities',()=>{assert.equal(validateReader(report),report);assert.equal(report.cases.length,25);});
for(const c of report.calculations)test(`independent exact calculation: ${c.id}`,()=>assert.equal(readerValue(report,c.id),c.expected));
for(const [label,mutate] of [
 ['missing source',r=>{r.cases[0].sourceIds=['missing'];}],
 ['empty sources',r=>{r.cases[0].sourceIds=[];}],
 ['duplicate source',r=>{r.sources.push(r.sources[0]);}],
 ['future source',r=>{r.sources[0].publishedOn='2027-01-01';}],
 ['active URL',r=>{r.sources[0].url='javascript:alert(1)';}],
 ['credential URL',r=>{r.sources[0].url='https://user:password@example.com';}],
 ['missing source locator',r=>{r.sources[0].locator='';}],
 ['missing function',r=>{r.sectors.pop();}],
 ['duplicate function',r=>{r.sectors[0].code=r.sectors[1].code;}],
 ['wrong total',r=>{r.macro.totalCents='110915400000001';}],
 ['empty total',r=>{r.macro.totalCents='0';}],
 ['fractional cents',r=>{r.sectors[0].amountCents='1.2';}],
 ['unresolved metric source',r=>{r.metrics['pinto-central'].sourceId='none';}],
 ['scientific notation',r=>{r.metrics['pinto-central'].value='1213e-1';}],
 ['changed arithmetic',r=>{r.metrics['pinto-central'].value='121.4';}],
 ['changed result',r=>{r.calculations[0].expected='99.99';}],
 ['duplicate calculation',r=>{r.calculations.push(r.calculations[0]);}],
 ['duplicate case',r=>{r.cases.push(r.cases[0]);}],
 ['missing legacy case',r=>{r.cases=r.cases.filter(c=>c.id!=='rti');r.sectors.forEach(s=>s.caseIds=s.caseIds.filter(id=>id!=='rti'));}],
 ['unresolved equation',r=>{r.cases[0].math.calculationIds=['none'];}],
 ['cyclic equation',r=>{r.calculations[0].inputs[0]=r.calculations[0].id;}],
 ['bad precision',r=>{r.calculations[0].digits=9;}],
 ['division by zero',r=>{r.metrics['pinto-central'].value='0';r.calculations[1].operation='ratio';r.calculations[1].inputs=['pinto-courts','pinto-central'];}],
 ['missing chart metric',r=>{r.cases[0].chart.rows[0].metric='none';}],
 ['missing chart caveat',r=>{r.cases[0].chart.note='';}],
 ['wrong sector',r=>{r.cases[0].sector='GF99';}],
 ['case filed in wrong function',r=>{r.sectors[0].caseIds.push('discariche');}],
 ['unsupported verdict',r=>{r.cases[0].kind='proved-fraud';}],
 ['missing period',r=>{r.cases[0].period='';}],
 ['national waste total',r=>{r.noNationalWasteTotal=false;}],
 ['second public edition',r=>{r.route='/report/new-v2';}],
 ['em dash',r=>{r.title+='\u2014';}],
])test(`reader rejects ${label}`,()=>{const r=clone();mutate(r);assert.throws(()=>validateReader(r));});
test('exact 11-cell excerpt reconciles; this is not a full original-file hash check',()=>validateReaderSnapshot(report,cells));
for(const [label,mutate] of [
 ['missing cell',c=>c.pop()],['duplicate',c=>c.push(c[0])],['wrong year',c=>c.forEach(r=>r.year=2023)],
 ['changed cents',c=>c[0].amountCents++],['unsafe integer',c=>c[0].amountCents=Number.MAX_SAFE_INTEGER+1],
 ['PIL changed',c=>c.at(-1).shareOfGdpHundredths++],
])test(`snapshot gate: ${label}`,()=>{const c=structuredClone(cells);mutate(c);assert.throws(()=>validateReaderSnapshot(report,c));});
test('RTI subtraction changes both numerator and denominator, never divides by nine',()=>{
 assert.equal(readerValue(report,'rti-company-rest'),'11087847.72');assert.equal(readerValue(report,'rti-total-rest'),'138086105.17');
 assert.equal(readerValue(report,'rti-without'),'8.03');assert.match(report.cases.find(c=>c.id==='rti').conclusion,/non è la quota corretta/);
 assert.equal(report.metrics['rti-all-total'].sourceId,'dvns-rti');
});
test('NAS detail disagreement is visible, not silently fixed',()=>{assert.equal(readerValue(report,'nas-detail'),'556');assert.equal(report.metrics['nas-total'].value,'558');});
test('Pinto payments are not recategorised as 2025 trial costs',()=>{const c=report.cases.find(c=>c.id==='processi-lenti');assert.match(c.period,/arretrati/);assert.match(c.conclusion,/diritto/);});
test('court order is not recategorised as paid cash',()=>assert.match(report.cases.find(c=>c.id==='depurazione').conclusion,/non certifica/));
test('COFOG share has a published common denominator',()=>assert.equal(readerShare('46813500000000','110915400000000'),'42.21'));
test('human-readable formula has input values and units',()=>assert.equal(readerCalculationText(report,report.calculations.find(c=>c.id==='pinto-total')),'121,3 + 86,1 = 207,4 mln €'));
test('no reader homework, generated reports remain separate from the internal research register',()=>{const text=report.cases.flatMap(c=>[c.lead,...c.paragraphs,c.conclusion,c.improve]).join(' ');assert.doesNotMatch(text,/Da verificare\.|acquisire|scarica i dati e/i);});

for (const [label, mutate] of [
 ['one cent in ministry',r=>{r.audit.ministries[0].remainingRsCents=String(BigInt(r.audit.ministries[0].remainingRsCents)+BigInt(1));}],
 ['wrong ministry total',r=>{r.audit.totals.paymentsCashCsCents='1';}],
 ['missing ministry',r=>{r.audit.ministries.pop();}],
 ['duplicate ministry',r=>{r.audit.ministries[0].code=r.audit.ministries[1].code;}],
 ['negative ministry amount',r=>{r.audit.ministries[0].paymentsResidualRsCents='-1';}],
 ['missing historical year',r=>{r.audit.history.pop();}],
 ['historical rounding beyond tolerance',r=>{r.audit.history[0].currentMillion++;r.audit.history[0].currentMillion++;}],
 ['invented inspected chapter rows',r=>{r.audit.upstream.rowsReprocessed=5395;}],
 ['declared hash presented as verified',r=>{r.audit.upstream.declaredHashesVerified=true;}],
 ['wrong portfolio chart',r=>{r.audit.portfolios[0].billion='1';}],
 ['wrong foreign aid chart',r=>{r.audit.foreignRows[0].million='1';}],
 ['missing chapter case',r=>{r.chapters[0].caseIds.pop();}],
]) test(`acquired aggregate audit rejects ${label}`,()=>{const r=clone();mutate(r);assert.throws(()=>validateReader(r));});


test('spending review: proposal and forecast remain explicit',()=>{
 const r=structuredClone(report);r.spendingReview.series[0].rows[0].status='riportato';assert.throws(()=>validateReader(r));
 const q=structuredClone(report);q.spendingReview.series[1].rows.find(x=>x.year===2018).status='riportato';assert.throws(()=>validateReader(q));
});
test('spending review: plans and military saving reconcile exactly',()=>{
 assert.equal(readerValue(report,'sr-pg-reconciliation'),'205');
 assert.equal(readerValue(report,'sr-rents-missed'),'245000');
 assert.equal(readerValue(report,'sr-army-net'),'5709334');
 assert.equal(readerValue(report,'sr-army-reconciliation'),'0');
});
test('spending review: archive references and case links must resolve',()=>{
 const r=structuredClone(report);r.spendingReview.documents[0].sourceId='not-present';assert.throws(()=>validateReader(r));
 const q=structuredClone(report);q.spendingReview.tracker[0].caseId='not-present';assert.throws(()=>validateReader(q));
});
test('energy reintegration is not assigned an invented waste amount',()=>{
 const c=report.cases.find(x=>x.id==='energia-obiettivo-mancato');assert.equal(c.math,null);assert.equal(c.number,'Obiettivo mancato');
});
