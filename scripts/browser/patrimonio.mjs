import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const output = path.join(defaultArtifactsDir(), "patrimonio");
const ranking = 'section[aria-labelledby="patrimonio-classifica"]';
const regionButton = 'table button';
const results = [];
await mkdir(output, { recursive: true });
await waitForServer(defaultBaseUrl(), { readyPath: "/patrimonio" });
const browser = await launchBrowser();

async function clickText(page, selector, text) {
  const candidates = await page.$$(selector);
  for (const candidate of candidates) {
    if ((await candidate.evaluate((element) => element.textContent.trim())) !== text) continue;
    await candidate.focus();
    await page.keyboard.press("Enter");
    return;
  }
  assert.fail(`Controllo non trovato: ${text}`);
}

try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      label: `Patrimonio ${width}px`, pathname: "/patrimonio", width, suite: "patrimonio",
      async validate(page) {
        assert.match(await page.$eval('[aria-label="Riepilogo: Italia"]', (el) => el.textContent), /133\.293/);
        await clickText(page, regionButton, "Lazio");
        await page.waitForSelector(`${ranking}[aria-busy="false"] button[aria-label^="Roma:"]`);
        assert.equal(new URL(page.url()).searchParams.get("regione"), "12");
        assert.match(await page.$eval('[aria-label="Riepilogo: Lazio"]', (el) => el.textContent), /6\.909/);
        await page.focus('button[aria-label^="Roma:"]');
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => new URL(location.href).searchParams.get("comuni") === "H501");
        assert.match(await page.$eval('button[aria-label^="Roma:"]', (el) => el.getAttribute("aria-pressed")), /true/);
        assert.match(await page.$eval("main", (el) => el.innerText), /Confronto tra i Comuni selezionati/);
        await page.locator(`${ranking} summary`).click();
        await page.locator(`${ranking} input[type="checkbox"]`).click();
        await page.waitForFunction(() => new URL(location.href).searchParams.has("tipo"));
        await page.keyboard.press("Escape");
        assert.equal(await page.$(`${ranking} details[open]`), null);
        const radios = await page.$$(`${ranking} input[type="radio"]`);
        await radios[1].focus();
        await page.keyboard.press("Space");
        await page.waitForFunction(() => new URL(location.href).searchParams.get("ordina") === "contribuenti");
        const sharedUrl = page.url();
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => [...document.querySelectorAll("table caption")].some((el) => el.textContent.includes("Confronto tra i Comuni selezionati")));
        assert.equal(page.url(), sharedUrl);
        assert.equal(await page.$eval(`${ranking} input[type="radio"]:checked`, (el) => el.parentElement.textContent.trim()), "Per 1.000 contribuenti");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(output, `${width}px.png`), fullPage: true });
        await clickText(page, "button", "Torna all’Italia");
        await page.waitForSelector('[aria-label="Riepilogo: Italia"]');
        await page.goBack({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => [...document.querySelectorAll("table caption")].some((el) => el.textContent.includes("Confronto tra i Comuni selezionati")));
        assert.equal(page.url(), sharedUrl);
        results.push({ width, status: "PASS", sharedUrl });
      },
    });
  }
  await runScenario(browser, {
    label: "Errore regionale recuperabile", pathname: "/patrimonio", width: 390, suite: "patrimonio",
    expectedFailure: (message) => /503/.test(message),
    async validate(page) {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/patrimonio/punti") {
          void request.respond({ status: 503, contentType: "application/json", body: "{}" });
        } else void request.continue();
      });
      const failedResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/patrimonio/punti" && response.status() === 503);
      await clickText(page, regionButton, "Lazio");
      await (await failedResponse).buffer();
      await page.waitForFunction(() => document.body.textContent.includes("Dati della regione non disponibili."));
      assert.equal(await page.$eval(ranking, (el) => el.getAttribute("aria-busy")), "false");
      await clickText(page, "button", "Torna all’Italia");
      await page.waitForSelector('[aria-label="Riepilogo: Italia"]');
      results.push({ scenario: "errore regionale", status: "PASS" });
    },
  });
} finally {
  await writeFile(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await closeBrowser(browser);
}
