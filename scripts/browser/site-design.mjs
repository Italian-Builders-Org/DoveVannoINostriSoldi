import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_INDEXABLE_PATHS, PUBLIC_NOINDEX_PATHS } from "../../src/lib/public-discovery.ts";
import { closeBrowser, defaultBaseUrl, defaultArtifactsDir, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

// Route inventory is independent of browser availability. The browser pass
// tests every concrete catalog page and discovers a sample for each remaining
// public detail template. It never labels an unvisited template as passing.
const root = fileURLToPath(new URL("../../", import.meta.url));
const app = path.join(root, "src/app");
const output = path.join(defaultArtifactsDir(), "site-design");
mkdirSync(output, { recursive: true });
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}
const routePattern = file => "/" + path.relative(app, path.dirname(file)).split(path.sep).filter(part => part && !part.startsWith("(")).join("/");
const templates = files(app).filter(file => file.endsWith("/page.tsx")).map(file => {
  const pattern = routePattern(file);
  const internal = pattern.startsWith("/snapshot-pages/");
  const session = pattern.startsWith("/dashboard/") && pattern.includes("[") || pattern.startsWith("/condividi/");
  return { pattern, file: path.relative(root, file), dynamic: pattern.includes("["), scope: internal ? "internal-rewrite" : session ? "authenticated-or-shared-fixture" : "public", visited: [] };
}).sort((a, b) => Number(a.dynamic) - Number(b.dynamic) || b.pattern.length - a.pattern.length);
function matches(template, pathname) {
  const expression = template.pattern.split("/").map(segment => segment.startsWith("[") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
  return new RegExp(`^${expression}/?$`).test(pathname);
}
const candidates = new Set([
  ...PUBLIC_INDEXABLE_PATHS,
  ...PUBLIC_NOINDEX_PATHS.filter(route => !route.startsWith("/snapshot-pages/")),
  ...templates.filter(route => !route.dynamic && route.scope === "public").map(route => route.pattern),
]);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const report = { revision, dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()), command: process.argv.join(" "), browser: "NOT RUN", templates, checks: [], failures: [], limits: ["Authenticated boards and shared links need valid fixtures.", "Dynamic detail pages are sampled by template, not by every record or filter combination.", "Snapshot routes are internal rewrites of public pages, not separate navigation destinations."] };
function save() {
  writeFileSync(path.join(output, "coverage.json"), JSON.stringify(report, null, 2));
}
save();
if (process.argv.includes("--inventory")) {
  console.log(JSON.stringify({ templates: templates.length, publicTemplates: templates.filter(r => r.scope === "public").length, internalRewrites: templates.filter(r => r.scope === "internal-rewrite").length, fixtureRequired: templates.filter(r => r.scope === "authenticated-or-shared-fixture").length, concreteCandidates: candidates.size, browser: report.browser, report: path.join(output, "coverage.json") }));
} else {
  const base = defaultBaseUrl();
  assert.ok(!["dovevannoinostrisoldi.com", "www.dovevannoinostrisoldi.com"].includes(base.hostname), "Run this design review on a preview deployment, not production.");
  report.baseUrl = base.origin;
  await waitForServer(base);
  const browser = await launchBrowser();
  report.browser = "RUNNING";
  const queued = new Set(candidates);
  const queue = [...candidates];
  let sequence = 0;
  try {
    for (const route of queue) {
      const template = templates.find(entry => matches(entry, new URL(route, base).pathname));
      if (!template || template.scope !== "public") continue;
      for (const width of (process.env.DVNS_SITE_DESIGN_WIDTHS ?? "390,1280,1920").split(",").map(Number).filter(Boolean)) {
        const id = String(++sequence).padStart(4, "0");
        try {
          await runScenario(browser, {
            label: `${route} ${width}px`, pathname: route, width, baseUrl: base, suite: "site-design", scenarioId: id, readySelector: "h1",
            validate: async page => {
              assert.equal(new URL(page.url()).origin, base.origin, "Navigation escaped the preview");
              await page.waitForFunction(() => [...document.querySelectorAll("a[data-site-page-link]")].every(link => new URL(link.href).origin === location.origin));
              const state = await page.evaluate(() => {
                const immersive = Boolean(document.documentElement.dataset.immersive || document.querySelector("[data-immersive-page]"));
                const header = document.querySelector(".header-inner");
                const main = document.querySelector("main.shell");
                const footer = document.querySelector(".site-footer");
                const box = node => node?.getBoundingClientRect().toJSON();
                const internal = [...document.querySelectorAll("a[href]")].map(link => ({ href: link.href, target: link.target, label: link.textContent.trim() }));
                return { immersive, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, header: box(header), main: box(main), footer: box(footer), links: internal, oldSidebar: Boolean(document.querySelector(".desktop-sidebar")), duplicateDirectory: Boolean(document.querySelector(".footer-sitemap")), github: document.querySelectorAll('.header-inner a[href="https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi"]').length };
              });
              assert.ok(state.scrollWidth <= state.width + 1, "Horizontal page overflow");
              assert.equal(state.oldSidebar, false, "Old fixed sidebar remains");
              assert.equal(state.duplicateDirectory, false, "Duplicate footer sitemap remains");
              if (!state.immersive) {
                assert.ok(state.header && state.footer, "Missing shared header/footer");
                assert.equal(state.github, 1, "Missing or duplicate GitHub control");
                for (const box of [state.main, state.footer].filter(Boolean)) {
                  assert.ok(Math.abs(box.left - state.header.left) < 2 && Math.abs(box.right - state.header.right) < 2, "Page/header/footer widths differ");
                }
                await page.click(".mobile-menu-trigger");
                await page.waitForSelector("#mobile-navigation:modal .primary-nav");
                const menuLinks = await page.$$eval("#mobile-navigation a[href]", links => links.map(link => ({ href: link.href, target: link.target, label: link.textContent.trim() })));
                state.links.push(...menuLinks);
                await page.keyboard.press("Escape");
                assert.equal(await page.$eval(".mobile-menu-trigger", button => document.activeElement === button), true, "Menu does not restore keyboard focus");
              }
              for (const link of state.links) {
                const url = new URL(link.href);
                const liveHost = ["dovevannoinostrisoldi.com", "www.dovevannoinostrisoldi.com"].includes(url.hostname);
                if (liveHost && !url.pathname.startsWith("/api/")) assert.fail(`Link escapes to production: ${link.label} → ${url.href}`);
                if (url.origin !== base.origin) continue;
                assert.notEqual(link.target, "_blank", `Internal link opens a new tab: ${url.pathname}`);
                const next = templates.find(entry => matches(entry, url.pathname));
                if (next?.scope === "public" && next.dynamic && next.visited.length === 0 && !queue.some(candidate => matches(next, new URL(candidate, base).pathname))) {
                  const href = url.pathname + url.search;
                  if (!queued.has(href)) { queued.add(href); queue.push(href); }
                }
              }
              for (const theme of ["light", "dark"]) {
                await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
                const colors = await page.evaluate(() => {
                  const css = getComputedStyle(document.documentElement);
                  const canvas = document.createElement("canvas").getContext("2d");
                  function luminance(color) {
                    canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
                    const channels = [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
                    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
                  }
                  const text = [...document.querySelectorAll("h1, h2, .panel-title, .page-intro p, .header-inner a, .site-footer a")].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden").map(node => {
                    const style = getComputedStyle(node);
                    let background = css.getPropertyValue("--color-bg");
                    for (let parent = node; parent; parent = parent.parentElement) {
                      const color = getComputedStyle(parent).backgroundColor;
                      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") { background = color; break; }
                    }
                    const values = [luminance(style.color), luminance(background)].sort((a, b) => b - a);
                    const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight, 10) >= 700;
                    return { label: node.textContent.trim().slice(0, 100), ratio: (values[0] + .05) / (values[1] + .05), minimum: large ? 3 : 4.5 };
                  });
                  return { background: css.getPropertyValue("--color-bg").trim(), text };
                });
                assert.ok(colors.background && colors.text.length, "Missing shared palette or visible text");
                for (const sample of colors.text) assert.ok(sample.ratio >= sample.minimum, `${theme}: contrast ${sample.ratio.toFixed(2)} for ${sample.label}`);
                await page.screenshot({ path: path.join(output, `${id}-${theme}.png`), fullPage: true });
              }
            },
          });
          template.visited.push({ route, width });
          report.checks.push({ route, width, status: "PASS" });
        } catch (error) {
          report.failures.push({ route, width, message: error.message });
        }
        save();
      }
    }
    for (const route of ["/supporto", "/metodologia", "/privacy", "/termini", "/fonti", "/supporter"]) {
      try {
        await runScenario(browser, {
          label: `Footer → ${route}`, pathname: "/", width: 1280, baseUrl: base, suite: "site-design",
          validate: async page => {
            const tabs = (await browser.pages()).length;
            await page.click(`.site-footer a[href="${route}"]`);
            await page.waitForFunction(expected => location.pathname === expected, {}, route);
            assert.equal(new URL(page.url()).origin, base.origin);
            assert.equal((await browser.pages()).length, tabs);
            await page.waitForSelector(".header-inner .mobile-menu-trigger");
          },
        });
        report.checks.push({ route, flow: "footer", status: "PASS" });
      } catch (error) { report.failures.push({ route, flow: "footer", message: error.message }); }
    }
  } finally {
    await closeBrowser(browser);
    report.unvisited = templates.filter(route => route.scope === "public" && route.visited.length === 0).map(route => route.pattern);
    report.browser = report.failures.length || report.unvisited.length ? "INCOMPLETE" : "PASS (public templates only)";
    save();
  }
  assert.equal(report.failures.length, 0, "Design regressions: see coverage.json and screenshots");
  assert.equal(report.unvisited.length, 0, "Unvisited public templates: add real linked fixtures before claiming coverage");
}
