import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import '../helpers/register-ts-alias.mjs';
const {QUOTA_SCRIPT}=await import('../../src/lib/assistant/free-quota.ts');
const run=promisify(execFile);
test('real Redis executes atomic admission, independent limits, TTL and burst cap',{skip:!process.env.DVNS_REDIS_BIN},async()=>{
 const dir=await mkdtemp(tmpdir()+'/dvns-quota-'),socket=dir+'/redis.sock';
 const server=spawn(process.env.DVNS_REDIS_BIN+'/redis-server',['--port','0','--unixsocket',socket,'--save','','--appendonly','no'],{stdio:'ignore'});
 const cli=async(...args)=>JSON.parse((await run(process.env.DVNS_REDIS_BIN+'/redis-cli',['-s',socket,'--json',...args.map(String)])).stdout);
 try{
  let ready=false;for(let i=0;i<50;i++){try{await cli('PING');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  const keys=['browser','network','browser:active','network:active','network:burst'];
  const expires=Date.now()+60000;
  const evalQuota=(mode='reserve',custom=keys)=>cli('EVAL',QUOTA_SCRIPT,5,...custom,mode,10,expires,'test-lease');
  assert.deepEqual(await evalQuota('status'),[1,0]);
  const wave=await Promise.all(Array.from({length:20},()=>evalQuota()));
  assert.equal(wave.filter(r=>r[0]===1).length,1);assert.equal(wave.filter(r=>r[0]===-1).length,19);
  assert.equal(await cli('GET','browser'),'1');assert.ok((await cli('PTTL','browser:active'))>85000);
  for(let i=1;i<10;i++){await cli('DEL',keys[2],keys[3]);assert.deepEqual(await evalQuota(),[1,i+1]);}
  await cli('DEL',keys[2],keys[3]);assert.deepEqual(await evalQuota(),[0,10]);
  assert.deepEqual(await evalQuota('reserve',['new-browser','network','new-browser:active','network:active','network:burst']),[0,10]);
  assert.deepEqual(await evalQuota('reserve',['browser','new-network','browser:active','new-network:active','new-network:burst']),[0,10]);
  assert.deepEqual(await evalQuota('reserve',keys.map(k=>'tomorrow:'+k)),[1,1]);
  assert.ok((await cli('PTTL','browser'))>50000);assert.ok((await cli('PTTL','network:burst'))>50000);
  let capped;for(let i=0;i<61;i++)capped=await evalQuota('status');assert.deepEqual(capped,[-2,10]);
 }finally{if(server.exitCode===null){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}await rm(dir,{recursive:true,force:true});}
});
