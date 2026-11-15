import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import './helpers/register-ts-alias.mjs';
const { loadIntegratedSourceBundle } = await import('../src/lib/integrated-sources.ts');
const { validateDatabaseChunk, databaseConnectionUrl } = await import('../src/lib/integrated-supabase-reader.ts');

const bundle = await loadIntegratedSourceBundle();
const dataset = bundle.datasetsById.get('consip-winners-2024');
const proofKey = 'src/data/generated/integrated/rows/consip-winners-2024.part-00000.jsonl.gz';
const compressed = await readFile(proofKey);
const rows = gunzipSync(compressed).toString().trimEnd().split('\n').map(JSON.parse);
const records = rows.map((payload,i)=>({ ordinal:String(i+1),payload }));

test('DB payloads reproduce the pinned original chunk, preserving empty and zero cells', async()=>{
 const result = await validateDatabaseChunk(dataset,0,records,bundle.datasetProof.artifactSha256[proofKey]);
 assert.deepEqual(result.rows,rows);
 assert.equal(result.compressedBytes,compressed.length);
});
test('DB corruption, missing/duplicate ordinals and wrong release digest fail closed',async()=>{
 const changed=structuredClone(records); changed[0].payload.cells[0]='__CORRUPT__';
 await assert.rejects(validateDatabaseChunk(dataset,0,changed,bundle.datasetProof.artifactSha256[proofKey]));
 await assert.rejects(validateDatabaseChunk(dataset,0,records.slice(1),bundle.datasetProof.artifactSha256[proofKey]));
 await assert.rejects(validateDatabaseChunk(dataset,0,[records[0],...records.slice(0,-1)],bundle.datasetProof.artifactSha256[proofKey]));
 await assert.rejects(validateDatabaseChunk(dataset,0,records,'0'.repeat(64)));
});
test('DB configuration requires the selected project, TLS and no unexpected backend',()=>{
 const valid='postgresql://postgres.zvqhikeylxynsljwgosc:placeholder@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require';
 assert.equal(databaseConnectionUrl(valid),valid);
 const scoped = valid.replace('postgres.', 'dvns_vercel_preview.');
 const transaction = scoped.replace(':5432/', ':6543/');
 assert.equal(databaseConnectionUrl(scoped), transaction);
 assert.equal(databaseConnectionUrl(transaction), transaction);
 assert.equal(databaseConnectionUrl(scoped.replace(':5432/', '/')), transaction);
 assert.throws(() => databaseConnectionUrl(scoped.replace(':5432/', ':5440/')));
 assert.throws(() => databaseConnectionUrl(valid.replace('postgres.', 'unexpected.')));

 for(const value of [undefined,'',valid.replace('zvqhikeylxynsljwgosc','another'),valid.replace('sslmode=require','sslmode=disable'),valid.replace('/postgres?','/other?'),valid+'&sslmode=disable']) assert.throws(()=>databaseConnectionUrl(value));
});

test('the isolated canary role can only connect from Vercel Preview', () => {
 const canary = 'postgresql://dvns_vercel_canary.zvqhikeylxynsljwgosc:placeholder@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require';
 const previous = process.env.VERCEL_ENV;
 try {
  process.env.VERCEL_ENV = 'preview';
  assert.equal(databaseConnectionUrl(canary), canary);
  process.env.VERCEL_ENV = 'production';
  assert.throws(() => databaseConnectionUrl(canary));
 } finally {
  if (previous === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previous;
 }
});

test('Supabase enabled without credentials fails instead of returning local rows', async()=>{
 const oldBackend=process.env.DVNS_DATA_BACKEND,oldUrl=process.env.DVNS_DATABASE_URL;
 process.env.DVNS_DATA_BACKEND='supabase';delete process.env.DVNS_DATABASE_URL;
 try {
  const {selectIntegratedDataset}=await import('../src/lib/integrated-public-view.ts');
  await assert.rejects(selectIntegratedDataset({datasetId:'consip-winners-2024',limit:1}), /Supabase non disponibile/);
  const {GET}=await import('../src/app/api/dati/[dataset]/route.ts');
  const response=await GET(new Request('http://localhost/api/dati/consip-winners-2024'),{params:Promise.resolve({dataset:'consip-winners-2024'})});
  assert.equal(response.status,503);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'Dati non disponibili: verifica di integrità non superata.'});
 } finally {
  if(oldBackend===undefined) delete process.env.DVNS_DATA_BACKEND; else process.env.DVNS_DATA_BACKEND=oldBackend;
  if(oldUrl===undefined) delete process.env.DVNS_DATABASE_URL; else process.env.DVNS_DATABASE_URL=oldUrl;
 }
});
