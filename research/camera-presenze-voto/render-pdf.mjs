#!/usr/bin/env node
/**
 * Render the frozen Camera attendance study to a versioned PDF (public + research).
 * Uses system Chrome headless print-to-pdf (Puppeteer launch can hang on some hosts).
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrowserExecutable } from "../../scripts/browser/harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const capsulePath = path.join(root, "src/content/studies/camera-presenze.json");
const capsule = JSON.parse(readFileSync(capsulePath, "utf8"));

function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pct(n) {
  return `${Number(n).toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

const bins = capsule.bins.filter((bin) => bin.count > 0);
const maxBin = Math.max(...bins.map((bin) => bin.count));
const groups = [...capsule.groups].sort((a, b) => b.median - a.median || b.count - a.count);

const binBars = bins
  .map((bin) => {
    const width = Math.max(2, (bin.count / maxBin) * 100);
    return `<div class="row"><span class="lab">${esc(bin.label)}</span><span class="track"><span style="width:${width}%"></span></span><span class="val">${bin.count}</span></div>`;
  })
  .join("");

const groupBars = groups
  .map((group) => {
    const width = Math.max(2, (group.median / 100) * 100);
    return `<div class="row"><span class="lab long">${esc(group.groupLabel)}</span><span class="track"><span style="width:${width}%"></span></span><span class="val">${pct(group.median)}</span></div>`;
  })
  .join("");

const groupRows = groups
  .map(
    (group) =>
      `<tr><td>${esc(group.groupLabel)}</td><td>${group.count}</td><td>${pct(group.median)}</td><td>${pct(group.mean)}</td><td>${pct(group.p25)}</td><td>${pct(group.p75)}</td></tr>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>${esc(capsule.title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font: 11pt/1.45 Helvetica, Arial, sans-serif; color: #1a1a1a; }
  h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 6px; letter-spacing: -0.02em; }
  h2 { font-size: 13pt; margin: 18px 0 8px; }
  .meta, .note, figcaption { font-size: 9.5pt; color: #444; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; padding: 10px 0; border-block: 1px solid #ccc; }
  .stats span { display: block; font-size: 9pt; color: #555; }
  .stats strong { font-size: 18pt; font-variant-numeric: tabular-nums; }
  .row { display: grid; grid-template-columns: 70px 1fr 42px; gap: 8px; align-items: center; margin: 4px 0; }
  .row .lab.long { font-size: 8.5pt; }
  .track { height: 9px; background: #eee; border-radius: 2px; overflow: hidden; }
  .track > span { display: block; height: 100%; background: #ec3013; }
  .val { text-align: right; font-variant-numeric: tabular-nums; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 8px; }
  th, td { border-bottom: 1px solid #ddd; padding: 5px 4px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  ul { padding-left: 1.1rem; margin: 6px 0; }
</style>
</head>
<body>
  <p class="meta">${esc(capsule.series)} · Versione ${esc(capsule.version)}</p>
  <h1>${esc(capsule.title)}</h1>
  <p>${esc(capsule.subtitle)}</p>
  <p class="meta">DoveVannoINostriSoldi · ${esc(capsule.publishedOn)} · Fonte rilevata ${esc(capsule.period.observedDate)}</p>
  <p class="note"><strong>Cosa misura.</strong> Partecipazione alle votazioni elettroniche in Aula (voto espresso o missione). Non misura presenza fisica continua né il lavoro in commissione. Il Senato non pubblica una tabella equivalente.</p>
  <div class="stats">
    <div><span>Deputati in distribuzione</span><strong>${capsule.headline.matchedDeputies}</strong></div>
    <div><span>Mediana</span><strong>${pct(capsule.headline.median)}</strong></div>
    <div><span>Banda 10°-90°</span><strong>${pct(capsule.headline.p10)}-${pct(capsule.headline.p90)}</strong></div>
  </div>
  <h2>Fasce di presenza</h2>
  <p>Media ${pct(capsule.headline.mean)}. Sotto il 10° percentile (${pct(capsule.headline.p10)}) ci sono ${capsule.headline.tailBelowP10} deputati.</p>
  <figure>${binBars}<figcaption>Fasce del 5%. Fonte: Camera dei deputati, partecipazione al voto.</figcaption></figure>
  <h2>Gruppi parlamentari</h2>
  <p>Mediana per gruppo (almeno 3 deputati abbinati).</p>
  <figure>${groupBars}</figure>
  <table>
    <thead><tr><th>Gruppo</th><th>n</th><th>Mediana</th><th>Media</th><th>P25</th><th>P75</th></tr></thead>
    <tbody>${groupRows}</tbody>
  </table>
  <h2>Limiti</h2>
  <ul>${capsule.caveats.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
  <p class="meta">Periodo: ${esc(capsule.period.label)}. URL fonte: ${esc(capsule.source.pageUrl)}</p>
</body>
</html>`;

const versionDir = path.join(root, `public/studi/presenze-camera/v${capsule.version}`);
const researchPaperDir = path.join(root, "research/camera-presenze-voto/paper");
mkdirSync(versionDir, { recursive: true });
mkdirSync(researchPaperDir, { recursive: true });

const htmlPath = path.join(researchPaperDir, "presenze-camera.html");
const pdfPath = path.join(versionDir, "presenze-camera.pdf");
writeFileSync(htmlPath, html);

const chrome = resolveBrowserExecutable();
if (!chrome) throw new Error("Chrome/Chromium non trovato per il render PDF");
const result = spawnSync(
  chrome,
  ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`],
  { encoding: "utf8", timeout: 60_000 },
);
if (result.status !== 0 || !existsSync(pdfPath)) {
  throw new Error(`render PDF fallito: ${result.stderr || result.stdout || result.status}`);
}

const bytes = readFileSync(pdfPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
copyFileSync(pdfPath, path.join(researchPaperDir, "presenze-camera.pdf"));
capsule.assets["presenze-camera.pdf"] = { bytes: bytes.length, sha256 };
writeFileSync(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`);
console.log(JSON.stringify({ pdfPath, bytes: bytes.length, sha256 }, null, 2));
