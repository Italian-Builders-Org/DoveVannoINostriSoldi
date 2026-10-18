import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  closeBrowser,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  navigate,
  runScenario,
  waitForServer,
} from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const output = path.join(defaultArtifactsDir(), "personale-pa-conto-annuale");
mkdirSync(output, { recursive: true });

function assertNoBadNumbers(text) {
  assert.doesNotMatch(text, /\bNaN\b/);
  assert.doesNotMatch(text, /\bundefined\b/i);
}

async function elementScreenshot(page, selector, filePath) {
  const handle = await page.waitForSelector(selector, { visible: true });
  assert.ok(handle, `missing selector ${selector}`);
  await handle.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await new Promise((resolve) => setTimeout(resolve, 600));
  await handle.screenshot({ path: filePath });
}

await waitForServer(baseUrl);

const browser = await launchBrowser();
try {
  await runScenario(browser, {
    label: "personale pa hub desktop final",
    pathname: "/personale-pa/conto-annuale",
    width: 1280,
    baseUrl,
    suite: "personale-pa-finals",
    readySelector: '[data-testid="staff-series-chart"]',
    validate: async (page) => {
      const body = await page.$eval("main", (node) => node.textContent ?? "");
      assertNoBadNumbers(body);
      const latestPermanent = await page.$eval(
        "section[aria-label='Panorama nazionale 2024'] .stat-value",
        (node) => node.textContent?.trim() ?? "",
      );
      assert.match(latestPermanent, /^\d{1,3}(\.\d{3})*$/);
      assert.ok(Number.parseInt(latestPermanent.replaceAll(".", ""), 10) > 3_000_000);
      assert.equal(await page.$$eval('[data-testid="staff-series-chart"]', (nodes) => nodes.length), 1);
      const yTicks = await page.$$eval('[data-testid="staff-series-chart"] text', (nodes) =>
        nodes
          .map((node) => node.textContent?.trim() ?? "")
          .filter((label) => label.length > 0 && !/^\d{4}$/.test(label)),
      );
      assert.ok(yTicks.length >= 3, "expected y-axis ticks");
      for (const tick of yTicks) {
        assert.doesNotMatch(tick, /^0\.000$/);
        assert.match(tick, /^\d{1,3}(\.\d{3})*(,\d+)?$/);
      }
      for (const tick of yTicks) {
        assert.doesNotMatch(tick, /^0\d/, "clipped y-axis label (leading zero merged with next tick)");
      }
      await page.screenshot({
        path: path.join(output, "hub-desktop-final.png"),
        fullPage: true,
      });
    },
  });

  await runScenario(browser, {
    label: "personale pa hub chart mobile final",
    pathname: "/personale-pa/conto-annuale",
    width: 390,
    baseUrl,
    suite: "personale-pa-finals",
    readySelector: "#serie-nazionale",
    validate: async (page) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const sectionText = await page.$eval("section[aria-labelledby='serie-nazionale']", (node) => node.textContent ?? "");
      assertNoBadNumbers(sectionText);
      assert.match(sectionText, /Italia · personale per tipo/);
      await elementScreenshot(
        page,
        "section[aria-labelledby='serie-nazionale'] [data-testid='staff-series-chart']",
        path.join(output, "hub-chart-mobile-final.png"),
      );
    },
  });

  await runScenario(browser, {
    label: "enti c_h501 personale section final",
    pathname: "/enti/c_h501",
    width: 1280,
    baseUrl,
    suite: "personale-pa-finals",
    readySelector: "#personale-conto-annuale",
    validate: async (page) => {
      const sectionText = await page.$eval("section[aria-labelledby='personale-conto-annuale']", (node) => node.textContent ?? "");
      assertNoBadNumbers(sectionText);
      assert.match(sectionText, /22\.125/);
      assert.match(sectionText, /Serie completa 2010-2024/);
      await elementScreenshot(
        page,
        "section[aria-labelledby='personale-conto-annuale']",
        path.join(output, "enti-c_h501-final.png"),
      );
    },
  });
} finally {
  await closeBrowser(browser);
}

console.log(`Saved finals under ${output}`);
