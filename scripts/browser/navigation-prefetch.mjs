import assert from "node:assert/strict";
import { createPage, delay, navigate } from "./harness.mjs";

export async function inspectNavigationPrefetch(browser, baseUrl) {
  // Hover/focus intent is a pointer behaviour; keep a non-touch viewport.
  const page = await createPage(browser, { width: 1280 });
  const prefetched = new Set();
  page.on("request", (request) => {
    if (request.headers()["next-router-prefetch"] === "1") {
      prefetched.add(new URL(request.url()).pathname);
    }
  });
  try {
    await navigate(page, {
      url: new URL("/inflazione", baseUrl).href,
      label: "navigation prefetch /inflazione",
      waitUntil: "domcontentloaded",
      readySelector: "main h1",
    });
    for (const pathname of ["/cuneo-fiscale", "/imprese"]) {
      assert.equal(prefetched.has(pathname), false, `${pathname}: prefetched without user intent`);
    }
    await page.click(".mobile-menu-trigger");
    await page.waitForSelector("#mobile-navigation:modal .primary-nav", { visible: true });
    // Opening the shared drawer must not warm every destination.
    await delay(400);
    for (const pathname of ["/cuneo-fiscale", "/imprese"]) {
      assert.equal(prefetched.has(pathname), false, `${pathname}: prefetched merely by opening the menu`);
    }
    const cuneoSelector = '#mobile-navigation-links a[href="/cuneo-fiscale"]';
    const impreseSelector = '#mobile-navigation-links a[href="/imprese"]';
    await page.waitForSelector(cuneoSelector, { visible: true });
    await page.hover(cuneoSelector);
    await page.waitForSelector(impreseSelector, { visible: true });
    await page.focus(impreseSelector);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.pathname === "/imprese");
    await page.waitForSelector("main h1", { visible: true });
    console.log("PASS navigation prefetch: idle menu stays quiet; hover, focus and keyboard navigation work");
  } finally {
    await page.close();
  }
}
