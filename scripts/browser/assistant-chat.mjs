import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchBrowser, closeBrowser, createPage, defaultBaseUrl } from './harness.mjs';

const browser=await launchBrowser();
const base=defaultBaseUrl();
mkdirSync('artifacts/browser',{recursive:true});
try {
  for(const width of [320,390,768,1280]) {
    const page=await createPage(browser,{width});
    const errors=[],requests=[];
    let hold=false,held;
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height:width<600?844:900});
    await page.setRequestInterception(true);
    const answer={ok:true,kind:'ai_answer',provider:'openai',model:'gpt-4.1-mini',text:'## Totale\n\n**Risposta di prova**: <b>testo semplice</b>\n\n**Limiti da considerare:**\n- Periodo 2025\n- Fonte ufficiale\n\nEcco i dati:\n| Anno | Totale |\n|---|---:|\n| 2025 | 4,65 mld |\n\nApri [i Comuni](/comuni), non [pagina non citata](/non-citata) né [sito esterno](https://example.com/).',evidence:[{dataset:'siope_comuni',title:'Pagamenti dei Comuni',sources:[{name:'SIOPE',url:'https://www.siope.it/',period:'2025'}],caveat:'Pagamenti di cassa: non coincidono con gli impegni di bilancio.'}],siteLinks:[{href:'/spese/panoramica',title:'Spesa pubblica'},{href:'/comuni',title:'Comuni',description:'Pagamenti, entrate e confronti per ogni Comune'}]};
    const fulfill=request=>request.respond({status:200,contentType:'text/event-stream',body:[{type:'delta',text:answer.text.slice(0,16)},{type:'delta',text:answer.text.slice(16)},{type:'done',response:answer}].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')});
    page.on('request',request=>{
      if(new URL(request.url()).pathname!=='/api/assistant/chat'){void request.continue();return;}
      requests.push({headers:request.headers(),body:JSON.parse(request.postData())});
      if(hold){held=request;return;}
      void fulfill(request);
    });
    await page.goto(new URL('/assistente/anteprima',base).href,{waitUntil:'networkidle0'});
    assert.equal(new URL(page.url()).pathname,'/assistente');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedText=text;}}}));
    const field='#assistant-prompt';
    const click=label=>page.click(`button[aria-label="${label}"]`);
    const replace=async(selector,value)=>{await page.$eval(selector,el=>{el.focus();el.select();});await page.keyboard.press('Backspace');await page.type(selector,value);};
    const complete=async count=>{await page.waitForFunction(count=>document.querySelectorAll('[data-assistant-reply] a[href="https://www.siope.it/"]').length===count && !document.querySelector('button[aria-label="Interrompi ricerca"]'),{},count);await page.waitForFunction(()=>!document.getAnimations().some(animation=>animation.playState==='running' && animation.effect?.getComputedTiming?.().iterations!==Infinity));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
    await page.waitForSelector(field);
    assert.ok(await page.$eval('body',el=>el.scrollWidth<=innerWidth),`${width}: overflow`);
    const themeLabel=process.env.DVNS_COLOR_SCHEME==='dark'?'Passa al tema chiaro':'Passa al tema scuro';
    assert.equal(await page.$$eval(`button[aria-label="${themeLabel}"]`,els=>els.length),1);
    await page.screenshot({path:`artifacts/browser/assistant-chat-${width}-${process.env.DVNS_COLOR_SCHEME ?? "light"}.png`,fullPage:true});
    // A suggestion shows the whole question it writes: clicking fills the field, without sending, and keeps typing there.
    const suggestion=await page.$eval('[aria-label="Domande di esempio"] button',el=>el.innerText.trim());
    await page.click('[aria-label="Domande di esempio"] button');
    assert.equal(await page.$eval(field,el=>el.value),suggestion);assert.match(suggestion,/\?$/);
    await page.waitForFunction(()=>document.activeElement?.id==='assistant-prompt');assert.equal(requests.length,0);
    await replace(field,'');
    await page.type(field,'@');await page.waitForSelector('[role="listbox"]');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.match(await page.$eval(field,el=>el.value),/Calabria/);assert.equal(requests.length,0);
    await page.keyboard.press('Enter');await page.waitForSelector('dialog[open]');
    assert.equal(requests.length,0,'no key, no provider call');
    const selectGeometry=await page.$eval('#assistant-provider',el=>{const field=el.getBoundingClientRect(),icon=el.parentElement.querySelector('svg').getBoundingClientRect();return{center:Math.abs(field.top+field.height/2-icon.top-icon.height/2),right:field.right-icon.right,padding:parseFloat(getComputedStyle(el).paddingRight)};});
    assert.ok(selectGeometry.center<1 && selectGeometry.right>=12 && selectGeometry.right<=16 && selectGeometry.padding>=40,JSON.stringify(selectGeometry));
    await page.type('#assistant-api-key','test-only-router-key-123');
    await page.select('#assistant-provider','openai');
    assert.equal(await page.$eval('#assistant-api-key',el=>el.value),'');
    assert.equal(await page.$eval('#assistant-model',el=>el.value),'gpt-4.1-mini');
    await page.type('#assistant-api-key','test-only-openai-key-123');
    await page.click('button[type="submit"]::-p-text(Usa in questa scheda)');
    await page.waitForSelector('dialog [role="alert"]');assert.equal(requests.length,0);
    await page.click('dialog input[type="checkbox"]');
    const geometry=await page.$eval('dialog[open]',el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,overflow:el.scrollWidth-el.clientWidth};});
    assert.ok(geometry.left>=0&&geometry.right<=geometry.width&&geometry.overflow<=1);
    await page.screenshot({path:`artifacts/browser/assistant-chat-${width}-settings.png`,fullPage:true});
    await page.click('button[type="submit"]::-p-text(Usa in questa scheda)');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('Impostazioni AI:'));
    assert.equal(requests.length,0,'saving must not call provider');
    await replace(field,'Quanto hanno speso i Comuni nel 2025?');await page.keyboard.press('Enter');await complete(1);
    assert.equal(requests[0].headers.authorization,'Bearer test-only-openai-key-123');
    assert.equal(requests[0].headers.accept,'text/event-stream');
    assert.equal(JSON.stringify(requests[0].body).includes('test-only-openai-key-123'),false);
    assert.equal(requests[0].body.consent,true);
    assert.equal(await page.$$eval('[data-assistant-reply] b',els=>els.length),0);
    assert.equal(await page.$$eval('[data-assistant-reply] strong',els=>els.length),4,'2 bold runs + 1 site link title + the data-limit label');
    const reply=await page.$eval('[data-assistant-reply]',el=>({
      list:[...el.querySelectorAll('ul li')].some(li=>li.textContent==='Periodo 2025'),
      dash:/(^|\n)- /.test(el.innerText),
      inline:[...el.querySelectorAll('p a')].map(a=>({href:a.getAttribute('href'),target:a.target,text:a.firstChild.textContent})),
      text:el.innerText,
      site:[...el.querySelectorAll('[data-site-links] a')].map(a=>({href:a.getAttribute('href'),target:a.target})),
      external:[...el.querySelectorAll('section:not([data-site-links]) a')].map(a=>({href:a.getAttribute('href'),target:a.target})),
      landmarks:el.querySelectorAll('nav').length,
      table:[...el.querySelectorAll('table th')].map(th=>th.textContent),
      pipes:/\|/.test(el.innerText),
      hints:el.querySelectorAll('[data-site-links] p').length,
      overflow:document.body.scrollWidth-innerWidth,
    }));
    assert.ok(reply.list&&!reply.dash,'label + list lines render a real list');
    assert.deepEqual(reply.inline,[{href:'/comuni',target:'_blank',text:'i Comuni'}],'only allow-listed internal links are anchors');
    assert.ok(reply.text.includes('pagina non citata')&&reply.text.includes('sito esterno')&&reply.text.split('example.com').length===1,'rejected links keep only their label');
    assert.deepEqual(reply.site,[{href:'/spese/panoramica',target:'_blank'}],'site links open in a new tab so the in-memory chat survives; a page already linked in the text is not listed again');
    assert.equal(reply.landmarks,0,'site pages are a labelled section, not one nav landmark per answer');
    assert.deepEqual(reply.table,['Anno','Totale']);assert.equal(reply.pipes,false,'a label line before a table must not leave raw pipes');
    assert.equal(reply.hints,0,'the ↗ icon and screen-reader text already say pages open in a new tab');
    assert.doesNotMatch(reply.text,/generata con AI|Verifica numeri|Citata nella risposta/,'one AI notice lives under the composer: answers repeat no labels or verification notes');
    assert.deepEqual(reply.external,[{href:'https://www.siope.it/',target:'_blank'}],'official sources open in a new tab');
    assert.ok(reply.overflow<=1,`${width}: answer overflow`);
    // Focus rings (2px + 3px offset) must fit inside the horizontally clipping scroller.
    const ringRoom=await page.$eval('[data-assistant-reply]',el=>{const scroller=el.closest('[role="log"]');const box=scroller.getBoundingClientRect();return Math.min(...[...el.querySelectorAll('a, summary, button, [tabindex="0"]')].map(node=>{node.focus({focusVisible:true});const style=getComputedStyle(node);const ring=parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset);const rect=node.getBoundingClientRect();node.blur();return Math.min(rect.left-box.left,box.right-rect.right)-ring;}));});
    assert.ok(ringRoom>=0,`${width}: a focus ring is clipped by ${-ringRoom}px at the scroller edge`);
    const order=await page.$eval('[data-assistant-reply]',el=>{const sections=[...el.querySelectorAll('section')];return{sources:sections.findIndex(section=>!section.hasAttribute('data-site-links')),pages:sections.findIndex(section=>section.hasAttribute('data-site-links')),limit:el.querySelector('section:not([data-site-links]) li p:last-child')?.innerText??''};});
    assert.ok(order.sources>=0&&order.sources<order.pages,'official sources come before the DVNS pages');
    assert.match(order.limit,/^Limiti del dato\s+Pagamenti di cassa/,'the data limit is visible without a click');
    await page.screenshot({path:`artifacts/browser/assistant-chat-${width}-answer-${process.env.DVNS_COLOR_SCHEME ?? "light"}.png`,fullPage:true});
    await click('Copia risposta');
    await page.waitForFunction(()=>typeof window.__copiedText==='string');
    const copiedAnswer=await page.evaluate(()=>window.__copiedText);
    assert.equal(copiedAnswer.split('\n').at(-1),'SIOPE: https://www.siope.it/');
    assert.ok(copiedAnswer.includes('Apri i Comuni,')&&copiedAnswer.includes(`Comuni: ${new URL('/comuni',base).href}`),'copy flattens links and lists site pages');
    await click('Copia domanda');
    assert.equal(await page.evaluate(()=>window.__copiedText),'Quanto hanno speso i Comuni nel 2025?');
    await page.type(field,'E nel 2024?');await page.keyboard.press('Enter');await complete(2);
    assert.deepEqual(requests[1].body.messages.map(message=>message.role),['user','assistant','user']);
    await (await page.$$('button[aria-label="Rigenera risposta"]')).at(-1).click();await complete(2);
    assert.equal(requests.length,3);assert.equal(requests[2].body.messages.at(-1).content,'E nel 2024?');
    await (await page.$$('button[aria-label="Modifica domanda"]'))[0].click();
    await replace('[id^="edit-message-"]','Quanto hanno speso i Comuni nel 2024?');
    await page.click('button::-p-text(Invia modifica)');await complete(1);
    assert.equal(requests.length,4);assert.equal(requests[3].body.messages.length,1);
    assert.equal(await page.$$eval('[data-assistant-reply]',els=>els.length),1,'edit removes downstream conversation');
    await click('Modifica domanda');await page.click('button::-p-text(Annulla modifica)');
    assert.equal(requests.length,4);
    hold=true;await page.type(field,'Domanda da interrompere');await page.keyboard.press('Enter');
    await page.waitForSelector('button[aria-label="Interrompi ricerca"]');await click('Interrompi ricerca');
    hold=false;if(held)await fulfill(held).catch(()=>{});
    await page.waitForFunction(()=>document.body.innerText.includes('Ricerca interrotta.'));
    assert.equal(await page.$$eval('[data-assistant-reply] a[href="https://www.siope.it/"]',els=>els.length),1);
    await page.screenshot({path:`artifacts/browser/assistant-chat-${width}-conversation.png`,fullPage:true});
    const composer=await page.$eval(field,el=>{const r=el.closest('form').getBoundingClientRect();return{bottom:r.bottom,viewport:innerHeight,overflow:document.body.scrollWidth-innerWidth};});
    assert.ok(composer.bottom<=composer.viewport&&composer.viewport-composer.bottom<130,`${width}: composer not docked`);
    assert.ok(composer.overflow<=1);
    await click('Nuova chat');assert.equal(await page.$$eval('[data-assistant-reply]',els=>els.length),0);
    assert.ok(await page.$('button[aria-label^="Impostazioni AI:"]'));
    await page.click('button[aria-label^="Impostazioni AI:"]');await page.click('button::-p-text(Scollega e rimuovi chiave)');
    await page.waitForSelector('button[aria-label="Usa la tua chiave AI"]');
    await click('Usa la tua chiave AI');assert.equal(await page.$eval('#assistant-api-key',el=>el.value),'');
    await page.select('#assistant-provider','anthropic');await page.type('#assistant-api-key','test-only-anthropic-key-123');
    await page.click('dialog input[type="checkbox"]');await page.click('button[type="submit"]::-p-text(Usa in questa scheda)');
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await page.waitForSelector('button[aria-label="Usa la tua chiave AI"]');await click('Usa la tua chiave AI');
    assert.equal(await page.$eval('#assistant-api-key',el=>el.value),'');
    await page.type('#assistant-api-key','test-only-unsaved-key-123');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(()=>!document.querySelector('dialog[open]'));await page.reload({waitUntil:'networkidle0'});
    await click('Usa la tua chiave AI');assert.equal(await page.$eval('#assistant-api-key',el=>el.value),'');
    assert.equal(await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>value.includes('test-only-'))),false);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Usa la tua chiave AI');
    assert.deepEqual(errors,[]);await page.close();
    console.log(`PASS assistant ${width}px: key consent, markdown lists, site links allow-list, sources, streaming protocol, copy, edit, regenerate, stop, context, docked composer, new chat, disconnect, pagehide, reload`);
  }
} finally {await closeBrowser(browser);}
