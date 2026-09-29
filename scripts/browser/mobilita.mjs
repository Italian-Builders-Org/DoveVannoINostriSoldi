import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/mobilita" });
const browser = await launchBrowser();

async function fillLabeledInput(page, labelText, value) {
  const handle = await page.evaluateHandle((label) => {
    const field = [...document.querySelectorAll("label")].find((node) =>
      [...node.querySelectorAll("span")].some((span) => span.textContent.trim() === label),
    );
    return field?.querySelector("input") ?? null;
  }, labelText);
  const input = handle.asElement();
  assert.ok(input, `Campo assente: ${labelText}`);
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await input.type(String(value), { delay: 5 });
}

try {
  for (const width of [390, 768, 1280]) {
    await runScenario(browser, {
      suite: "mobilita",
      label: `Mobilita ${width}px`,
      pathname: "/mobilita",
      width,
      async validate(page) {
        assert.match(await page.$eval("h1", (el) => el.textContent), /Quante auto ci sono/);
        const main = await page.$eval("main", (el) => el.innerText);
        assert.match(main, /709/);
        assert.match(main, /Benzina €2,152\/L/);
        assert.match(main, /Gasolio €2,369\/L/);
        assert.match(main, /posti-km/);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
          "overflow orizzontale",
        );

        const live = '[aria-live="polite"]';
        await page.waitForFunction((selector) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return /€/.test(text) && /litri stimati/.test(text);
        }, { timeout: 15_000 }, live);

        await fillLabeledInput(page, "Chilometri annui", "0");
        await page.waitForFunction((selector) =>
          (document.querySelector(selector)?.textContent ?? "").includes("Inserisci valori maggiori di zero"),
        { timeout: 15_000 }, live);

        // 10_000 km × 5 L/100 km × €2/L = €1_000 e 500 litri
        await fillLabeledInput(page, "Chilometri annui", "10000");
        await fillLabeledInput(page, "Consumo medio (L/100 km)", "5");
        await fillLabeledInput(page, "Prezzo al litro (€)", "2");
        await page.waitForFunction((selector) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return /1[.\u00a0]?000,00/.test(text) && /\b500\b/.test(text);
        }, { timeout: 15_000 }, live);

        await fillLabeledInput(page, "Spesa familiare mensile (€) · facoltativa", "2000");
        await page.waitForFunction((selector) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return /4[,.]2\s*%/.test(text);
        }, { timeout: 15_000 }, live);

        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text());
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("h1");
        assert.equal(errors.length, 0, `Console/page errors: ${errors.join(" | ")}`);
      },
    });
    console.log(`PASS mobilita ${width}px`);
  }
} finally {
  await closeBrowser(browser);
}
