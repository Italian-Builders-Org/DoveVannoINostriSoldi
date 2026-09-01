import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/governi/page.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/app/governi/[id]/page.tsx", import.meta.url), "utf8");
const comparison = await readFile(new URL("../src/app/governi/confronta/page.tsx", import.meta.url), "utf8");
const comparisonStyles = await readFile(new URL("../src/app/governi/confronta/confronta.module.css", import.meta.url), "utf8");
const comparisonOverlay = await readFile(new URL("../src/app/governi/confronta/government-comparison-overlay.tsx", import.meta.url), "utf8");
const comparisonOverlayStyles = await readFile(new URL("../src/app/governi/confronta/government-comparison-overlay.module.css", import.meta.url), "utf8");
const citizenModel = await readFile(new URL("../src/app/governi/citizen-score-model.tsx", import.meta.url), "utf8");
const currentOverview = await readFile(new URL("../src/app/governi/current-government-overview.tsx", import.meta.url), "utf8");
const currentSignals = await readFile(new URL("../src/app/governi/current-government-signals.tsx", import.meta.url), "utf8");
const indicatorChart = await readFile(new URL("../src/app/governi/government-indicator-chart.tsx", import.meta.url), "utf8");
const governmentArchive = await readFile(new URL("../src/app/governi/government-archive.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/governi/governi.module.css", import.meta.url), "utf8");
const overviewStyles = await readFile(new URL("../src/app/governi/current-government-overview.module.css", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");

test("government scorecard is server-first and opens on the current government", () => {
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /Economia italiana: cosa sta migliorando e cosa no/);
  assert.match(page, /getGovernmentCurrentSignalsView/);
  assert.match(page, /<CurrentGovernmentOverview governmentName=\{current\.name\} calculation=\{currentScore\} currentSignals=\{currentSignals\} ameco=\{data\.sources\.ameco\} \/>/);
  assert.match(page, /Risultati annuali al \{data\.sources\.ameco\.observedThrough\} · prezzi a \{currentSignals\.latestPeriod\}/);
  assert.match(page, /I sei indicatori annuali permettono lo storico/);
  assert.match(page, /<CitizenScoreModel \/>/);
  assert.ok(page.indexOf("<CurrentGovernmentOverview") < page.indexOf("<CitizenScoreModel"));
});

test("page keeps current data first, then inheritance, context, actions, archive, comparison and method", () => {
  const headings = [
    "Se le previsioni si realizzano",
    "Cosa ha ereditato il governo attuale",
    "In quale situazione ha operato",
    "Cosa ha fatto e cosa possiamo verificare",
    "<GovernmentArchive",
    "Scegli due governi e sovrapponi i dati",
    "Quali dati mancano e come viene calcolato il risultato",
    "Cosa il risultato non dimostra",
  ];
  let cursor = -1;
  for (const heading of headings) {
    const next = page.indexOf(heading);
    assert.ok(next > cursor, heading);
    cursor = next;
  }
  assert.match(page, /<GovernmentArchive id="confronto-governi" selectedGovernmentId=\{current\.id\} ameco=\{data\.sources\.ameco\} \/>/);
  assert.match(page, /<details className=\{styles\.explorer\} id="metodo-dati">/);
  assert.match(page, /non un dato osservato e non un risultato anticipato/);
  assert.doesNotMatch(page, /Il confronto con i peer non è lo spread/);
  assert.match(citizenModel, /Perché è fuori oggi:/);
  assert.match(citizenModel, /Perché resta diagnostico:/);
  assert.match(page, /current\.measures\.map/);
});

test("current overview turns all six indicators into readable trends and peer comparisons", () => {
  assert.doesNotMatch(currentOverview, /^"use client"/);
  assert.match(currentOverview, /Come sta andando con \{governmentName\}/);
  assert.match(currentOverview, /Indicatori migliorati/);
  assert.match(currentOverview, /Meglio dei peer/);
  assert.match(currentOverview, /Intervallo stress test/);
  assert.match(currentOverview, /Attribuzione al governo/);
  assert.match(currentOverview, /calculation\.indicators\.map/);
  assert.match(currentOverview, /<TrendSparkline indicator=\{indicator\} \/>/);
  assert.match(currentOverview, /Periodo del grafico/);
  assert.match(currentOverview, /Variazione nel mandato/);
  assert.match(currentOverview, /Valore attuale/);
  assert.match(currentOverview, /2020 = 100/);
  assert.match(currentOverview, /Mediana peer/);
  assert.match(currentOverview, /comparisonLabel\(indicator\)/);
  assert.match(currentOverview, /Math\.abs\(value\) < MOVEMENT_EPSILON/);
  assert.match(currentOverview, /label: "→ Stabile"/);
  assert.match(currentOverview, /data-peer=\{peerPosition\}/);
  assert.match(currentOverview, /export function CurrentGovernmentPeerComparison/);
  assert.match(currentOverview, /Lo zero è il \{baselineYear\}/);
  assert.match(currentOverview, /<GovernmentIndicatorChart indicators=\{indicators\} \/>/);
  assert.match(currentOverview, /role="img"/);
  assert.match(currentOverview, /Fonte: AMECO/);
  assert.match(currentOverview, /italySourceCodes\(indicator\.sourceCodes\)/);
  assert.match(currentOverview, /indice calcolato dal sito/);
  assert.match(currentOverview, /function levelChange/);
  assert.match(currentOverview, /Italia · variazione di livello/);
  assert.match(currentOverview, /Nel grafico verso l’alto significa miglioramento/);
  assert.match(currentOverview, /Il livello italiano è sceso, i peer di più/);
  assert.match(currentSignals, /Include affitti e utenze/);
  assert.match(currentSignals, /Fonte: \{data\.source\.owner\}/);
  assert.match(governmentArchive, /indice calcolato da AMECO/);
  assert.match(page, /Previsione AMECO/);
  assert.match(page, /Fonte: AMECO/);
  assert.match(page, /indicators=\{currentScore\.indicators\}/);
  assert.match(page, /baselineYear=\{currentScore\.baselineYear\}/);
  assert.ok(page.indexOf("Scegli due governi e sovrapponi i dati") < page.indexOf("<CurrentGovernmentPeerComparison"));
});

test("current monthly signals explain harmonised prices without silently changing the score", () => {
  assert.doesNotMatch(currentSignals, /^"use client"/);
  assert.match(currentSignals, /Prezzi al consumo dall’insediamento a oggi/);
  assert.match(currentSignals, /La percentuale grande mostra quanto sono cambiati i prezzi da \{monthLabel\(data\.startPeriod\)\}/);
  assert.match(currentSignals, /Da \{monthLabel\(data\.startPeriod\)\} · %/);
  assert.match(currentSignals, /Ultimi 12 mesi/);
  assert.match(currentSignals, /Legenda dei grafici mensili/);
  assert.match(currentSignals, /12 mesi: in aumento/);
  assert.match(currentSignals, /signal\.series\.map/);
  assert.match(currentSignals, /Mediana peer/);
  assert.match(currentSignals, /Questo non è un punto assegnato al governo/);
  assert.match(currentSignals, /non misura il costo della vita della singola famiglia/);
  assert.match(currentSignals, /data\.source\.landingUrl/);
  assert.match(currentSignals, /role="img"/);
  assert.match(currentSignals, /<ChartDataTable/);
  assert.doesNotMatch(currentSignals, /ottobre 2022/);
});

test("citizen model exposes ten source-backed indicators and explains every exclusion", () => {
  assert.match(citizenModel, /Dieci dati utili, con ruoli diversi/);
  assert.match(citizenModel, /possono entrare nel risultato del cittadino/);
  assert.match(citizenModel, /indicator\.role === "score"/);
  assert.match(citizenModel, /indicator\.role === "diagnostic"/);
  assert.match(citizenModel, /sei indicatori macro del Core/);
  assert.match(citizenModel, /indicator\.exclusionReason/);
  assert.match(citizenModel, /indicator\.sourceUrl/);
});

test("page exposes raw values, peers, missing-score reasons and official sources", () => {
  assert.match(currentOverview, /baselineValue/);
  assert.match(currentOverview, /endValue/);
  assert.match(currentOverview, /relativeChange/);
  assert.match(governmentArchive, /government\.calculation\.reason/);
  assert.match(page, /data\.sources\.ameco\.landingUrl/);
  assert.match(page, /data\.sources\.governmentChronology\.pageUrl/);
  assert.match(page, /currentSignals\.source\.landingUrl/);
  assert.match(page, /controllo automatico settimanale/);
  assert.ok((page.match(/target="_blank"/g) ?? []).length >= 5);
  assert.match(detail, /relativeChangeLabel\(indicator\)/);
  assert.match(detail, /sources\.ameco\.landingUrl/);
  assert.match(detail, /sources\.ameco\.retrievedAt/);
  assert.match(comparison, /data\.sources\.ameco\.landingUrl/);
  assert.match(comparison, /data\.sources\.ameco\.retrievedAt/);
  assert.doesNotMatch(detail, /signed\(indicator\.relativeChange\)/);
});

test("every government links to a dedicated five-part assessment", () => {
  assert.match(governmentArchive, /href=\{`\/governi\/\$\{government\.id\}`\}/);
  assert.match(detail, /<GovernmentArchive id="altri-governi" selectedGovernmentId=\{government\.id\} ameco=\{sources\.ameco\} \/>/);
  for (const heading of ["Cosa ha ereditato", "In quale situazione ha governato", "Cosa ha fatto per intervenire", "Risultati osservati e situazione lasciata", "Cosa i dati non dimostrano"]) {
    assert.match(detail, new RegExp(heading));
  }
  assert.match(detail, /Periodo economico e geopolitico/);
  assert.match(detail, /government\.inheritance\.trend/);
  assert.match(detail, /government\.measures\.map/);
  assert.match(detail, /government\.contexts\.map/);
  assert.match(detail, /<GovernmentIndicatorChart indicators=\{calculation\.indicators\} \/>/);
  assert.match(detail, /Come i sei indicatori formano il numero/);
  assert.match(detail, /Intervallo dopo \{calculation\.robustness\.checks\.length\} stress test/);
  assert.match(detail, /government\.attribution\.label/);
  assert.match(detail, /dynamicParams = false/);
  assert.match(detail, /generateStaticParams/);
});

test("users can compare any two scored governments and open either detail", () => {
  assert.doesNotMatch(page, /Miglior risultato tra i governi conclusi e valutabili/);
  assert.match(governmentArchive, /Ogni nome apre la scheda completa del governo/);
  assert.match(page, /href=\{`\/governi\/confronta\?x=\$\{current\.id\}`\}/);
  assert.match(comparison, /name="x"/);
  assert.match(comparison, /name="y"/);
  assert.match(comparison, /Dove differiscono di più/);
  assert.match(comparison, /Dove nasce la differenza/);
  assert.match(comparison, /I dati, uno per uno/);
  assert.match(comparison, /<GovernmentComparisonOverlay/);
  assert.match(comparison, /href=\{`\/governi\/\$\{government\.id\}`\}/);
  assert.match(comparison, /Non decreta il governo migliore/);
  assert.match(comparison, /Math\.abs\(category\.difference\) < 0\.1/);
  assert.doesNotMatch(comparison, /data-higher-result/);
  assert.doesNotMatch(comparisonStyles, /data-higher-result/);
  assert.match(comparisonOverlay, /^"use client"/);
  assert.match(comparisonOverlay, /Dati sovrapposti/);
  assert.match(comparisonOverlay, /ReferenceLine y=\{0\}/);
  assert.match(comparisonOverlay, /<ChartDataTable/);
  assert.match(comparisonOverlay, /stroke="var\(--chart-primary\)"/);
  assert.match(comparisonOverlay, /stroke="var\(--chart-secondary\)" strokeDasharray="8 5"/);
  assert.doesNotMatch(comparisonOverlay, /stroke="#[0-9a-f]+"/i);
  assert.match(comparisonOverlayStyles, /min-height: 44px/);
});

test("government comparison chart is an isolated client component with accessible raw data", () => {
  assert.match(indicatorChart, /^"use client"/);
  assert.match(indicatorChart, /miglioramento annuale dalla baseline/);
  assert.match(indicatorChart, /Italia/);
  assert.match(indicatorChart, /Francia/);
  assert.match(indicatorChart, /Germania/);
  assert.match(indicatorChart, /Spagna/);
  assert.match(indicatorChart, /<ChartDataTable/);
  assert.match(indicatorChart, /accessibilityLayer/);
});

test("page is discoverable, progressive and responsive", () => {
  assert.match(navigation, /href: "\/governi", label: "Pagella dei governi"/);
  assert.match(discovery, /"\/governi"/);
  assert.match(styles, /\.explorer/);
  assert.match(styles, /\.governmentBars/);
  assert.match(styles, /\.pageJumps[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(overviewStyles, /\.indicatorGrid/);
  assert.match(overviewStyles, /\.liveGrid/);
  assert.match(overviewStyles, /@media \(max-width: 700px\)/);
  assert.match(overviewStyles, /\.summaryStats \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(overviewStyles, /\.valueRow \{[\s\S]*flex-direction: column/);
  assert.match(styles, /\.governmentBars li \{[\s\S]*grid-template-columns: 1fr auto/);
  assert.doesNotMatch(styles, /color-neutral-950/);
  assert.match(overviewStyles, /\.summary[\s\S]*background: var\(--color-text\)/);
  assert.doesNotMatch(`${styles}\n${overviewStyles}`, /font-size:\s*[89]px/);
  assert.doesNotMatch(`${styles}\n${overviewStyles}\n${comparisonOverlayStyles}`, /#[0-9a-f]{3,8}/i);
});
