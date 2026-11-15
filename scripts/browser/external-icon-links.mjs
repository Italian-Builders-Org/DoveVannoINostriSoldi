import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_URL, SOCIAL_LINKS } from "../../src/lib/site.ts";
import { defaultArtifactsDir, runScenario } from "./harness.mjs";

/** Exercise the actual anchors; third-party page availability is not part of our UI contract. */
export async function verifyExternalIconLinks(browser, baseUrl) {
  const output = path.join(defaultArtifactsDir(), "external-icon-links");
  mkdirSync(output, { recursive: true });
  const report = { revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), checks: [] };
  const links = [
    { selector: `.header-actions a[href="${REPO_URL}"]`, href: REPO_URL, label: "GitHub header" },
    ...SOCIAL_LINKS.map((social) => ({ selector: `.footer-social a[href="${social.href}"]`, href: social.href, label: social.label })),
    { selector: `.footer-actions a[href="${REPO_URL}"]`, href: REPO_URL, label: "GitHub footer" },
  ];
  try {
    for (const route of ["/", "/supporto"]) for (const width of [390, 1280]) {
      const id = `${route === "/" ? "home" : "supporto"}-${width}`;
      await runScenario(browser, {
        label: `Icone esterne ${id}`, pathname: route, width, touch: width === 390,
        baseUrl, suite: "external-icon-links", scenarioId: id,
        validate: async (page) => {
          const originalUrl = page.url();
          const originalTitle = await page.$eval("main h1", (node) => node.textContent);
          for (const link of links) {
            const attributes = await page.$eval(link.selector, (anchor) => ({
              href: anchor.href, target: anchor.target, rel: [...anchor.relList],
            }));
            assert.equal(attributes.href, link.href, `${link.label}: destinazione`);
            assert.equal(attributes.target, "_blank", `${link.label}: nuova scheda`);
            assert.ok(attributes.rel.includes("noopener") && attributes.rel.includes("noreferrer"), `${link.label}: protezione opener`);
            const control = await page.$(link.selector);
            await control.scrollIntoView();
            const previousTargets = new Set(browser.targets());
            const [target] = await Promise.all([
              browser.waitForTarget((candidate) => candidate.type() === "page" && !previousTargets.has(candidate), { timeout: 15_000 }),
              width === 390 ? control.tap() : control.click(),
            ]);
            const popup = await target.page();
            assert.ok(popup && popup !== page, `${link.label}: finestra distinta`);
            try {
              assert.equal(page.url(), originalUrl, `${link.label}: pagina originale conservata`);
              assert.equal(await page.$eval("main h1", (node) => node.textContent), originalTitle);
              await popup.waitForFunction(() => window.opener === null, { timeout: 10_000 });
              report.checks.push({ route, width, href: link.href, label: link.label, status: "PASS" });
            } finally {
              await popup.close();
              await page.bringToFront();
            }
          }
          // The external-link policy must not spread to the ordinary site menu/footer.
          const targetsBeforeInternalClick = new Set(browser.targets());
          await page.click('.footer-actions a[href="/metodologia"]');
          await page.waitForFunction(() => location.pathname === "/metodologia");
          assert.equal(new URL(page.url()).origin, baseUrl.origin);
          assert.ok(browser.targets().filter((target) => target.type() === "page").every((target) => targetsBeforeInternalClick.has(target)));
          await page.screenshot({ path: path.join(output, `${id}.png`) });
          report.checks.push({ route, width, href: "/metodologia", label: "Link interno nella stessa scheda", status: "PASS" });
        },
      });
    }
  } finally {
    writeFileSync(path.join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`PASS external-icon-links: ${report.checks.length} checks, actual clicks, mobile/desktop, home/supporto`);
}
