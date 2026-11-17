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
const ROMA_ASSET_MANIFEST = readFileSync(
  path.join(process.cwd(), "src/lib/mobilita/roma-network-asset.ts"),
  "utf8",
);

function romaFixture() {
  const assetPath = ROMA_ASSET_MANIFEST.match(/"path": "(\/mappe\/mobilita\/roma\/network-[^"]+)"/)?.[1];
  assert.ok(assetPath, "asset rete Roma non dichiarato");
  const network = JSON.parse(readFileSync(path.join(process.cwd(), "public", assetPath), "utf8"));
  const routeIndex = network.routes.findIndex((route) => route[0] === "170");
  const pattern = network.patterns.find((p) => p[0] === routeIndex && p[1] === 0);
  assert.ok(pattern, "pattern 170 assente nella rete pubblicata");
  return { network, pattern, stop: network.stops[pattern[3][3]], next: network.stops[pattern[3][4]] };
}

// Predicted arrivals for the mock bus: 4 and 7 minutes to its next two stops,
// 3 minutes late, so ETA, delay chip and stop board are all exercised.
function romaArrivalsMock({ unavailable = false } = {}) {
  const { stop, next } = romaFixture();
  const base = Math.floor(Date.now() / 1000);
  const body = unavailable
    ? {
        status: "unavailable",
        error: "upstream_timeout",
        message: "Il feed ATAC è lento a rispondere.",
        source: {},
        fetchedAt: new Date().toISOString(),
      }
    : {
        status: "ok",
        source: {},
        fetchedAt: new Date().toISOString(),
        feedTimestamp: base - 10,
        feedAgeSeconds: 10,
        stale: false,
        tripCount: 1,
        cancelledCount: 0,
        base,
        trips: [{ t: "0#mock", r: "170", k: 0, v: "mock-1", d: 180, s: [stop[0], next[0]], a: [240, 420], y: [180, 180] }],
      };
  return { pathname: "/api/mobilita/roma/arrivals", status: unavailable ? 504 : 200, body };
}

// Punctuality summary: one bus per band, so every percentage is checkable.
function romaPunctualityMock({ unavailable = false } = {}) {
  const body = unavailable
    ? {
        status: "unavailable",
        error: "upstream_timeout",
        message: "Il feed ATAC è lento a rispondere.",
        source: {},
        fetchedAt: new Date().toISOString(),
      }
    : {
        status: "ok",
        source: {},
        fetchedAt: new Date().toISOString(),
        feedTimestamp: Math.floor(Date.now() / 1000) - 10,
        stale: false,
        total: 20,
        buckets: { early: 2, ontime: 10, late: 4, verylate: 2, severe: 2, unknown: 0 },
      };
  return { pathname: "/api/mobilita/roma/punctuality", status: unavailable ? 504 : 200, body };
}

// Coverage is asserted only while today is inside the published calendar.
function coverageCoversToday() {
  const first = ROMA_ASSET_MANIFEST.match(/"firstDate": "([0-9-]+)"/)?.[1];
  const last = ROMA_ASSET_MANIFEST.match(/"lastDate": "([0-9-]+)"/)?.[1];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  return Boolean(first && last && today >= first && today <= last);
}

function romaLiveMock({ unavailable = false } = {}) {
  const { stop } = romaFixture();
  const now = Math.floor(Date.now() / 1000);
  const body = unavailable
    ? {
        status: "unavailable",
        error: "upstream_timeout",
        message: "Il feed ATAC è lento a rispondere.",
        source: {},
        fetchedAt: new Date().toISOString(),
      }
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

// Real-time entry point: header disclosure "Tempo reale" → city "Roma".
async function clickByText(page, selector, text) {
  const handle = await page.waitForFunction(
    (sel, needle) => [...document.querySelectorAll(sel)].find((el) => el.textContent?.includes(needle)) ?? null,
    { timeout: 15_000 },
    selector,
    text,
  );
  await handle.asElement().click();
}

async function openRomaLive(page) {
  await clickByText(page, '[data-immersive-page="mobilita"] header details > summary', "Tempo reale");
  // The city panel must open inside the viewport (it overflowed left on phones).
  const box = await page.$eval('[data-immersive-page="mobilita"] header details[open] > div', (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth };
  });
  assert.ok(box.left >= 0 && box.right <= box.width + 1, `pannello tempo reale fuori schermo: ${JSON.stringify(box)}`);
  await clickByText(page, '[data-immersive-page="mobilita"] header details[open] a', "Roma");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("vista") === "bus-live");
}

// The explorer must stay laid out under the live view: if it is collapsed
// (display:none) its camera becomes NaN and the map is blank on return.
async function assertExplorerCovered(page, covered) {
  const state = await page.$eval("#mobilita-viewer", (frame) => ({
    visibility: getComputedStyle(frame).visibility,
    inert: frame.inert,
    width: frame.getBoundingClientRect().width,
    height: frame.getBoundingClientRect().height,
  }));
  assert.ok(state.width > 200 && state.height > 200, `iframe velocità senza dimensioni: ${JSON.stringify(state)}`);
  assert.equal(state.visibility === "hidden", covered, `visibilità iframe velocità: ${JSON.stringify(state)}`);
  assert.equal(state.inert, covered, "iframe velocità raggiungibile da tastiera nella vista live");
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
    /\/mappe\/mobilita\/roma\/(network|coverage)-[0-9a-f]{12}\.json|\/mappe\/mobilita\/roma\/coverage\/[0-9a-f]{12}\.json|\/api\/mobilita\/roma\/(vehicles|arrivals|punctuality)|tiles\.openfreemap\.org/.test(
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
      requestMocks: [mock, romaArrivalsMock(), romaPunctualityMock(), OFFLINE_TILEJSON, OFFLINE_TILES],
      expectedFailure: expectedLiveAbort,
      async validate(page) {
        await openRomaLive(page);
        await page.waitForFunction(
          () => /In diretta · 1 autobus/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        await assertExplorerCovered(page, true);
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
        await assertExplorerCovered(page, false);
      },
    });
  }

  for (const width of [390, 1280]) {
    const { stop } = romaFixture();
    await runScenario(browser, {
      suite: "mappe-mobilita",
      label: `Bus Roma fermata e ritardi ${width}px`,
      pathname: "/mappe/mobilita?vista=bus-live",
      width,
      readySelector: "aside",
      requestMocks: [romaLiveMock(), romaArrivalsMock(), romaPunctualityMock(), OFFLINE_TILEJSON, OFFLINE_TILES],
      expectedFailure: expectedLiveAbort,
      async validate(page) {
        await page.waitForFunction(
          () => /In diretta · 1 autobus/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        if (coverageCoversToday()) {
          await page.waitForFunction(
            () => /corse programmate in corso/.test(document.querySelector("aside")?.textContent ?? ""),
            { timeout: 30_000 },
          );
        }
        // Punctuality: five bands with percentages from the summary feed.
        await page.waitForFunction(
          () => {
            const text = document.querySelector('[aria-labelledby="punct-title"]')?.textContent ?? "";
            return /in orario \(±2 min\)50%/.test(text) && /ritardo 5-10 min10%/.test(text) && /ritardo oltre 10 min10%/.test(text);
          },
          { timeout: 30_000 },
        );
        // Stop search by code (exact), then the board shows the mock arrival.
        await page.type("#roma-live-search", stop[0]);
        await page.waitForSelector('ul[aria-label="Fermate"] button', { timeout: 30_000 });
        await page.click('ul[aria-label="Fermate"] button');
        await page.waitForFunction(() => new URL(location.href).searchParams.has("fermata"));
        await page.waitForFunction(
          () => {
            const text = document.querySelector('[aria-labelledby="stop-title"]')?.textContent ?? "";
            return /4 min|3 min/.test(text) && /\+3 min/.test(text);
          },
          { timeout: 30_000 },
        );
        await page.click('ul[aria-label="Arrivi"] button');
        await page.waitForFunction(
          () => /Rispetto all’orario/.test(document.querySelector("aside")?.textContent ?? ""),
          { timeout: 30_000 },
        );
        assert.match(page.url(), /vettura=9999/, "mezzo dal tabellone non condivisibile");
        assert.match(page.url(), /fermata=/, "fermata di provenienza persa");
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => !new URL(location.href).searchParams.has("vettura") && new URL(location.href).searchParams.has("fermata"),
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("fermata"));
        // Delay colours: toggle is reachable and pressed state is exposed.
        await page.click('[aria-label="Colore dei mezzi"] button:nth-child(2)');
        assert.equal(
          await page.$eval('[aria-label="Colore dei mezzi"] button:nth-child(2)', (b) => b.getAttribute("aria-pressed")),
          "true",
        );
        // 2D/3D: the switch is exposed and the camera tilts (compass shows pitch).
        await page.click('[aria-label="Prospettiva della mappa"] button:nth-child(2)');
        assert.equal(
          await page.$eval('[aria-label="Prospettiva della mappa"] button:nth-child(2)', (b) => b.getAttribute("aria-pressed")),
          "true",
        );
        await page.waitForFunction(() => (() => Number(/rotateX\(([-\d.e]+)deg\)/.exec(document.querySelector(".maplibregl-ctrl-compass .maplibregl-ctrl-icon")?.getAttribute("style") ?? "")?.[1] ?? NaN))() > 30, { timeout: 10_000 });
        await page.click('[aria-label="Prospettiva della mappa"] button:nth-child(1)');
        await page.waitForFunction(() => Math.abs((() => Number(/rotateX\(([-\d.e]+)deg\)/.exec(document.querySelector(".maplibregl-ctrl-compass .maplibregl-ctrl-icon")?.getAttribute("style") ?? "")?.[1] ?? NaN))()) < 0.5, { timeout: 10_000 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
          `overflow orizzontale fermata ${width}px`,
        );
        await page.screenshot({ path: path.join(output, `mobilita-bus-stop-${width}.png`), fullPage: false });
      },
    });
  }

  for (const width of [390, 1280]) {
    await runScenario(browser, {
      suite: "mappe-mobilita",
      label: `Ritorno dal tempo reale alle velocità ${width}px`,
      pathname: "/mappe/mobilita",
      width,
      readySelector: "#mobilita-viewer",
      requestMocks: [romaLiveMock(), romaArrivalsMock(), romaPunctualityMock(), OFFLINE_TILEJSON, OFFLINE_TILES],
      expectedFailure: expectedLiveAbort,
      async validate(page) {
        const frame = await waitForViewerFrame(page);
        await selectMilanoNetwork(frame, "milano");
        const scale = () => frame.$eval("#scale-bar", (node) => node.textContent?.trim() ?? "");
        assert.match(await scale(), /^\d[\d.,]* (m|km)$/, "scala iniziale non valida");
        await openRomaLive(page);
        await page.waitForSelector("aside", { timeout: 30_000 });
        await assertExplorerCovered(page, true);
        // Back with the header button (the reported bug), then again via history.
        await clickByText(page, '[data-immersive-page="mobilita"] header button', "Velocità");
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("vista"));
        await assertExplorerCovered(page, false);
        await frame.waitForFunction(
          () => /^\d[\d.,]* (m|km)$/.test(document.querySelector("#scale-bar")?.textContent?.trim() ?? ""),
          { timeout: 10_000 },
        );
        assert.match(await frame.$eval("#map-title", (n) => n.textContent ?? ""), /Milano/, "città persa al ritorno");
        await openRomaLive(page);
        await page.waitForSelector("aside", { timeout: 30_000 });
        await page.goBack();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("vista"));
        await frame.waitForFunction(
          () => /^\d[\d.,]* (m|km)$/.test(document.querySelector("#scale-bar")?.textContent?.trim() ?? ""),
          { timeout: 10_000 },
        );
        await page.screenshot({ path: path.join(output, `mobilita-ritorno-velocita-${width}.png`), fullPage: false });
      },
    });
  }

  // A tap on «Roma» before hydration (≈4 s on a phone) must still open the
  // live view: the entry is a real link, not a handler-only button.
  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "Tempo reale prima dell'idratazione",
    pathname: "/mappe/mobilita",
    width: 390,
    readySelector: "header details > summary",
    requestMocks: [romaLiveMock(), romaArrivalsMock(), romaPunctualityMock(), OFFLINE_TILEJSON, OFFLINE_TILES],
    expectedFailure: expectedLiveAbort,
    async validate(page) {
      await page.setJavaScriptEnabled(false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await clickByText(page, '[data-immersive-page="mobilita"] header details > summary', "Tempo reale");
      await clickByText(page, '[data-immersive-page="mobilita"] header details[open] a', "Roma");
      await page.waitForFunction(() => new URL(location.href).searchParams.get("vista") === "bus-live", {
        timeout: 15_000,
      });
      await page.setJavaScriptEnabled(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => /In diretta · 1 autobus/.test(document.querySelector("aside")?.textContent ?? ""),
        { timeout: 30_000 },
      );
    },
  });

  await runScenario(browser, {
    suite: "mappe-mobilita",
    label: "Bus Roma live feed non disponibile",
    pathname: "/mappe/mobilita?vista=bus-live",
    width: 1280,
    readySelector: "aside",
    requestMocks: [
      romaLiveMock({ unavailable: true }),
      romaArrivalsMock({ unavailable: true }),
      romaPunctualityMock({ unavailable: true }),
      OFFLINE_TILEJSON,
      OFFLINE_TILES,
    ],
    // The simulated upstream outage is the point of this scenario.
    expectedFailure: (failure) =>
      expectedLiveAbort(failure) ||
      (/\b504\b/.test(failure) && /\/api\/mobilita\/roma\/(vehicles|arrivals|punctuality)/.test(failure)),
    async validate(page) {
      await page.waitForFunction(
        () => /non risponde/.test(document.querySelector("aside")?.textContent ?? ""),
        { timeout: 30_000 },
      );
      // A stop board opened by link degrades to an explicit message, not an empty list.
      const { stop } = romaFixture();
      await page.goto(new URL(`/mappe/mobilita?vista=bus-live&fermata=${stop[0]}`, page.url()).href);
      await page.waitForFunction(
        () => /feed degli arrivi non risponde/.test(document.querySelector('[aria-labelledby="stop-title"]')?.textContent ?? ""),
        { timeout: 60_000 },
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
