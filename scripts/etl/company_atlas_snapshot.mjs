import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = resolve(ROOT, "src/data/generated/company-atlas-snapshot.json");

export const SOURCE_URLS = Object.freeze({
  activeStock: "https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia.json",
  workforce: "https://opendata.marche.camcom.it/data/2026-Q2-Addetti-Localizzazioni-Attive-Italia.csv",
  productionValue: "https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia-Valore-Produzione.json",
});

const REGION_CODES = Object.freeze({
  ITF1: "13",
  ITF5: "17",
  ITF6: "18",
  ITF3: "15",
  ITH5: "08",
  ITH4: "06",
  ITI4: "12",
  ITC3: "07",
  ITC4: "03",
  ITI3: "11",
  ITF2: "14",
  ITC1: "01",
  ITF4: "16",
  ITG2: "20",
  ITG1: "19",
  ITI1: "09",
  ITH1_H2: "04",
  ITI2: "10",
  ITC2: "02",
  ITH3: "05",
});

const REGION_NAMES = Object.freeze({
  "01": "Piemonte",
  "02": "Valle d'Aosta",
  "03": "Lombardia",
  "04": "Trentino-Alto Adige",
  "05": "Veneto",
  "06": "Friuli-Venezia Giulia",
  "07": "Liguria",
  "08": "Emilia-Romagna",
  "09": "Toscana",
  "10": "Umbria",
  "11": "Marche",
  "12": "Lazio",
  "13": "Abruzzo",
  "14": "Molise",
  "15": "Campania",
  "16": "Puglia",
  "17": "Basilicata",
  "18": "Calabria",
  "19": "Sicilia",
  "20": "Sardegna",
});

const EXPECTED_REGION_CODES = Object.freeze(Object.keys(REGION_NAMES).sort());
const EXPECTED_SECTOR_CODES = Object.freeze([
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
  "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "X",
]);

const WORKFORCE_RELEASE = Object.freeze({
  period: "2026-Q2",
  updatedAt: "2026-08-04",
  rows: 118_673,
  employees: 19_490_025,
  localUnits: 6_394_474,
});

function normalizeRegionLabel(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[’‘]/g, "'")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .toLocaleUpperCase("it-IT");
}

const REGION_SOURCE_NAMES = Object.freeze({
  [normalizeRegionLabel("ABRUZZO")]: "13",
  [normalizeRegionLabel("BASILICATA")]: "17",
  [normalizeRegionLabel("CALABRIA")]: "18",
  [normalizeRegionLabel("CAMPANIA")]: "15",
  [normalizeRegionLabel("EMILIA ROMAGNA")]: "08",
  [normalizeRegionLabel("EMILIA-ROMAGNA")]: "08",
  [normalizeRegionLabel("FRIULI-VENEZIA GIULIA")]: "06",
  [normalizeRegionLabel("LAZIO")]: "12",
  [normalizeRegionLabel("LIGURIA")]: "07",
  [normalizeRegionLabel("LOMBARDIA")]: "03",
  [normalizeRegionLabel("MARCHE")]: "11",
  [normalizeRegionLabel("MOLISE")]: "14",
  [normalizeRegionLabel("PIEMONTE")]: "01",
  [normalizeRegionLabel("PUGLIA")]: "16",
  [normalizeRegionLabel("SARDEGNA")]: "20",
  [normalizeRegionLabel("SICILIA")]: "19",
  [normalizeRegionLabel("TOSCANA")]: "09",
  [normalizeRegionLabel("TRENTINO ALTO ADIGE")]: "04",
  [normalizeRegionLabel("TRENTINO-ALTO ADIGE")]: "04",
  [normalizeRegionLabel("UMBRIA")]: "10",
  [normalizeRegionLabel("VALLE D'AOSTA")]: "02",
  [normalizeRegionLabel("VENETO")]: "05",
});

const LICENSE = "CC BY 4.0";
const ATECO_VERSION = "ATECO 2025";
const OBSERVED_AT_OVERRIDE = process.argv.find((arg) => arg.startsWith("--observed-at="))?.split("=", 2)[1]
  ?? process.env.COMPANY_ATLAS_OBSERVED_AT
  ?? null;

function latestSourceTimestamp(values) {
  const timestamps = values
    .map((value) => {
      if (value == null || value === "") return null;
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
    })
    .filter(Boolean)
    .sort();
  if (timestamps.length === 0) {
    throw new Error("Nessuna data di aggiornamento fonte valida");
  }
  return timestamps[timestamps.length - 1];
}

function categoryCodes(dataset, dimensionId) {
  const category = dataset.dimension[dimensionId].category;
  return Array.isArray(category.index) ? category.index : Object.keys(category.label);
}

function categoryLabel(dataset, dimensionId, code) {
  return dataset.dimension[dimensionId].category.label[code] ?? code;
}

function readJsonStatValue(dataset, selection) {
  const positions = dataset.id.map((dimensionId) => {
    const codes = categoryCodes(dataset, dimensionId);
    const position = codes.indexOf(String(selection[dimensionId]));
    if (position < 0) throw new Error(`Codice ${selection[dimensionId]} non trovato in ${dimensionId}`);
    return position;
  });

  let offset = 0;
  for (let index = 0; index < positions.length; index += 1) {
    let stride = 1;
    for (let next = index + 1; next < dataset.size.length; next += 1) stride *= dataset.size[next];
    offset += positions[index] * stride;
  }
  return dataset.value[offset] ?? null;
}

function displaySectorLabel(label, code) {
  return label.replace(new RegExp(`^${code}\\s*-\\s*`), "");
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertExactSet(actualValues, expectedValues, label) {
  const actual = [...new Set(actualValues)].sort();
  const expected = [...new Set(expectedValues)].sort();
  if (actual.length !== actualValues.length || actual.join("|") !== expected.join("|")) {
    throw new Error(`${label} inattesi: attesi ${expected.join(", ")}; ricevuti ${actual.join(", ")}`);
  }
}

function workforceValue(value, field, lineNumber) {
  const parsed = numericValue(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Valore ${field} non valido alla riga CSV ${lineNumber}: ${value}`);
  }
  return parsed;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} ha risposto HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} ha risposto HTTP ${response.status}`);
  return response.text();
}

function sourceRecord({ id, label, url, updatedAt, observedAt, cadence, coverage, caveat }) {
  return {
    id,
    label,
    url,
    publisher: "CCIAA Marche su dati InfoCamere",
    license: LICENSE,
    updatedAt,
    observedAt,
    cadence,
    coverage,
    caveat,
  };
}

function normalizeActiveStock(dataset) {
  const sourceRegions = dataset.dimension?.geo?.category?.child?.IT;
  if (!Array.isArray(sourceRegions)) throw new Error("Copertura regionale JSON-stat assente o non valida");
  assertExactSet(sourceRegions, Object.keys(REGION_CODES), "Regioni JSON-stat");
  const sectors = categoryCodes(dataset, "ateco2025").filter((code) => code !== "TOTAL");
  assertExactSet(sectors, EXPECTED_SECTOR_CODES, "Sezioni ATECO JSON-stat");
  const periods = categoryCodes(dataset, "time").map((code) => ({
    id: categoryLabel(dataset, "time", code),
    label: categoryLabel(dataset, "time", code),
  }));
  const observations = [];

  for (const sourceRegionCode of sourceRegions) {
    const regionCode = REGION_CODES[sourceRegionCode];
    if (!regionCode) throw new Error(`Regione JSON-stat non mappata: ${sourceRegionCode}`);
    for (const sectorCode of sectors) {
      for (const period of periods) {
        observations.push({
          observationType: "aggregate",
          geographyLevel: "region",
          geographyCode: regionCode,
          geographyName: REGION_NAMES[regionCode],
          atecoVersion: ATECO_VERSION,
          sectorCode,
          sectorLabel: displaySectorLabel(categoryLabel(dataset, "ateco2025", sectorCode), sectorCode),
          metric: "active_enterprises",
          period: period.id,
          value: numericValue(readJsonStatValue(dataset, {
            metric: "V11910",
            geo: sourceRegionCode,
            ateco2025: sectorCode,
            time: categoryCodes(dataset, "time").find((code) => categoryLabel(dataset, "time", code) === period.id),
          })),
          sourceId: "active-stock",
        });
      }
    }
  }

  return {
    observations,
    periods,
    updatedAt: dataset.updated,
    regions: sourceRegions.map((sourceRegionCode) => {
      const code = REGION_CODES[sourceRegionCode];
      return { code, name: REGION_NAMES[code], sourceCode: sourceRegionCode };
    }),
    sectors: sectors.map((code) => ({
      code,
      label: displaySectorLabel(categoryLabel(dataset, "ateco2025", code), code),
    })),
  };
}

export function normalizeWorkforce(csv, sectorLabels = new Map(), options = {}) {
  const expectedHeader = "Regione;Provincia;Settore;Divisione;Classe;Sottocategoria;Addetti;Localizzazioni Attive";
  const expectedRegionCodes = options.expectedRegionCodes ?? EXPECTED_REGION_CODES;
  const expectedSectorCodes = options.expectedSectorCodes ?? EXPECTED_SECTOR_CODES;
  const expectedRows = options.expectedRows ?? WORKFORCE_RELEASE.rows;
  const expectedTotals = options.expectedTotals ?? {
    employees: WORKFORCE_RELEASE.employees,
    localUnits: WORKFORCE_RELEASE.localUnits,
  };
  const period = options.period ?? WORKFORCE_RELEASE.period;
  const expectedRegionSet = new Set(expectedRegionCodes);
  const expectedSectorSet = new Set(expectedSectorCodes);
  const lines = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const header = lines.shift()?.trim();
  if (header !== expectedHeader) throw new Error(`Intestazione CSV inattesa: ${header}`);

  const dataLines = lines.filter((line) => line.trim());
  const sourceRegions = new Set();
  const sourceSectors = new Set();
  const sourceRows = [];
  const sourceRowKeys = new Set();
  let employeesTotal = 0;
  let localUnitsTotal = 0;

  for (const [index, line] of dataLines.entries()) {
    const lineNumber = index + 2;
    const fields = line.split(";").map((field) => field.trim());
    if (fields.length !== 8) {
      throw new Error(`Riga CSV ${lineNumber} con ${fields.length} colonne, attese 8`);
    }
    const [rawRegion, province, rawSectorCode, division, classe, sottocategoria, employees, localUnits] = fields;
    if (!rawRegion || !province || !rawSectorCode || !division || !classe || !sottocategoria) {
      throw new Error(`Dimensione CSV vuota alla riga ${lineNumber}`);
    }
    const normalizedRegion = normalizeRegionLabel(rawRegion);
    const regionCode = REGION_SOURCE_NAMES[normalizedRegion];
    if (!regionCode || !expectedRegionSet.has(regionCode)) {
      throw new Error(`Regione CSV non mappata alla riga ${lineNumber}: ${rawRegion}`);
    }
    const sectorCode = rawSectorCode.toLocaleUpperCase("it-IT");
    if (!/^[A-Z]$/.test(sectorCode) || !expectedSectorSet.has(sectorCode)) {
      throw new Error(`Settore ATECO CSV inatteso alla riga ${lineNumber}: ${rawSectorCode}`);
    }
    if (!/^\d{2}$/.test(division) || !/^\d{2,4}$/.test(classe) || !/^\d{2,6}$/.test(sottocategoria)) {
      throw new Error(`Codice ATECO CSV non valido alla riga ${lineNumber}`);
    }
    const sourceRowKey = [regionCode, province, sectorCode, division, classe, sottocategoria].join("|");
    if (sourceRowKeys.has(sourceRowKey)) throw new Error(`Riga CSV duplicata alla riga ${lineNumber}: ${sourceRowKey}`);
    sourceRowKeys.add(sourceRowKey);
    const row = {
      regionCode,
      province,
      sectorCode,
      division,
      classe,
      sottocategoria,
      employees: workforceValue(employees, "Addetti", lineNumber),
      localUnits: workforceValue(localUnits, "Localizzazioni Attive", lineNumber),
    };
    sourceRows.push(row);
    sourceRegions.add(regionCode);
    sourceSectors.add(sectorCode);
    employeesTotal += row.employees;
    localUnitsTotal += row.localUnits;
  }

  if (sourceRows.length !== expectedRows) {
    throw new Error(`Righe workforce inattese: attese ${expectedRows}, ricevute ${sourceRows.length}`);
  }
  assertExactSet([...sourceRegions], expectedRegionCodes, "Regioni CSV");
  assertExactSet([...sourceSectors], expectedSectorCodes, "Sezioni ATECO CSV");
  if (employeesTotal !== expectedTotals.employees || localUnitsTotal !== expectedTotals.localUnits) {
    throw new Error(
      `Totali workforce non riconciliati: attesi ${expectedTotals.employees}/${expectedTotals.localUnits}, `
      + `ricevuti ${employeesTotal}/${localUnitsTotal}`,
    );
  }

  const aggregate = new Map();
  for (const row of sourceRows) {
    const key = [row.regionCode, row.sectorCode].join("|");
    const current = aggregate.get(key) ?? {
      regionCode: row.regionCode,
      sectorCode: row.sectorCode,
      employees: 0,
      localUnits: 0,
      rows: 0,
    };
    current.employees += row.employees;
    current.localUnits += row.localUnits;
    current.rows += 1;
    aggregate.set(key, current);
  }

  const observations = [];
  let observedCells = 0;
  let missingCells = 0;
  for (const regionCode of expectedRegionCodes) {
    for (const sectorCode of expectedSectorCodes) {
      const row = aggregate.get([regionCode, sectorCode].join("|"));
      if (row) observedCells += 1;
      else missingCells += 1;
      const sectorLabel = sectorLabels.get(sectorCode) ?? sectorCode;
      for (const [metric, value] of [
        ["employees", row?.employees ?? null],
        ["active_local_units", row?.localUnits ?? null],
      ]) {
        observations.push({
          observationType: "aggregate",
          geographyLevel: "region",
          geographyCode: regionCode,
          geographyName: REGION_NAMES[regionCode],
          atecoVersion: ATECO_VERSION,
          sectorCode,
          sectorLabel,
          metric,
          period,
          value,
          sourceId: "workforce",
        });
      }
    }
  }
  return {
    observations,
    updatedAt: WORKFORCE_RELEASE.updatedAt,
    period,
    rowsRead: sourceRows.length,
    rowsAccepted: sourceRows.length,
    regionCount: expectedRegionCodes.length,
    sectorCount: expectedSectorCodes.length,
    regionSectorCells: expectedRegionCodes.length * expectedSectorCodes.length,
    observedCells,
    missingCells,
    nullObservations: missingCells * 2,
    employeesTotal,
    localUnitsTotal,
  };
}

function normalizeProductionValue(dataset) {
  const sourceRegions = dataset.dimension?.geo?.category?.child?.IT;
  if (!Array.isArray(sourceRegions)) throw new Error("Copertura regionale JSON-stat assente o non valida");
  assertExactSet(sourceRegions, Object.keys(REGION_CODES), "Regioni JSON-stat");
  const sectors = categoryCodes(dataset, "ateco2025").filter((code) => code !== "TOTAL");
  assertExactSet(sectors, EXPECTED_SECTOR_CODES, "Sezioni ATECO JSON-stat");
  const bands = categoryCodes(dataset, "productionvalue").map((code) => ({
    code,
    label: categoryLabel(dataset, "productionvalue", code),
  }));
  const timeCode = categoryCodes(dataset, "time")[0];
  const period = categoryLabel(dataset, "time", timeCode);
  const observations = [];

  for (const sourceRegionCode of sourceRegions) {
    const regionCode = REGION_CODES[sourceRegionCode];
    if (!regionCode) throw new Error(`Regione JSON-stat non mappata: ${sourceRegionCode}`);
    for (const sectorCode of sectors) {
      for (const band of bands) {
        observations.push({
          observationType: "aggregate",
          geographyLevel: "region",
          geographyCode: regionCode,
          geographyName: REGION_NAMES[regionCode],
          atecoVersion: ATECO_VERSION,
          sectorCode,
          sectorLabel: displaySectorLabel(categoryLabel(dataset, "ateco2025", sectorCode), sectorCode),
          metric: "production_value_band_count",
          period,
          value: numericValue(readJsonStatValue(dataset, {
            metric: "V11910",
            geo: sourceRegionCode,
            ateco2025: sectorCode,
            productionvalue: band.code,
            time: timeCode,
          })),
          bandCode: band.code,
          bandLabel: band.label,
          sourceId: "production-value",
        });
      }
    }
  }

  return { observations, bands, period, updatedAt: dataset.updated };
}

export function validateSnapshot(snapshot) {
  if (snapshot.schemaVersion !== 1) throw new Error("schemaVersion non supportata");
  if (snapshot.observationType !== "aggregate") throw new Error("Il POC accetta soltanto aggregati");
  if (!Array.isArray(snapshot.regions) || snapshot.regions.length !== EXPECTED_REGION_CODES.length) {
    throw new Error("Lo snapshot deve coprire esattamente le 20 regioni");
  }
  assertExactSet(snapshot.regions.map((region) => region.code), EXPECTED_REGION_CODES, "Regioni snapshot");
  if (!Array.isArray(snapshot.sectors)) throw new Error("Sezioni ATECO snapshot assenti");
  assertExactSet(snapshot.sectors.map((sector) => sector.code), EXPECTED_SECTOR_CODES, "Sezioni ATECO snapshot");
  if (!Array.isArray(snapshot.productionBands) || snapshot.productionBands.length !== 10) {
    throw new Error("Fasce di valore della produzione inattese");
  }
  const sourceIds = new Set(snapshot.observations.map((row) => row.sourceId));
  const expectedSourceIds = ["active-stock", "workforce", "production-value"];
  if (sourceIds.size !== expectedSourceIds.length || !expectedSourceIds.every((id) => sourceIds.has(id))) {
    throw new Error("Lo snapshot deve contenere esattamente le tre fonti dichiarate");
  }
  if (!snapshot.sources?.workforce?.caveat
    || !/posizioni previdenziali attive/i.test(snapshot.sources.workforce.caveat)
    || !/trimestre precedente/i.test(snapshot.sources.workforce.caveat)
    || !/occupazione/i.test(snapshot.sources.workforce.caveat)
    || !/istat.*asia/i.test(snapshot.sources.workforce.caveat)) {
    throw new Error("Caveat workforce ufficiale assente o incompleto");
  }

  const observationKeys = new Set();
  const counts = new Map();
  const workforceCells = new Map();
  let activeStockNullValues = 0;
  let productionValueNullValues = 0;
  for (const row of snapshot.observations) {
    if (row.observationType !== "aggregate" || row.geographyLevel !== "region") {
      throw new Error("Trovata un’osservazione fuori dal perimetro aggregato regionale");
    }
    if (!EXPECTED_REGION_CODES.includes(row.geographyCode) || !EXPECTED_SECTOR_CODES.includes(row.sectorCode)) {
      throw new Error(`Geografia o sezione inattesa nell’osservazione: ${row.geographyCode}/${row.sectorCode}`);
    }
    if (row.value !== null && (!Number.isSafeInteger(row.value) || row.value < 0)) {
      throw new Error("Valore osservazione non intero o negativo");
    }
    const key = [row.sourceId, row.metric, row.period, row.geographyCode, row.sectorCode, row.bandCode ?? ""].join("|");
    if (observationKeys.has(key)) throw new Error(`Osservazione duplicata: ${key}`);
    observationKeys.add(key);
    const groupKey = [row.sourceId, row.metric, row.period].join("|");
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
    if (row.sourceId === "active-stock" && row.value === null) activeStockNullValues += 1;
    if (row.sourceId === "production-value" && row.value === null) productionValueNullValues += 1;
    if (row.sourceId === "workforce") {
      if (row.bandCode !== undefined) throw new Error("Il workforce non può contenere fasce di produzione");
      const cellKey = [row.geographyCode, row.sectorCode].join("|");
      const cell = workforceCells.get(cellKey) ?? {};
      cell[row.metric] = row.value;
      workforceCells.set(cellKey, cell);
    }
  }

  const activePeriods = snapshot.periods?.activeStock ?? [];
  const workforcePeriods = snapshot.periods?.workforce ?? [];
  const productionPeriods = snapshot.periods?.productionValue ?? [];
  if (activePeriods.length < 1 || new Set(activePeriods.map((period) => period.id)).size !== activePeriods.length) {
    throw new Error("Periodi stock imprese attive assenti o duplicati");
  }
  if (workforcePeriods.length !== 1 || workforcePeriods[0]?.id !== WORKFORCE_RELEASE.period) {
    throw new Error("Periodo workforce inatteso");
  }
  if (productionPeriods.length !== 1) throw new Error("Periodo production-value inatteso");
  const expectedActiveCount = activePeriods.length * EXPECTED_REGION_CODES.length * EXPECTED_SECTOR_CODES.length;
  const expectedWorkforceCount = EXPECTED_REGION_CODES.length * EXPECTED_SECTOR_CODES.length;
  const expectedProductionCount = expectedWorkforceCount * snapshot.productionBands.length;
  const expectedPerPeriodCount = EXPECTED_REGION_CODES.length * EXPECTED_SECTOR_CODES.length;
  for (const period of activePeriods) {
    if ((counts.get(`active-stock|active_enterprises|${period.id}`) ?? 0) !== expectedPerPeriodCount) {
      throw new Error(`Cardinalità stock imprese attive non riconciliata per ${period.id}`);
    }
  }
  if ((counts.get(`workforce|employees|${WORKFORCE_RELEASE.period}`) ?? 0) !== expectedWorkforceCount
    || (counts.get(`workforce|active_local_units|${WORKFORCE_RELEASE.period}`) ?? 0) !== expectedWorkforceCount) {
    throw new Error("Cardinalità workforce non riconciliata");
  }
  if ((counts.get(`production-value|production_value_band_count|${productionPeriods[0]?.id}`) ?? 0) !== expectedProductionCount) {
    throw new Error("Cardinalità fasce di produzione non riconciliata");
  }
  if (snapshot.observations.length !== expectedActiveCount + expectedWorkforceCount * 2 + expectedProductionCount) {
    throw new Error("Cardinalità complessiva snapshot inattesa");
  }

  let workforceObservedCells = 0;
  let workforceMissingCells = 0;
  let workforceNullObservations = 0;
  let workforceEmployeesTotal = 0;
  let workforceLocalUnitsTotal = 0;
  for (const regionCode of EXPECTED_REGION_CODES) {
    for (const sectorCode of EXPECTED_SECTOR_CODES) {
      const cell = workforceCells.get([regionCode, sectorCode].join("|"));
      if (!cell || !Object.hasOwn(cell, "employees") || !Object.hasOwn(cell, "active_local_units")) {
        throw new Error(`Cella workforce mancante: ${regionCode}/${sectorCode}`);
      }
      const bothNull = cell.employees === null && cell.active_local_units === null;
      const oneNull = cell.employees === null || cell.active_local_units === null;
      if (oneNull && !bothNull) throw new Error(`Null workforce parziale: ${regionCode}/${sectorCode}`);
      if (bothNull) {
        workforceMissingCells += 1;
        workforceNullObservations += 2;
      } else {
        workforceObservedCells += 1;
        workforceEmployeesTotal += cell.employees;
        workforceLocalUnitsTotal += cell.active_local_units;
      }
    }
  }
  const coverage = snapshot.coverage;
  const expectedCoverage = {
    activeStockObservations: expectedActiveCount,
    activeStockNullValues,
    workforceRowsRead: WORKFORCE_RELEASE.rows,
    workforceRowsAccepted: WORKFORCE_RELEASE.rows,
    workforceRegionCount: EXPECTED_REGION_CODES.length,
    workforceSectorCount: EXPECTED_SECTOR_CODES.length,
    workforceRegionSectorCells: expectedWorkforceCount,
    workforceObservedCells,
    workforceMissingCells,
    workforceNullObservations,
    workforceEmployeesTotal: WORKFORCE_RELEASE.employees,
    workforceLocalUnitsTotal: WORKFORCE_RELEASE.localUnits,
    workforceObservations: expectedWorkforceCount * 2,
    productionValueObservations: expectedProductionCount,
    productionValueNullValues,
  };
  for (const [key, value] of Object.entries(expectedCoverage)) {
    if (coverage?.[key] !== value) throw new Error(`Copertura snapshot divergente in ${key}: atteso ${value}, ricevuto ${coverage?.[key]}`);
  }
  if (workforceEmployeesTotal !== WORKFORCE_RELEASE.employees || workforceLocalUnitsTotal !== WORKFORCE_RELEASE.localUnits) {
    throw new Error("Totali workforce nello snapshot non riconciliati con la fonte ufficiale");
  }
}

export async function buildSnapshot() {
  const [activeStock, workforceCsv, productionValue] = await Promise.all([
    fetchJson(SOURCE_URLS.activeStock),
    fetchText(SOURCE_URLS.workforce),
    fetchJson(SOURCE_URLS.productionValue),
  ]);
  const active = normalizeActiveStock(activeStock);
  const sectorLabels = new Map(active.sectors.map((sector) => [sector.code, sector.label]));
  const workforce = normalizeWorkforce(workforceCsv, sectorLabels, {
    expectedRegionCodes: active.regions.map((region) => region.code),
    expectedSectorCodes: active.sectors.map((sector) => sector.code),
  });
  const production = normalizeProductionValue(productionValue);
  const generatedAt = OBSERVED_AT_OVERRIDE
    ?? latestSourceTimestamp([active.updatedAt, workforce.updatedAt, production.updatedAt]);
  const latestActivePeriod = active.periods.at(-1)?.id;
  const snapshot = {
    schemaVersion: 1,
    generatedAt,
    observationType: "aggregate",
    geographyVersion: "regioni ISTAT allineate ai codici territoriali usati dalla fonte",
    atecoVersion: ATECO_VERSION,
    sources: {
      "active-stock": sourceRecord({
        id: "active-stock",
        label: "Imprese attive · stock mensile",
        url: SOURCE_URLS.activeStock,
        updatedAt: active.updatedAt,
        observedAt: generatedAt,
        cadence: "mensile",
        coverage: latestActivePeriod
          ? `Sedi di impresa attive per regione, settore ATECO 2025 e mese; ultimo periodo ${latestActivePeriod}.`
          : "Sedi di impresa attive per regione, settore ATECO 2025 e mese.",
        caveat: "Conta sedi di impresa attive, non ricavi e non gruppi societari.",
      }),
      workforce: sourceRecord({
        id: "workforce",
        label: "Addetti e localizzazioni attive · trimestre",
        url: SOURCE_URLS.workforce,
        updatedAt: workforce.updatedAt,
        observedAt: generatedAt,
        cadence: "trimestrale",
        coverage: "Tutte le righe sono bucket ATECO osservati distinti; la pipeline somma i bucket provinciali a regione × sezione ATECO senza scartare i livelli più specifici.",
        caveat: "Le posizioni previdenziali attive sono conteggiate nel trimestre precedente a quello indicato, a partire dalla fornitura INPS: il dato non rappresenta il livello di occupazione nel territorio e non è direttamente comparabile con ISTAT/ASIA. Le localizzazioni attive comprendono sedi di impresa e unità locali non cessate.",
      }),
      "production-value": sourceRecord({
        id: "production-value",
        label: "Fasce di valore della produzione · bilanci",
        url: SOURCE_URLS.productionValue,
        updatedAt: production.updatedAt,
        observedAt: generatedAt,
        cadence: "annuale",
        coverage: "Numero di sedi attive obbligate al deposito del bilancio per fascia, regione e settore; periodo 31/12/2025.",
        caveat: "Il valore della produzione non è fatturato o ricavi esatti; la fonte lo deriva dai bilanci depositati.",
      }),
    },
    periods: {
      activeStock: active.periods,
      workforce: [{ id: workforce.period, label: "2° trimestre 2026" }],
      productionValue: [{ id: production.period, label: production.period }],
    },
    regions: active.regions.map(({ code, name }) => ({ code, name })),
    sectors: active.sectors,
    productionBands: production.bands,
    observations: [...active.observations, ...workforce.observations, ...production.observations],
    coverage: {
      activeStockObservations: active.observations.length,
      activeStockNullValues: active.observations.filter((observation) => observation.value === null).length,
      workforceRowsRead: workforce.rowsRead,
      workforceRowsAccepted: workforce.rowsAccepted,
      workforceRegionCount: workforce.regionCount,
      workforceSectorCount: workforce.sectorCount,
      workforceRegionSectorCells: workforce.regionSectorCells,
      workforceObservedCells: workforce.observedCells,
      workforceMissingCells: workforce.missingCells,
      workforceNullObservations: workforce.nullObservations,
      workforceEmployeesTotal: workforce.employeesTotal,
      workforceLocalUnitsTotal: workforce.localUnitsTotal,
      workforceObservations: workforce.observations.length,
      productionValueObservations: production.observations.length,
      productionValueNullValues: production.observations.filter((observation) => observation.value === null).length,
    },
  };
  validateSnapshot(snapshot);
  return snapshot;
}

async function main() {
  if (process.argv.includes("--check")) {
    const snapshot = JSON.parse(await readFile(OUTPUT, "utf8"));
    validateSnapshot(snapshot);
    console.log(`OK ${OUTPUT}: ${snapshot.observations.length} osservazioni aggregate`);
    return;
  }
  const snapshot = await buildSnapshot();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Scritto ${OUTPUT}: ${snapshot.observations.length} osservazioni aggregate`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
