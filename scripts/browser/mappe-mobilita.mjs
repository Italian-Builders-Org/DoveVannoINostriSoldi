import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const MAP_GROUP = 'details:has(#maps-title)';
const MAP_LIST = `${MAP_GROUP} ul`;
const MAP_CARD = `${MAP_LIST} a[href="/mappe/mobilita"]`;

async function ensureMapsOpen(page) {
  await page.waitForSelector("#maps-title");
  await page.evaluate((selector) => {
    const details = document.querySelector(selector);
    if (details instanceof HTMLDetailsElement) details.open = true;
  }, MAP_GROUP);
  await page.waitForSelector(`${MAP_LIST} a[href="/mappe/mobilita"]`, { visible: true });
}

async function assertMapGrid(page, width) {
  await ensureMapsOpen(page);
  const links = await page.$$eval(`${MAP_LIST} a`, (items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { title: item.textContent.trim(), height: rect.height, left: rect.left, right: rect.right };
  }));
  assert.deepEqual(links.map((link) => link.title), ['Mappa dei Comuni', 'Mappa della politica', 'Mappa della mobilità']);
  assert.ok(links.every((link) => link.height >= 44 && link.left >= 0 && link.right <= width + 1), 'Mappe: collegamenti accessibili senza overflow');
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

async function selectCityNetwork(frame, { networkId, titleIncludes }) {
  await frame.evaluate((id) => {
    const select = document.querySelector("#city, select[name='city'], select");
    if (!(select instanceof HTMLSelectElement)) return;
    const match = [...select.options].find(
      (option) =>
        option.value === id ||
        option.textContent?.toLowerCase().includes(String(id).toLowerCase()),
    );
    if (match) {
      select.value = match.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, networkId);
  await frame.waitForFunction(
    (expected) => document.querySelector("#map-title")?.textContent?.includes(expected),
    { timeout: 30_000 },
    titleIncludes,
  );
}

async function selectMilanoNetwork(frame, networkId = "milano") {
  await selectCityNetwork(frame, {
    networkId,
    titleIncludes: "Milano",
  });
}

// Deterministic live feed built from the published network: a line-170 bus
// sitting on its own path, so search, route panel and follow panel are
// exercised without the upstream feed or map tiles.
function romaLiveMock({ unavailable = false } = {}) {
  const manifest = readFileSync(
    path.join(process.cwd(), "src/lib/mobilita/roma-network-asset.ts"),
    "utf8",
  );
  const assetPath = manifest.match(/"path": "([^"]+)"/)?.[1];
  assert.ok(assetPath, "asset rete Roma non dichiarato");
  const network = JSON.parse(readFileSync(path.join(process.cwd(), "public", assetPath), "utf8"));
  const routeIndex = network.routes.findIndex((route) => route[0] === "170");
  const pattern = network.patterns.find((p) => p[0] === routeIndex && p[1] === 0);
  assert.ok(pattern, "pattern 170 assente nella rete pubblicata");
  const stop = network.stops[pattern[3][3]];
  const now = Math.floor(Date.now() / 1000);
  const body = unavailable
    ? { status: "unavailable", error: "upstream_timeout", source: {}, fetchedAt: new Date().toISOString() }
    : {
        status: "ok",
        source: {},
        fetchedAt: new Date().toISOString(),
        feedTimestamp: now - 20,
        feedAgeSeconds: 20,
        stale: false,
        vehicleCount: 1,
        vehicles: [
          {
            id: "mock-1",
            label: "9999",
            routeId: "170",
            tripId: "0#mock",
            directionId: 0,
            startTime: "15:30:00",
            lat: stop[3],
            lon: stop[2],
            ts: now - 30,
            stopId: stop[0],
            status: "in_transit",
          },
        ],
      };
  return {
    pathname: "/api/mobilita/roma/vehicles",
    status: unavailable ? 504 : 200,
    body,
    stopName: stop[1],
  };
}

// CI has no outbound network: the external basemap answers with an empty but
// valid TileJSON, tiles and glyphs, so the map and the live layer still load.
const TILE_HOST = "https://tiles.openfreemap.org/";
const OFFLINE_TILEJSON = {
  match: (request) => request.url() === `${TILE_HOST}planet`,
  headers: { "Access-Control-Allow-Origin": "*" },
  body: {
    tilejson: "3.0.0",
    tiles: [`${TILE_HOST}offline/{z}/{x}/{y}.pbf`],
    minzoom: 0,
    maxzoom: 14,
    vector_layers: [],
  },
};
const OFFLINE_TILES = {
  match: (request) => request.url().startsWith(TILE_HOST),
  headers: { "Access-Control-Allow-Origin": "*" },
  contentType: "application/x-protobuf",
  body: "",
};

// The live view aborts its own fetches on unmount (and React dev remounts it):
// those cancellations are expected, any other failure is not.
function expectedLiveAbort(failure) {
  return (
    failure.includes("net::ERR_ABORTED") &&
    /\/mappe\/mobilita\/roma\/network-[0-9a-f]{12}\.json|\/api\/mobilita\/roma\/vehicles|tiles\.openfreemap\.org/.test(
      failure,
    )
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
  const frame = await page.waitForFrame(
    (candidate) => candidate.url().includes("/mappe/mobilita/explorer/"),
    { timeout: 45_000 },
  );
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
      await ensureMapsOpen(page);
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

  for (const width of [390, 1280]) {
    const mock = romaLiveMock();
    await runScenario(browser, {
      suite: "mappe-mobilita",
      label: `Bus Roma live ${width}px`,
      pathname: "/mappe/mobilita",
      width,
      readySelector: "#mobilita-viewer",
      requestMocks: [mock, OFFLINE_TILEJSON, OFFLINE_TILES],
      expectedFailure: expectedLiveAbort,
      async validate(page) {
        await page.click('[aria-label="Vista della mappa"] button:nth-child(2)');
        await page.waitForFunction(() => new URL(location.href).searchParams.get("vista") === "bus-live");
        await page.waitForFunction(
          () => /In diretta · 1 autobus/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        assert.equal(
          await page.$eval("#mobilita-viewer", (frame) => frame.hidden),
          true,
          "iframe velocità visibile nella vista live",
        );
        await page.type("#roma-live-search", "170");
        // The network asset may still be loading: submit once 170 is listed.
        await page.waitForFunction(
          () => /1 autobus ora/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          () => /1 autobus in servizio/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        assert.match(page.url(), /linea=170/, "linea non condivisibile nell'URL");
        await page.click("aside ul li button");
        await page.waitForFunction(
          () => /Vettura 9999/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        const panel = await page.$eval("aside", (node) => node.textContent);
        assert.match(panel, /Prossime fermate/, "fermate successive assenti");
        assert.match(page.url(), /vettura=9999/, "vettura non condivisibile nell'URL");
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
          `overflow orizzontale vista live ${width}px`,
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("vettura"));
        await page.screenshot({
          path: path.join(output, `mobilita-bus-live-${width}.png`),
          fullPage: false,
        });
        await page.goBack();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("vista"));
        assert.equal(
          await page.$eval("#mobilita-viewer", (frame) => frame.hidden),
          false,
          "indietro non riporta alle velocità",
        );
      },
    });
  }

  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "Bus Roma live feed non disponibile",
    pathname: "/mappe/mobilita?vista=bus-live",
    width: 1280,
    readySelector: "aside",
    requestMocks: [romaLiveMock({ unavailable: true }), OFFLINE_TILEJSON, OFFLINE_TILES],
    // The simulated upstream outage is the point of this scenario.
    expectedFailure: (failure) =>
      expectedLiveAbort(failure) ||
      (/\b504\b/.test(failure) && failure.includes("/api/mobilita/roma/vehicles")),
    async validate(page) {
      await page.waitForFunction(
        () => /non risponde/.test(document.querySelector("aside")?.textContent ?? ""),
        { timeout: 30_000 },
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
      await page.waitForFunction(() => location.pathname === "/" && location.hash === "#maps-title");
      await ensureMapsOpen(page);
      await page.evaluate(() => {
        document.getElementById("maps-title")?.scrollIntoView({ block: "start" });
      });
      await page.waitForFunction(() => {
        const heading = document.getElementById("maps-title");
        if (!heading) return false;
        const rect = heading.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight * 0.75;
      }, { timeout: 5_000 });
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
