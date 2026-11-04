import assert from 'node:assert/strict';
import test from 'node:test';
import{mkdtemp,mkdir,writeFile,readFile,rm,lstat}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{createRuntimeView}from'../scripts/lib/supabase-runtime-view.mjs';

test('runtime uses restored generated files and current code, without copying credentials or .next',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dvns-runtime-'));
 try{
 const repo=join(root,'repo'),cache=join(repo,'artifacts/cache'),site=join(repo,'artifacts/site');
 for(const path of ['src/data/generated','data/source-ledger','public','node_modules','.next','artifacts/cache/src/data/generated','artifacts/cache/data/source-ledger'])await mkdir(join(repo,path),{recursive:true});
 await writeFile(join(repo,'package.json'),'{}');await writeFile(join(repo,'src/code.ts'),'new code');await writeFile(join(repo,'src/data/generated/x.json'),'GIT DATA');await writeFile(join(repo,'.env.local'),'PRIVATE');await writeFile(join(cache,'src/data/generated/x.json'),'DATABASE DATA');
 await createRuntimeView(repo,site,cache);
 assert.equal(await readFile(join(site,'src/data/generated/x.json'),'utf8'),'DATABASE DATA');assert.equal(await readFile(join(site,'src/code.ts'),'utf8'),'new code');
 await assert.rejects(lstat(join(site,'.env.local')),{code:'ENOENT'});await assert.rejects(lstat(join(site,'.next')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
