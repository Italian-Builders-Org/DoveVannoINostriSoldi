import assert from "node:assert/strict";
import { createPage } from "./harness.mjs";

export async function inspectNavigationPrefetch(browser, baseUrl) {
  const page = await createPage(browser, { width: 1280 });
  const prefetched = new Set();
  const isPrefetch = (request, pathname) =>
    request.headers()["next-router-prefetch"] === "1"
    && new URL(request.url()).pathname === pathname;
  page.on("request", (request) => {
    if (request.headers()["next-router-prefetch"] === "1") {
      prefetched.add(new URL(request.url()).pathname);
    }
  });
  try {
    await page.goto(new URL("/inflazione", baseUrl).href, { waitUntil: "networkidle0" });
    for (const pathname of ["/cuneo-fiscale", "/imprese"]) {
      assert.equal(prefetched.has(pathname), false, `${pathname}: prefetched without user intent`);
    }
    await Promise.all([
      page.waitForRequest((request) => isPrefetch(request, "/cuneo-fiscale")),
      page.hover('nav[aria-label="Altre pagine in Economia"] a[href="/cuneo-fiscale"]'),
    ]);
    await Promise.all([
      page.waitForRequest((request) => isPrefetch(request, "/imprese")),
      page.focus('#desktop-navigation a[href="/imprese"]'),
    ]);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.pathname === "/imprese");
    await page.waitForSelector("main h1", { visible: true });
    console.log("PASS navigation prefetch: idle menu stays quiet; hover, focus and keyboard navigation work");
  } finally {
    await page.close();
  }
}
