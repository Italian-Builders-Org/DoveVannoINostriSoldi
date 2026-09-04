#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  getBudgetLawMissionSeries,
  resetBudgetLawMissionSeriesCacheForTests,
  validateBudgetLawSnapshotArtifact,
  validateBudgetLawMissionSeries,
} from "../../src/lib/bdap-legge-bilancio.ts";

const DEFAULT_OUTPUT = "src/data/generated/openbdap-budget-law-missions.json";
const PACKAGE_SEARCH_URL =
  "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_search?q=LBF_SPE_CRU_AMPMA_001&rows=20";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

const outputPath = resolve(valueAfter("--output") ?? DEFAULT_OUTPUT);

if (process.argv.includes("--check")) {
  const artifact = readJson(outputPath);
  validateBudgetLawSnapshotArtifact(artifact);
  console.log(`Snapshot Legge di Bilancio valido: ${outputPath}`);
  process.exit(0);
}

const packagePath = valueAfter("--package-json");
const csvPath = valueAfter("--csv");
const observedAt = valueAfter("--observed-at");
if (!packagePath || !csvPath || !observedAt) {
  throw new Error(
    "Uso: --package-json FILE --csv FILE --observed-at ISO [--output FILE], oppure --check",
  );
}
if (Number.isNaN(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) {
  throw new Error("--observed-at deve essere un timestamp ISO UTC canonico");
}

const packageBytes = readFileSync(resolve(packagePath));
const csvBytes = readFileSync(resolve(csvPath));
const packagePayload = JSON.parse(packageBytes.toString("utf8"));
const packageId = packagePayload.result?.results?.[0]?.id;
if (typeof packageId !== "string") throw new Error("Catalogo OpenBDAP privo di package id");
const csvUrl = `https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${packageId}.csv`;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(input.toString());
  if (url.pathname.endsWith("/package_search")) {
    return new Response(packageBytes, { headers: { "content-type": "application/json" } });
  }
  if (url.toString() === csvUrl) {
    return new Response(csvBytes, { headers: { "content-type": "text/csv" } });
  }
  throw new Error(`URL non previsto dal generatore snapshot: ${url}`);
};

try {
  resetBudgetLawMissionSeriesCacheForTests();
  const liveSeries = await getBudgetLawMissionSeries({ windowYears: 10, allowSnapshot: false });
  const series = validateBudgetLawMissionSeries(
    { ...liveSeries, dataMode: "snapshot", observedAt },
    { expectedDataMode: "snapshot" },
  );
  const artifact = {
    schemaVersion: 1,
    source: {
      packageId,
      resourceId: series.dataset.resourceId,
      title: series.dataset.title,
      license: series.dataset.license,
      licenseUrl: series.dataset.licenseUrl,
      catalogUrl: PACKAGE_SEARCH_URL,
      csvUrl,
      catalogSha256: `sha256:${sha256(packageBytes)}`,
      catalogBytes: packageBytes.byteLength,
      csvSha256: `sha256:${sha256(csvBytes)}`,
      csvBytes: csvBytes.byteLength,
      encoding: "cp1252",
      delimiter: ";",
      quoteChar: '"',
      lineEnding: "CRLF",
      observedAt,
    },
    series,
  };
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Snapshot Legge di Bilancio scritto: ${outputPath}`);
} finally {
  globalThis.fetch = originalFetch;
  resetBudgetLawMissionSeriesCacheForTests();
}
