#!/usr/bin/env node
/**
 * Render the frozen Camera attendance study (v2) to a versioned PDF.
 * Every figure is an inline SVG drawn from the capsule: no network, no client JS.
 * Uses Chrome headless print-to-pdf; CSS @page margin boxes carry the running footer.
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
const { deputies } = JSON.parse(readFileSync(path.join(root, "src/content/studies/camera-presenze-deputati.json"), "utf8"));

const ACCENT = "#ec3013";
const DARK = "#444141";
const GREY = "#9b9797";
const LIGHT = "#e4e1e1";
const RULE = "#d9d6d6";

const esc = (text) =>
  String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const pct = (n, digits = 1) =>
  `${Number(n).toLocaleString("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
const num = (n) => Number(n).toLocaleString("it-IT");
const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" });
const longDate = (iso) => date.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

const h = capsule.headline;
const a = h.aggregate;
const groups = capsule.groups;
const blocs = capsule.blocs;
const roles = capsule.profiles.roles;
const [govRole, presidencyRole, otherRole] = roles;
const majority = blocs.find((b) => b.key === "maggioranza");
const opposition = blocs.find((b) => b.key === "opposizione");
const [women, men] = capsule.profiles.gender;
const foreign = capsule.profiles.elected.find((p) => p.label === "Circoscrizione Estero");
const majorityGroups = groups.filter((g) => g.bloc === "maggioranza");
const pd = groups.find((g) => g.short === "PD");
// Rankings name individuals: deceased deputies stay in the appendix only.
const fullTerm = deputies.filter((d) => d.votable === h.totalVotes && !d.deceased);
const lowest = [...fullTerm].sort((x, y) => x.presence - y.presence).slice(0, 10);
const mostVotes = [...fullTerm].sort((x, y) => y.votes - x.votes || x.name.localeCompare(y.name, "it")).slice(0, 10);
const government = deputies.filter((d) => d.government).sort((x, y) => x.votes - y.votes);

/* ---------- SVG figures ---------- */

function histogramSvg(width = 640, height = 250) {
  const pad = { l: 34, r: 8, t: 26, b: 30 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = Math.max(...capsule.presenceBins.map((b) => b.count), ...capsule.votesBins.map((b) => b.count));
  const top = Math.ceil(max / 20) * 20;
  const slot = iw / capsule.presenceBins.length;
  const bw = slot * 0.4;
  let out = "";
  for (let v = 0; v <= top; v += 20) {
    const y = pad.t + ih - (v / top) * ih;
    out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}" stroke="${RULE}" stroke-width="0.6"/>`;
    out += `<text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" class="tick">${v}</text>`;
  }
  capsule.presenceBins.forEach((bin, i) => {
    const x = pad.l + i * slot + slot * 0.1;
    const hp = (bin.count / top) * ih;
    const hv = (capsule.votesBins[i].count / top) * ih;
    out += `<rect x="${x}" y="${pad.t + ih - hp}" width="${bw}" height="${hp}" fill="${GREY}"/>`;
    out += `<rect x="${x + bw}" y="${pad.t + ih - hv}" width="${bw}" height="${hv}" fill="${ACCENT}"/>`;
    if (i % 2 === 0) out += `<text x="${pad.l + i * slot}" y="${height - 12}" text-anchor="middle" class="tick">${bin.from}%</text>`;
  });
  out += `<text x="${width - pad.r}" y="${height - 12}" text-anchor="end" class="tick">100%</text>`;
  out += legend([["Presenza ufficiale", GREY], ["Voti espressi", ACCENT]], pad.l, 12);
  out += `<text x="${pad.l}" y="${height}" class="axis">Deputati per fascia di 5 punti percentuali</text>`;
  return `<svg viewBox="0 0 ${width} ${height + 4}" width="100%" role="img" aria-label="Istogramma presenza e voti espressi">${out}</svg>`;
}

function legend(items, x, y) {
  let cx = x;
  return items
    .map(([label, color]) => {
      const item = `<rect x="${cx}" y="${y - 8}" width="9" height="9" fill="${color}"/><text x="${cx + 13}" y="${y}" class="legend">${esc(label)}</text>`;
      cx += 22 + label.length * 5.4;
      return item;
    })
    .join("");
}

function scatterSvg(width = 640, height = 330) {
  const pad = { l: 40, r: 12, t: 26, b: 34 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const sx = (v) => pad.l + (v / 100) * iw;
  const sy = (v) => pad.t + ih - (v / 100) * ih;
  let out = "";
  for (let v = 0; v <= 100; v += 25) {
    out += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${pad.t}" y2="${pad.t + ih}" stroke="${RULE}" stroke-width="0.6"/>`;
    out += `<line x1="${pad.l}" x2="${pad.l + iw}" y1="${sy(v)}" y2="${sy(v)}" stroke="${RULE}" stroke-width="0.6"/>`;
    out += `<text x="${sx(v)}" y="${pad.t + ih + 13}" text-anchor="middle" class="tick">${v}%</text>`;
    out += `<text x="${pad.l - 6}" y="${sy(v) + 3}" text-anchor="end" class="tick">${v}%</text>`;
  }
  // Anyone on this line has no absences: votes + missions = 100.
  out += `<line x1="${sx(0)}" y1="${sy(100)}" x2="${sx(100)}" y2="${sy(0)}" stroke="${GREY}" stroke-dasharray="3 3" stroke-width="0.8"/>`;
  const dot = (d, color, r, opacity = 1) => `<circle cx="${sx(d.missions).toFixed(1)}" cy="${sy(d.votes).toFixed(1)}" r="${r}" fill="${color}" fill-opacity="${opacity}"/>`;
  out += deputies.filter((d) => !d.government && !d.role).map((d) => dot(d, GREY, 2.2, 0.55)).join("");
  out += deputies.filter((d) => !d.government && d.role).map((d) => dot(d, DARK, 2.8)).join("");
  out += deputies.filter((d) => d.government).map((d) => dot(d, ACCENT, 3)).join("");
  out += `<text x="${sx(14)}" y="${sy(90)}" class="note-svg">nessuna assenza</text>`;
  out += legend([["Altri deputati", GREY], ["Ufficio di Presidenza", DARK], ["Membri del Governo", ACCENT]], pad.l, 12);
  out += `<text x="${pad.l + iw / 2}" y="${height - 2}" text-anchor="middle" class="axis">Missioni, % delle votazioni</text>`;
  out += `<text transform="translate(11 ${pad.t + ih / 2}) rotate(-90)" text-anchor="middle" class="axis">Voti espressi, %</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Missioni e voti espressi per deputato">${out}</svg>`;
}

function stackSvg(rows, { width = 640, labelWidth = 150, bar = 16, gap = 9 } = {}) {
  const pad = { t: 24, b: 22, r: 44 };
  const iw = width - labelWidth - pad.r;
  const height = pad.t + rows.length * (bar + gap) + pad.b;
  let out = legend([["Voti espressi", ACCENT], ["Missioni", DARK], ["Assenze", LIGHT]], labelWidth, 12);
  rows.forEach((row, i) => {
    const y = pad.t + i * (bar + gap);
    const total = row.meanVotes + row.meanMissions + row.meanAbsences;
    const w1 = (row.meanVotes / total) * iw;
    const w2 = (row.meanMissions / total) * iw;
    const w3 = iw - w1 - w2;
    out += `<text x="${labelWidth - 8}" y="${y + bar * 0.72}" text-anchor="end" class="label">${esc(row.label)} <tspan class="muted">(${row.count})</tspan></text>`;
    out += `<rect x="${labelWidth}" y="${y}" width="${w1}" height="${bar}" fill="${ACCENT}"/>`;
    out += `<rect x="${labelWidth + w1}" y="${y}" width="${w2}" height="${bar}" fill="${DARK}"/>`;
    out += `<rect x="${labelWidth + w1 + w2}" y="${y}" width="${w3}" height="${bar}" fill="${LIGHT}"/>`;
    if (w1 > 30) out += `<text x="${labelWidth + 4}" y="${y + bar * 0.72}" class="inbar">${pct(row.meanVotes, 0)}</text>`;
    if (w2 > 30) out += `<text x="${labelWidth + w1 + 4}" y="${y + bar * 0.72}" class="inbar">${pct(row.meanMissions, 0)}</text>`;
    out += `<text x="${width - pad.r + 6}" y="${y + bar * 0.72}" class="value">${pct(row.presence, 0)}</text>`;
  });
  out += `<text x="${width - pad.r + 6}" y="${pad.t - 6}" class="tick">pres.</text>`;
  out += `<text x="${labelWidth}" y="${height - 4}" class="axis">Media delle quote dei deputati; a destra la presenza ufficiale mediana</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img">${out}</svg>`;
}

/** One bar for the whole chamber: every seat in every electronic vote. */
function splitSvg(width = 640) {
  const parts = [
    ["Voti espressi", a.votesShare, ACCENT, "#fff"],
    ["Missioni", a.missionsShare, DARK, "#fff"],
    ["Assenze", a.absencesShare, LIGHT, "#222"],
  ];
  const total = parts.reduce((n, p) => n + p[1], 0);
  let x = 0;
  const slots = deputies.reduce((n, d) => n + d.votable, 0);
  let out = `<text x="0" y="10" class="legend">Su ${num(slots)} voti possibili (ogni deputato per ogni votazione del suo mandato):</text>`;
  for (const [label, value, fill, ink] of parts) {
    const w = (value / total) * width;
    out += `<rect x="${x}" y="18" width="${w}" height="34" fill="${fill}"/>`;
    out += `<text x="${x + 6}" y="33" style="font-size:11px;font-weight:650" fill="${ink}">${pct(value)}</text>`;
    out += `<text x="${x + 6}" y="46" style="font-size:8px" fill="${ink}">${label}</text>`;
    x += w;
  }
  return `<svg viewBox="0 0 ${width} 56" width="100%" role="img" aria-label="Quota di voti espressi, missioni e assenze sul totale">${out}</svg>`;
}

/* ---------- tables ---------- */

/** The first `text` columns are left-aligned labels, the rest are numbers. */
function table(head, rows, cls = "", text = 1) {
  const attr = (i) => (i >= text ? ' class="n"' : "");
  return `<table class="${cls}"><thead><tr>${head.map((c, i) => `<th${attr(i)}>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${attr(i)}>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

const deputyRows = (list) => list.map((d) => [esc(d.name), esc(d.group), pct(d.presence), pct(d.votes), pct(d.missions)]);

// The freeze keeps the Camera's own order (surname first), so no re-sorting here.
const appendixRows = deputies.map((d) => [
    `${esc(d.name)}${d.government ? '<sup>G</sup>' : d.role ? '<sup>P</sup>' : ""}${d.votable < h.totalVotes ? "<sup>*</sup>" : ""}${d.deceased ? "<sup>†</sup>" : ""}`,
    esc(d.group),
    pct(d.presence),
    pct(d.votes),
    pct(d.missions),
    pct(d.absences),
    pct(d.justified),
  ]);

/* ---------- document ---------- */

const css = `
  @page { size: A4; margin: 20mm 18mm 22mm;
    @bottom-left { content: "DoveVannoINostriSoldi · Presenze al voto alla Camera · v${capsule.version}"; font: 7.5pt Inter, Helvetica, sans-serif; color: #8a8686; }
    @bottom-right { content: counter(page) " / " counter(pages); font: 7.5pt Inter, Helvetica, sans-serif; color: #8a8686; }
  }
  @page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 9.6pt/1.6 Inter, Helvetica, Arial, sans-serif; color: #1d1b1b; hyphens: auto; }
  h1, h2, h3, .sans, table, figcaption, .kicker, .stat, .box, .toc { font-family: Inter, Helvetica, Arial, sans-serif; }
  h2 { font-size: 15pt; letter-spacing: -0.01em; margin: 0 0 8pt; padding-top: 4pt; break-after: avoid; }
  h2 .num { color: ${ACCENT}; margin-right: 6pt; }
  h3 { font-size: 10.5pt; margin: 14pt 0 6pt; break-after: avoid; }
  p { margin: 0 0 8pt; text-align: justify; orphans: 3; widows: 3; }
  a { color: inherit; }
  section { margin-bottom: 16pt; }
  section.break { break-before: page; }
  figure { margin: 10pt 0 12pt; break-inside: avoid; }
  figcaption { font-size: 8pt; color: #5c5858; margin-top: 4pt; line-height: 1.45; }
  svg text { font-family: Inter, Helvetica, sans-serif; }
  svg .tick { font-size: 8px; fill: #6d6969; }
  svg .axis { font-size: 8px; fill: #5c5858; }
  svg .legend { font-size: 8.5px; fill: #333; }
  svg .label { font-size: 8.5px; fill: #222; }
  svg .muted { fill: #8a8686; }
  svg .inbar { font-size: 7.5px; fill: #fff; font-weight: 600; }
  svg .value { font-size: 8px; fill: #222; font-weight: 600; }
  svg .note-svg { font-size: 7.5px; fill: #6d6969; font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; font-variant-numeric: tabular-nums; margin: 6pt 0 12pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { text-align: left; font-weight: 600; border-bottom: 1px solid #1d1b1b; padding: 3pt 4pt; }
  td { border-bottom: 0.5pt solid ${RULE}; padding: 2.6pt 4pt; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  table.dense { font-size: 7pt; }
  table.dense td { padding: 1.6pt 3pt; }
  sup { font-size: 5.5pt; color: ${ACCENT}; margin-left: 1pt; }
  .box { border-left: 3pt solid ${ACCENT}; background: #faf6f5; padding: 8pt 11pt; margin: 10pt 0 14pt; font-size: 9pt; line-height: 1.5; break-inside: avoid; }
  .box p { text-align: left; margin-bottom: 4pt; }
  .box strong { display: block; margin-bottom: 3pt; font-size: 9.5pt; }
  ul { margin: 4pt 0 10pt; padding-left: 14pt; }
  li { margin-bottom: 4pt; }
  .findings li { margin-bottom: 6pt; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-block: 1pt solid #1d1b1b; margin: 0 0 14pt; }
  .stat { padding: 8pt 8pt 8pt 0; }
  .stat + .stat { padding-left: 10pt; border-left: 0.5pt solid ${RULE}; }
  .stat b { display: block; font-size: 19pt; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 7.6pt; color: #555; line-height: 1.3; display: block; }
  .cover { page: cover; height: 297mm; padding: 26mm 20mm 18mm; display: flex; flex-direction: column; background: #fff; }
  .cover .bar { height: 5pt; width: 64pt; background: ${ACCENT}; margin-bottom: 18pt; }
  .kicker { font-size: 8.5pt; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; color: #5c5858; }
  .cover h1 { font-size: 40pt; line-height: 1.02; letter-spacing: -0.035em; margin: 10pt 0 12pt; font-weight: 700; }
  .cover .sub { font: 400 14pt/1.35 Inter, Helvetica, sans-serif; color: #333; max-width: 140mm; margin-bottom: 18pt; }
  .cover .abstract { font-size: 10pt; line-height: 1.55; max-width: 150mm; text-align: left; }
  .cover .foot { margin-top: auto; font: 8pt/1.5 Inter, Helvetica, sans-serif; color: #5c5858; border-top: 0.5pt solid ${RULE}; padding-top: 8pt; display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; }
  .cover-fig { margin: 4pt 0 14pt; }
  .toc { font-size: 9pt; columns: 2; column-gap: 18pt; margin: 6pt 0 0; padding: 0; list-style: none; }
  .toc li { margin-bottom: 3pt; }
  .toc span { color: ${ACCENT}; font-weight: 600; margin-right: 4pt; }
  .small { font-size: 8.4pt; color: #444; }
  .appendix p { text-align: left; }
  code { font: 7pt "JetBrains Mono", monospace; word-break: break-all; }
`;

const findings = [
  `Dall'inizio della ${capsule.period.legislature} a ${capsule.period.monthLabel.toLowerCase()} la Camera ha svolto ${num(h.totalVotes)} votazioni elettroniche. Sul totale dei posti a disposizione i deputati hanno votato nel ${pct(a.votesShare)} dei casi, erano in missione nel ${pct(a.missionsShare)} e assenti nel ${pct(a.absencesShare)}.`,
  `La presenza ufficiale ha una mediana dell'${pct(h.presence.median)}. Contando solo i voti espressi la mediana scende al ${pct(h.votes.median)} e i deputati sotto il 50% passano da ${h.presenceBelow50} a ${h.votesBelow50}.`,
  `I ${h.governmentCount} deputati con un incarico di governo hanno una presenza mediana del ${pct(h.governmentMedianPresence)} e votano, in mediana, nel ${pct(h.governmentMedianVotes)} delle votazioni. Il resto della Camera vota nel ${pct(h.nonGovernmentMedianVotes)}.`,
  `Maggioranza e opposizione votano quasi nella stessa misura (${pct(majority.votes)} e ${pct(opposition.votes)} in mediana). La distanza sulla presenza ufficiale (${pct(majority.presence)} contro ${pct(opposition.presence)}) viene dalle missioni.`,
  `Le assenze sono concentrate: i ${h.lowestDecileCount} deputati con la presenza più bassa accumulano il ${pct(h.lowestDecileAbsenceShare)} di tutte le assenze. La Camera classifica come giustificate il ${pct(a.justifiedOfAbsences)} delle assenze.`,
];

const html = `<!doctype html>
<html lang="it">
<head><meta charset="utf-8" /><title>${esc(capsule.title)} · v${esc(capsule.version)}</title><style>${css}</style></head>
<body>

<div class="cover">
  <div class="bar"></div>
  <div class="kicker">${esc(capsule.series)} · Versione ${esc(capsule.version)} · ${esc(longDate(capsule.revisedAt))}</div>
  <h1>Presenze al voto<br/>alla Camera</h1>
  <div class="sub">${esc(capsule.subtitle)}</div>
  <div class="stats">
    <div class="stat"><b>${num(h.totalVotes)}</b><span>votazioni elettroniche in Aula</span></div>
    <div class="stat"><b>${pct(h.presence.median)}</b><span>presenza ufficiale, mediana</span></div>
    <div class="stat"><b>${pct(h.votes.median)}</b><span>voti espressi, mediana</span></div>
    <div class="stat"><b>${pct(h.governmentMedianVotes)}</b><span>voti espressi dai membri del Governo, mediana</span></div>
  </div>
  <p class="abstract">La Camera pubblica ogni mese, per ciascun deputato, quante volte ha votato, quante volte era in missione e quante era assente. La percentuale che circola come «presenza» somma voti e missioni. Questo quaderno separa le due voci sulla tabella ufficiale fino a ${esc(capsule.period.monthLabel.toLowerCase())} e mostra cosa cambia: per gruppo, tra maggioranza e opposizione, per chi ha un incarico di governo e deputato per deputato.</p>
  <figure class="cover-fig">${splitSvg()}</figure>
  <ul class="toc">
    <li><span>1</span>Presenza e voto</li>
    <li><span>2</span>Chi è in missione</li>
    <li><span>3</span>I gruppi parlamentari</li>
    <li><span>4</span>Maggioranza e opposizione</li>
    <li><span>5</span>Gli estremi della distribuzione</li>
    <li><span>6</span>Assenze giustificate e no</li>
    <li><span>7</span>Genere, età, tipo di elezione</li>
    <li><span>8</span>Le assenze e la diaria</li>
    <li><span>A</span>Tutti i ${h.rows} deputati</li>
    <li><span>B</span>Metodo, fonti e limiti</li>
  </ul>
  <div class="foot">
    <div>DoveVannoINostriSoldi<br/>dovevannoinostrisoldi.com/studi/presenze-camera</div>
    <div>Fonte: ${esc(capsule.source.owner)}, partecipazione al voto<br/>${esc(capsule.period.label)}</div>
  </div>
</div>

<section>
  <h2>In sintesi</h2>
  <ul class="findings">${findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
  <div class="box"><strong>Cosa misura la tabella</strong>
    <p>La Camera considera presente un deputato quando vota (favorevole, contrario o astenuto) oppure quando è in missione, cioè assente per un incarico istituzionale. Le percentuali sono calcolate sulle votazioni elettroniche in Aula a cui il deputato poteva partecipare. La tabella non misura la presenza fisica continua, il lavoro in commissione, nelle giunte o nelle delegazioni, né le votazioni per alzata di mano.</p>
  </div>
</section>

<section>
  <h2><span class="num">1</span>Presenza e voto non sono la stessa cosa</h2>
  <p>La percentuale pubblicata come presenza somma due voci di natura diversa. Il voto espresso è un atto in Aula: il deputato preme il pulsante. La missione è un'assenza autorizzata per un altro incarico, per esempio un ministro impegnato al suo dicastero o un deputato in una delegazione all'estero. Per la maggior parte dei deputati le missioni pesano poco; per alcuni sono quasi tutto.</p>
  <figure>${histogramSvg(640, 210)}<figcaption>Figura 1. Deputati per fascia di 5 punti percentuali, presenza ufficiale e voti espressi. ${h.rows} righe della tabella ufficiale.</figcaption></figure>
  <p>Il risultato si vede nella distribuzione. La presenza ufficiale (in grigio) è schiacciata verso l'alto: il 10% dei deputati sta sotto il ${pct(h.presence.p10)}, il 10% sopra il ${pct(h.presence.p90)}, e ${h.presenceAtLeast95} deputati superano il 95%. La distribuzione dei voti espressi (in rosso) è più larga e ha una coda lunga a sinistra: il decimo più basso sta sotto il ${pct(h.votes.p10)}. Per ${h.gapOver20} deputati la differenza tra le due misure supera i 20 punti.</p>

  <p>Le due misure rispondono a domande diverse. La presenza ufficiale dice se il deputato era disponibile per la Camera o per un altro incarico pubblico. I voti espressi dicono quanto ha partecipato alle decisioni dell'Aula. Nessuna delle due misura da sola l'impegno di un parlamentare.</p>
</section>

<section>
  <h2><span class="num">2</span>Chi è in missione</h2>
  <p>L'articolo 46 del Regolamento della Camera considera presenti, ai fini del numero legale, i deputati impegnati fuori sede per un incarico della Camera e i membri del Governo per ragioni del loro ufficio. La statistica ufficiale li conta presenti anche quando non votano. ${h.missionsOver20} deputati sono in missione in più di una votazione su cinque, ${h.missionsOver50} in più della metà.</p>
  <figure>${scatterSvg()}<figcaption>Figura 2. Ogni punto è un deputato. In orizzontale la quota di votazioni in missione, in verticale quella di voti espressi. Sulla diagonale tratteggiata si trova chi non ha assenze. Incarichi in corso a settembre 2026.</figcaption></figure>
  <p>I membri del Governo si raccolgono in basso a destra: presenza mediana del ${pct(govRole.presence)}, voti espressi al ${pct(govRole.votes)}. L'Ufficio di Presidenza della Camera (vicepresidenti, questori e segretari) sta a metà strada, con una presenza mediana del ${pct(presidencyRole.presence)} e voti espressi al ${pct(presidencyRole.votes)}. Gli altri ${otherRole.count} deputati votano in mediana nel ${pct(otherRole.votes)} dei casi.</p>
  <p>Tra chi è molto in missione ci sono anche deputati senza un incarico di governo in corso: ex membri del Governo, presidenti di commissione, componenti di delegazioni internazionali. La tabella non indica per quale incarico il deputato era in missione.</p>
  <h3>Deputati con incarico di governo, dal meno votante</h3>
  ${table(["Deputato", "Incarico", "Presenza", "Voti espressi", "Missioni"], government.map((d) => [esc(d.name), esc(d.role), pct(d.presence), pct(d.votes), pct(d.missions)]), "", 2)}
</section>

<section>
  <h2><span class="num">3</span>I gruppi parlamentari</h2>
  <p>La Figura 3 divide le votazioni di ciascun gruppo in voti espressi, missioni e assenze, come media dei deputati del gruppo. La presenza mediana più alta è quella di ${esc(groups[0].label)} (${pct(groups[0].presence)}), la più bassa quella di ${esc(groups.at(-1).label)} (${pct(groups.at(-1).presence)}). Nei quattro gruppi di maggioranza, che esprimono ministri e sottosegretari, le missioni valgono in media tra il ${pct(Math.min(...majorityGroups.map((g) => g.meanMissions)))} e il ${pct(Math.max(...majorityGroups.map((g) => g.meanMissions)))} delle votazioni; nel Partito Democratico il ${pct(pd.meanMissions)}.</p>
  <figure>${stackSvg(groups, { labelWidth: 150 })}<figcaption>Figura 3. Quote medie per gruppo, ordinate per presenza ufficiale mediana. Gruppo indicato dalla Camera per il periodo; le componenti del Misto sono un unico gruppo. Tra parentesi il numero di deputati.</figcaption></figure>
  ${table(["Gruppo", "Deputati", "Presenza mediana", "P25-P75", "Voti espressi mediana", "Missioni media"], groups.map((g) => [esc(g.label), g.count, pct(g.presence), `${pct(g.p25)}-${pct(g.p75)}`, pct(g.votes), pct(g.meanMissions)]))}
</section>

<section>
  <h2><span class="num">4</span>Maggioranza e opposizione</h2>
  <p>I deputati dei gruppi di maggioranza (Fratelli d'Italia, Lega, Forza Italia, Noi Moderati) hanno una presenza mediana del ${pct(majority.presence)}, quelli di opposizione (PD, MoVimento 5 Stelle, Alleanza Verdi e Sinistra, Azione, Italia Viva) dell'${pct(opposition.presence)}. Sui voti espressi la distanza quasi sparisce: ${pct(majority.votes)} contro ${pct(opposition.votes)}. Le missioni valgono in media il ${pct(majority.meanMissions)} delle votazioni in maggioranza e il ${pct(opposition.meanMissions)} in opposizione. Il gruppo Misto contiene componenti di entrambi gli schieramenti ed è tenuto a parte.</p>
  <p>Un voto non espresso non è sempre disinteresse. L'opposizione può uscire dall'Aula per far mancare il numero legale, mentre la maggioranza deve garantirlo. La tabella registra il risultato, non il motivo.</p>
  <figure>${stackSvg([...blocs, ...roles], { labelWidth: 190 })}<figcaption>Figura 4. Quote medie per schieramento e per incarico istituzionale.</figcaption></figure>
</section>

<section>
  <h2><span class="num">5</span>Gli estremi della distribuzione</h2>
  <p>Le tabelle seguenti considerano solo i ${fullTerm.length} deputati in carica per tutta la legislatura, così che le percentuali poggino sullo stesso numero di votazioni. Umberto Bossi, deceduto, non è incluso: la sua riga resta nell'appendice. Una presenza bassa può avere ragioni che la tabella non registra, come una malattia: la Camera avverte che il sistema di voto non distingue sempre queste cause.</p>
  <h3>Le 10 presenze ufficiali più basse</h3>
  ${table(["Deputato", "Gruppo", "Presenza", "Voti espressi", "Missioni"], deputyRows(lowest), "", 2)}
  <h3>I 10 deputati con più voti espressi</h3>
  ${table(["Deputato", "Gruppo", "Presenza", "Voti espressi", "Missioni"], deputyRows(mostVotes), "", 2)}
</section>

<section>
  <h2><span class="num">6</span>Assenze giustificate e no</h2>
  <p>Accanto alle assenze la Camera pubblica quante sono giustificate. Nel complesso lo sono il ${pct(a.justifiedOfAbsences)}. Per il deputato tipico le assenze giustificate valgono il ${pct(capsule.absences.justified.median)} delle votazioni e quelle non giustificate il ${pct(capsule.absences.unjustified.median)}; il 90% dei deputati ha assenze non giustificate sotto il ${pct(capsule.absences.unjustified.p90)}. ${capsule.absences.unjustifiedOver20} deputati superano il 20% di assenze non giustificate, ${capsule.absences.noJustified} non ne hanno nessuna giustificata.</p>
  <p>Le assenze sono concentrate in pochi nomi. I ${h.lowestDecileCount} deputati con la presenza più bassa, un decimo della Camera, accumulano il ${pct(h.lowestDecileAbsenceShare)} di tutte le assenze registrate.</p>
</section>

<section>
  <h2><span class="num">7</span>Genere, età, tipo di elezione</h2>
  <p>Le donne hanno una presenza mediana del ${pct(women.presence)} e votano nel ${pct(women.votes)} dei casi; gli uomini ${pct(men.presence)} e ${pct(men.votes)}. La presenza ufficiale degli uomini è più alta per effetto delle missioni: ${men.missionsOver50} uomini su ${men.count} sono in missione in più di metà delle votazioni, contro ${women.missionsOver50} donne su ${women.count}. Con l'età la presenza ufficiale cresce di poco e i voti espressi restano simili. Gli eletti nei collegi uninominali hanno una presenza più alta di quelli eletti con le liste proporzionali, ma anche qui la differenza sta nelle missioni.${foreign ? ` Gli ${foreign.count} eletti nella circoscrizione Estero hanno la presenza mediana più bassa (${pct(foreign.presence)}).` : ""}</p>
  <figure>${stackSvg([...capsule.profiles.gender, ...capsule.profiles.age, ...capsule.profiles.elected], { labelWidth: 160 })}<figcaption>Figura 5. Quote medie per genere, classe di età al ${esc(longDate(capsule.period.observedDate))} e tipo di elezione. Solo i ${h.matchedDeputies} deputati collegati all'anagrafe della Camera.</figcaption></figure>
</section>

<section>
  <h2><span class="num">8</span>Le assenze e la diaria</h2>
  <p>Oltre all'indennità, ogni deputato riceve una diaria di ${esc(capsule.diaria.monthlyEuro)} euro al mese, un rimborso forfetario. La Camera la riduce di ${esc(capsule.diaria.dailyDeductionEuro)} euro per ogni giorno di assenza dalle sedute dell'Assemblea con votazioni elettroniche. Il deputato è considerato presente nella giornata se partecipa ad almeno il 30% delle votazioni di quel giorno. L'indennità non viene toccata.</p>
  <p>La tabella usata in questo studio è cumulata sull'intera legislatura e non riporta le singole giornate. Non permette quindi di calcolare quanto sia stato trattenuto a ciascun deputato: una presenza complessiva bassa è compatibile con molte giornate sopra la soglia del 30%.</p>
  <h3>Altre analisi</h3>
  <ul>${capsule.external.map((e) => `<li>${esc(e.owner)}, «${esc(e.title)}». ${esc(e.finding)} <span class="small">${esc(e.url)}</span></li>`).join("")}</ul>
  <p>Sul periodo completo fino a ${esc(capsule.period.monthLabel.toLowerCase())}, nei nostri calcoli le missioni valgono il ${pct(a.missionsShare)} dei posti disponibili.</p>
</section>

<section class="break appendix">
  <h2><span class="num">A</span>Tutti i ${h.rows} deputati</h2>
  <p class="small">Ordine alfabetico per cognome, come nella tabella della Camera. Valori in percentuale delle votazioni a cui il deputato poteva partecipare. Presenza = voti espressi + missioni; assenze = 100% − presenza; la colonna «giustif.» è la parte delle assenze che la Camera classifica come giustificata. <sup>G</sup> incarico di governo in corso, <sup>P</sup> Ufficio di Presidenza, <sup>*</sup> mandato non coperto per intero (${h.partialTenure} deputati), <sup>†</sup> deceduto.</p>
  ${table(["Deputato", "Gruppo", "Presenza", "Voti", "Missioni", "Assenze", "Giustif."], appendixRows, "dense", 2)}
</section>

<section class="break appendix">
  <h2><span class="num">B</span>Metodo, fonti e limiti</h2>
  <h3>Fonte primaria</h3>
  <p>${esc(capsule.source.title)}. ${esc(capsule.period.label)}. Pagina: ${esc(capsule.source.pageUrl)}. Impronta SHA-256 della risposta acquisita: <code>${esc(capsule.source.sha256)}</code>.</p>
  <h3>Collegamenti</h3>
  <p>Genere, data di nascita, collegio e incarichi dell'Ufficio di Presidenza vengono dall'anagrafe della Camera; gli incarichi di governo da dati.camera.it. Il collegamento tra la tabella e l'anagrafe riesce per ${h.matchedDeputies} righe su ${h.rows}: le altre restano nella distribuzione e nell'appendice, ma non nelle analisi per profilo.</p>
  <h3>Calcoli</h3>
  <p>Mediane e percentili usano l'interpolazione lineare tra le osservazioni ordinate. Le medie per gruppo e profilo sono medie semplici delle quote dei deputati, non pesate per il numero di votazioni. Le quote aggregate (voti, missioni, assenze sul totale) sono invece calcolate sui conteggi assoluti.</p>
  <h3>Limiti</h3>
  <ul>${capsule.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <h3>Riproducibilità</h3>
  <p>I numeri sono congelati in <code>src/content/studies/camera-presenze.json</code> dallo script <code>research/camera-presenze-voto/freeze.py</code>, che legge solo snapshot già versionati nel repository. Questo PDF è generato da <code>research/camera-presenze-voto/render-pdf.mjs</code>. Studio DVNS, non sottoposto a peer review esterna. Le versioni precedenti restano disponibili: /studi/presenze-camera/v2/presenze-camera.pdf e /studi/presenze-camera/v1/presenze-camera.pdf. La 2.1 esclude dalle classifiche Umberto Bossi, deceduto.</p>
</section>

</body>
</html>`;

if (/[\u2014\u2013]/.test(html)) throw new Error("em/en dash nel PDF");

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
  ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", "--generate-pdf-document-outline", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`],
  { encoding: "utf8", timeout: 120_000 },
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
