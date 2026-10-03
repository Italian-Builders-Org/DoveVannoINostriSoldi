import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import '../../../tests/helpers/register-ts-alias.mjs';
import { GovCoreClient } from '@gov-core/client';
import { enrichDvnsIdentityLinks } from '../links.ts';
const { getMunicipalitySearchEntities, getSiopeMunicipalityDetailByIpaCode }=await import('../../../src/lib/siope-municipality-detail.ts');

const readOnlyEntities=getMunicipalitySearchEntities(), byIpa=new Map(readOnlyEntities.map(entity=>[entity.codiceIpa,entity]));
const get=code=>{const entity=byIpa.get(code);assert.ok(entity,`current DVNS snapshot identity ${code}`);return entity;};
const ipaCodes=['c_d150','c_f023','c_d969','c_c580','c_l219'];
const source=()=>createHash('sha256').update(readFileSync(new URL('../../../src/data/generated/siope-municipal-detail.json',import.meta.url))).digest('hex');
const evidence={source_id:'synthetic-local',source_url:'https://example.test/public-identity-fixture',retrieved_at:'2026-10-03T00:00:00Z',verified_at:'2026-10-03T01:00:00Z',content_sha256:'b'.repeat(64),verification_status:'verified',valid_from:null,valid_to:null,scope:'institutional',competences:[]};
const entity=(row,char)=>({id:'gov_'+char.repeat(32),kind:'municipality',name:row.denominazione,status:'active',provenance:[evidence],identifiers:[{scheme:'ipa',value:row.codiceIpa,valid_from:null,valid_to:null,provenance:[evidence]},{scheme:'tax_code',value:row.codiceFiscale,valid_from:null,valid_to:null,provenance:[evidence]}],aliases:[],facts:[]});
const resolved=entity(get('c_d150'),'a'),candidate1=entity(get('c_f023'),'c'),candidate2=entity({...get('c_f023'),denominazione:'Seconda identita sintetica'},'d');
const result=(status,selected=null,candidates=[])=>({schema_version:'1',status,entity:selected,candidates});
async function service(t){
  const requests=[];let active=0,peak=0;
  const server=createServer(async(req,res)=>{
    requests.push({url:req.url,method:req.method});active++;peak=Math.max(peak,active);
    const u=new URL(req.url,'http://localhost'),ipa=u.searchParams.get('ipa_code')?.toLowerCase();
    await new Promise(resolve=>setTimeout(resolve,ipa==='c_d150'?30:5));active--;
    let body=result('not_found');
    if(ipa==='c_d150')body=u.searchParams.get('tax_code')===get('c_d150').codiceFiscale?result('resolved',resolved):result('conflict',null,[resolved,candidate1]);
    if(ipa==='c_f023')body=result('ambiguous',null,[candidate1,candidate2]);
    if(ipa==='c_c580')body={...body,schema_version:'invalid'};
    if(ipa==='c_l219'){res.writeHead(503);res.end();return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {baseUrl:`http://127.0.0.1:${server.address().port}`,requests,get peak(){return peak;}};
}

test('current DVNS public identity projection links with bounded real HTTP and leaves accounting and snapshots untouched',async t=>{
  const svc=await service(t),original=source();
  const financial=getSiopeMunicipalityDetailByIpaCode('c_d150'),financialBefore=JSON.stringify(financial);
  const input=[get('c_d150'),{...get('c_d150'),codiceIpa:'C_D150',accounting:financial,privateNotes:'LOCAL_ONLY',sede:{codiceComuneIstat:'001272'}},get('c_f023'),get('c_d969'),get('c_c580'),get('c_l219'),{...get('c_d150'),codiceFiscale:get('c_l219').codiceFiscale},{codiceIpa:null,codiceFiscale:null}];
  const before=JSON.stringify(input);
  const output=await enrichDvnsIdentityLinks(new GovCoreClient({baseUrl:svc.baseUrl}),input,{concurrency:2});
  assert.deepEqual(output.stats,{inputRows:8,validRows:7,uniqueRequests:6,deduplicatedRows:1});assert.equal(svc.peak,2);
  assert.deepEqual(output.links.map(row=>row.link.ok?row.link.result.status:row.link.error),['resolved','resolved','ambiguous','not_found','invalid_response','unavailable','conflict','invalid_input']);
  assert.deepEqual(output.links.map(row=>row.govCoreEntityId),[resolved.id,resolved.id,null,null,null,null,null,null]);
  assert.deepEqual(output.links[2].link.result.candidates.map(row=>row.id),[candidate1.id,candidate2.id]);
  assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(financial),financialBefore);assert.equal(source(),original);
  assert.equal(svc.requests.length,6);
  for(const request of svc.requests){const u=new URL(request.url,svc.baseUrl);assert.equal(request.method,'GET');assert.equal(u.pathname,'/v1/entities/resolve');assert.ok([...u.searchParams.keys()].every(key=>['ipa_code','tax_code'].includes(key)));assert.ok(!request.url.includes('LOCAL_ONLY')&&!request.url.includes('001272')&&!request.url.includes('totalCents'));}
  assert.ok(!JSON.stringify(output).includes('accounting')&&!JSON.stringify(output).includes('totalCents'));
  assert.ok(financial.years.some(year=>year.totalCents!==null),'fixture has actual accounting totals that stayed local');
});
test('installed SDK CLI reads current validated DVNS snapshot and outputs a separate public link overlay',async t=>{
  const svc=await service(t);
  const {stdout}=await promisify(execFile)(process.execPath,['--experimental-strip-types','--import','../../scripts/ci/node-test-setup.mjs','link-public-entities.mjs','--ipa','c_d150','--ipa','C_D150','--concurrency','2'],{cwd:new URL('..',import.meta.url),env:{...process.env,GOVCORE_URL:svc.baseUrl}});
  const output=JSON.parse(stdout);assert.equal(output.mode,'public-identity-overlay');assert.equal(output.links.length,2);assert.equal(output.stats.uniqueRequests,1);assert.equal(output.links[0].govCoreEntityId,resolved.id);assert.equal(svc.requests.length,1);
  assert.ok(!stdout.includes('totalCents'));
});
test('CLI malformed selectors fail before HTTP',async t=>{
  const svc=await service(t);
  await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types','--import','../../scripts/ci/node-test-setup.mjs','link-public-entities.mjs','--ipa','invalid@private.test'],{cwd:new URL('..',import.meta.url),env:{...process.env,GOVCORE_URL:svc.baseUrl}}),error=>error.code===2);
  assert.equal(svc.requests.length,0);
});
