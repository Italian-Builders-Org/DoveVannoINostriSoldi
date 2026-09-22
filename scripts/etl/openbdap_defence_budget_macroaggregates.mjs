#!/usr/bin/env node
/**
 * Build or check the Difesa mission × macroaggregate CP A1 series from the
 * same OpenBDAP AMPMA CSV locked for openbdap-budget-law-missions.
 *
 * Usage:
 *   node ... scripts/etl/openbdap_defence_budget_macroaggregates.mjs --csv FILE --observed-at ISO
 *   node ... scripts/etl/openbdap_defence_budget_macroaggregates.mjs --check
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { decodePublicDataText, parseDelimitedRecords } from "../../src/lib/data/delimited.ts";
import { parseOpenBdapAmount } from "../../src/lib/data/bdap-payment-contract.ts";
import {
  DEFENCE_MISSION,
  validateDefenceBudgetMacroaggregatesArtifact,
} from "../../src/lib/defence-budget-macroaggregates-contract.ts";
import sourceLock from "./specs/openbdap-defence-budget-macroaggregates.source.json" with { type: "json" };

const DEFAULT_OUTPUT = "src/data/generated/openbdap-defence-budget-macroaggregates.json";
const AMOUNT_FIELD = "Legge di Bilancio CP A1";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const outputPath = resolve(valueAfter("--output") ?? DEFAULT_OUTPUT);

if (process.argv.includes("--check")) {
  const artifact = JSON.parse(readFileSync(outputPath, "utf8"));
  validateDefenceBudgetMacroaggregatesArtifact(artifact, sourceLock);
  console.log(`Snapshot macroaggregati Difesa valido: ${outputPath}`);
  process.exit(0);
}

const csvPath = valueAfter("--csv");
const observedAt = valueAfter("--observed-at");
if (!csvPath || !observedAt) {
  throw new Error("Uso: --csv FILE --observed-at ISO [--output FILE], oppure --check");
}
if (Number.isNaN(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) {
  throw new Error("--observed-at deve essere un timestamp ISO UTC canonico");
}

const csvBytes = readFileSync(resolve(csvPath));
if (csvBytes.byteLength !== sourceLock.source.csv.bytes) {
  throw new Error(`CSV Difesa: byte ${csvBytes.byteLength}, attesi ${sourceLock.source.csv.bytes}`);
}
const digest = sha256(csvBytes);
if (digest !== sourceLock.source.csv.sha256) {
  throw new Error(`CSV Difesa: SHA-256 ${digest}, atteso ${sourceLock.source.csv.sha256}`);
}

if (sourceLock.source.csv.encoding !== "cp1252" || sourceLock.source.csv.delimiter !== ";") {
  throw new Error("Lock Difesa: encoding/delimiter inattesi rispetto al parser OpenBDAP");
}
const text = decodePublicDataText(csvBytes);
const records = parseDelimitedRecords(text, sourceLock.source.csv.delimiter);

const years = sourceLock.transformation.years;
const yearSet = new Set(years);
const totals = new Map();
for (const year of years) {
  for (const macro of sourceLock.transformation.macroaggregates) {
    totals.set(`${year}::${macro}`, 0);
  }
}

for (const record of records) {
  const mission = record.Missione?.trim();
  if (mission !== DEFENCE_MISSION) continue;
  const yearRaw = record["Esercizio Finanziario"]?.trim();
  if (!yearRaw || !/^\d{4}$/.test(yearRaw)) {
    throw new Error(`OpenBDAP Difesa: anno non valido: ${yearRaw}`);
  }
  const year = Number.parseInt(yearRaw, 10);
  if (!yearSet.has(year)) continue;
  const macro = record.Macroaggregato?.trim();
  if (!macro) throw new Error(`OpenBDAP Difesa ${year}: Macroaggregato mancante`);
  if (!sourceLock.transformation.macroaggregates.includes(macro)) {
    throw new Error(`OpenBDAP Difesa ${year}: macroaggregato inatteso «${macro}»`);
  }
  const amountEur = parseOpenBdapAmount(record[AMOUNT_FIELD], AMOUNT_FIELD);
  const key = `${year}::${macro}`;
  totals.set(key, (totals.get(key) ?? 0) + amountEur);
}

const rows = [];
for (const year of years) {
  let missionTotal = 0;
  for (const macro of sourceLock.transformation.macroaggregates) {
    const amountEur = totals.get(`${year}::${macro}`) ?? 0;
    missionTotal += amountEur;
    rows.push({ year, macroaggregate: macro, amountEur });
  }
  const expected = sourceLock.expectedMissionTotalsEur[String(year)];
  if (missionTotal !== expected) {
    throw new Error(`Difesa ${year}: totale macroaggregati ${missionTotal} ≠ missione attesa ${expected}`);
  }
  const investment = totals.get(`${year}::${sourceLock.transformation.investmentMacroaggregate}`) ?? 0;
  if (investment !== sourceLock.expectedInvestmentEur[String(year)]) {
    throw new Error(`Difesa ${year}: INVESTIMENTI ${investment} ≠ atteso`);
  }
}

if (rows.length !== sourceLock.transformation.cells) {
  throw new Error(`Celle macroaggregato: ${rows.length}, attese ${sourceLock.transformation.cells}`);
}

const artifact = {
  schemaVersion: 1,
  datasetId: sourceLock.datasetId,
  mission: DEFENCE_MISSION,
  measure: AMOUNT_FIELD,
  unit: "euro",
  years,
  macroaggregates: sourceLock.transformation.macroaggregates,
  investmentMacroaggregate: sourceLock.transformation.investmentMacroaggregate,
  rows,
  source: {
    ...sourceLock.source,
    observedAt,
    csvSha256: `sha256:${digest}`,
  },
  caveats: [
    "Stanziamenti di competenza CP A1 della Legge di Bilancio sulla missione «Difesa e sicurezza del territorio», ripartiti per macroaggregato ufficiale OpenBDAP.",
    "INVESTIMENTI non è spesa COFOG GF02, non è un pagamento di cassa e non è la misura NATO.",
    "La somma dei macroaggregati per anno riconcilia il totale di missione già pubblicato su /spese/difesa; non sommare queste serie a Eurostat.",
    "Macroaggregati assenti in un anno non compaiono come zero inventato: ogni cella dello snapshot è una somma osservata (può essere 0 se la fonte pubblica zero).",
  ],
};

validateDefenceBudgetMacroaggregatesArtifact(artifact, sourceLock);
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Scritto ${outputPath} (${rows.length} celle, observedAt=${observedAt})`);
