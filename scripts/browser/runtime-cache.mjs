import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const snapshotEvidence = [];
for (const [route, seconds] of [["/enti/c_h501/appalti", 31536000], ["/enti/c_h501/appalti?view=procedures", 31536000], ["/appalti/operatori/op-00000001", 31536000], ["/comuni?ente=c_f205", 21600]]) {
  const first = await fetch(new URL(route, base));
  assert.equal(first.status, 200, route);
  const html = await first.text();
  const initialCache = first.headers.get("x-nextjs-cache");
  let current = first;
  // A persisted local Next cache resumes as STALE after process restart.
  // Require regeneration to restore the declared TTL within a bounded window.
  if (initialCache === "STALE") {
    const deadline = Date.now() + 5000;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      current = await fetch(new URL(route, base));
      assert.equal(await current.text(), html, "Regeneration must preserve the committed snapshot");
    } while (current.headers.get("x-nextjs-cache") !== "HIT" && Date.now() < deadline);
    assert.equal(current.headers.get("x-nextjs-cache"), "HIT", route);
  }
  assert.match(current.headers.get("cache-control") ?? "", new RegExp(`s-maxage=${seconds}(?:,|$)`), route);
  const second = await fetch(new URL(route, base));
  assert.equal(second.headers.get("x-nextjs-cache"), "HIT", route);
  assert.equal(await second.text(), html, "Cached responses must preserve the same snapshot");
  const rscUrl = new URL(route, base);
  rscUrl.searchParams.set("_rsc", "runtime-cache-proof");
  const rsc = await fetch(rscUrl, { headers: { rsc: "1" } });
  assert.match(rsc.headers.get("content-type") ?? "", /text\/x-component/, route);
  await rsc.arrayBuffer();
  snapshotEvidence.push({ route, initialCache, cache: "HIT", rsc: true, sha256: createHash("sha256").update(html).digest("hex") });
}
// Historical links carry an operator into tabs that do not filter by it.
// Those URLs must share the default snapshot; an actual operator detail must not.
for (const view of ["summary", "operators", "procedures", "awards"]) {
  const canonical = await fetch(new URL(`/enti/c_h501/appalti?view=${view}`, base));
  const legacy = await fetch(new URL(`/enti/c_h501/appalti?view=${view}&operator=op-000001&operator=op-000002&metric=count&cpv=&awardYear=`, base));
  assert.match(legacy.headers.get("cache-control") ?? "", /s-maxage=31536000(?:,|$)/, view);
  assert.equal(await legacy.text(), await canonical.text(), `Ignored operator must not split ${view} snapshots`);
}
for (const route of ["/comuni?q=Roma", "/enti/c_h501/appalti?view=operator&operator=op-000001", "/enti/c_h501/appalti?view=operators&metric=value", "/enti/c_h501/appalti?view=awards&page=2", "/enti/c_h501/appalti?awardYear=2024", "/appalti/operatori/op-00000001?year=2024"]) {
  const response = await fetch(new URL(route, base));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/, route);
  await response.arrayBuffer();
}
// Submitting the operator form with its five default fields must reuse the
// unfiltered page. Actual or ambiguous filters still require dynamic rendering.
const operatorPath = "/appalti/operatori/op-00000001";
const operatorFields = ["year", "authority", "procedure", "minAmount", "maxAmount"];
const blankOperatorForm = operatorFields.map(key => `${key}=`).join("&");
const operatorDefault = await fetch(new URL(operatorPath, base));
const operatorHtml = await operatorDefault.text();
const operatorBlank = await fetch(new URL(`${operatorPath}?${blankOperatorForm}`, base));
assert.equal(operatorBlank.status, 200);
assert.equal(operatorBlank.headers.get("x-nextjs-cache"), "HIT", "Empty operator form must reuse the default snapshot");
assert.match(operatorBlank.headers.get("cache-control") ?? "", /s-maxage=31536000(?:,|$)/);
assert.equal(await operatorBlank.text(), operatorHtml, "Empty operator form must preserve the unfiltered body");
const operatorRscDefault = await fetch(new URL(`${operatorPath}?_rsc=operator-empty-form-proof`, base), { headers: { rsc: "1" } });
const operatorRscBlank = await fetch(new URL(`${operatorPath}?${blankOperatorForm}&_rsc=operator-empty-form-proof`, base), { headers: { rsc: "1" } });
for (const response of [operatorRscDefault, operatorRscBlank]) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/x-component/);
  assert.equal(response.headers.get("x-nextjs-cache"), "HIT");
}
assert.equal(await operatorRscBlank.text(), await operatorRscDefault.text(), "Empty operator form must preserve the RSC snapshot");
for (const query of ["year=2024", "procedure=UNRECOGNIZED_PROCEDURE", ...operatorFields.flatMap(key => [`${key}=invalid`, `${key}=&${key}=`])]) {
  const response = await fetch(new URL(`${operatorPath}?${query}`, base), { redirect: "manual" });
  assert.equal(response.status, 200, query);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/, query);
  const html = await response.text();
  if (query.includes("=&") || (query.endsWith("=invalid") && !query.startsWith("procedure="))) {
    assert.match(html, /Filtri non validi/, query);
  }
}
snapshotEvidence.push({ route: `${operatorPath}?${blankOperatorForm}`, cache: "HIT", rsc: true, sha256: createHash("sha256").update(operatorHtml).digest("hex") });
for (const route of ["/comuni?ente=not_a_published_municipality", "/enti/no_such_entity/appalti"]) {
  const response = await fetch(new URL(route, base));
  assert.equal(response.status, 200, "Preserve the published missing-data state");
  const html = await response.text();
  assert.doesNotMatch(html, /DYNAMIC_SERVER_USAGE|Application error/, route);
}
const missingOperator = await fetch(new URL("/appalti/operatori/op-99999999", base));
assert.equal(missingOperator.status, 404);
await missingOperator.arrayBuffer();
await (await import("node:fs/promises")).writeFile(path.join(output, "snapshot-cache.json"), JSON.stringify(snapshotEvidence, null, 2));

for (const query of ["cpv=invalid", "awardYear=invalid", "cpv=30121100&cpv=45000000", "awardYear=2025&awardYear=2024"]) {
  for (const code of ["c_h501", "no_such_entity"]) {
    const response = await fetch(new URL(`/enti/${code}/appalti?${query}`, base));
    assert.equal(response.status, 404, `Invalid filter accepted: ${code}?${query}`);
    await response.arrayBuffer();
  }
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

    await page.goto(new URL("/comuni?ente=c_f205", base).href, { waitUntil: "domcontentloaded" });
    await page.waitForNetworkIdle({ idleTime: 300, concurrency: 2 });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.immersive), "comuni");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.equal(await page.$eval("h1", node => node.textContent), "Milano");
    await page.screenshot({ path: path.join(output, `comuni-${width}.png`) });
    await page.type("#comuni-search", "Roma");
    await page.waitForFunction(() => document.querySelector('[role="option"]')?.textContent?.includes("Roma Capitale"));
    await page.screenshot({ path: path.join(output, `comuni-roma-search-${width}.png`) });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Roma Capitale");

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
  await noScript.goto(new URL("/politici", base).href, { waitUntil: "load" });
  assert.equal(await noScript.evaluate(() => getComputedStyle(document.body).overflowY), "hidden");
  assert.ok(await noScript.$('[data-immersive-page="politici"]'));
  await noScript.close();
  console.log("PASS cache headers and atlas shell without JavaScript");
} finally { await closeBrowser(browser); }
