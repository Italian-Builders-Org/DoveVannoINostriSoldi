import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const {freeQuota,quotaDay,quotaNetwork}=await import('../src/lib/assistant/free-quota.ts');
const {POST:chat}=await import('../src/app/api/assistant/chat/route.ts');
const {POST:status}=await import('../src/app/api/assistant/quota/route.ts');
const fixed=Date.parse('2026-09-12T10:00:00Z');
let seq=30;
function request(cookie='',payload,ip=`192.0.2.${++seq}`){return new Request('https://example.test/api/assistant/'+(payload?'chat':'quota'),{method:'POST',headers:{host:'example.test',origin:'https://example.test','content-type':'application/json',cookie,'x-vercel-forwarded-for':ip,'x-forwarded-for':ip},body:JSON.stringify(payload??{})});}
const payload={mode:'free',provider:'regolo',model:'glm5.2',consent:true,messages:[{role:'user',content:'Quali dati avete?'}]};
function env(t,key,value){const previous=process.env[key];process.env[key]=value;t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});}
function config(t){for(const [key,value] of Object.entries({VERCEL:'1',VERCEL_ENV:'preview',REGOLO_API_KEY:'test-only-server-regolo-key',ASSISTANT_QUOTA_SECRET:'test-only-quota-secret-at-least-32-characters',ASSISTANT_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',ASSISTANT_SUPABASE_SECRET_KEY:'sb_secret_test_only_database_key_123456789'}))env(t,key,value);}
function cookieOf(result){return result.cookie.split(';')[0];}
function store(t){const counts=new Map(),locks=new Map(),commands=[];let providers=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('supabase.co')){
   const args=JSON.parse(init.body);commands.push(args);
   assert.equal(init.headers.apikey,'sb_secret_test_only_database_key_123456789');
   assert.equal(init.headers.Authorization,undefined);
   const a=[args.p_scope,args.p_day,'browser',args.p_browser].join(':'),b=[args.p_scope,args.p_day,'network',args.p_network].join(':');
   const lease=args.p_lease;
   if(String(url).endsWith('/assistant_quota_release')){for(const k of [a,b])if(locks.get(k)===lease)locks.delete(k);return Response.json(true);}
   assert.ok(String(url).endsWith('/assistant_quota'));
   const used=Math.max(counts.get(a)??0,counts.get(b)??0);
   if(!args.p_reserve)return Response.json([1,used]);
   if(used>=10)return Response.json([0,used]);
   if(locks.has(a)||locks.has(b))return Response.json([-1,used]);
   locks.set(a,lease);locks.set(b,lease);counts.set(a,(counts.get(a)??0)+1);counts.set(b,(counts.get(b)??0)+1);return Response.json([1,used+1]);
  }
  providers++;assert.equal(url,'https://api.regolo.ai/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer test-only-server-regolo-key');assert.ok(!init.body.includes('test-only-server-regolo-key'));
  return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'query_dvns',arguments:JSON.stringify({queries:[],clarification:'Quale anno ti interessa?'})}}]}}]});
 });return {counts,locks,commands,get providers(){return providers;}};
}

test('Rome quota resets at midnight across summer time, DST changes and year boundary',()=>{
 for(const [now,expected] of [['2026-09-12T10:00:00Z','2026-09-12T22:00:00.000Z'],['2026-03-28T23:30:00Z','2026-03-29T22:00:00.000Z'],['2026-10-24T22:30:00Z','2026-10-25T23:00:00.000Z'],['2026-12-31T12:00:00Z','2026-12-31T23:00:00.000Z']])assert.equal(quotaDay(Date.parse(now)).resetAt,expected);
});
test('network identifiers canonicalize IPv6 /64 and mapped IPv4 without trusting invalid lists',()=>{
 assert.equal(quotaNetwork('::ffff:192.0.2.1'),'192.0.2.1');assert.equal(quotaNetwork('2001:db8:0:0::1'),quotaNetwork('2001:db8::abcd'));
 for(const ip of ['','192.0.2.1, 192.0.2.2','garbage','fe80::1%eth0'])assert.equal(quotaNetwork(ip),null);
});
test('ten reservations survive browser changes and reject the eleventh before model egress',async(t)=>{
 config(t);const db=store(t),ip='192.0.2.10';let cookie=cookieOf(await freeQuota(request('',undefined,ip),false,fixed));
 for(let i=0;i<10;i++){const admitted=await freeQuota(request(cookie,undefined,ip),true,fixed);assert.equal(admitted.quota.remaining,9-i);await admitted.release();await admitted.release();}
 cookie=cookieOf(await freeQuota(request('',undefined,ip),false,fixed));
 await assert.rejects(freeQuota(request(cookie,undefined,ip),true,fixed),{code:'free_limit'});assert.equal(db.providers,0);
 assert.ok(db.commands.every(c=>!JSON.stringify(c).includes(ip)));assert.ok(db.commands.every(c=>c.p_day===quotaDay(fixed).day));
});
test('browser quota survives network changes; cookie is signed, daily and HttpOnly',async(t)=>{
 config(t);store(t);const initial=await freeQuota(request(),false,fixed),cookie=cookieOf(initial);
 assert.match(initial.cookie,/HttpOnly; SameSite=Strict/);assert.match(initial.cookie,/; Secure$/);assert.match(initial.cookie,/^__Host-/);
 const first=await freeQuota(request(cookie),true,fixed);await first.release();assert.equal((await freeQuota(request(cookie),false,fixed)).quota.remaining,9);
 await assert.rejects(freeQuota(request(cookie.slice(0,-1)+'z'),true,fixed),{code:'free_identity'});
 await assert.rejects(freeQuota(request(cookie),true,fixed+86400000),{code:'free_identity'});
 assert.equal((await freeQuota(request(cookie),false,fixed+86400000)).quota.remaining,10);
});
test('shared store serializes independent callers and releases only its own lease',async(t)=>{
 config(t);const db=store(t),ip='192.0.2.20',cookie=cookieOf(await freeQuota(request('',undefined,ip),false,fixed));
 const results=await Promise.allSettled(Array.from({length:8},()=>freeQuota(request(cookie,undefined,ip),true,fixed)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='free_busy').length,7);
 const admitted=results.find(r=>r.status==='fulfilled').value;for(const key of db.locks.keys())db.locks.set(key,'different-owner');await admitted.release();assert.equal(db.locks.size,2);
});
test('missing config, untrusted ingress, malformed store and outages fail closed',async(t)=>{
 config(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('secret diagnostic');});
 await assert.rejects(freeQuota(request()),{code:'free_unavailable'});assert.equal(calls,1);
 for(const data of [[1,-1],[1,11],[7,0],{error:'private'},{}]){t.mock.method(globalThis,'fetch',async()=>Response.json(data));await assert.rejects(freeQuota(request()),{code:'free_unavailable'});}
 env(t,'REGOLO_API_KEY','');await assert.rejects(freeQuota(request()),{code:'free_unavailable'});
});
test('quota route exposes only counters and private technical cookie; chat uses only server credential',async(t)=>{
 config(t);const db=store(t),ip='192.0.2.25';const res=await status(request('',undefined,ip));assert.equal(res.status,200);const body=await res.text();assert.ok(!body.includes('key'));assert.deepEqual(Object.keys(JSON.parse(body)).sort(),['available','remaining','resetAt']);assert.equal(res.headers.get('cache-control'),'private, no-store');
 const cookie=res.headers.get('set-cookie').split(';')[0];const reply=await chat(request(cookie,payload,ip));assert.equal(reply.status,200);assert.equal(reply.headers.get('x-assistant-remaining'),'9');const text=await reply.text();assert.ok(!text.includes('test-only-server'));assert.equal(db.providers,1);assert.equal(db.locks.size,0);
});
test('free admission rejects mode tampering and images without touching store or provider',async(t)=>{
 config(t);const db=store(t);
 for(const invalid of [{...payload,model:'other'},{...payload,provider:'openai'},{...payload,reasoning:'medium'},{...payload,consent:false},{...payload,messages:[{role:'user',content:'Foto',attachments:[{kind:'image',name:'image.jpg',mime:'image/jpeg',data:'/9j/AAAA',width:1,height:1,note:''}]}]}])assert.equal((await chat(request('',invalid))).status,400);
 assert.equal(db.commands.length,0);assert.equal(db.providers,0);
});
test('personal mode never falls back to the shared server key',async(t)=>{
 config(t);const db=store(t);const result=await chat(request('',{...payload,mode:'personal'}));assert.equal(result.status,401);assert.equal(db.commands.length,0);assert.equal(db.providers,0);
});

test('untrusted network headers and duplicated cookies cannot establish a free identity',async(t)=>{
 config(t);const db=store(t);const req=request();req.headers.delete('x-vercel-forwarded-for');await assert.rejects(freeQuota(req),{code:'free_unavailable'});assert.equal(db.commands.length,0);
 const valid=cookieOf(await freeQuota(request(),false,fixed));await assert.rejects(freeQuota(request(valid+'; '+valid),true,fixed),{code:'free_identity'});
});
test('quota lookup rejects foreign origin and oversized bodies before store access',async(t)=>{
 config(t);const db=store(t);const req=request();req.headers.set('origin','https://foreign.test');assert.equal((await status(req)).status,403);
 const large=request();large.headers.set('content-length','1000');assert.equal((await status(large)).status,413);assert.equal(db.commands.length,0);
});
test('free stream hides provider credentials and accounts for an accepted provider failure',async(t)=>{
 config(t);const db=store(t),ip='192.0.2.110';const res=await status(request('',undefined,ip));const cookie=res.headers.get('set-cookie').split(';')[0];
 const original=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,init)=>String(url).includes('supabase.co')?original(url,init):Response.json({error:'test-only-server-regolo-key'},{status:401}));
 const req=request(cookie,payload,ip);req.headers.set('accept','text/event-stream');const response=await chat(req);assert.equal(response.headers.get('x-assistant-remaining'),'9');const text=await response.text();assert.match(text,/Regolo non ha completato/);assert.ok(!text.includes('test-only-server-regolo-key'));assert.equal(db.locks.size,0);
 assert.equal((await freeQuota(request(cookie,undefined,ip))).quota.remaining,9);
});
test('aborted and oversized Supabase responses fail closed and cancel the reader',async(t)=>{
 config(t);let cancelled=false;
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}})));
 await assert.rejects(freeQuota(request()),{code:'free_unavailable'});assert.equal(cancelled,true);
 const controller=new AbortController();const req=new Request(request(),{signal:controller.signal});cancelled=false;
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(){setImmediate(()=>controller.abort());},cancel(){cancelled=true;}})));
 await assert.rejects(freeQuota(req),{code:'free_unavailable'});assert.equal(cancelled,true);
});

test('unconfigured quota is a normal unavailable status while free chat remains closed',async(t)=>{
 config(t);env(t,'REGOLO_API_KEY','');let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('no egress');});
 const availability=await status(request());assert.equal(availability.status,200);assert.equal((await availability.json()).available,false);
 const response=await chat(request('',payload));assert.equal(response.status,503);assert.equal((await response.json()).code,'free_unavailable');assert.equal(calls,0);
});


test('Supabase configuration accepts only project HTTPS URLs and server secret keys',async(t)=>{
 config(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json([1,0]);});
 for(const endpoint of ['https://example.com','https://abcdefghijklmnopqrst.supabase.co.attacker.test','http://abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co/other','https://user@abcdefghijklmnopqrst.supabase.co']){
  env(t,'ASSISTANT_SUPABASE_URL',endpoint);await assert.rejects(freeQuota(request()),{code:'free_unavailable'});
 }
 env(t,'ASSISTANT_SUPABASE_URL','https://abcdefghijklmnopqrst.supabase.co');
 for(const key of ['sb_publishable_test_key','legacy-jwt','']){env(t,'ASSISTANT_SUPABASE_SECRET_KEY',key);await assert.rejects(freeQuota(request()),{code:'free_unavailable'});}
 assert.equal(calls,0);
});

test('warm-instance burst protection bounds database calls and expires without granting credit', async (t) => {
 config(t);
 let databaseCalls = 0;
 t.mock.method(globalThis, 'fetch', async () => {
  databaseCalls++;
  return Response.json([1, 10]);
 });
 const ip = '192.0.2.201';
 for (let i = 0; i < 60; i++) {
  const result = await freeQuota(request('', undefined, ip), false, fixed);
  assert.equal(result.quota.remaining, 0);
 }
 await assert.rejects(freeQuota(request('', undefined, ip), false, fixed), { code: 'free_busy' });
 assert.equal(databaseCalls, 60);
 const refreshed = await freeQuota(request('', undefined, ip), false, fixed + 60_000);
 assert.equal(refreshed.quota.remaining, 0);
 assert.equal(databaseCalls, 61);
});
