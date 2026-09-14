import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

const root = resolve(import.meta.dirname, "../..");
const input = await readFile(resolve(root, "src/content/reports/state-budget-2025.json"));
const report = JSON.parse(input);
const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const paragraphs = (texts) => texts.map((text) => `<p>${escape(text)}</p>`).join("");
const sourceNumbers = new Map(report.sources.map((source, index) => [source.id, index + 1]));
const html = `<!doctype html><html lang="it"><meta charset="utf-8">
<title>${escape(report.title)}</title><style>
@page { size: A4; margin: 20mm 19mm 22mm; }
body { color: #000; background: #fff; font: 10.5pt/1.55 Arial, sans-serif; }
h1 { font-size: 27pt; line-height: 1.15; margin: 12pt 0; }
h2 { font-size: 16pt; line-height: 1.25; margin: 22pt 0 8pt; break-after: avoid; }
h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
p { margin: 7pt 0; orphans: 3; widows: 3; break-inside: avoid; }
a { color: #000; overflow-wrap: anywhere; }
.meta { font-size: 9pt; }
.lead { font-size: 12pt; }
.proof { break-inside: avoid; font-size: 9pt; border-left: 1px solid #777; padding-left: 9pt; }
.sources { font-size: 8.5pt; }
.sources li { margin: 10pt 0; break-inside: avoid; }
.section { break-before: auto; }
#affidamenti, .section.sources { break-before: page; }
.label { font-size: 9pt; margin-bottom: 0; break-after: avoid; }
.label + h2 { margin-top: 3pt; }
dt { font-weight: bold; break-after: avoid; margin-top: 12pt; }
dd { margin: 0; }
</style><body>
<p class="meta">DoveVannoINostriSoldi · Analisi del 14 settembre 2026</p>
<h1>${escape(report.title)}</h1><p class="lead">${escape(report.summary)}</p>
${paragraphs(report.introduction)}
<h2>Indice</h2><ol>${report.cases.map((item) => `<li><a href="#${escape(item.id)}">${escape(item.title)}</a></li>`).join("")}</ol>
<section style="break-before:page"><h2>Come leggere importi e risultati</h2>${paragraphs(report.readingGuide)}
</section>
${report.cases.map((item, index) => `<section id="${escape(item.id)}">
<p class="label">${index + 1}. ${escape(item.label)}</p><h2>${escape(item.title)}</h2>
<p><b>${escape(item.summary)}</b></p>${paragraphs(item.paragraphs)}
<div class="proof"><p>${escape(item.record)}</p><p>${escape(item.calculation)}</p>
<p>Fonti: ${item.sourceIds.map((id) => `<a href="#source-${escape(id)}">[${sourceNumbers.get(id)}]</a>`).join(", ")}.</p></div>
<p><b>Da verificare.</b> ${escape(item.nextStep)}</p></section>`).join("")}
<h2>Altre verifiche</h2>${report.controls.map((item) => `<p>${escape(item.text)} Fonti: ${item.sourceIds.map((id) => `<a href="#source-${escape(id)}">[${sourceNumbers.get(id)}]</a>`).join(", ")}.</p>`).join("")}
<section class="section"><h2>Copertura e metodo</h2><dl>${report.coverage.map((item) => `<dt>${escape(item.area)}</dt><dd>${paragraphs([item.checked, item.limit])}</dd>`).join("")}</dl>
${paragraphs(report.method)}</section>
<section class="section sources"><h2>Fonti</h2><ol>${report.sources.map((source) => `<li id="source-${escape(source.id)}"><b>${escape(source.publisher)}: ${escape(source.title)}</b><br>${escape(source.locator)}<br><a href="${escape(source.url)}">${escape(source.url)}</a></li>`).join("")}</ol>
<p>Calcoli e ricevute, versione congelata delle prove:<br><a href="${escape(report.evidenceUrl)}">${escape(report.evidenceUrl)}</a></p>
<p>SHA-256 del contenuto: ${createHash("sha256").update(input).digest("hex")}</p></section></body></html>`;

const destination = resolve(root, "public/report/bilancio-stato-2025.pdf");
await mkdir(resolve(root, "public/report"), { recursive: true });
const engine = process.argv[2] ?? "chromium";
if (!["chromium", "weasyprint"].includes(engine)) throw new Error("Engine: chromium | weasyprint");
if (engine === "weasyprint") {
  // Optional offline fallback for environments that cannot start Chromium.
  // It consumes exactly the same HTML and manuscript as the default renderer.
  const footer = '<style>@page { @bottom-center { content: "DVNS · Bilancio dello Stato 2025 · " counter(page) " / " counter(pages); font: 8pt Arial, sans-serif; color: #000; } }</style>';
  execFileSync(process.env.PYTHON ?? "python3", ["-c", `
import sys
from weasyprint import HTML
def offline_fetcher(url, **kwargs):
    raise ValueError("Network and external resources are disabled: " + url)
HTML(string=sys.stdin.read(), url_fetcher=offline_fetcher).write_pdf(sys.argv[1], pdf_variant="pdf/ua-1")
`, destination], { input: html.replace("</style>", `</style>${footer}`), stdio: ["pipe", "inherit", "inherit"] });
} else {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => request.abort());
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: destination, preferCSSPageSize: true, tagged: true,
      displayHeaderFooter: true, headerTemplate: "<span></span>",
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#000">DVNS · Bilancio dello Stato 2025 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
}
const pdf = await readFile(destination);
await writeFile(resolve(root, "docs/research/state-budget-2025/pdf-receipt.json"), `${JSON.stringify({
  manuscriptSha256: createHash("sha256").update(input).digest("hex"),
  pdfSha256: createHash("sha256").update(pdf).digest("hex"),
  pdfBytes: pdf.length,
}, null, 2)}\n`);
console.log(destination);
