import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, navigate, runScenario } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const root = "/enti/c_h501/appalti";
const screenshots = path.join(defaultArtifactsDir(), "procurement-award-year");
mkdirSync(screenshots, { recursive: true });
async function captureMain(page, name) {
  const bounds = await (await page.$("main")).boundingBox();
  assert.ok(bounds);
  await page.screenshot({ path: path.join(screenshots, name), clip: bounds, captureBeyondViewport: true });
}
const browser = await launchBrowser();
try {
  for (const width of [1280, 768, 390, 320]) {
    await runScenario(browser, { label: `award year ${width}`, pathname: `${root}?awardYear=2025`, width, baseUrl, suite: "procurement-award-year", readySelector: "#summary-title",
      validate: async (page) => {
        assert.equal(await page.$eval("#anac-award-year", (el) => el.value), "2025");
        assert.match(await page.$eval("#award-year-coverage", (el) => el.textContent), /2.516.*2.891/);
        assert.match(await page.$eval("#cpv-scope", (el) => el.textContent), /prima del filtro anno/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        const targets = await page.$$eval("main select, main button", (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { height: r.height, width: r.width, right: r.right }; }));
        assert.ok(targets.every((r) => r.height >= 44 && r.width > 0 && r.right <= width));
        assert.equal(await page.$(`a[href="${root}/confronti"]`), null);
        await page.focus("#anac-award-year");
        await page.keyboard.press("Tab");
        assert.equal(await page.$eval("button[type=submit].btn-primary", (el) => el === document.activeElement), true);
        await captureMain(page, `roma-2025-${width}.png`);
        const links = await page.$$eval('main a[href*="view=concentration"]', (els) => [...new Set(els.map((el) => el.getAttribute("href")))]);
        assert.equal(links.length, 6);
        assert.ok(links.every((href) => new URL(href, baseUrl).searchParams.get("awardYear") === "2025"));
        await navigate(page, { url: new URL(links.find((href) => href.includes("metric=value") && href.includes("selection=all")), baseUrl).toString(), label: "annual HHI contracts", readySelector: "#concentration-detail-title" });
        const dates = await page.$$eval("main tbody tr", (els) => els.map((el) => el.children[1].textContent));
        assert.ok(dates.length > 0 && dates.every((date) => date.startsWith("2025-")));
        const next = await page.$eval('nav[aria-label="Paginazione"] a:last-child', (el) => el.getAttribute("href"));
        assert.match(next, /awardYear=2025/);
        await captureMain(page, `roma-hhi-2025-${width}.png`);
      },
    });
  }
  await runScenario(browser, { label: "year and CPV navigation", pathname: root, width: 390, baseUrl, suite: "procurement-award-year", readySelector: "#summary-title",
    validate: async (page) => {
      assert.ok(await page.$(`a[href="${root}/confronti"]`));
      await page.select("#anac-cpv", "45233141");
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click('section[aria-labelledby="cpv-filter-title"] button')]);
      await page.select("#anac-award-year", "2025");
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click('section[aria-labelledby="award-year-title"] button')]);
      const selected = new URL(page.url());
      assert.equal(selected.searchParams.get("cpv"), "45233141");
      assert.equal(selected.searchParams.get("awardYear"), "2025");
      const links = await page.$$eval('main a[href*="view=concentration"]', (els) => els.map((el) => el.getAttribute("href")));
      assert.ok(links.length > 0 && links.every((href) => href.includes("cpv=45233141") && href.includes("awardYear=2025")));
      await navigate(page, { url: new URL(links[0], baseUrl).toString(), label: "CPV annual source", readySelector: "#concentration-detail-title" });
      assert.ok(await page.$('main a[href*="view=operator"][href*="cpv=45233141"][href*="awardYear=2025"]'));
      await captureMain(page, "roma-cpv-year-drilldown-390.png");
    },
  });
  for (const [year, text] of [["undated", "Data non disponibile"], ["2026", "Anno 2026"], ["1990", "Nessuna aggiudicazione nel periodo selezionato"]]) {
    await runScenario(browser, { label: `award year ${year}`, pathname: `${root}?awardYear=${year}`, width: 390, baseUrl, suite: "procurement-award-year", readySelector: "#summary-title",
      validate: async (page) => {
        assert.ok(await page.$eval("main", (el, text) => el.textContent.includes(text), text));
        if (year !== "undated") assert.equal(await page.$('main a[href*="view=concentration"]'), null);
        if (year === "undated") {
          const href = await page.$eval('section[aria-labelledby="summary-title"] a[href*="view=awards"]', (el) => el.getAttribute("href"));
          await navigate(page, { url: new URL(href, baseUrl).toString(), label: "undated awards", readySelector: "#awards-title" });
          assert.ok((await page.$$eval("main tbody tr", (els) => els.map((el) => el.children[1].textContent))).every((date) => date === "non disponibile"));
        }
        await captureMain(page, `roma-${year}-390.png`);
      },
    });
  }
  for (const query of ["awardYear=2025&awardYear=2024", "awardYear=25", "awardYear=2025-01-01"]) {
    assert.equal((await fetch(new URL(`${root}?${query}`, baseUrl))).status, 404);
  }
  console.log("Award-year filter: responsive UI, keyboard, dates, CPV and exact cohort navigation PASS");
} finally { await closeBrowser(browser); }
