import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {launchBrowser,closeBrowser,defaultBaseUrl} from './harness.mjs';
const browser=await launchBrowser();
mkdirSync('artifacts/browser',{recursive:true});
mkdirSync('artifacts/assistant-fixtures',{recursive:true});
writeFileSync('artifacts/assistant-fixtures/corrotto.pdf','Not a PDF');
writeFileSync('artifacts/assistant-fixtures/lungo.txt','x'.repeat(80001));
const fixture=name=>resolve('tests/fixtures/assistant',name);
let activePage,activeWidth;
try {
  for(const width of process.env.DVNS_ATTACHMENT_WIDTH ? [Number(process.env.DVNS_ATTACHMENT_WIDTH)] : [320,390,743,768,983,1280]) {
    const page=await browser.newPage(),errors=[],requests=[]; activePage=page;activeWidth=width;
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height:[743,768,983].includes(width)?695:844});
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(new URL(request.url()).pathname!=='/api/assistant/chat'){void request.continue();return;}
      const payload=JSON.parse(request.postData());requests.push(payload);
      const activities=[{id:'attachments',label:'Allegati disponibili',status:'done',resources:payload.messages.flatMap(m=>m.attachments?.map(f=>f.name)??[])},{id:'planning',label:'Fonti selezionate',status:'done'},{id:'answer',label:'Analisi approfondita completata',status:'done'}];
      const answer={ok:true,kind:'ai_answer',provider:'openrouter',model:'openai/gpt-5.6-luna',text:`Risposta di prova ${requests.length}. Dati sintetici.\n\n| Voce | Stanziamento | Pagamenti | Residuo | Percentuale |\n|---|---:|---:|---:|---:|\n| Biblioteca | 120.000 euro | 90.000 euro | 30.000 euro | 75% |`,evidence:[]};
      void request.respond({status:200,contentType:'text/event-stream',body:[...activities.map(activity=>({type:'activity',activity})),{type:'delta',text:answer.text},{type:'done',response:answer}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});
    });
    await page.goto(new URL('/assistente',defaultBaseUrl()).href,{waitUntil:'networkidle0'});
    await page.evaluate(()=>{window.__progress=[];new MutationObserver(()=>{for(const el of document.querySelectorAll('[role="progressbar"]'))window.__progress.push(Number(el.getAttribute('aria-valuenow')));}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-valuenow']});});
    const upload=async paths=>{const input=await page.$('input[type="file"]');await input.uploadFile(...paths);};
    const ready=async count=>page.waitForFunction(count=>document.querySelectorAll('[aria-label="Allegati da inviare"] li[data-ready="true"][data-error="false"]').length===count,{},count).catch(async error=>{await page.screenshot({path:`artifacts/browser/assistant-attachments-${width}-failure.png`,fullPage:true});console.error(JSON.stringify({width,errors,files:await page.$$eval('[aria-label="Allegati da inviare"] li',els=>els.map(el=>({title:el.title,ready:el.dataset.ready,error:el.dataset.error}))),alerts:await page.$$eval('[role="alert"]',els=>els.map(el=>el.textContent))}));throw error;});
    const click=label=>page.click(`button[aria-label="${label}"]`);
    const complete=number=>page.waitForFunction(number=>!!document.querySelector('[data-assistant-reply] table')&&document.querySelector('[data-assistant-reply]')?.textContent.includes(`Risposta di prova ${number}.`)&&!document.querySelector('button[aria-label="Interrompi ricerca"]'),{},number);
    await upload(['riepilogo.pdf','relazione.docx','pagamenti.xlsx','nota.txt','criteri.md','nota.txt','criteri.md','nota.txt'].map(fixture));await ready(8);
    assert.equal(requests.length,0,'preparation must not call the provider');
    for(const [name,text] of [['riepilogo.pdf','Biblioteca'],['relazione.docx','120.000'],['pagamenti.xlsx','120000']]){
      await click('Anteprima '+name);await page.waitForSelector('dialog[open] pre');assert.ok((await page.$eval('dialog pre',el=>el.textContent)).includes(text));await click('Chiudi anteprima allegato');await page.waitForFunction(name=>document.activeElement?.getAttribute('aria-label')==='Anteprima '+name,{},name);
    }
    await page.type('#assistant-prompt','Confronta i tre allegati sintetici. Verifica la coerenza delle cifre, calcola residui e percentuali di pagamento per biblioteca e parco, poi il totale e la percentuale complessiva ponderata. Cita i file e segnala cosa manca nel Word. Non consultare dataset ufficiali per questi dati inventati.');
    const bounds=await page.evaluate(()=>{
      const main=document.querySelector('main[aria-label="Assistente sui dati pubblici"]');
      const footer=main.querySelector('footer').getBoundingClientRect(),suggestions=main.querySelector('[aria-label="Domande di esempio"]').getBoundingClientRect(),composer=main.querySelector('form').getBoundingClientRect();
      return{footerTop:footer.top,suggestionsBottom:suggestions.bottom,composerBottom:composer.bottom,overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(bounds.footerTop>=bounds.suggestionsBottom,`${width}: footer overlaps suggestions`);assert.ok(bounds.footerTop>=bounds.composerBottom);assert.ok(bounds.overflow<=1);
    assert.deepEqual(await page.$$eval('[aria-label="Allegati da inviare"] li',els=>els.map(el=>el.dataset.format)),['pdf','word','sheet','text','code','text','code','text']);
    await page.screenshot({path:`artifacts/browser/assistant-attachments-${width}-documents.png`,fullPage:true});
    await click('Invia domanda');await page.waitForSelector('dialog[open]');assert.equal(requests.length,0);
    await page.select('#assistant-reasoning','medium');await page.type('#assistant-api-key','test-only-attachment-key');await page.click('dialog input[type="checkbox"]');await page.click('button[type="submit"]::-p-text(Usa in questa scheda)');
    await click('Invia domanda');await complete(1);
    assert.equal(requests[0].reasoning,"medium");assert.equal(requests[0].messages[0].attachments.length,8);assert.ok(requests[0].messages[0].attachments.every(f=>f.kind==='text'));assert.equal(await page.$$eval('[aria-label="Allegati da inviare"]',els=>els.length),0);
    assert.ok(await page.$eval('[aria-label="Allegati del messaggio"]',el=>el.firstElementChild.getBoundingClientRect().left>=el.getBoundingClientRect().left), 'the first sent attachment remains reachable when the strip overflows');
    const activity=await page.$('[data-assistant-activity] > button');assert.equal(await activity.evaluate(el=>el.getAttribute('aria-expanded')),'false');await activity.click();
    await page.waitForFunction(()=>!!document.querySelector('[aria-label="Conversazione di questa pagina"] [aria-expanded="true"]'));await page.waitForFunction(()=>!document.getAnimations().some(animation=>animation.playState==='running'));
    await page.screenshot({path:`artifacts/browser/assistant-attachments-${width}-answer.png`,fullPage:true});
    assert.ok(await page.$eval('body',el=>el.scrollWidth<=innerWidth));
    await click('Rigenera risposta');await complete(2);assert.deepEqual(requests[1].messages[0].attachments,requests[0].messages[0].attachments);
    await click('Modifica domanda');await page.waitForSelector('[id^="edit-message-"]');await page.$eval('[id^="edit-message-"]',el=>{el.focus();el.select();});await page.keyboard.press('Backspace');await page.type('[id^="edit-message-"]','Confronta soltanto la biblioteca nei file.');await page.click('button::-p-text(Invia modifica)');await complete(3);assert.deepEqual(requests[2].messages[0].attachments,requests[0].messages[0].attachments);
    await upload(['grafico.png','nota.txt','criteri.md'].map(fixture));await ready(3);
    await click('Anteprima grafico.png');await page.waitForSelector('dialog[open] img');assert.equal(await page.$eval('dialog img',el=>el.naturalWidth),1000);await click('Chiudi anteprima allegato');
    await page.screenshot({path:`artifacts/browser/assistant-attachments-${width}-image-text.png`,fullPage:true});
    await page.type('#assistant-prompt','Leggi questi nuovi allegati.');await click('Invia domanda');await page.waitForFunction(()=>document.querySelectorAll('[data-assistant-reply] table').length===2&&!document.querySelector('button[aria-label="Interrompi ricerca"]'));
    assert.ok(await page.$eval('main',el=>el.innerText.includes('i file dei messaggi più vecchi non sono inclusi')));
    const latest=requests.at(-1).messages;assert.equal(latest.length,1,'older file-bearing pairs are dropped when the attachment budget is exceeded');assert.equal(latest[0].attachments[0].kind,'image');assert.ok(latest[0].attachments[0].data.startsWith('/9j/'));
    await click('Nuova chat');await page.waitForFunction(()=>!document.querySelector('[aria-label="Allegati del messaggio"]'));
    await upload([resolve('artifacts/assistant-fixtures/corrotto.pdf'),resolve('artifacts/assistant-fixtures/lungo.txt')]);await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Allegati da inviare"] li[data-error="true"]').length===2);
    await page.type('#assistant-prompt','Non inviare file non leggibili');assert.equal(await page.$eval('button[aria-label="Invia domanda"]',el=>el.disabled),true);await click('Rimuovi corrotto.pdf');await click('Rimuovi lungo.txt');await page.waitForFunction(()=>!document.querySelector('[aria-label="Allegati da inviare"]'));
    await upload(Array.from({length:9},()=>fixture('nota.txt')));await page.waitForFunction(()=>document.body.innerText.includes('fino a 8 file per messaggio'));assert.equal(await page.$$eval('[aria-label="Allegati da inviare"] li',els=>els.length),0);
    // Long paste becomes a removable text file; typing keeps all characters and bounds the editor.
    await page.$eval('#assistant-prompt',el=>{el.focus();el.select();});await page.keyboard.press('Backspace');
    const pasted='Testo sintetico da conservare. '.repeat(400);
    await page.$eval('#assistant-prompt',(el,text)=>{const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},pasted);
    await ready(1);await click('Anteprima testo-incollato-1.txt');
    assert.equal(await page.$eval('dialog pre',el=>el.textContent),pasted.trim());await click('Chiudi anteprima allegato');
    assert.equal(await page.$eval('#assistant-prompt',el=>el.value),'Analizza il testo allegato.');
    await click('Rimuovi testo-incollato-1.txt');
    await page.$eval('#assistant-prompt',el=>{el.focus();el.select();});await page.keyboard.press('Backspace');
    await page.keyboard.sendCharacter('Domanda lunga\n'.repeat(650));
    const longDraft=await page.$eval('#assistant-prompt',el=>({length:el.value.length,height:el.getBoundingClientRect().height,scroll:el.scrollHeight,invalid:el.getAttribute('aria-invalid')}));
    assert.equal(longDraft.length,9100);assert.ok(longDraft.height<=181);assert.ok(longDraft.scroll>longDraft.height);assert.equal(longDraft.invalid,'true');
    assert.equal(await page.$eval('button[aria-label="Invia domanda"]',el=>el.disabled),true);
    assert.ok(await page.$eval('body',el=>el.scrollWidth<=innerWidth));
    await page.screenshot({path:`artifacts/browser/assistant-attachments-${width}-long-text.png`,fullPage:true});
    await upload([fixture('riepilogo.pdf')]);await click('Nuova chat');await page.waitForFunction(()=>!document.querySelector('[aria-label="Allegati da inviare"]'));await page.waitForFunction(()=>document.activeElement?.id==='assistant-prompt');
    const observed=await page.evaluate(()=>window.__progress);assert.ok(observed.some(p=>p>=0&&p<100),'real preparation progress observed');
    assert.deepEqual(errors,[]);await page.close();console.log(`PASS attachments ${width}px: actual PDF/DOCX/XLSX/PNG/TXT/MD extraction, preview, format identity, layout, message retention, budget, invalid files and cancellation`);
  }
}catch(error){
  console.error(`Attachment browser check failed at ${activeWidth}px:`, error);
  if(activePage&&!activePage.isClosed()){
    await activePage.screenshot({path:`artifacts/browser/assistant-attachments-${activeWidth}-failure.png`,fullPage:true}).catch(()=>{});
  }
  throw error;
}finally{await closeBrowser(browser);}
