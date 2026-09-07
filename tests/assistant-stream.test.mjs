import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const {readProviderStream}=await import('../src/lib/assistant/provider-stream.ts');
const {readChatStream}=await import('../src/lib/assistant/chat-stream.ts');
const {completeProviderText}=await import('../src/lib/assistant/provider-client.ts');
const connection={provider:'openrouter',model:'openai/gpt-5.6-luna',apiKey:'test-only-stream-key-123'};
const frame=value=>`data: ${typeof value==='string'?value:JSON.stringify(value)}\r\n\r\n`;
function response(text, size=7) {
  const bytes=new TextEncoder().encode(text);
  let offset=0;
  return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+size));offset+=size;}}),{headers:{'content-type':'text/event-stream'}});
}
const signal=()=>new AbortController().signal;
const router=delta=>({choices:[{delta:{content:delta},finish_reason:null}]});
const stop=()=>({choices:[{delta:{},finish_reason:'stop'}]});

test('provider streaming delivers real partial text across UTF-8 chunks and ignores heartbeat/usage frames',async()=>{
  const deltas=[];
  const body=': heartbeat\r\n\r\n'+frame(router('Il totale è '))+frame(router('1.234 €'))+frame(stop())+frame({...stop(),usage:{prompt_tokens:20}})+frame('[DONE]');
  const result=await readProviderStream(response(body,1),connection,signal(),chunk=>deltas.push(chunk));
  assert.equal(result,'Il totale è 1.234 €');assert.deepEqual(deltas,['Il totale è ','1.234 €']);
});

test('provider streaming redacts credentials split over multiple chunks',async()=>{
  const deltas=[];
  const body=frame(router('Test '+connection.apiKey.slice(0,12)))+frame(router(connection.apiKey.slice(12)))+frame(router(' fine'))+frame(stop())+frame('[DONE]');
  const result=await readProviderStream(response(body),connection,signal(),delta=>deltas.push(delta));
  assert.equal(result,'Test [chiave rimossa] fine');
  assert.equal(deltas.join(''),result);assert.ok(!deltas.join('').includes(connection.apiKey.slice(0,12)));
});

for(const body of [frame(router('Parziale')),frame({error:{message:'private provider details'}}),frame({choices:[{delta:{content:'Parziale'},finish_reason:'length'}]})+frame('[DONE]'),frame(router('x'.repeat(8001))),frame(router('Parziale'))+frame('[DONE]')]) {
  test('provider streaming fails closed on truncated, oversized or failed generation',async()=>{
    await assert.rejects(readProviderStream(response(body),connection,signal(),()=>{}),error=>!error.message.includes('private provider'));
  });
}

for(const provider of ['openai','anthropic']) {
  test(`${provider} streaming recognizes text and terminal events`,async()=>{
    const body=provider==='openai'
      ? frame({type:'response.output_text.delta',delta:'Ciao'})+frame({type:'response.completed',response:{status:'completed'}})
      : frame({type:'content_block_delta',delta:{type:'text_delta',text:'Ciao'}})+frame({type:'message_delta',delta:{stop_reason:'end_turn'}})+frame({type:'message_stop'});
    const chunks=[];
    assert.equal(await completeProviderText({...connection,provider},'System',[{role:'user',content:'Ciao'}],{signal:signal(),onDelta:delta=>chunks.push(delta),fetcher:async(url,init)=>{
      assert.equal(JSON.parse(init.body).stream,true);return response(body);
    }}),'Ciao');
    assert.deepEqual(chunks,['Ciao']);
  });
}

test('stream abort cancels its reader and does not accept partial data as completion',async()=>{
  const controller=new AbortController();let cancelled=false;
  const source=new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode(frame(router('Parziale'))));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
  const pending=readProviderStream(source,connection,controller.signal,()=>controller.abort());
  await assert.rejects(pending);assert.equal(cancelled,true);
});

const answer={ok:true,kind:'ai_answer',provider:'openrouter',model:connection.model,text:'Totale',evidence:[]};
const appFrame=event=>`data: ${JSON.stringify(event)}\n\n`;
test('browser protocol exposes partial text before accepting the final answer',async()=>{
  const updates=[];
  const value=await readChatStream(response(appFrame({type:'delta',text:'To'})+appFrame({type:'delta',text:'tale'})+appFrame({type:'done',response:answer})),signal(),text=>updates.push(text));
  assert.deepEqual(updates,['To','Totale']);assert.deepEqual(value,answer);
});

test('browser protocol rejects interrupted or forged stream events',async()=>{
  for(const events of [[{type:'delta',text:'Incomplete'}],[{type:'done',response:{...answer,evidence:[{dataset:'x',title:'x',sources:[{name:'x',url:'javascript:alert(1)'}]}]}}],[{type:'done',response:answer},{type:'delta',text:'Late'}]]) {
    await assert.rejects(readChatStream(response(events.map(appFrame).join('')),signal(),()=>{}));
  }
});
