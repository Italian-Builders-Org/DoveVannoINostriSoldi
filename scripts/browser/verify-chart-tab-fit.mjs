import { mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const baseUrl = process.env.DVNS_BASE_URL ?? "http://127.0.0.1:4321";
const outDir = "/opt/cursor/artifacts";
mkdirSync(outDir, { recursive: true });

const paths = ["/governi/meloni-i", "/governi"];
const widths = [390, 768, 1024, 1280];
const themes = ["light", "dark"];

function summarize(results) {
  for (const row of results) {
    console.log(JSON.stringify(row));
  }
  const failed = results.filter((row) => !row.ok);
  if (failed.length > 0) {
    console.error(`chart tab fit: ${failed.length} failing checks`);
    process.exitCode = 1;
    return;
  }
  console.log(`chart tab fit: all ${results.length} checks passed`);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const results = [];

for (const pathname of paths) {
  for (const width of widths) {
    for (const theme of themes) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle0", timeout: 120000 });
      await page.evaluate(() => document.querySelector("#grafici")?.scrollIntoView({ block: "start" }));
      await page.waitForSelector('[aria-label="Scegli un indicatore"]');

      const check = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const labels = [...document.querySelectorAll('[aria-label="Scegli un indicatore"] button')].map((button) => {
          const span = button.querySelector("span");
          if (!span || span.getClientRects().length === 0) {
            return { visible: false, label: span?.textContent?.trim() ?? "" };
          }
          const spanRect = span.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          const labelShown = span.clientWidth > 2 && spanRect.width > 2 && spanRect.height > 2;
          const spanFits = !labelShown || span.scrollWidth <= span.clientWidth + 1;
          const withinButton = !labelShown || (
            spanRect.left >= buttonRect.left - 1
            && spanRect.right <= buttonRect.right + 1
            && spanRect.top >= buttonRect.top - 1
            && spanRect.bottom <= buttonRect.bottom + 1
          );
          return {
            visible: true,
            label: span.textContent?.trim() ?? "",
            spanScrollWidth: span.scrollWidth,
            spanClientWidth: span.clientWidth,
            spanFits,
            withinButton,
          };
        });
        const visible = labels.filter((label) => label.visible);
        const badLabels = visible.filter((label) => !label.spanFits || !label.withinButton);
        return { docOverflow, visibleCount: visible.length, badLabels, labels: visible };
      });

      if ([768, 1024, 1280].includes(width) && theme === "light" && pathname === "/governi/meloni-i") {
        const tabs = await page.$('[aria-label="Scegli un indicatore"]');
        if (tabs) {
          await tabs.screenshot({
            path: join(outDir, `chart_tabs_fit_${width}_${theme}.png`),
          });
        }
      }

      const ok = !check.docOverflow && check.badLabels.length === 0;
      const labelMetrics = check.labels
        .filter((label) => label.visible && label.spanClientWidth > 2)
        .map((label) => ({
          label: label.label,
          spanScrollWidth: label.spanScrollWidth,
          spanClientWidth: label.spanClientWidth,
        }));
      results.push({
        pathname,
        width,
        theme,
        ok,
        docOverflow: check.docOverflow,
        visibleTabCount: check.visibleCount,
        badLabels: check.badLabels,
        labelMetrics,
      });
      await page.close();
    }
  }
}

await browser.close();
summarize(results);