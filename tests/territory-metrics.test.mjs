import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const [{
  aggregateEurosPerSquareKilometreCents,
}, {
  getSiopeMunicipalityPeerCoverage,
  getSiopeMunicipalityPeerObservations,
}, { getMunicipalityProfile }] = await Promise.all([
  import("../src/lib/municipality-geography.ts"),
  import("../src/lib/siope-municipality-detail.ts"),
  import("../src/lib/municipality-profile.ts"),
]);

test("national per-square-kilometre aggregation fails closed on missing geography", () => {
  assert.equal(
    aggregateEurosPerSquareKilometreCents([
      { amountCents: 10_000, surfaceSquareMetres: 1_000_000 },
      { amountCents: 20_000, surfaceSquareMetres: null },
    ]),
    null,
  );
  assert.equal(
    aggregateEurosPerSquareKilometreCents([
      { amountCents: 10_000, surfaceSquareMetres: 1_000_000 },
      { amountCents: 20_000, surfaceSquareMetres: 2_000_000 },
    ]),
    10_000,
  );
});

test("municipality peer benchmark declares the ISTAT population year separately from SIOPE", async () => {
  const profile = await getMunicipalityProfile({
    codiceIpa: "c_a783",
    denominazione: "Comune Benevento",
    codiceFiscale: "00074270620",
    tipologia: "Pubbliche Amministrazioni",
    codiceCategoria: "L6",
    codiceNatura: "2430",
    codiceAteco: null,
    inLiquidazione: false,
    codiceMiur: null,
    codiceIstat: null,
    acronimo: null,
    responsabile: { nome: null, cognome: null, titolo: null },
    sede: {
      codiceComuneIstat: "062008",
      codiceCatastaleComune: "A783",
      cap: null,
      indirizzo: null,
    },
    email: [],
    sitoIstituzionale: null,
    social: { facebook: null, linkedin: null, twitter: null, youtube: null },
    dataAggiornamento: null,
  });
  assert.ok(profile?.siope.peerBenchmark);
  assert.equal(profile.siope.peerBenchmark.year, 2026);
  assert.equal(profile.siope.peerBenchmark.populationYear, 2024);
});

test("municipality ranking coverage distinguishes eligible rows from excluded movements", () => {
  const coverage = getSiopeMunicipalityPeerCoverage(2026);
  const observations = getSiopeMunicipalityPeerObservations(2026);
  assert.equal(coverage.withMovementsAndGeography, observations.length);
  assert.equal(coverage.withoutMovements, coverage.activeMunicipalities - coverage.withMovements);
  assert.equal(
    coverage.withMovementsWithoutGeography,
    coverage.withMovements - coverage.withMovementsAndGeography,
  );
  assert.ok(coverage.withMovementsWithoutGeography > 0);
});

test("territory page metadata and copy identify the per-square-kilometre coverage", async () => {
  const page = await readFile(new URL("../src/app/territori/page.tsx", import.meta.url), "utf8");
  assert.match(page, /aggregateEurosPerSquareKilometreCents/);
  assert.match(page, /valori per km²/);
  assert.match(page, /Comuni con movimenti e superficie ISTAT disponibile/);
  assert.match(page, /senza superficie ISTAT abbinata/);
});

test("macro-area per-square-kilometre values fail closed on partial geography", async () => {
  const page = await readFile(new URL("../src/app/territori/page.tsx", import.meta.url), "utf8");
  assert.match(page, /areaRegions\.every\(\(region\) => region\.geography !== null\)/);
  assert.match(page, /areaSurfaceSquareKilometres === null[\s\S]*?"n\.d\."/);
  assert.doesNotMatch(page, /region\.geography\?\.surfaceSquareKilometres \?\? 0/);
});

test("fiscal per-square-kilometre values keep null instead of becoming zero", async () => {
  const page = await readFile(new URL("../src/app/territori/fisco/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /balancePerSquareKmCents \?\? 0/);
  assert.doesNotMatch(page, /PerCapitaCents`\] \?\? 0/);
  assert.match(page, /value === null\s*\?\s*"n\.d\."/);
  assert.match(page, /rightValue === null/);
});

test("fiscal copy and accessibility labels follow the selected measure", async () => {
  const page = await readFile(new URL("../src/app/territori/fisco/page.tsx", import.meta.url), "utf8");
  assert.match(page, /La vista è ordinata per saldo \{measureLabel\}/);
  assert.match(page, /aria-label=\{`Territori ordinati per saldo \$\{measureLabel\}`\}/);
  assert.match(page, /ordinati per saldo \$\{measureLabel\}/);
  assert.doesNotMatch(page, /saldo pro capite/);
});

test("territory national per-square-kilometre KPI declares its regionalized perimeter", async () => {
  const page = await readFile(new URL("../src/app/territori/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const nationalMetricLabel = metric === "per-km2"/);
  assert.match(page, /Valore nazionale regionalizzato/);
  assert.match(page, /data\.coverage\.withoutRegion/);
  assert.match(page, /data\.coverage\.paymentsWithoutRegion/);
  assert.match(page, /circa/);
  assert.match(page, /label: nationalMetricLabel/);
});

test("territory municipality tooltip keeps unavailable values as n.d.", async () => {
  const page = await readFile(new URL("../src/app/territori/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function exactMetricValue\(value: number \| null\)/);
  assert.match(page, /exactMetricValue\(selectedMunicipalityValue\)/);
  assert.doesNotMatch(page, /municipality\.perCapita \?\? 0/);
});

test("territory municipality ranking uses grammatical ordering labels", async () => {
  const page = await readFile(new URL("../src/app/territori/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const METRIC_ORDERING_LABELS:[\s\S]*?"per-abitante": "per abitante"/);
  assert.match(page, /const METRIC_ORDERING_LABELS:[\s\S]*?"per-km2": "per km²"/);
  assert.match(page, /Mostriamo i primi \$\{topMunicipalities\.length\} \$\{METRIC_ORDERING_LABELS\[metric\]\}/);
  assert.match(page, /<caption[^>]*>Pagamenti regionali \{METRIC_ORDERING_LABELS\[metric\]\}/);
  assert.match(page, /<caption[^>]*>Comuni ordinati \{METRIC_ORDERING_LABELS\[metric\]\}/);
  assert.doesNotMatch(page, /per \{METRIC_LABELS\[metric\]/);
});

test("municipality profile sheet follows the no-radius design rule", async () => {
  const css = await readFile(new URL("../src/app/enti/[codice]/scheda.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /border-radius\s*:/);
});
