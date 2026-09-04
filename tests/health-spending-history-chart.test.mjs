import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const chartSourcePath = new URL(
  "../src/components/charts/health-spending-history-chart.tsx",
  import.meta.url,
);
const chartCssPath = new URL(
  "../src/components/charts/health-spending-history-chart.module.css",
  import.meta.url,
);
const storicoPagePath = new URL(
  "../src/app/spese/sanita/storico/page.tsx",
  import.meta.url,
);

const chartCode = readFileSync(chartSourcePath, "utf8");
const chartCss = readFileSync(chartCssPath, "utf8");
const pageCode = readFileSync(storicoPagePath, "utf8");

test("health spending history page uses the shared persistent OpenBDAP cache", () => {
  assert.match(pageCode, /getCachedSsnNationalHistory\(\)/);
  assert.match(pageCode, /export const maxDuration = 60/);
});

test("health spending trend chart defines the five canonical SSN CCE accounting series", () => {
  assert.match(chartCode, /export function HealthSpendingHistoryChart/);
  assert.match(chartCode, /export const HEALTH_SPENDING_SERIES/);
  assert.match(chartCode, /export const PRIMARY_SERIES/);
  assert.match(chartCode, /export const WORK_SERVICES_SERIES/);

  // All 5 voice codes
  assert.match(chartCode, /code:\s*"BZ9999"/);
  assert.match(chartCode, /code:\s*"BA2080"/);
  assert.match(chartCode, /code:\s*"BA0390"/);
  assert.match(chartCode, /code:\s*"BA1350"/);
  assert.match(chartCode, /code:\s*"BA1750"/);

  // All 5 metric keys
  assert.match(chartCode, /key:\s*"productionCosts"/);
  assert.match(chartCode, /key:\s*"personnelCost"/);
  assert.match(chartCode, /key:\s*"purchasedServices"/);
  assert.match(chartCode, /key:\s*"healthcareWorkServices"/);
  assert.match(chartCode, /key:\s*"nonHealthcareWorkServices"/);
});

test("health spending trend chart separates macro aggregates and work services into distinct honest scales without dual axis", () => {
  // Rejects misleading dual-axis patterns on a single chart
  assert.doesNotMatch(chartCode, /yAxisId=["']right["']/);
  assert.doesNotMatch(chartCode, /orientation=["']right["']/);

  // Uses two synchronized panels with separate scales
  assert.match(chartCode, /syncId="ssn-national-history"/);
  assert.match(chartCode, /GRANDI AGGREGATI/);
  assert.match(chartCode, /PRESTAZIONI DI LAVORO/);
  assert.match(chartCode, /Scala assoluta da zero/);
  assert.match(chartCode, /Scala dedicata/);

  // Primary panel contains the 3 macro aggregates
  assert.match(chartCode, /PRIMARY_SERIES/);
  assert.match(chartCode, /panel:\s*"primary"/);

  // Work services panel contains the 2 smaller series
  assert.match(chartCode, /WORK_SERVICES_SERIES/);
  assert.match(chartCode, /panel:\s*"workServices"/);
});
test("health spending trend chart preserves design tokens, accessibility and zero animation", () => {
  // Client directive for Recharts
  assert.match(chartCode, /^"use client";/);

  // Accessibility contract on both figures and chart containers
  assert.match(chartCode, /accessibilityLayer/);
  assert.match(chartCode, /role="img"/);
  assert.match(chartCode, /aria-label=/);

  // No entrance animation
  assert.match(chartCode, /isAnimationActive=\{false\}/);
  assert.doesNotMatch(chartCode, /animationDuration=/);

  // Explicit units formatting on Y axis and tooltips
  assert.match(chartCode, /tickFormatter=\{formatAxisEuro\}/);
  assert.match(chartCode, /mld €/);
  assert.match(chartCode, /mln €/);

  // Disclaimer note on nominal economic-accounting values without causality inference
  assert.match(chartCode, /Valori nominali a consuntivo in euro di competenza economica/);
  assert.match(chartCode, /due grafici a scala separata/);
  assert.match(chartCode, /doppio asse/);
  assert.match(chartCode, /non misura efficienza/);
  assert.match(chartCode, /dotazioni organiche/);

  // Scoped CSS tokens
  assert.match(chartCss, /var\(--chart-primary\)/);
  assert.match(chartCss, /var\(--chart-secondary\)/);
  assert.match(chartCss, /var\(--chart-tertiary\)/);
  assert.match(chartCss, /var\(--color-accent-600\)/);
  assert.match(chartCss, /var\(--chart-quaternary\)/);
  assert.match(chartCss, /var\(--color-neutral-300\)/);
  assert.match(chartCss, /var\(--color-text\)/);
  assert.match(chartCss, /var\(--color-on-strong\)/);
  assert.match(chartCss, /var\(--color-on-strong-muted\)/);
  assert.match(chartCss, /@media \(max-width: 960px\)/);
  assert.match(chartCss, /@media \(max-width: 720px\)/);
  assert.match(chartCss, /max-width: calc\(100vw - 64px\)/);
});

test("storico page integrates the chart while preserving the exact table as accessible truth", () => {
  // Chart component imported and rendered with history.years
  assert.match(pageCode, /import \{ HealthSpendingHistoryChart \} from "@\/components\/charts\/health-spending-history-chart";/);
  assert.match(pageCode, /<HealthSpendingHistoryChart data=\{history!\.years\} \/>/);

  // Exact historical table remains in place as accessible truth
  assert.match(pageCode, /<HistoryTable history=\{history!\} \/>/);
  assert.match(pageCode, /role="region" aria-label="Conto Economico SSN nazionale, serie storica"/);

  // Error handling, provenance, routes, and cautionary notice preserved
  assert.match(pageCode, /Dati OpenBDAP non raggiungibili in questo momento/);
  assert.match(pageCode, /<ProvenanceList history=\{history!\} \/>/);
  assert.match(pageCode, /Cosa questa serie non dimostra/);
  assert.match(pageCode, /href="\/spese\/sanita"/);
});
