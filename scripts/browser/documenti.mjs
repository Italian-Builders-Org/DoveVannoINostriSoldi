import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  closeBrowser,
  createPage,
  defaultArtifactsDir,
  defaultBaseUrl,
  launchBrowser,
  navigate,
  waitForServer,
} from "./harness.mjs";

const widths = [
  { width: 390, height: 844, label: "mobile" },
  { width: 1280, height: 900, label: "desktop" },
];

const v2DetailIds = [
  "senato-moro-viii-introduzione",
  "senato-terrorismo-stragi-introduzione",
  "normattiva-legge-82-2014",
  "archivi-carte-delle-stragi",
  "archivi-elenco-versamenti-stragi",
  "archivi-direttiva-draghi-gladio-p2",
  "acs-sala-raccolte-desecretate",
  "camera-moro-bollettino-2018-01-17",
];

await waitForServer(defaultBaseUrl());
const browser = await launchBrowser();
const base = defaultBaseUrl();
const artifacts = defaultArtifactsDir();
mkdirSync(artifacts, { recursive: true });

try {
  for (const viewport of widths) {
    const page = await createPage(browser, viewport);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await navigate(page, {
      url: new URL("/documenti", base).href,
      label: `documenti hub ${viewport.label}`,
      readySelector: '[data-testid="documenti-hub"]',
    });
    const hub = await page.$eval('[data-testid="documenti-hub"]', (el) => ({
      title: el.querySelector("h1")?.textContent?.trim() ?? "",
      caveat: el.textContent?.includes("Declassificare non significa pubblicare online") ?? false,
      rows: el.querySelectorAll("a[href^='/documenti/']").length,
      overflow: el.scrollWidth > el.clientWidth + 1,
    }));
    assert.equal(hub.title, "Documenti declassificati");
    assert.equal(hub.caveat, true);
    assert.ok(hub.rows >= 8, `${viewport.label}: attese almeno 8 schede`);
    assert.equal(hub.overflow, false, `${viewport.label}: overflow hub`);

    await page.focus('select[name="tema"]');
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const firstHref = await page.$eval("a[href^='/documenti/']", (el) => el.getAttribute("href"));
    assert.ok(firstHref?.startsWith("/documenti/"));
    await navigate(page, {
      url: new URL(firstHref, base).href,
      label: `documenti detail ${viewport.label}`,
      readySelector: '[data-testid="documenti-detail"]',
    });
    const detail = await page.$eval('[data-testid="documenti-detail"]', (el) => ({
      hasCta: Boolean(el.querySelector("a[href^='https://']")),
      hasPoints: (el.querySelectorAll("ul li").length ?? 0) >= 3,
      overflow: el.scrollWidth > el.clientWidth + 1,
    }));
    assert.equal(detail.hasCta, true, `${viewport.label}: CTA fonte ufficiale`);
    assert.equal(detail.hasPoints, true, `${viewport.label}: punti chiave`);
    assert.equal(detail.overflow, false, `${viewport.label}: overflow detail`);

    await page.screenshot({
      path: path.join(artifacts, `documenti-hub-${viewport.label}.png`),
      fullPage: true,
    });

    for (const docId of v2DetailIds) {
      await navigate(page, {
        url: new URL(`/documenti/${docId}`, base).href,
        label: `documenti ${docId} ${viewport.label}`,
        readySelector: '[data-testid="documenti-detail"]',
      });
      const card = await page.$eval('[data-testid="documenti-detail"]', (el) => ({
        h1: el.querySelector("h1")?.textContent?.trim() ?? "",
        hasAccessLabel: /Consultabile online|Consultazione in sede|Richiesta SPID|Su richiesta/u.test(
          el.textContent ?? "",
        ),
        overflow: el.scrollWidth > el.clientWidth + 1,
      }));
      assert.ok(card.h1.length > 0, `${docId} ${viewport.label}: titolo mancante`);
      assert.equal(card.hasAccessLabel, true, `${docId} ${viewport.label}: accesso in italiano`);
      assert.equal(card.overflow, false, `${docId} ${viewport.label}: overflow`);
      await page.screenshot({
        path: path.join(artifacts, `documenti-${docId}-${viewport.label}.png`),
        fullPage: true,
      });
    }

    assert.deepEqual(errors, [], `${viewport.label}: errori console\n${errors.join("\n")}`);
    await page.close();
  }
  console.log("PASS documenti browser: hub+detail mobile/desktop, tastiera, overflow, console");
} finally {
  await closeBrowser(browser);
}
