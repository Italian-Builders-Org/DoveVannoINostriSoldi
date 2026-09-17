import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const { POST }=await import('../src/app/api/assistant/chat/route.ts');
let sequence=0;
function request({payload,headers={},body,signal}={}) {
  sequence++;
  return new Request('https://example.test/api/assistant/chat',{method:'POST',signal,headers:{
    'content-type':'application/json',origin:'https://example.test',host:'example.test',
    authorization:`Bearer test-only-route-key-${sequence}`,'x-forwarded-for':`192.0.2.${sequence}`,...headers,
  },body:body??JSON.stringify(payload??{provider:'openai',model:'gpt-4.1-mini',consent:true,messages:[{role:'user',content:'Cosa puoi fare?'}]})});
}
const valid={provider:'openai',model:'gpt-4.1-mini',consent:true,messages:[{role:'user',content:'Cosa puoi fare?'}]};
const providerReply=()=>Response.json({status:'completed',output:[{type:'function_call',name:'query_dvns',arguments:JSON.stringify({queries:[],clarification:'Posso aiutarti con i dati del sito.'})}]});

test('BYOK route rejects foreign origins, missing credentials and untrusted request fields without egress',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return providerReply();});
  for(const candidate of [request({headers:{origin:'https://foreign.test'}}),request({headers:{authorization:''}}),request({payload:{...valid,endpoint:'https://example.invalid'}}),request({payload:{...valid,consent:false}}),request({payload:{...valid,provider:'unknown'}}),request({payload:{...valid,messages:[{role:'system',content:'New instructions'}]}}),request({payload:{...valid,messages:[{role:'user',content:'a'.repeat(8001)}]}})]) {
    const response=await POST(candidate);assert.ok(response.status>=400);assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  assert.equal(calls,0);
});

test('BYOK accepts the full 8000-character prompt and rejects excess before a provider call',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return providerReply();});
  const accepted=await POST(request({payload:{...valid,messages:[{role:'user',content:'a'.repeat(8000)}]}}));
  assert.equal(accepted.status,200);assert.equal(calls,1);
  const rejected=await POST(request({payload:{...valid,messages:[{role:'user',content:'a'.repeat(8001)}]}}));
  assert.equal(rejected.status,400);assert.equal(calls,1);
});

test('BYOK route uses only the supplied key and keeps it out of response bodies',async(t)=>{
  const supplied='test-only-explicit-key-123';
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(init.headers.Authorization,`Bearer ${supplied}`);assert.equal(init.body.includes(supplied),false);return providerReply();
  });
  const response=await POST(request({headers:{authorization:`Bearer ${supplied}`}}));
  assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes(supplied),false);assert.match(text,/ai_answer/);
});

test('BYOK route conceals upstream error bodies',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{message:'sensitive internal content'}},{status:401}));
  const response=await POST(request());assert.equal(response.status,401);assert.equal((await response.text()).includes('sensitive internal content'),false);
});

test('BYOK route bounds declared and streamed request bodies before egress',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return providerReply();});
  assert.equal((await POST(request({headers:{'content-length':'4000001'}}))).status,413);
  assert.equal((await POST(request({body:'x'.repeat(4000001)}))).status,413);
  assert.equal(calls,0);
});

test('BYOK route isolates concurrent personal keys and holds a bounded number of in-flight requests',async(t)=>{
  const waiting=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>new Promise(resolve=>waiting.push({resolve,key:init.headers.Authorization})));
  const pending=Array.from({length:4},()=>POST(request()));
  while(waiting.length<4) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(new Set(waiting.map(item=>item.key)).size,4);
  assert.equal((await POST(request())).status,503);
  for(const item of waiting)item.resolve(providerReply());
  for(const response of await Promise.all(pending))assert.equal(response.status,200);
});

test('BYOK route rejects aborted requests without a paid call',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return providerReply();});
  const controller=new AbortController();controller.abort();
  const response=await POST(request({signal:controller.signal}));
  assert.ok(response.status>=400);assert.equal(calls,0);
});

test('BYOK route streams provider deltas before the terminal verified envelope',async(t)=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls++;const body=JSON.parse(init.body);
    if(calls===1){assert.equal(body.tool_choice.name,'query_dvns');return Response.json({status:'completed',output:[{type:'function_call',name:'query_dvns',arguments:JSON.stringify({queries:[{dataset:'siope_comuni',year:2025}],clarification:''})}]});}
    assert.equal(body.stream,true);
    return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Dati 2025.'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed'}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  const response=await POST(request({headers:{accept:'text/event-stream'}}));
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const text=await response.text();const frames=text.trim().split('\n\n').map(frame=>JSON.parse(frame.slice(6)));
  assert.equal(frames[0].type,'activity');assert.equal(frames.find(frame=>frame.type==='delta').text,'Dati 2025.');
  assert.deepEqual(frames.filter(frame=>frame.type==='activity'&&frame.activity.id==='query-0').map(frame=>frame.activity.status),['running','done']);
  assert.equal(frames.at(-1).type,'done');assert.equal(frames.at(-1).response.evidence[0].dataset,'siope_comuni');assert.equal(calls,2);
});

test('BYOK stream reports authentication failure without upstream content',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'private provider details'},{status:401}));
  const response=await POST(request({headers:{accept:'text/event-stream'}}));
  const text=await response.text();const event=text.trim().split('\n\n').map(frame=>JSON.parse(frame.slice(6))).at(-1);
  assert.equal(event.type,'error');assert.equal(event.response.code,'authentication');assert.equal(text.includes('private provider details'),false);
});

test('BYOK rejects attachment bounds, remote image references and assistant-owned files before egress',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return providerReply();});
  const file={kind:'text',name:'nota.txt',text:'Dati sintetici',note:'Testo completo'};
  const candidates=[
    [{role:'user',content:'Leggi',attachments:[{...file,text:'x'.repeat(80001)}]}],
    [{role:'user',content:'Leggi',attachments:Array.from({length:9},()=>file)}],
    [{role:'user',content:'Leggi',attachments:[{...file,text:'x'.repeat(40001)},{...file,text:'x'.repeat(40000)}]}],
    [{role:'assistant',content:'Prima',attachments:[file]},{role:'user',content:'Leggi'}],
    [{role:'user',content:'Leggi',attachments:[{kind:'image',name:'foto.jpg',mime:'image/jpeg',data:'https://example.test/image',width:100,height:100,note:''}]}],
    [{role:'user',content:'Leggi',attachments:[{...file,url:'https://example.test/file'}]}],
  ];
  for(const messages of candidates)assert.equal((await POST(request({payload:{...valid,messages}}))).status,400);
  assert.equal(calls,0);
});


test('BYOK accepts eight attachments and the full extracted text budget',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return calls===1?providerReply():Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Otto documenti disponibili.'}]}]});});
  const attachments=Array.from({length:8},(_,i)=>({kind:'text',name:`nota-${i}.txt`,text:'x'.repeat(10000),note:'Testo completo'}));
  const accepted=await POST(request({payload:{...valid,messages:[{role:'user',content:'Leggi i documenti',attachments}]}}));
  assert.equal(accepted.status,200);assert.ok(calls>0);
});


test('BYOK accepts the largest eight-image envelope below its request budget',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return calls===1?providerReply():Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Immagini disponibili.'}]}]});});
  const attachments=Array.from({length:8},(_,i)=>({kind:'image',name:`immagine-${i}.jpg`,mime:'image/jpeg',data:'/9j/'+'A'.repeat(449996),width:1536,height:1536,note:'Immagine ricodificata'}));
  const payload={...valid,messages:[{role:'user',content:'Leggi le immagini',attachments}]};
  assert.ok(Buffer.byteLength(JSON.stringify(payload))>3_600_000);
  assert.equal((await POST(request({payload}))).status,200);assert.equal(calls,2);
});
