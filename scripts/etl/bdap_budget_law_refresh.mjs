#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aggregateBudgetLawRecords,
  budgetLawSeriesFromAggregate,
  normalizeBudgetLawPackage,
  validateBudgetLawMissionSeries,
  validateBudgetLawSnapshotArtifact,
} from "../../src/lib/bdap-legge-bilancio.ts";
import { parseDelimitedRows } from "../../src/lib/data/delimited.ts";
import { fetchOfficialSource } from "../../src/lib/data/source-fetch.ts";

export const SNAPSHOT_PATH = "src/data/generated/openbdap-budget-law-missions.json";
export const LOCK_PATH = "scripts/etl/specs/openbdap-budget-law-missions.source.json";
export const CATALOG_URL = "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_search?q=LBF_SPE_CRU_AMPMA_001&rows=20";
const HEADERS = ["Esercizio Finanziario", "Stato di Previsione", "Amministrazione", "Missione", "Programma", "Unità di voto 1° Livello", "Unità di voto 2° Livello", "Unità di voto 3° Livello", "Macroaggregato", "Legge di Bilancio CP A1", "Legge di Bilancio CP A2", "Legge di Bilancio CP A3", "Legge di Bilancio CS A1", "Legge di Bilancio CS A2", "Legge di Bilancio CS A3"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function datasetFromCatalog(bytes) {
  const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (payload.success !== true || !Array.isArray(payload.result?.results)) throw new Error("Catalogo OpenBDAP non valido");
  const datasets = payload.result.results.map(normalizeBudgetLawPackage).filter(Boolean);
  if (datasets.length !== 1) throw new Error("Il catalogo deve identificare un solo prodotto Legge di Bilancio");
  return datasets[0];
}

/** Pure candidate construction; no network, cache fallback or filesystem mutation. */
export function buildBudgetLawRefresh({ catalogBytes, csvBytes, observedAt, previous, previousLock }) {
  validateBudgetLawSnapshotArtifact(previous, previousLock);
  if (new Date(observedAt).toISOString() !== observedAt || observedAt < previous.source.observedAt) {
    throw new Error("Data di osservazione non canonica o precedente allo snapshot");
  }
  const dataset = datasetFromCatalog(catalogBytes);
  // Identity and licence must match the runtime contract before any proposal.
  validateBudgetLawMissionSeries({ ...previous.series, dataset });
  const text = new TextDecoder("windows-1252").decode(csvBytes);
  if (!text.includes("\r\n") || /(?<!\r)\n/.test(text)) throw new Error("Formato CSV diverso dal CRLF verificato");
  const rows = parseDelimitedRows(text);
  if (rows.length < 2 || JSON.stringify(rows[0]) !== JSON.stringify(HEADERS)
    || rows.some((row) => row.length !== HEADERS.length)) {
    throw new Error("Schema CSV Legge di Bilancio inatteso");
  }
  const records = rows.slice(1).map((row) => Object.fromEntries(HEADERS.map((field, index) => [field, row[index]])));
  if (records.some((row) => !/^\d{4}$/.test(row[HEADERS[0]]?.trim() ?? "") || (Number(row[HEADERS[0]]) >= 2017 && !row.Missione?.trim()))) {
    throw new Error("Riga CSV priva di anno o missione: aggiornamento incompleto");
  }
  const keys = new Set();
  for (const row of records) {
    if (Number(row[HEADERS[0]]) < 2017) continue;
    const key = JSON.stringify(HEADERS.slice(0, 9).map((field) => row[field]));
    if (keys.has(key)) throw new Error("Riga contabile duplicata nella fonte");
    keys.add(key);
  }
  const aggregate = aggregateBudgetLawRecords(dataset, records, observedAt);
  const years = aggregate.availableYears;
  if (!years.length || years.length > 20 || years[0] !== previous.series.years[0]
    || years.at(-1) < previous.series.years.at(-1)
    || years.some((year, i) => i > 0 && year !== years[i - 1] + 1)) {
    throw new Error("Copertura temporale ridotta, discontinua o oltre il contratto");
  }
  const expectedMissions = [...previous.series.missions].sort();
  for (const year of years) {
    if (JSON.stringify([...(aggregate.missionsByYear.get(year) ?? [])].sort()) !== JSON.stringify(expectedMissions)) {
      throw new Error(`Tassonomia o copertura delle missioni cambiata nel ${year}`);
    }
  }
  const series = validateBudgetLawMissionSeries({
    ...budgetLawSeriesFromAggregate(aggregate, years.length), dataMode: "snapshot",
  }, { expectedDataMode: "snapshot" });
  const lock = structuredClone(previousLock);
  lock.source.observedAt = observedAt;
  lock.source.catalog = { bytes: catalogBytes.byteLength, sha256: digest(catalogBytes) };
  lock.source.csv = { ...lock.source.csv, bytes: csvBytes.byteLength, sha256: digest(csvBytes), rowsIncludingHeader: records.length + 1 };
  lock.transformation = { ...lock.transformation, years, allocations: series.allocations.length, yearOverYearDeltas: series.yearOverYearDeltas.length };
  lock.expectedAnnualTotalsEur = Object.fromEntries(years.map((year) => [year,
    series.allocations.filter((row) => row.year === year).reduce((sum, row) => sum + row.amountEur, 0),
  ]));
  const artifact = {
    schemaVersion: 1,
    source: { ...previous.source, observedAt,
      catalogSha256: `sha256:${lock.source.catalog.sha256}`, catalogBytes: catalogBytes.byteLength,
      csvSha256: `sha256:${lock.source.csv.sha256}`, csvBytes: csvBytes.byteLength,
    },
    series,
  };
  validateBudgetLawSnapshotArtifact(artifact, lock);
  const unchanged = artifact.source.csvSha256 === previous.source.csvSha256
    && JSON.stringify(dataset) === JSON.stringify(previous.series.dataset);
  return { changed: !unchanged, artifact: unchanged ? previous : artifact, lock: unchanged ? previousLock : lock };
}

async function download(url, kind, maxBytes, fetchSource, signal) {
  const response = await fetchSource("openbdap", url, {
    kind, signal, cacheMode: "no-store", rejectHttpError: true,
    headers: { Accept: kind === "discovery" ? "application/json" : "text/csv" },
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`OpenBDAP HTTP ${response.status}`); }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes(kind === "discovery" ? "json" : "csv")) {
    await response.body?.cancel(); throw new Error(`OpenBDAP formato inatteso: ${type}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenBDAP risposta priva di corpo");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`OpenBDAP supera il limite di ${maxBytes} byte`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function fetchBudgetLawRefresh({ previous, previousLock, observedAt = new Date().toISOString(), fetchSource = fetchOfficialSource }) {
  validateBudgetLawSnapshotArtifact(previous, previousLock);
  const signal = AbortSignal.timeout(70_000);
  const catalogBytes = await download(CATALOG_URL, "discovery", 2 * 1024 * 1024, fetchSource, signal);
  const dataset = datasetFromCatalog(catalogBytes);
  validateBudgetLawMissionSeries({ ...previous.series, dataset });
  const csvBytes = await download(dataset.csvUrl, "data", 32 * 1024 * 1024, fetchSource, signal);
  return buildBudgetLawRefresh({ catalogBytes, csvBytes, observedAt, previous, previousLock });
}

export function writeBudgetLawRefresh(candidate, { snapshotPath = SNAPSHOT_PATH, lockPath = LOCK_PATH } = {}) {
  if (!candidate.changed) return;
  validateBudgetLawSnapshotArtifact(candidate.artifact, candidate.lock);
  const files = [[snapshotPath, jsonBytes(candidate.artifact)], [lockPath, jsonBytes(candidate.lock)]];
  const originals = files.map(([path]) => readFileSync(path));
  const staged = files.map(([path]) => `${path}.${process.pid}.tmp`);
  try {
    files.forEach(([, payload], index) => writeFileSync(staged[index], payload, { flag: "wx" }));
    files.forEach(([path], index) => renameSync(staged[index], path));
  } catch (error) {
    files.forEach(([path], index) => writeFileSync(path, originals[index]));
    throw error;
  } finally {
    staged.forEach((path) => rmSync(path, { force: true }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error("Il refresh non accetta URL o percorsi arbitrari");
  const candidate = await fetchBudgetLawRefresh({ previous: readJson(SNAPSHOT_PATH), previousLock: readJson(LOCK_PATH) });
  writeBudgetLawRefresh(candidate);
  console.log(candidate.changed ? "Snapshot e source lock aggiornati: candidato da validare e proporre in PR" : "Fonte invariata: nessuna modifica agli artifact o alla data di acquisizione");
}
