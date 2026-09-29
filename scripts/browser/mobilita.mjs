import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/mobilita" });
const browser = await launchBrowser();

async function setLabeledInput(page, labelText, value) {
  const ok = await page.evaluate((label, next) => {
    const field = [...document.querySelectorAll("label")].find((node) =>
      [...node.querySelectorAll("span")].some((span) => span.textContent.trim() === label),
    );
    const input = field?.querySelector("input");
    if (!input) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, next);
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: next,
      inputType: "insertReplacementText",
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input.value === next;
  }, labelText, String(value));
  assert.equal(ok, true, `Campo assente o non aggiornato: ${labelText}`);
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
        const before = await page.$eval(live, (el) => el.textContent);

        // 20_000 km a consumo/prezzo di default deve alzare litri e costo rispetto allo scenario iniziale.
        await setLabeledInput(page, "Chilometri annui", "20000");
        await page.waitForFunction((selector, previous) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return text.includes("litri stimati") && text !== previous && /€/.test(text);
        }, { timeout: 15_000 }, live, before);

        await setLabeledInput(page, "Chilometri annui", "0");
        await page.waitForFunction((selector) => {
          const text = document.querySelector(selector)?.textContent ?? "";
          return text.includes("Inserisci valori maggiori di zero");
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
