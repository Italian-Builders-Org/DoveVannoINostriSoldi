import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { closeBrowser, defaultArtifactsDir, defaultBaseUrl, launchBrowser, navigate, runScenario } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const root = "/enti/c_l780/appalti";
const screenshots = path.join(defaultArtifactsDir(), "procurement-peers");
mkdirSync(screenshots, { recursive: true });
async function captureMain(page, filename) {
  const bounds = await (await page.$("main")).boundingBox();
  assert.ok(bounds);
  await page.screenshot({ path: path.join(screenshots, filename), clip: bounds, captureBeyondViewport: true });
}

const browser = await launchBrowser();
try {
  for (const width of [1440, 768, 390]) {
    await runScenario(browser, {
      label: `procurement peers ${width}`, pathname: `${root}/confronti`, width, baseUrl, suite: "procurement-peers", readySelector: "#comparison-title",
      validate: async (page) => {
        assert.equal(await page.$eval("#comparison-title", (el) => el.textContent), "Il confronto con 10 altri Comuni");
        assert.equal(await page.$$eval("main article", (els) => els.length), 3);
        assert.equal(await page.$$eval("main tbody tr", (els) => els.length), 10);
        assert.equal(await page.$eval("main", (el) => el.textContent.includes("80%") && el.textContent.includes("2024")), true);
        const links = await page.$$eval("main article a", (els) => els.map((el) => el.getAttribute("href")));
        assert.deepEqual(links, ["top1", "top10", "all"].map((selection) => `${root}?view=concentration&metric=count&selection=${selection}`));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `page overflow at ${width}px`);
        const boxes = await page.$$eval("main article", (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
        for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x >= boxes[i - 1].right - 1 || boxes[i].y >= boxes[i - 1].bottom - 1, "overlapping indicators");
        if (width === 390) {
          const hint = await page.$$eval("main p", (elements) => elements.find((el) => el.textContent.includes("Scorri la tabella"))?.getBoundingClientRect().width);
          assert.ok(hint > 0 && hint <= width, "mobile scroll hint hidden or clipped");
        }
        await captureMain(page, `veroli-${width}.png`);
        await page.focus("main details summary");
        await page.keyboard.press("Enter");
        assert.equal(await page.$eval("main details summary", (el) => el === document.activeElement), true);
        assert.equal(await page.$eval("main details", (el) => el.open), true);
        await navigate(page, { url: new URL(links[2], baseUrl).toString(), label: "peer HHI source", readySelector: "#concentration-detail-title" });
        assert.ok(await page.$("main table"), "exact concentration drill-down missing");
      },
    });
  }
  for (const [pathname, message] of [
    [`${root}/confronti?metric=value`, "Valore positivo attribuibile in meno del 90%"],
    ["/enti/c_h477/appalti/confronti", "9 altri Comuni soddisfano i criteri"],
    ["/enti/no_such_municipality/appalti/confronti", "Comune non collegato univocamente"],
  ]) {
    await runScenario(browser, { label: message, pathname, width: 390, baseUrl, suite: "procurement-peers", readySelector: "#comparison-title",
      validate: async (page) => {
        assert.equal(await page.$eval("#comparison-title", (el) => el.textContent), "Confronto non pubblicato");
        assert.ok(await page.$eval("main", (el, text) => el.textContent.includes(text), message));
        assert.equal(await page.$$eval("main article", (els) => els.length), 0, "withheld values shown as indicators");
        if (pathname === `${root}/confronti?metric=value`) await captureMain(page, "veroli-value-390.png");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      },
    });
  }
  await runScenario(browser, { label: "procurement peer entry point", pathname: root, width: 1440, baseUrl, suite: "procurement-peers", readySelector: "#summary-title",
    validate: async (page) => {
      assert.ok(await page.$(`a[href="${root}/confronti"]`));
      await navigate(page, { url: new URL(`${root}?cpv=45112000`, baseUrl).toString(), label: "filtered scope", readySelector: "#summary-title" });
      assert.equal(await page.$(`a[href="${root}/confronti"]`), null, "CPV filter silently dropped");
    },
  });
  for (const query of ["cpv=45112000", "metric=bad", "metric=count&metric=value", "page=0"]) {
    const response = await fetch(new URL(`${root}/confronti?${query}`, baseUrl));
    assert.equal(response.status, 404, `invalid comparison query accepted: ${query}`);
  }
  console.log("Procurement peer comparison: desktop/tablet/mobile, exact source links and withheld states PASS");
} finally { await closeBrowser(browser); }
