import { readFileSync } from "node:fs";
import path from "node:path";
const [worktree, base = "http://localhost:3417"] = process.argv.slice(2);
const { launchBrowser, closeBrowser } = await import(path.join(worktree, "scripts/browser/harness.mjs"));
const mock = readFileSync(new URL("./mock.js", import.meta.url), "utf8");
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(`window.__dvnsMockDelay = 0.05; document.addEventListener("DOMContentLoaded", () => { ${mock} });`);
  await page.goto(new URL("/assistente", base).href, { waitUntil: "load" });
  await page.waitForSelector("#assistant-prompt");
  await page.type("#assistant-prompt", "Quanto hanno speso i Comuni in Calabria nel 2025?");
  await page.keyboard.press("Enter");
  const c = await page.waitForSelector("dialog[open]", { timeout: 4000 }).catch(() => null);
  if (c) await page.click("dialog[open] [class*=providerSave]");
  await page.waitForFunction(() => document.querySelector("[data-assistant-reply] [data-site-links]") && !document.querySelector('button[aria-label="Interrompi ricerca"]'), { timeout: 20000 });
  const r = await page.evaluate(() => [...document.querySelectorAll("[data-assistant-reply] a, footer button, footer a, [data-assistant-reply] button, main button")].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)} ${e.className.split(" ")[0]?.slice(0,30)} «${(e.textContent||e.getAttribute("aria-label")||"").trim().slice(0,30)}»`; }));
  console.log(r.join("\n"));
} finally { await closeBrowser(browser); }
