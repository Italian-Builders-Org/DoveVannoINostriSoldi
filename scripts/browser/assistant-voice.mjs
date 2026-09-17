import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

// Test-only browser API. Exercises real DOM, focus and HTTP without recording audio.
async function installRecognition(page, mode = "available") {
  await page.evaluate((mode) => {
    const calls = { available: [], install: [], starts: 0, stops: 0, aborts: 0, instance: null };
    window.__voiceTest = calls;
    class Recognition {
      processLocally = false;
      static async available(options) { calls.available.push(options); return mode === "downloadable" ? "downloadable" : "available"; }
      static async install(options) { calls.install.push(options); return true; }
      constructor() { calls.instance = this; }
      start() {
        if (this.processLocally !== true || this.lang !== "it-IT") throw new Error("nonlocal recognition");
        calls.starts++;
        if (mode === "denied") this.onerror?.({ error: "not-allowed" });
        else this.onstart?.();
      }
      stop() { calls.stops++; this.onend?.(); }
      abort() { calls.aborts++; }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: mode === "unsupported" ? undefined : Recognition });
  }, mode);
}

async function click(page, label) {
  await page.click(`button[aria-label="${label}"]`);
}
async function open(page, mode) {
  await installRecognition(page, mode);
  await click(page, "Detta la domanda");
  await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent.includes("Verifico"));
}
async function inspectVoice(page, width) {
  const requests = [];
  page.on("request", request => { if (request.method() === "POST") requests.push(request); });
  const field = "#assistant-prompt";
  const draft = () => page.$eval(field, el=>el.value);
  await page.type(field, "Domanda precedente");
  await open(page, "unsupported");
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes("non supporta"));
  await page.keyboard.press("Escape");
  assert.equal(await draft(), "Domanda precedente");
  await open(page, "downloadable");
  await page.waitForSelector('button::-p-text(Scarica italiano)');
  assert.equal(await page.evaluate(()=>window.__voiceTest.starts),0);
  await page.click('button::-p-text(Scarica italiano)');
  await page.waitForFunction(()=>window.__voiceTest.install.length===1 && document.querySelector('[role="status"]')?.textContent.includes("Pacchetto pronto"));
  assert.equal(await page.evaluate(()=>window.__voiceTest.starts),0);
  assert.deepEqual(await page.evaluate(()=>window.__voiceTest.install),[{langs:["it-IT"],processLocally:true}]);
  await page.keyboard.press("Escape");
  await open(page,"denied");
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes("Permesso microfono negato"));
  await page.keyboard.press("Escape");
  await open(page,"available");
  await page.waitForFunction(()=>window.__voiceTest.starts===1);
  await page.evaluate(()=>{
    window.__voiceTest.queued=window.__voiceTest.instance.onresult;
    window.__voiceTest.instance.onresult({results:[{isFinal:true,0:{transcript:"da annullare"}}]});
  });
  await click(page,"Annulla dettatura");
  await page.evaluate(()=>window.__voiceTest.queued({results:[{isFinal:true,0:{transcript:"tardivo"}}]}));
  assert.equal(await draft(),"Domanda precedente");
  assert.equal(await page.evaluate(()=>window.__voiceTest.aborts),1);
  await open(page,"available");
  await page.waitForFunction(()=>window.__voiceTest.starts===1);
  await page.evaluate(()=>{
    window.__voiceTest.instance.onresult({results:[{isFinal:true,0:{transcript:"pagina lasciata"}}]});
    window.dispatchEvent(new Event("pagehide"));
  });
  await page.waitForFunction(()=>!document.querySelector('#assistant-prompt').readOnly);
  assert.equal(await draft(),"Domanda precedente");
  assert.equal(await page.evaluate(()=>window.__voiceTest.aborts),1);
  await open(page,"available");
  await page.waitForFunction(()=>window.__voiceTest.starts===1);
  await page.evaluate(()=>window.__voiceTest.instance.onresult({results:[{isFinal:true,0:{transcript:"x".repeat(9000)}}]}));
  await click(page,"Termina dettatura");
  await page.waitForFunction(()=>!document.querySelector('#assistant-prompt').readOnly);
  assert.equal((await draft()).length,"Domanda precedente ".length+9000);
  assert.equal(await page.$eval('button[aria-label="Invia domanda"]',el=>el.disabled),true);
  await page.$eval(field,el=>{el.focus();el.select();});
  await page.keyboard.press("Backspace");
  await page.type(field,"Quanto hanno speso i Comuni nel 2025?");
  await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));
  assert.equal(await draft(),"Quanto hanno speso i Comuni nel 2025?", "edited reviewed draft survives pagehide");
  assert.equal(requests.length,0,'voice must never submit');
  await page.screenshot({path:`artifacts/browser/assistant-voice-${width}.png`});
  await click(page,"Invia domanda");
  await page.waitForSelector('dialog[open]');
  assert.equal(requests.length,0,"senza chiave la domanda apre le impostazioni");
  assert.equal(await draft(),"Quanto hanno speso i Comuni nel 2025?");
}

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl);
mkdirSync("artifacts/browser", { recursive: true });
const browser = await launchBrowser();
try {
  for (const width of [320, 390, 768, 1280]) {
    await runScenario(browser, {
      label: `assistant voice ${width}px`, pathname: "/assistente", width, baseUrl,
      validate: async (page) => {
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await inspectVoice(page, width);
      },
    });
    console.log(`PASS assistant voice ${width}px: keyboard, cancellation, local-only, denied, unsupported, confirmed HTTP`);
  }
} finally { await closeBrowser(browser); }
