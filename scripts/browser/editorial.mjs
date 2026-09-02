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

function normalizeVisibleText(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("it-IT");
}

async function waitForInteractiveHydration(page) {
  // A native <details> can be toggled before React finishes hydrating and then
  // reconciled back to its server state between Puppeteer input commands.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(resolve, { timeout: 1_000 });
          return;
        }
        setTimeout(resolve, 0);
      });
    });
  }));
}

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
    await waitForInteractiveHydration(page);

    const label = `${pathname} ${width}px`;
    const expectedSummary = "che cosa non dimostra da solo";
    let nativeLimits = false;
    const limitSummaries = await page.$$("details > summary");
    for (let index = 0; index < limitSummaries.length; index += 1) {
      const summary = limitSummaries[index];
      const summaryText = await summary.evaluate((element) => element.textContent ?? "");
      if (normalizeVisibleText(summaryText) !== expectedSummary) continue;

      const readDetailsState = () => summary.evaluate((element) => {
        const details = element.closest("details");
        const isVisible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        return {
          hasDetails: Boolean(details),
          open: details?.open === true,
          summaryVisible: isVisible(element),
          contentVisible: Boolean(
            details?.open &&
              [...details.children]
                .filter((child) => child !== element)
                .some((child) => (child.textContent ?? "").trim().length > 0 && isVisible(child)),
          ),
        };
      });
      const waitForDetailsState = async (expectedOpen) => {
        await page.waitForFunction(
          (element, open) => element.closest("details")?.open === open,
          // CI runners can take longer than 2s for native <details> toggles under load.
          { timeout: 5_000 },
          summary,
          expectedOpen,
        );
        return readDetailsState();
      };

      let detailsState = await readDetailsState();
      assert.equal(detailsState.hasDetails, true, `${label}: summary senza details nativo`);
      assert.equal(detailsState.summaryVisible, true, `${label}: summary del confine non visibile`);
      if (detailsState.open) {
        await summary.click();
        detailsState = await waitForDetailsState(false);
      }
      assert.equal(detailsState.open, false, `${label}: confine nativo non chiuso inizialmente`);

      await summary.focus();
      const focused = await summary.evaluate((element) => document.activeElement === element);
      assert.equal(focused, true, `${label}: summary del confine non riceve il focus`);
      await page.keyboard.press("Enter");
      try {
        detailsState = await waitForDetailsState(true);
      } catch {
        detailsState = await readDetailsState();
      }
      if (!detailsState.open || !detailsState.contentVisible) {
        if (detailsState.open) {
          await summary.click();
          await waitForDetailsState(false);
        }
        await summary.focus();
        await page.keyboard.press("Space");
        detailsState = await waitForDetailsState(true);
      }
      assert.equal(detailsState.open, true, `${label}: apertura da tastiera del confine fallita`);
      assert.equal(detailsState.contentVisible, true, `${label}: contenuto del confine non visibile`);

      await summary.click();
      detailsState = await waitForDetailsState(false);
      assert.equal(detailsState.open, false, `${label}: chiusura click del confine fallita`);
      await summary.click();
      detailsState = await waitForDetailsState(true);
      assert.equal(detailsState.open, true, `${label}: riapertura click del confine fallita`);
      assert.equal(detailsState.contentVisible, true, `${label}: contenuto non visibile dopo riapertura`);
      nativeLimits = true;
      break;
    }

    const state = await page.evaluate((nativeBoundaryVisible) => {
      const root = document.documentElement;
      const h1s = [...document.querySelectorAll("h1")];
      const dataLink = [...document.querySelectorAll("a")].some((link) =>
        /Vedi tutte le righe|Dati e fonti|registro completo/i.test(link.textContent ?? ""),
      );
      const normalize = (value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("it-IT");
      const legacyLimitHeadings = new Set([
        "che cosa non dimostra da solo",
        "limiti dichiarati nello snapshot",
      ]);
      const legacyLimits = [...document.querySelectorAll("h2")].some((heading) => {
        const style = window.getComputedStyle(heading);
        const rect = heading.getBoundingClientRect();
        return (
          legacyLimitHeadings.has(normalize(heading.textContent ?? "")) &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      return {
        bodyWidth: document.body.scrollWidth,
        clientWidth: root.clientWidth,
        h1: h1s[0]?.textContent?.trim(),
        h1Count: h1s.length,
        dataLink,
        limits: nativeBoundaryVisible || legacyLimits,
      };
    }, nativeLimits);
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
