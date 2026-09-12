import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launchBrowser,closeBrowser,createPage,defaultBaseUrl} from './harness.mjs';
const browser=await launchBrowser(),base=defaultBaseUrl();mkdirSync('artifacts/browser',{recursive:true});
try{
 for(const width of [390,768,1280]){
  const page=await createPage(browser,{width});await page.setViewport({width,height:900});const requests=[],errors=[];let remaining=10;
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',r=>{
   const path=new URL(r.url()).pathname;
   if(path==='/api/assistant/quota'){void r.respond({status:200,contentType:'application/json',body:JSON.stringify({available:true,remaining,resetAt:new Date(Date.now()+3600000).toISOString()})});return;}
   if(path!=='/api/assistant/chat'){void r.continue();return;}
   const body=JSON.parse(r.postData());requests.push({headers:r.headers(),body});if(body.mode==='free')remaining--;
   const answer={ok:true,kind:'ai_answer',provider:body.provider,model:body.model,text:'I pagamenti dei comuni sono dati di cassa. Periodo 2025.',evidence:[{dataset:'siope_comuni',title:'Pagamenti dei Comuni',sources:[{name:'SIOPE',url:'https://www.siope.it/',period:'2025'}]}]};
   void r.respond({status:200,contentType:'text/event-stream',headers:{'X-Assistant-Remaining':String(remaining),'X-Assistant-Reset':new Date(Date.now()+3600000).toISOString()},body:[{type:'delta',text:answer.text.slice(0,15)},{type:'delta',text:answer.text.slice(15)},{type:'done',response:answer}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')});
  });
  await page.goto(new URL('/assistente',base).href,{waitUntil:'networkidle0'});await page.waitForSelector('[data-free-quota]');
  assert.match(await page.$eval('[data-free-quota]',e=>e.textContent),/10 domande/);
  await page.type('#assistant-prompt','Pagamenti dei comuni nel 2025');await page.keyboard.press('Enter');await page.waitForSelector('#assistant-free-title');assert.equal(requests.length,0);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(requests.length,0);
  await page.focus('#assistant-prompt');await page.keyboard.press('Enter');await page.waitForSelector('#assistant-free-title');
  const bounds=await page.$eval('dialog[open]',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,w:innerWidth,overflow:e.scrollWidth-e.clientWidth};});assert.ok(bounds.left>=0&&bounds.right<=bounds.w&&bounds.overflow<=1);
  await page.screenshot({path:`artifacts/browser/assistant-free-consent-${width}-${process.env.DVNS_COLOR_SCHEME??"light"}.png`});
  await page.click('button::-p-text(Accetta e invia)');await page.waitForSelector('button[aria-label="Copia risposta"]');
  assert.equal(requests[0].headers.authorization,undefined);assert.equal(requests[0].body.mode,'free');assert.equal(requests[0].body.model,'glm5.2');assert.equal(requests[0].body.consent,true);
  await page.waitForFunction(()=>document.querySelector('[data-free-quota]').textContent.includes('9 domande'));
  // Simulate the authoritative final remaining question, then verify the personal-key handoff.
  remaining=1;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-free-quota]').textContent.includes('1 domanda'));
  await page.type('#assistant-prompt','E in Calabria?');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('button[aria-label="Copia risposta"]').length===2);
  assert.deepEqual(requests[1].body.messages.map(m=>m.role),['user','assistant','user']);
  await page.waitForFunction(()=>document.querySelector('[data-free-quota]').textContent.includes('esaurite'));
  await page.type('#assistant-prompt','Continua con la mia chiave');await page.keyboard.press('Enter');await page.waitForSelector('#assistant-provider');assert.equal(requests.length,2);
  await page.select('#assistant-provider','regolo');assert.equal(await page.$eval('#assistant-model',e=>e.value),'glm5.2');await page.type('#assistant-api-key','test-only-regolo-personal-key');await page.click('dialog input[type="checkbox"]');await page.click('button[type="submit"]::-p-text(Usa in questa scheda)');
  // Closing settings restores focus in requestAnimationFrame. Wait for that
  // accessibility transition before focusing the composer, or Enter can reopen settings.
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('Impostazioni AI:'));
  assert.equal(await page.$$eval('[data-assistant-reply]',es=>es.length),2,'key handoff retains conversation');
  await page.focus('#assistant-prompt');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('button[aria-label="Copia risposta"]').length===3);
  assert.equal(requests[2].headers.authorization,'Bearer test-only-regolo-personal-key');assert.equal(requests[2].body.messages.length,5);assert.ok(!JSON.stringify(requests[2].body).includes('test-only-regolo-personal-key'));
  assert.ok(await page.$eval('body',e=>e.scrollWidth<=innerWidth));await page.screenshot({path:`artifacts/browser/assistant-free-handoff-${width}-${process.env.DVNS_COLOR_SCHEME??"light"}.png`});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS free assistant: consent, quota, history, Regolo BYOK handoff, 390/768/1280px');
}finally{await closeBrowser(browser);}
