import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const root = process.cwd();
const outputDir = path.join(root, "docs/readme");
const baseUrl = process.env.DVNS_BASE_URL ?? "https://www.dovevannoinostrisoldi.com";

const shots = [
  { pathname: "/", file: "home.jpg", wait: "main h1" },
  { pathname: "/spese/panoramica", file: "panoramica.jpg", wait: "main h1" },
  { pathname: "/territori", file: "territori.jpg", wait: "main h1" },
  { pathname: "/governi", file: "governi.jpg", wait: "main h1" },
  { pathname: "/istruzione", file: "istruzione.jpg", wait: "main h1" },
  { pathname: "/imprese", file: "imprese.jpg", wait: "main h1" },
  { pathname: "/controlli", file: "controlli.jpg", wait: "main h1" },
  { pathname: "/dati", file: "dati.jpg", wait: "main h1" },
  {
    pathname: "/territori/confronto",
    file: "confronto-territori.jpg",
    wait: "main h1",
  },
  { pathname: "/debito", file: "debito.jpg", wait: "main h1" },
  { pathname: "/spese/sanita", file: "sanita.jpg", wait: "main h1" },
  { pathname: "/mcp", file: "mcp.jpg", wait: "main h1" },
  { pathname: "/opere", file: "opere.jpg", wait: "main h1" },
  { pathname: "/appalti/operatori", file: "appalti-operatori.jpg", wait: "main h1" },
  { pathname: "/assistente", file: "assistente.jpg", wait: "main h1" },
  { pathname: "/poverta", file: "poverta.jpg", wait: "main h1" },
  { pathname: "/stato", file: "stato.jpg", wait: "main h1" },
];

function chromeExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

await mkdir(outputDir, { recursive: true });
console.log(`capturing ${shots.length} pages from ${baseUrl}`);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromeExecutable(),
  args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  for (const shot of shots) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 2 });
      const url = new URL(shot.pathname, baseUrl).toString();
      console.log(`goto ${shot.pathname}`);
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (!response?.ok()) {
        throw new Error(`${url}: HTTP ${response?.status() ?? "nessuna risposta"}`);
      }
      await page.waitForSelector(shot.wait, { visible: true, timeout: 45_000 });
      await page.evaluate(() => {
        document.querySelector(".skip-link")?.setAttribute("hidden", "");
        document.querySelector("nextjs-portal")?.remove();
        document.querySelector("[data-nextjs-dev-overlay]")?.remove();
        document.querySelector('button[aria-label="Open Next.js Dev Tools"]')?.remove();
      });
      await Promise.race([
        page.evaluate(() => document.fonts.ready),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8_000 }).catch(() => {});
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
      );

      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const brand = document.querySelector(".brand")?.getBoundingClientRect();
        const search = document.querySelector(".header-search")?.getBoundingClientRect();
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: root.clientWidth,
          headerOverlap: Boolean(brand && search && brand.right > search.left),
          navNotePresent: Boolean(document.querySelector(".nav-note")),
        };
      });
      if (layout.bodyWidth > layout.viewportWidth + 1) {
        throw new Error(`${url}: overflow orizzontale durante la cattura`);
      }
      if (layout.headerOverlap) {
        throw new Error(`${url}: brand e ricerca si sovrappongono durante la cattura`);
      }
      if (layout.navNotePresent) {
        throw new Error(`${url}: nota di navigazione obsoleta ancora presente`);
      }

      const jpg = await page.screenshot({
        type: "jpeg",
        quality: 78,
        captureBeyondViewport: false,
      });
      const outputPath = path.join(outputDir, shot.file);
      await writeFile(outputPath, jpg);
      console.log(`wrote ${path.relative(root, outputPath)} (${Math.round(jpg.length / 1024)} KB)`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
