import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import {
  closeBrowser,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  navigate,
  runScenario,
} from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const screenshots = path.join(defaultArtifactsDir(), "operatori");
mkdirSync(screenshots, { recursive: true });
const list = 'ol[aria-label="Elenco operatori ANAC"]';
const results = 'ol[aria-label="Risultati imprese aggiudicatarie"]';
const summaries = JSON.parse(
  readFileSync(
    "src/data/generated/anac-operator-awards-index/summaries.json",
    "utf8",
  ),
);
const largeRef = summaries.topOperatorsByAwardCount[0].ref;
const bucket = createHash("sha256").update(largeRef).digest("hex").slice(0, 2);
const history = gunzipSync(
  readFileSync(`src/data/generated/anac-operator-history/${bucket}.jsonl.gz`),
)
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .find((row) => row.ref === largeRef);
const detailPath = `/appalti/operatori/${largeRef}`;
const historySection = 'section[aria-labelledby="history-title"]';
const historyRows = `${historySection} tbody tr`;
const combo = history.detail.filterRows.find(
  ([year, authority, procedure]) =>
    year !== null && authority !== null && procedure !== null,
);
assert.ok(
  combo,
  "The source fixture must exercise matched year, authority and procedure filters",
);
const matching = history.detail.filterRows.filter(
  (row) => row[0] === combo[0] && row[1] === combo[1] && row[2] === combo[2],
);
const browser = await launchBrowser();
try {
  for (const width of [1280, 768, 390]) {
    await runScenario(browser, {
      label: `operatori list and detail ${width}`,
      pathname: "/appalti/operatori?vista=elenco",
      width,
      baseUrl,
      suite: "operatori",
      readySelector: list,
      validate: async (page) => {
        assert.equal(
          await page.$$eval(`${list} > li`, (rows) => rows.length),
          50,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
          true,
        );
        const firstRef = await page.$eval(`${list} h3 a`, (link) =>
          link.getAttribute("href"),
        );
        await page.screenshot({
          path: path.join(screenshots, `list-${width}.png`),
        });
        await page.click('a[href="/appalti/operatori?vista=elenco&page=2"]');
        await page.waitForFunction(
          () => new URL(location.href).searchParams.get("page") === "2",
        );
        await page.waitForFunction(
          (selector, previous) => {
            const first = document.querySelector(`${selector} h3 a`);
            return first && first.getAttribute("href") !== previous;
          },
          {},
          list,
          firstRef,
        );
        assert.equal(
          await page.$$eval(`${list} > li`, (rows) => rows.length),
          50,
        );
        await page.click(
          'a[href="/appalti/operatori?vista=elenco&ordine=valore"]',
        );
        await page.waitForFunction(
          () => new URL(location.href).searchParams.get("ordine") === "valore",
        );
        await page.waitForSelector(
          '[aria-label="Ordine dell\'elenco"] a[aria-current="page"][href*="ordine=valore"]',
        );
        await page.waitForSelector(list);
        const ref = await page.$eval(`${list} h3 a`, (link) =>
          link.getAttribute("href"),
        );
        const name = await page.$eval(
          `${list} h3 a`,
          (link) => link.textContent,
        );
        await page.click(`${list} h3 a`);
        await page.waitForSelector("#history-title");
        assert.equal(new URL(page.url()).pathname, ref);
        assert.equal(
          await page.$eval("h1", (heading) => heading.textContent),
          name,
        );
        assert.ok(
          await page.$$eval(
            'section[aria-labelledby="history-title"] tbody tr',
            (rows) => rows.length > 0 && rows.length <= 25,
          ),
        );
        assert.ok(
          await page.$$eval(
            'tbody a[href*="dettaglio_cig"]',
            (links) => links.length > 0,
          ),
        );
        assert.match(
          await page.$eval("#screening-title", (node) => node.textContent),
          /Servizi e forniture 2025/,
        );
        assert.match(
          await page.$eval("main", (node) => node.textContent),
          /non valuta la legittimità/,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(screenshots, `detail-${width}.png`),
        });
        await navigate(page, {
          url: new URL("/appalti/operatori?q=autostrade", baseUrl).toString(),
          label: "operator name search",
          readySelector: results,
        });
        assert.ok(
          await page.$$eval(
            `${results} > li`,
            (rows) => rows.length > 0 && rows.length <= 50,
          ),
        );
        await page.focus("#operatori-query");
        await page.click("#operatori-query", { clickCount: 3 });
        await page.type("#operatori-query", "zzzzinesistentezzzz");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() =>
          document
            .querySelector('[role="status"]')
            ?.textContent?.includes("Nessuna impresa"),
        );
        assert.equal(
          await page.$$eval(`${results} > li`, (rows) => rows.length),
          0,
        );
      },
    });
  }
  for (const query of [
    "page=1234",
    "page=99999",
    "page=-1",
    "ordine=valore&page=1234",
  ]) {
    await runScenario(browser, {
      label: `operator pagination ${query}`,
      pathname: `/appalti/operatori?vista=elenco&${query}`,
      width: 390,
      baseUrl,
      suite: "operatori",
      readySelector: list,
      validate: async (page) => {
        assert.ok(
          await page.$$eval(
            `${list} > li`,
            (rows) => rows.length > 0 && rows.length <= 50,
          ),
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
          true,
        );
      },
    });
  }
  for (const width of [1280, 768, 390]) {
    await runScenario(browser, {
      label: `complete operator history ${width}`,
      pathname: detailPath,
      width,
      baseUrl,
      suite: "operatori",
      readySelector: "#history-title",
      validate: async (page) => {
        assert.equal(await page.$$eval(historyRows, (rows) => rows.length), 25);
        await page.screenshot({
          path: path.join(screenshots, `complete-history-${width}.png`),
          fullPage: true,
        });
        assert.ok(
          await page.$eval(
            historySection,
            (element, count) => element.textContent.includes(count),
            history.awardCount.toLocaleString("it-IT"),
          ),
        );
        const next = await page.$(
          '[aria-label="Pagine aggiudicazioni"] a[href*="page=2"]',
        );
        assert.ok(next);
        await next.click();
        await page.waitForFunction(() =>
          document
            .querySelector('[aria-label="Pagine aggiudicazioni"]')
            ?.textContent.includes("Pagina 2 di"),
        );
        assert.equal(new URL(page.url()).searchParams.get("page"), "2");
        const jump = '[aria-label="Pagine aggiudicazioni"] input[name="page"]';
        await page.locator(jump).fill("3");
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.locator('[aria-label="Pagine aggiudicazioni"] button').click(),
        ]);
        assert.equal(new URL(page.url()).searchParams.get("page"), "3");
        assert.equal(await page.$$eval(historyRows, (rows) => rows.length), 25);
        const last = Math.ceil(history.awardCount / 25);
        await navigate(page, {
          url: new URL(`${detailPath}?page=999999`, baseUrl).toString(),
          label: "last history page",
          readySelector: "#history-title",
        });
        assert.equal(
          new URL(page.url()).searchParams.get("page"),
          String(last),
        );
        assert.equal(
          await page.$$eval(historyRows, (rows) => rows.length),
          history.awardCount % 25 || 25,
        );
        await page.select('select[name="year"]', String(combo[0]));
        await page.select('select[name="authority"]', combo[1]);
        await page.select('select[name="procedure"]', combo[2]);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.locator('form[aria-label="Filtri delle aggiudicazioni"] button').click(),
        ]);
        await page.waitForFunction(
          (selector, prefix) =>
            document
              .querySelector(`${selector} > p`)
              ?.textContent.startsWith(prefix),
          {},
          historySection,
          `${matching.length.toLocaleString("it-IT")} risultati su`,
        );
        assert.equal(
          await page.$$eval(historyRows, (rows) => rows.length),
          Math.min(25, matching.length),
        );
        assert.equal(
          await page.$$eval(
            `${historyRows} td:nth-child(3)`,
            (cells, expected) =>
              cells.every(
                (cell) => cell.textContent.trim() === expected.trim(),
              ),
            combo[2],
          ),
          true,
        );
        // Streamed HTML can already match the assertions while its form is
        // still hidden. Locators wait for visible, stable controls before acting.
        for (const name of ["minAmount", "maxAmount"]) {
          await page.locator(`input[name="${name}"]`).fill("0");
        }
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.locator('form[aria-label="Filtri delle aggiudicazioni"] button').click(),
        ]);
        const zeroCount = matching.filter(
          (row) => row[3] !== null && /^-?0(?:\.0+)?$/.test(row[3]),
        ).length;
        await page.waitForFunction(
          (selector, prefix) =>
            document
              .querySelector(`${selector} > p`)
              ?.textContent.startsWith(prefix),
          {},
          historySection,
          `${zeroCount.toLocaleString("it-IT")} risultati su`,
        );
        assert.equal(
          await page.$$eval(historyRows, (rows) => rows.length),
          Math.min(25, zeroCount),
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(screenshots, `filtered-history-${width}.png`),
        });
        await navigate(page, {
          url: new URL(`${detailPath}?year=9999`, baseUrl).toString(),
          label: "empty history",
          readySelector: "#history-title",
        });
        assert.equal(await page.$$eval(historyRows, (rows) => rows.length), 0);
        assert.ok(
          await page.$eval(historySection, (element) =>
            element.textContent.includes("Nessuna aggiudicazione"),
          ),
        );
      },
    });
  }
  console.log(
    "Operator hub/list: both orders, navigation, deep/last pages, search/empty state and complete detail PASS at 390/768/1280px",
  );
} finally {
  await closeBrowser(browser);
}
