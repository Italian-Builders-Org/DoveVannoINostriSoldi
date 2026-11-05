import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeBrowser,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  runScenario,
  waitForServer,
} from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const output = path.join(defaultArtifactsDir(), "mappe-mobilita");
await mkdir(output, { recursive: true });
await waitForServer(baseUrl, { readyPath: "/mappe/mobilita" });
const browser = await launchBrowser();

const MAP_LIST = '[aria-label="Mappe immersive"]';
const MAP_CARD = `${MAP_LIST} a[href="/mappe/mobilita"]`;

async function assertMapGrid(page, width) {
  const metrics = await page.$$eval(`${MAP_LIST} > li`, (items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        title: item.querySelector("a")?.innerText?.split("\n")[1]?.trim() ?? "",
        height: rect.height,
        top: rect.top,
      };
    }),
  );
  assert.equal(metrics.length, 3, "Mappe: tre schede attese");
  const sameRow =
    width >= 1100 ? metrics : width >= 720 ? metrics.slice(0, 2) : [];
  if (sameRow.length > 1) {
    const maxHeight = Math.max(...sameRow.map((row) => row.height));
    const minHeight = Math.min(...sameRow.map((row) => row.height));
    assert.ok(
      maxHeight - minHeight <= 2,
      `Altezze schede disallineate (${minHeight}–${maxHeight}px)`,
    );
  }
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    "overflow orizzontale homepage",
  );
  if (width === 390) {
    await page.evaluate(() => {
      const link = document.querySelector('a[href="/mappe/mobilita"]');
      link?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await page.waitForFunction(() => {
      const link = document.querySelector('a[href="/mappe/mobilita"]');
      if (!link) return false;
      const rect = link.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    });
  }
  await page.screenshot({
    path: path.join(output, `home-maps-${width}.png`),
    fullPage: false,
  });
}

async function selectMilanoNetwork(frame, networkId = "milano") {
  await frame.evaluate((id) => {
    const select = document.querySelector("#city, select[name='city'], select");
    if (!(select instanceof HTMLSelectElement)) return;
    const match = [...select.options].find(
      (option) => option.value === id || option.textContent?.includes("Milano"),
    );
    if (match) {
      select.value = match.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, networkId);
  await frame.waitForFunction(
    () => document.querySelector("#map-title")?.textContent?.includes("Milano"),
    { timeout: 30_000 },
  );
}

async function assertPublishedBasemap(frame) {
  await frame.waitForFunction(
    () => {
      const attribution = document.getElementById("map-attribution");
      const notice = document.getElementById("notice");
      if (!attribution || attribution.hidden) return false;
      if (notice && !notice.hidden && notice.textContent?.includes("Sfondo OSM non incluso")) {
        return false;
      }
      return /OpenStreetMap/i.test(attribution.textContent || "");
    },
    { timeout: 30_000 },
  );
}

async function assertBasemapNoticeClearsControls(frame) {
  await frame.waitForFunction(
    () => {
      const notice = document.getElementById("notice");
      const center = document.getElementById("center");
      if (!notice || notice.hidden || notice.dataset.context !== "true") return true;
      if (!center) return true;
      const n = notice.getBoundingClientRect();
      const c = center.getBoundingClientRect();
      return !(
        n.right >= c.left - 2 &&
        n.left <= c.right + 2 &&
        n.bottom >= c.top - 2 &&
        n.top <= c.bottom + 2
      );
    },
    { timeout: 30_000 },
  );
}

async function openMobilitaFontiPanel(page) {
  const opened = await page.evaluate(() => {
    const details = [
      ...document.querySelectorAll('[data-immersive-page="mobilita"] details'),
    ];
    const fonti = details.find(
      (node) => node.querySelector("summary")?.textContent?.trim() === "Fonti",
    );
    if (!fonti) return false;
    fonti.open = true;
    return true;
  });
  assert.ok(opened, "Pannello Fonti immersivo assente");
  await page.waitForFunction(() => {
    const heading = document.querySelector(
      '[data-immersive-page="mobilita"] details[open] h2',
    );
    return heading?.textContent?.includes("Cosa misura");
  });
}

async function waitForViewerFrame(page) {
  const frame = page.frames().find((candidate) => candidate.url().includes("/mappe/mobilita/explorer/"));
  assert.ok(frame, "iframe explorer assente");
  await frame.waitForFunction(
    () => {
      const data = document.getElementById("data");
      return Boolean(data?.textContent?.includes('"cities"'));
    },
    { timeout: 45_000 },
  );
  await frame.waitForFunction(
    () => {
      const select = document.querySelector("#city, select[name='city'], select");
      return select instanceof HTMLSelectElement && select.options.length > 0;
    },
    { timeout: 45_000 },
  );
  return frame;
}

try {
  for (const width of [1280, 1024, 768, 390, 320]) {
    await runScenario(browser, {
      suite: "mappe-mobilita",
      label: `Home Mappe ${width}px`,
      pathname: "/",
      width,
      async validate(page) {
        await page.waitForSelector("#maps-title");
        await assertMapGrid(page, width);
        if (width >= 768) {
          await page.focus(MAP_CARD);
          const outline = await page.$eval(MAP_CARD, (link) => {
            const styles = getComputedStyle(link);
            return `${styles.outlineWidth} ${styles.outlineStyle} ${styles.outlineColor}`;
          });
          assert.notEqual(outline, "0px none rgb(0, 0, 0)", "focus visibile sulla scheda mobilità");
        }
      },
    });
  }

  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "Click Apri mobilità da home",
    pathname: "/",
    width: 1280,
    async validate(page) {
      await page.waitForSelector(MAP_CARD);
      await page.click(MAP_CARD);
      await page.waitForFunction(() => /\/mappe\/mobilita\/?$/.test(location.pathname));
      await page.waitForSelector("#mobilita-viewer");
      const frame = await waitForViewerFrame(page);
      await selectMilanoNetwork(frame, "milano");
      await assertPublishedBasemap(frame);
      const legend = await frame.$("#legend, .legend, [class*='legend']");
      assert.ok(legend || (await frame.$("canvas")), "mappa o legenda visibile");
      await page.screenshot({
        path: path.join(output, "mobilita-map-1280.png"),
        fullPage: false,
      });
      await openMobilitaFontiPanel(page);
      await page.screenshot({
        path: path.join(output, "mobilita-fonti-1280.png"),
        fullPage: false,
      });
    },
  });

  for (const width of [1280, 1024, 768, 390, 320]) {
    await runScenario(browser, {
      suite: "mappe-mobilita",
      label: `Basemap OSM e controlli ${width}px`,
      pathname: "/mappe/mobilita",
      width,
      readySelector: "#mobilita-viewer",
      async validate(page) {
        const frame = await waitForViewerFrame(page);
        await selectMilanoNetwork(frame, "milano");
        await assertPublishedBasemap(frame);
        await assertBasemapNoticeClearsControls(frame);
      },
    });
  }

  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "URL diretto mobilità 390px",
    pathname: "/mappe/mobilita",
    width: 390,
    readySelector: "#mobilita-viewer",
    async validate(page) {
      await page.waitForSelector("#mobilita-viewer");
      const exitLink = await page.$('a[aria-label="Torna al sito DoveVannoINostriSoldi"]');
      assert.ok(exitLink, "Torna al sito visibile a 390px");
      const frame = await waitForViewerFrame(page);
      await selectMilanoNetwork(frame, "milano-bus");
      const canvas = await frame.$("canvas");
      assert.ok(canvas, "canvas mappa presente");
      await page.screenshot({
        path: path.join(output, "mobilita-map-390.png"),
        fullPage: false,
      });
    },
  });

  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "Header mobilità 320px",
    pathname: "/mappe/mobilita",
    width: 320,
    readySelector: "#mobilita-viewer",
    async validate(page) {
      const exitLink = await page.$('a[aria-label="Torna al sito DoveVannoINostriSoldi"]');
      assert.ok(exitLink, "Torna al sito visibile a 320px");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
        "overflow orizzontale header mobilità",
      );
    },
  });

  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "Ritorno alla sezione Mappe",
    pathname: "/mappe/mobilita",
    width: 1280,
    readySelector: "#mobilita-viewer",
    async validate(page) {
      await page.waitForSelector('a[href="/#maps-title"]');
      await page.click('a[href="/#maps-title"]');
      await page.waitForFunction(() => location.pathname === "/" || location.pathname === "");
      assert.match(page.url(), /\/(#maps-title)?$/);
      await page.waitForSelector("#maps-title");
      const inView = await page.evaluate(() => {
        const section = document.getElementById("maps-title");
        if (!section) return false;
        const rect = section.getBoundingClientRect();
        return rect.top >= 0 && rect.top < innerHeight * 0.6;
      });
      assert.ok(inView, "sezione Mappe visibile dopo il link Mappe");
    },
  });

  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify({ ok: true, suite: "mappe-mobilita" }, null, 2),
  );
  console.log("PASS mappe-mobilita browser suite");
} finally {
  await closeBrowser(browser);
}
