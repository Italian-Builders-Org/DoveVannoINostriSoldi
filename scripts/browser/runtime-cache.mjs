import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launchBrowser, closeBrowser, defaultBaseUrl, defaultArtifactsDir } from "./harness.mjs";

const base = defaultBaseUrl();
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname), "Run against the owned local production server");
const output = path.join(defaultArtifactsDir(), "runtime-cache");
await mkdir(output, { recursive: true });

for (const [route, seconds] of [["/privacy", 31536000], ["/fonti/stato", 300], ["/stato/legislature", 21600]]) {
  const response = await fetch(new URL(route, base));
  assert.equal(response.status, 200, route);
  assert.match(response.headers.get("cache-control") ?? "", new RegExp(`s-maxage=${seconds}(?:,|$)`), route);
  await response.arrayBuffer();
}

const browser = await launchBrowser({ extraArgs: ["--host-resolver-rules=MAP politici.dovevannoinostrisoldi.com 127.0.0.1"] });
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage();
    const errors = [];
    const prefetches = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/enti/c_h501/appalti" && request.headers()["next-router-prefetch"]) prefetches.push(url.search);
    });
    await page.setViewport({ width, height: 900 });
    await page.goto(new URL("/enti/c_h501/appalti?cpv=30121100&view=procedures", base).href, { waitUntil: "domcontentloaded" });
    await page.waitForNetworkIdle({ idleTime: 300, concurrency: 2 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(prefetches, [], "Filter links must not prefetch unseen variants");
    await page.screenshot({ path: path.join(output, `appalti-${width}.png`) });

    await page.goto(new URL("/politici", base).href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-atlas-ready="true"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.immersive), "politici");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const entries = await page.$$('[data-europa-entry][href="/politici/europa"]');
    let europa;
    for (const entry of entries) if (await entry.boundingBox()) { europa = entry; break; }
    assert.ok(europa);
    // Exercise keyboard activation through a client navigation, not a full reload.
    await europa.focus();
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.keyboard.press("Enter")]);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.immersive ?? null), null);
    assert.ok(await page.$(".mobile-menu-trigger, .desktop-sidebar"));
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-atlas-ready="true"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.immersive), "politici");
    await page.screenshot({ path: path.join(output, `politici-${width}.png`) });
    assert.deepEqual(errors, [], `Hydration/JavaScript errors at ${width}px`);
    await page.close();
    console.log(`PASS runtime cache and immersive navigation ${width}px`);
  }

  const subdomain = await browser.newPage();
  const rewritten = new URL(base);
  rewritten.hostname = "politici.dovevannoinostrisoldi.com";
  rewritten.pathname = "/";
  const subdomainErrors = [];
  subdomain.on("pageerror", (error) => subdomainErrors.push(error.message));
  await subdomain.setViewport({ width: 1280, height: 900 });
  await subdomain.goto(rewritten.href, { waitUntil: "domcontentloaded" });
  await subdomain.waitForSelector('[data-atlas-ready="true"]');
  assert.ok(await subdomain.$('[data-immersive-page="politici"]'));
  assert.equal(await subdomain.evaluate(() => document.documentElement.dataset.immersive), "politici");
  assert.deepEqual(subdomainErrors, [], "Subdomain rewrite must hydrate without mismatches");
  await subdomain.close();

  const noScript = await browser.newPage();
  await noScript.setViewport({ width: 1280, height: 900 });
  await noScript.setJavaScriptEnabled(false);
  await noScript.goto(new URL("/politici", base).href, { waitUntil: "domcontentloaded" });
  assert.equal(await noScript.evaluate(() => getComputedStyle(document.body).overflowY), "hidden");
  assert.ok(await noScript.$('[data-immersive-page="politici"]'));
  await noScript.close();
  console.log("PASS cache headers and atlas shell without JavaScript");
} finally { await closeBrowser(browser); }
