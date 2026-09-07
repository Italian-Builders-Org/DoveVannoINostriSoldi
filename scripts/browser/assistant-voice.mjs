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

async function button(page, text) {
  const control = await page.$(`button::-p-text(${text})`);
  assert.ok(control, `pulsante mancante: ${text}`);
  await control.focus();
  await page.keyboard.press("Enter");
}
async function open(page, mode) {
  await installRecognition(page, mode);
  await button(page, "Detta la domanda");
  await page.waitForFunction(() => document.querySelector("#assistant-voice-title")?.closest("dialog").open &&
    !document.querySelector('#assistant-voice-dialog [role="status"]').textContent.includes("Verifica"));
}
async function assertClosed(page) {
  assert.equal(await page.$eval("#assistant-voice-title", (element) => element.closest("dialog").open), false);
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Detta la domanda/);
  assert.equal(await page.$eval("#assistant-voice-draft", (element) => element.value), "");
}

async function inspectVoice(page, width) {
  const requests = [];
  page.on("request", (request) => { if (request.method() === "POST") requests.push(request); });
  await page.type("#assistant-prompt", "Domanda precedente");
  await open(page, "unsupported");
  assert.match(await page.$eval('#assistant-voice-dialog [role="status"]', (element) => element.textContent), /non supporta/);
  await page.keyboard.press("Escape");
  await assertClosed(page);
  assert.equal(await page.$eval("#assistant-prompt", (element) => element.value), "Domanda precedente");

  await open(page, "downloadable");
  assert.equal(await page.evaluate(() => window.__voiceTest.starts), 0);
  await button(page, "Scarica pacchetto italiano");
  await page.waitForSelector('button::-p-text(Inizia dettatura)');
  assert.equal(await page.evaluate(() => window.__voiceTest.starts), 0);
  assert.deepEqual(await page.evaluate(() => window.__voiceTest.install), [{ langs: ["it-IT"], processLocally: true }]);
  await page.keyboard.press("Escape");
  await assertClosed(page);

  await open(page, "denied");
  await button(page, "Inizia dettatura");
  assert.match(await page.$eval('#assistant-voice-dialog [role="status"]', (element) => element.textContent), /Permesso microfono negato/);
  await page.keyboard.press("Escape");
  await assertClosed(page);

  await open(page, "available");
  // Native modal keeps background controls inert; Chromium can report BODY while Tab wraps.
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({ inside: document.activeElement.closest("dialog") !== null, tag: document.activeElement.tagName, id: document.activeElement.id, documentFocused: document.hasFocus() }));
    assert.ok(focus.inside || focus.tag === "BODY", JSON.stringify(focus));
  }
  await page.$eval("#assistant-prompt", (element) => element.focus());
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "assistant-prompt", "background form is not inert");
  const geometry = await page.$eval("#assistant-voice-title", (element) => {
    const dialog = element.closest("dialog");
    const rect = dialog.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth, overflow: dialog.scrollWidth - dialog.clientWidth,
      controls: [...dialog.querySelectorAll("button")].map((control) => control.getBoundingClientRect().height) };
  });
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.overflow <= 1, `${width}px overflow`);
  assert.ok(geometry.controls.every((height) => height >= 44));
  await button(page, "Inizia dettatura");
  await page.evaluate(() => {
    const recognition = window.__voiceTest.instance;
    window.__voiceTest.queued = recognition.onresult;
    recognition.onresult({ results: [{ isFinal: true, 0: { transcript: "bozza annullata" } }] });
  });
  await page.keyboard.press("Escape");
  await assertClosed(page);
  await page.evaluate(() => window.__voiceTest.queued({ results: [{ isFinal: true, 0: { transcript: "tardivo" } }] }));
  assert.equal(await page.$eval("#assistant-voice-draft", (element) => element.value), "");
  assert.equal(await page.evaluate(() => window.__voiceTest.aborts), 1);

  await open(page, "available");
  await button(page, "Inizia dettatura");
  await page.evaluate(() => {
    window.__voiceTest.instance.onresult({ results: [{ isFinal: true, 0: { transcript: "pagina lasciata" } }] });
    window.dispatchEvent(new Event("pagehide"));
  });
  await assertClosed(page);
  assert.equal(await page.evaluate(() => window.__voiceTest.aborts), 1);
  assert.equal(await page.$eval("#assistant-prompt", (element) => element.value), "Domanda precedente");

  await open(page, "available");
  await button(page, "Inizia dettatura");
  await page.evaluate(() => window.__voiceTest.instance.onresult({ results: [{ isFinal: true, 0: { transcript: "x".repeat(2000) } }] }));
  await button(page, "Termina dettatura");
  assert.equal(await page.$eval("#assistant-voice-draft", (element) => element.value.length), 501);
  assert.equal(await page.$eval('button::-p-text(Usa questo testo)', (element) => element.disabled), true);
  await page.focus("#assistant-voice-draft");
  await page.$eval("#assistant-voice-draft", (element) => element.select());
  await page.keyboard.press("Backspace");
  await page.type("#assistant-voice-draft", "Quanto hanno speso i Comuni nel 2025?");
  // No audio or prompt has been posted during discovery, installation, recognition or editing.
  assert.equal(requests.length, 0);
  await page.screenshot({ path: `artifacts/browser/assistant-voice-${width}.png` });
  await button(page, "Usa questo testo");
  await assertClosed(page);
  assert.equal(requests.length, 0);
  assert.equal(await page.$eval("#assistant-prompt", (element) => element.value), "Quanto hanno speso i Comuni nel 2025?");
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/assistant");
  await button(page, "Cerca nei dati");
  const payload = await (await response).json();
  assert.equal(payload.kind, "answer");
  assert.ok(payload.answer.source.url.startsWith("https://"));
  assert.equal(payload.answer.period.year, 2025);
  await page.waitForSelector("#assistant-answer-title");
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].postData()), { prompt: "Quanto hanno speso i Comuni nel 2025?" });
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
