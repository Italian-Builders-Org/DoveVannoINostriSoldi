import '../../tests/helpers/register-ts-alias.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { GovCoreClient } from '@gov-core/client';
import { linkDvnsEntity, linkDvnsEntities } from '@gov-core/client/dvns';
const {getMunicipalitySearchEntities}=await import('../../src/lib/siope-municipality-detail.ts');
const codes=['c_d150','c_f023','c_l219','c_d969','c_c580'],all=getMunicipalitySearchEntities();
const rows=codes.map(code=>all.find(row=>row.codiceIpa===code));assert.ok(rows.every(Boolean));
const stamp='2026-10-03T00:00:00Z',proof={source_id:'synthetic-benchmark',source_url:'https://example.test/benchmark',retrieved_at:stamp,verified_at:stamp,verification_status:'verified',content_sha256:'b'.repeat(64),valid_from:null,valid_to:null,scope:'institutional',competences:[]};
const bodies=new Map(rows.map((row,index)=>[row.codiceIpa,{schema_version:'1',status:'resolved',entity:{id:'gov_'+String(index+1).repeat(32),kind:'municipality',name:row.denominazione,status:'active',provenance:[proof],identifiers:[{scheme:'ipa',value:row.codiceIpa,valid_from:null,valid_to:null,provenance:[proof]},{scheme:'tax_code',value:row.codiceFiscale,valid_from:null,valid_to:null,provenance:[proof]}],aliases:[],facts:[]},candidates:[]}]));
let calls=0,active=0,peak=0;
const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');assert.equal(req.method,'GET');assert.equal(u.pathname,'/v1/entities/resolve');assert.ok([...u.searchParams.keys()].every(key=>['ipa_code','tax_code'].includes(key)));
  calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;
  res.setHeader('content-type','application/json');res.end(JSON.stringify(bodies.get(u.searchParams.get('ipa_code'))));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const client=new GovCoreClient({baseUrl:`http://127.0.0.1:${server.address().port}`});
  const input=Array.from({length:50},(_,i)=>({ipaCode:rows[i%5].codiceIpa,taxCode:rows[i%5].codiceFiscale}));
  const digest=results=>createHash('sha256').update(JSON.stringify(results.map(r=>[r.status,r.entity?.id??null]))).digest('hex');
  const singleStart=performance.now(),single=[];for(const identity of input)single.push(await linkDvnsEntity(client,identity));
  const sequential={requests:calls,peakConcurrency:peak,elapsedMs:Math.round(performance.now()-singleStart),digest:digest(single)};
  calls=0;peak=0;const batchStart=performance.now(),batch=await linkDvnsEntities(client,input,{concurrency:4});
  assert.ok(batch.rows.every(row=>row.ok));const batched={requests:calls,peakConcurrency:peak,elapsedMs:Math.round(performance.now()-batchStart),digest:digest(batch.rows.map(row=>row.result))};
  assert.equal(sequential.digest,batched.digest);assert.equal(calls,5);assert.ok(peak<=4);
  const sourceSha=createHash('sha256').update(readFileSync(new URL('../../src/data/generated/siope-municipal-detail.json',import.meta.url))).digest('hex');
  console.log(JSON.stringify({status:'PASS',mode:'controlled synthetic loopback HTTP; 10 ms per reply, current DVNS identities',rows:50,distinctIdentities:5,sourceSha256:sourceSha,sequential,batched,stats:batch.stats,financialRowsExported:0,externalRequests:0},null,2));
} finally {await new Promise(resolve=>server.close(resolve));}
