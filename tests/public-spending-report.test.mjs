import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { calculateRounded, sectionShare, validatePublicSpendingReport, compareReportSnapshot } from '../src/lib/public-spending-report.ts';
import { checkSnapshot } from '../scripts/reports/check_public_spending_snapshot.mjs';
const report = JSON.parse(await readFile(new URL('../src/content/reports/public-spending-2026.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(report);
function fixtureCells() {
  // Synthetic cells based on rounded report amounts. Not the original Eurostat bytes.
  const entries = [{code: 'TOTAL', amount: report.macro.totalBillionRounded}, ...report.sections.map((s) => ({code:s.code, amount:s.amountBillionRounded}))];
  return entries.map((s) => ({geo:'IT',year:2024,function:s.code,amountCents:Number(s.amount.replace('.',''))*1_000_000_000,shareOfGdpHundredths:5040}));
}
test('report canonico valido, dieci funzioni, nessuna copertura transazioni inventata', () => {
  assert.equal(validatePublicSpendingReport(report), report);
  assert.equal(report.sections.length,10);
  assert.equal(report.scope.transactionAuditCoverage,null);
});
for (const c of report.calculations) test(`ricalcolo razionale indipendente ${c.id}`, () => assert.equal(calculateRounded(c),c.roundedResult));
for (const [a,b,digits,want] of [['1','8',2,'0.13'],['-1','8',2,'-0.13'],['-1','1000',2,'0.00'],['90071992547409931234','2',0,'45035996273704965617']]) {
  test(`arrotondamento esatto ${a}/${b}`, () => assert.equal(calculateRounded({operation:'ratio',inputs:[a,b],roundDigits:digits}),want));
}
test('punti percentuali e crescita relativa sono distinti', () => {
  assert.equal(report.calculations.find(c=>c.id==='C03').roundedResult,'2.3');
  assert.equal(report.calculations.find(c=>c.id==='C10').roundedResult,'30.3');
});
test('quota di composizione su totale indipendente', () => assert.equal(sectionShare('468.14','1109.15'),'42,2'));
for (const [name, mutation] of [
  ['fonte mancante',r=>{r.facts[0].sourceIds=['S999'];}],
  ['fonte vuota',r=>{r.facts[0].sourceIds=[];}],
  ['fonte duplicata',r=>{r.sources.push(r.sources[0]);}],
  ['fatto duplicato',r=>{r.facts.push(r.facts[0]);}],
  ['calcolo duplicato',r=>{r.calculations.push(r.calculations[0]);}],
  ['funzione mancante',r=>{r.sections.pop();}],
  ['funzione duplicata',r=>{r.sections[1].code='GF01';}],
  ['risultato alterato',r=>{r.calculations[0].roundedResult='999.0';}],
  ['calcolo senza definizione',r=>{r.facts[0].calculationId='C999';}],
  ['fatto senza periodo',r=>{r.facts[0].referencePeriod='';}],
  ['fatto senza qualifica',r=>{r.facts[0].kind='proved-corruption';}],
  ['fonte futura',r=>{r.sources[0].publicationDate='2027-01-01';}],
  ['URL attivo',r=>{r.sources[0].url='javascript:alert(1)';}],
  ['URL con credenziali',r=>{r.sources[0].url='https://user:pass@example.org/';}],
  ['copertura inventata',r=>{r.scope.transactionAuditCoverage=1;}],
  ['totale di sprechi',r=>{r.noSavingsTotal=false;}],
  ['path traversal',r=>{r.pdfPath='/../private.pdf';}],
  ['em dash',r=>{r.title+='\u2014test';}],
  ['fatto orfano di sezione',r=>{r.sections[0].factIds=['F999'];}],
]) test(`fail-closed: ${name}`,()=>{const r=clone();mutation(r);assert.throws(()=>validatePublicSpendingReport(r));});
for (const [operation,inputs,roundDigits] of [['ratio',['1','0'],2],['execute',['1','2'],2],['ratio',['1e3','2'],2],['ratio',['1'],2],['ratio',['1','2'],9]]) {
  test(`calcolo non ammesso ${operation}/${inputs}/${roundDigits}`,()=>assert.throws(()=>calculateRounded({operation,inputs,roundDigits})));
}
test('fixture COFOG sintetica, non dati originali',()=>assert.deepEqual(compareReportSnapshot(report,fixtureCells()),[]));
test('snapshot privo di cella',()=>assert.ok(compareReportSnapshot(report,fixtureCells().slice(1)).length));
test('snapshot con duplicato',()=>{const rows=fixtureCells();rows.push(rows[0]);assert.ok(compareReportSnapshot(report,rows).length);});
test('snapshot diverso non riscrive il report',()=>{const rows=fixtureCells();rows[1].amountCents+=10_000_000_000;const before=JSON.stringify(report);assert.ok(compareReportSnapshot(report,rows).length);assert.equal(JSON.stringify(report),before);});
test('somma settore non perde un intero unsafe',()=>{const rows=fixtureCells();rows[1].amountCents=Number.MAX_SAFE_INTEGER+1;assert.ok(compareReportSnapshot(report,rows).length);});
test('anno diverso non diventa confronto coevo',()=>{const rows=fixtureCells().map(r=>({...r,year:2023}));assert.equal(compareReportSnapshot(report,rows).length,11);});
test('nessun doppio conteggio comunale nella mappa',()=>assert.equal(report.sections.some(s=>s.code==='COMUNI'),false));
test('prove e cataloghi distinti',()=>{assert.equal(report.sources.filter(s=>s.verificationChannel==='catalogue').length,11);assert.ok(report.sources.filter(s=>s.verificationChannel!=='catalogue').length>10);});

test('gate completo verifica hash/dimensione/riconciliazione su fixture, rifiuta alterazione',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dvns-report-'));
  try {
    const r=clone(); const data={datasetId:'eurostat-cofog',observations:fixtureCells()};
    const bytes=Buffer.from(JSON.stringify(data)); const sha=createHash('sha256').update(bytes).digest('hex');
    r.macro.sourceDataArtifactSha256Declared=sha;
    await mkdir(join(root,'src/content/reports'),{recursive:true});await mkdir(join(root,'src/data/generated'),{recursive:true});
    await writeFile(join(root,'src/content/reports/public-spending-2026.json'),JSON.stringify(r));
    const path=join(root,'src/data/generated/eurostat-cofog-2014-2024.data.json');await writeFile(path,bytes);
    await writeFile(join(root,'src/data/generated/eurostat-cofog-2014-2024.meta.json'),JSON.stringify({integrity:{dataArtifact:{sha256:sha,bytes:bytes.length}},reconciliation:{toleranceCents:60_000_000}}));
    assert.equal((await checkSnapshot(root)).rows,11);
    await writeFile(path,Buffer.concat([bytes,Buffer.from(' ')]));
    await assert.rejects(()=>checkSnapshot(root),/snapshot non coincide/);
  } finally {await rm(root,{recursive:true,force:true});}
});
