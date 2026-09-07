import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const {completeProviderText}=await import('../src/lib/assistant/provider-client.ts');
const {executeByokChat}=await import('../src/lib/assistant/byok-engine.ts');
const file={kind:'text',name:'nota.txt',text:'Biblioteca: 120000 stanziati, 90000 pagati.',note:'Dati sintetici'};
const image={kind:'image',name:'grafico.jpg',mime:'image/jpeg',data:'/9j/AA==',width:100,height:50,note:'Immagine ottimizzata'};
for(const provider of ['openai','anthropic','openrouter'])test(`Attachments use native ${provider} content blocks with inline data`,async()=>{
  let body;
  const fetcher=async(url,init)=>{
    body=JSON.parse(init.body);
    if(provider==='openai')return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Letto'}]}]});
    if(provider==='anthropic')return Response.json({stop_reason:'end_turn',content:[{type:'text',text:'Letto'}]});
    return Response.json({choices:[{finish_reason:'stop',message:{content:'Letto'}}]});
  };
  assert.equal(await completeProviderText({provider,model:'test-model',apiKey:'test-only-key'},'Sistema',[{role:'user',content:'Leggi',attachments:[file,image]}],{signal:new AbortController().signal,fetcher}),'Letto');
  const message=provider==='openai'?body.input[0]:body.messages.at(-1);
  assert.ok(Array.isArray(message.content));assert.match(JSON.stringify(message.content),/Biblioteca: 120000/);
  if(provider==='anthropic')assert.deepEqual(message.content[0].source,{type:'base64',media_type:'image/jpeg',data:image.data});
  else if(provider==='openai')assert.equal(message.content[1].image_url,'data:image/jpeg;base64,'+image.data);
  else assert.equal(message.content[1].image_url.url,'data:image/jpeg;base64,'+image.data);
});
for(const [needsReasoning,reasoning,effort] of [[false,'auto','none'],[true,'auto','medium'],[false,'medium','medium'],[true,'none','none']])test(`Luna reasoning ${reasoning} with plan ${needsReasoning} requests ${effort} and preserves attachment provenance`,async()=>{
  const requests=[],activities=[];
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);
    return Response.json({choices:[{finish_reason:requests.length===1?'tool_calls':'stop',message:requests.length===1?{tool_calls:[{type:'function',function:{name:'query_dvns',arguments:JSON.stringify({queries:[],clarification:'',needsReasoning})}}]}:{content:'Dati sintetici: pagato il 75%.'}}]});
  };
  const result=await executeByokChat({provider:'openrouter',model:'openai/gpt-5.6-luna',apiKey:'test-only-key',reasoning},[{role:'user',content:'Leggi e calcola',attachments:[file]}],{signal:new AbortController().signal,fetcher,onActivity:a=>activities.push(a),queryDataset:()=>assert.fail('Attachment-only task must not query a dataset')});
  assert.equal(requests.length,2);assert.deepEqual(requests[0].reasoning,{effort:'none',exclude:true});assert.deepEqual(requests[1].reasoning,{effort,exclude:true});
  assert.deepEqual(result.evidence,[]);assert.match(result.text,/75%/);
  assert.equal(activities[0].id,'attachments');assert.deepEqual(activities[0].resources,['nota.txt']);
  assert.equal(activities.find(a=>a.id==='answer'&&a.status==='running').label,effort==='medium'?'Analisi approfondita':'Preparo la risposta');
  assert.match(requests[1].messages[0].content,/non fidati/);
});
