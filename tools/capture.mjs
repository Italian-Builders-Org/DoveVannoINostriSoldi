// Usage: node capture.mjs <worktree> <outDir> [baseUrl]
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const [worktree, outDir, base = "http://localhost:3417"] = process.argv.slice(2);
const { launchBrowser, closeBrowser } = await import(path.join(worktree, "scripts/browser/harness.mjs"));
const mock = readFileSync(new URL("./mock.js", import.meta.url), "utf8");
mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  for (const scheme of ["dark", "light"]) {
    for (const [name, width, height] of [["desktop", 1280, 860], ["mobile", 390, 844]]) {
      const page = await browser.newPage();
      page.on("pageerror", (e) => errors.push(`${scheme}-${name}: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`${scheme}-${name} console: ${m.text()}`); });
      await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600 });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }]);
      await page.evaluateOnNewDocument(`window.__dvnsMockDelay = 0.05; document.addEventListener("DOMContentLoaded", () => { ${mock} });`);
      await page.goto(new URL("/assistente", base).href, { waitUntil: "load" });
      await page.waitForSelector("#assistant-prompt"); await page.waitForFunction(() => document.querySelector("[data-free-quota]"), { timeout: 15000 }); await new Promise((r) => setTimeout(r, 300));
      await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
      await page.mouse.move(1, 1); await page.screenshot({ path: path.join(outDir, `${scheme}-${name}-empty.png`) });
      await page.type("#assistant-prompt", "Quanto hanno speso i Comuni in Calabria nel 2025? E dove posso approfondire sul sito?");
      await page.keyboard.press("Enter");
      const consent = await page.waitForSelector("dialog[open]", { timeout: 4000 }).catch(() => null);
      if (consent) {
        await page.mouse.move(1, 1); await page.screenshot({ path: path.join(outDir, `${scheme}-${name}-consent.png`) });
        await page.click("dialog[open] [class*=providerSave]");
      }
      await page.waitForFunction(() => document.querySelector("[data-assistant-reply] [data-site-links]") && !document.querySelector('button[aria-label="Interrompi ricerca"]'), { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => { const s = document.querySelector('[role="log"]'); const t = s?.querySelector("[data-assistant-reply]")?.parentElement; if (s && t) s.scrollTop = t.offsetTop - 16; });
      await page.evaluate(() => document.querySelector("nextjs-portal")?.remove());
      await page.mouse.move(1, 1); await page.screenshot({ path: path.join(outDir, `${scheme}-${name}-answer.png`) });
      // Full reply: expand the scroller so the whole conversation is visible.
      await page.evaluate(() => { const s = document.querySelector('[role="log"]'); if (s) s.scrollTop = s.scrollHeight; });
      await new Promise((r) => setTimeout(r, 200));
      await page.mouse.move(1, 1); await page.screenshot({ path: path.join(outDir, `${scheme}-${name}-answer-bottom.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) errors.push(`${scheme}-${name}: horizontal overflow ${overflow}px`);
      await page.close();
    }
  }
} finally { await closeBrowser(browser); }
console.log(errors.length ? errors.join("\n") : "no errors");
