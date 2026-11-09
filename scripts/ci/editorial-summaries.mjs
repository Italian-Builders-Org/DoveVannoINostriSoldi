import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import "./register-source-alias.mjs";

// Derive the summaries from the verified release files even on a SQL checkout.
process.env.DVNS_DATA_BACKEND = "filesystem";
process.env.DVNS_HEAVY_DATA_BACKEND = "filesystem";
delete process.env.DVNS_BUILD_DATA_BACKEND;
delete process.env.DVNS_BUILD_HEAVY_DATA_BACKEND;
process.env.DVNS_OFFLINE_GUARD = "1";
await import("./node-offline-guard.mjs");

const { loadAllIntegratedDatasetRows } = await import("../../src/lib/integrated-full-dataset-page.ts");
const { ADE_IMMOBILI_UTILIZZO_DATASET, ADE_IMMOBILI_TABELLE_DATASET } = await import("../../src/lib/ade-immobili-italia-2026.ts");
const { buildAdeImmobiliHousingInsights } = await import("../../src/lib/data/ade-immobili-utilizzo-derive.ts");
const { buildAdeImmobiliTabelleInsights } = await import("../../src/lib/data/ade-immobili-tabelle-derive.ts");
const { aggregateHospitalBeds, HOSPITAL_BEDS_DATASET } = await import("../../src/lib/data/salute-hospital-beds-contract.ts");
const { aggregateMedicalDeviceSpending, listMedicalDeviceFilters } = await import("../../src/lib/medical-device-spending.ts");

const housing = await loadAllIntegratedDatasetRows(ADE_IMMOBILI_UTILIZZO_DATASET);
const tables = await loadAllIntegratedDatasetRows(ADE_IMMOBILI_TABELLE_DATASET);
const beds = await loadAllIntegratedDatasetRows(HOSPITAL_BEDS_DATASET);
const history = [];
const years = listMedicalDeviceFilters().years.map(({ year }) => year).sort((a, b) => a - b);
for (const year of years) {
  const { coverage } = await aggregateMedicalDeviceSpending({ year: String(year), limit: 1 });
  history.push({ year, spending: coverage.spending });
}

// These compact projections ship with the code, outside the pinned Supabase
// inventory. Their source rows and archives remain in the existing inventory.
const directory = new URL("../../src/data/editorial-snapshots/", import.meta.url);
const outputs = {
  "ade-immobili.json": {
    housing: buildAdeImmobiliHousingInsights(housing.rows),
    tables: buildAdeImmobiliTabelleInsights(tables.dataset, tables.rows),
  },
  "salute-posti-letto.json": {
    dataset: beds.dataset,
    regions: aggregateHospitalBeds(beds.dataset.headers, beds.rows),
  },
  "dispositivi.json": {
    history,
    defaultAggregate: await aggregateMedicalDeviceSpending({ year: String(years.at(-1)), limit: 25 }),
  },
};
const write = process.argv.includes("--write");
if (write) mkdirSync(directory, { recursive: true });
for (const [name, data] of Object.entries(outputs)) {
  const file = new URL(name, directory);
  const expected = `${JSON.stringify(data)}\n`;
  if (write) writeFileSync(file, expected);
  else if (readFileSync(file, "utf8") !== expected) {
    throw new Error(`Riepilogo ${name} divergente: eseguire npm run editorial-summaries:generate`);
  }
}
console.log("Riepiloghi Immobili, posti letto e dispositivi medici riconciliati con il rilascio.");
