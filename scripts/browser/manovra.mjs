import assert from "node:assert/strict";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
await waitForServer(baseUrl, { readyPath: "/manovra" });
const browser = await launchBrowser();

try {
  for (const width of [390, 1280]) {
    await runScenario(browser, {
      suite: "manovra",
      label: `Manovra ${width}px`,
      pathname: "/manovra",
      width,
      async validate(page) {
        assert.match(
          await page.$eval("h1", (el) => el.textContent ?? ""),
          /Manovra a confronto/,
        );
        const main = await page.$eval("main", (el) => el.innerText);
        assert.match(main, /Bilancio in Breve/i);
        assert.match(main, /Quanto spendiamo/i);
        assert.match(main, /Per missione|Dove vanno i soldi/i);
        assert.match(main, /Scuola|Istruzione scolastica/i);
        assert.match(main, /Missione/i);
        assert.match(main, /Tasse e imposte|tributarie/i);
        assert.match(main, /Ricorso al mercato/i);
        assert.match(main, /Confronta/i);
        assert.match(main, /asse sx|asse dx|Debito pubblico/i);
        assert.match(main, /2026/);
        assert.match(main, /partono dal 2023|PDF|OpenBDAP/i);
        assert.match(main, /IRPEF|Imposta sul reddito delle persone fisiche/i);
        assert.match(main, /Come leggerli/i);
        assert.match(main, /Anno nel triennio/i);
        assert.ok(
          await page.$('a[href*="anno=2027"]'),
          "manca link anno 2027 del triennio",
        );
        await page.click('a[href*="anno=2027"]');
        await page.waitForFunction(
          () => location.search.includes("anno=2027"),
          { timeout: 10_000 },
        );
        assert.match(
          await page.$eval("main", (el) => el.innerText),
          /912|Nel 2027/,
        );
        assert.match(main, /Competenza/i);
        assert.match(main, /Cassa/i);
        assert.match(main, /Saldo netto da finanziare/i);
        assert.ok(
          await page.$('a[href*="rgs.mef.gov.it"][href$=".pdf"], a[href*="rgs.mef.gov.it"][href*=".pdf"]'),
          "manca link PDF ufficiale RGS",
        );
        assert.ok(
          await page.$('a[href*="rgs.mef.gov.it"][href$=".xlsx"], a[href*="rgs.mef.gov.it"][href*=".xlsx"]'),
          "manca link XLSX ufficiale RGS",
        );
        assert.ok(
          await page.$('#glossario-competenza, [id="glossario-competenza"]'),
          "manca ancoraggio glossario competenza",
        );
        assert.doesNotMatch(main, /\d{1,3}(?:\.\d{3}){3,} €/);
        assert.ok(
          (await page.$$("main .recharts-responsive-container, main [role='img']")).length >= 4,
          "attesi più grafici",
        );

        const chips = await page.$$eval(
          'a[href*="edizione="]',
          (nodes) => nodes.map((node) => node.getAttribute("href")),
        );
        assert.ok(chips.length >= 4, "attese almeno 4 edizioni");

        const editionNav = '[role="navigation"][aria-label="Edizione della manovra"]';
        const targetHref = await page.$eval(
          `${editionNav} a[href*="edizione=lb-2024-2026"]`,
          (el) => el.getAttribute("href"),
        );
        assert.ok(targetHref, "manca link edizione 2024");
        await page.click(`${editionNav} a[href*="edizione=lb-2024-2026"]`);
        await page.waitForFunction(
          () => location.search.includes("edizione=lb-2024-2026"),
          { timeout: 10_000 },
        );
        assert.equal(
          await page.$eval(
            `${editionNav} a[href*="edizione=lb-2024-2026"]`,
            (el) => el.getAttribute("aria-current"),
          ),
          "page",
        );
        assert.ok(
          await page.$('[aria-label="Anno di confronto"]'),
          "manca selettore confronto anni",
        );
        assert.match(
          await page.$eval("main", (el) => el.innerText),
          /2024/,
        );

        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
          "overflow orizzontale",
        );

        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text());
        });
        await page.keyboard.press("Tab");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("h1");
        assert.equal(errors.length, 0, `Console/page errors: ${errors.join(" | ")}`);
      },
    });
    console.log(`PASS manovra ${width}px`);
  }
} finally {
  await closeBrowser(browser);
}
