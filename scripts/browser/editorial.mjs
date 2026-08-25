import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeBrowser,
  defaultBaseUrl,
  launchBrowser,
  navigate,
  resolveBrowserExecutable,
} from "./harness.mjs";
import { EDITORIAL_TOPICS } from "../../src/lib/integrated-editorial.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseUrl = defaultBaseUrl();
const reviewDirectory = path.join(root, ".impeccable", "review");

assert.ok(
  ["http:", "https:"].includes(baseUrl.protocol),
  "DVNS_BASE_URL non valido",
);

async function inspectRoute(browser, pathname, title, width) {
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width,
      height: width <= 390 ? 844 : 900,
      deviceScaleFactor: 1,
      hasTouch: width <= 390,
      isMobile: width <= 390,
    });
    const url = new URL(pathname, baseUrl).toString();
    // Use DOMContentLoaded + specific selector readiness instead of
    // networkidle0 (PR1.8): wait for the h1 that carries the title.
    await navigate(page, { url, label: `${pathname} ${width}px`, readySelector: "h1" });

    const state = await page.evaluate(() => {
      const root = document.documentElement;
      const h1s = [...document.querySelectorAll("h1")];
      const dataLink = [...document.querySelectorAll("a")].some((link) =>
        /Vedi tutte le righe|Dati e fonti|registro completo/i.test(link.textContent ?? ""),
      );
      const limits = [...document.querySelectorAll("h2")].some((heading) =>
        /non dimostra|limiti/i.test(heading.textContent ?? ""),
      );
      return {
        bodyWidth: document.body.scrollWidth,
        clientWidth: root.clientWidth,
        h1: h1s[0]?.textContent?.trim(),
        h1Count: h1s.length,
        dataLink,
        limits,
      };
    });
    const label = `${pathname} ${width}px`;
    assert.equal(state.h1Count, 1, `${label}: serve un solo h1`);
    assert.equal(state.h1, title, `${label}: titolo inatteso`);
    assert.ok(state.bodyWidth <= state.clientWidth + 1, `${label}: overflow globale`);
    assert.equal(state.dataLink, true, `${label}: drill-down dati assente`);
    assert.equal(state.limits, true, `${label}: confine probatorio assente`);
  } finally {
    await page.close();
  }
}

async function captureHub(browser, pathname, width, outputName) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: width <= 390 ? 844 : 900, deviceScaleFactor: 1 });
    const url = new URL(pathname, baseUrl).toString();
    await navigate(page, { url, label: `hub ${pathname}`, readySelector: "h1" });
    await page.screenshot({ path: path.join(reviewDirectory, outputName), fullPage: true });
  } finally {
    await page.close();
  }
}

mkdirSync(reviewDirectory, { recursive: true });

const browser = await launchBrowser({
  executablePath: resolveBrowserExecutable(),
});

try {
  for (const width of [390, 1280]) {
    for (const topic of EDITORIAL_TOPICS) {
      await inspectRoute(browser, `/${topic.section}/${topic.slug}`, topic.title, width);
    }
  }
  await captureHub(browser, "/appalti/dettaglio", 1280, "desktop.png");
  await captureHub(browser, "/appalti/dettaglio", 390, "mobile.png");
  process.stdout.write(`${JSON.stringify({ ok: true, routes: EDITORIAL_TOPICS.length, viewports: [390, 1280] })}\n`);
} finally {
  await closeBrowser(browser);
}
