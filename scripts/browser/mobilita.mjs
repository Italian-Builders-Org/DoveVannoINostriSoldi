import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/mobilita" });
const browser = await launchBrowser();

async function fillLabeledInput(page, labelText, value) {
  const ok = await page.evaluate((label, next) => {
    const field = [...document.querySelectorAll("label")].find((node) =>
      [...node.querySelectorAll("span")].some((span) => span.textContent.trim() === label),
    );
    const input = field?.querySelector("input");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, labelText, value);
  assert.equal(ok, true, `Campo assente: ${labelText}`);
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
        }, {}, live);

        await fillLabeledInput(page, "Chilometri annui", "0");
        await page.waitForFunction((selector) =>
          (document.querySelector(selector)?.textContent ?? "").includes("Inserisci valori maggiori di zero"),
        {}, live);

        await fillLabeledInput(page, "Chilometri annui", "10000");
        await fillLabeledInput(page, "Consumo medio (L/100 km)", "5");
        await fillLabeledInput(page, "Prezzo al litro (€)", "2");
        await page.waitForFunction((selector) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return text.includes("1.000,00") && text.includes("500");
        }, {}, live);

        await fillLabeledInput(page, "Spesa familiare mensile (€) · facoltativa", "2000");
        await page.waitForFunction((selector) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return /4,2\s*%/.test(text) || text.includes("4,2%");
        }, {}, live);

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