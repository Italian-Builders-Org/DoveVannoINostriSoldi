#!/usr/bin/env node
/**
 * Compact index for /personale-pa/conto-annuale: search, rankings and type aggregates.
 * Reads committed integrated row shards only (offline, fail-closed).
 */
import { createGunzip } from "node:zlib";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const rowsDir = join(root, "src/data/generated/integrated/rows");
const outDir = join(root, "src/data/generated/rgs-conto-annuale-occupazione-ente-index");
const catalog = JSON.parse(readFileSync(join(root, "src/data/generated/integrated/catalog.json"), "utf8"));
const enteSpec = JSON.parse(
  readFileSync(join(root, "scripts/etl/specs/rgs-conto-annuale-occupazione-ente.source.json"), "utf8"),
);

const ENTE_ID = "rgs-conto-annuale-occupazione-ente-2010-2024";
const TIPO_ID = "rgs-conto-annuale-occupazione-tipologia-2010-2024";
const YEARS = enteSpec.years.map((entry) => entry.year);
const BASELINE = YEARS[0];
const LATEST = YEARS[YEARS.length - 1];
const SHARD_COUNT = 256;

function shardIdForCode(code) {
  return String(Number(code) % SHARD_COUNT).padStart(3, "0");
}

const PERMANENT = [
  "Numero Dipendenti Donne Tempo Pieno",
  "Numero Dipendenti Uomini Tempo Pieno",
  "Numero Dipendenti Donne Part time Inf. 50%",
  "Numero Dipendenti Uomini Part time Inf. 50%",
  "Numero Dipendenti Donne Part time Sup. 50%",
  "Numero Dipendenti Uomini Part time Sup. 50%",
];
const FLEXIBLE = [
  "Numero Dipendenti Donne Tempo Determinato",
  "Numero Dipendenti Uomini Tempo Determinato",
  "Numero Dipendenti Donne Formazione Lavoro",
  "Numero Dipendenti Uomini Formazione Lavoro",
  "Numero Dipendenti Donne Lavoro Interinale",
  "Numero Dipendenti Uomini Lavoro Interinale",
  "Numero Dipendenti Donne Lavoro Socialmente Utile",
  "Numero Dipendenti Uomini Lavoro Socialmente Utile",
];

function datasetMeta(id) {
  const entry = catalog.datasets.find((item) => item.id === id);
  if (!entry) throw new Error(`Dataset assente dal catalogo: ${id}`);
  return entry;
}

function parseMeasure(raw, decimalYear) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw new Error("Misura non testuale");
  const trimmed = raw.trim();
  if (decimalYear) {
    if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(trimmed)) throw new Error(`Misura decimale non conforme: ${trimmed}`);
    return Number(trimmed);
  }
  if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) throw new Error(`Misura intera non conforme: ${trimmed}`);
  return Number(trimmed);
}

function sumMeasures(cells, keys, decimalYear) {
  let total = 0;
  for (const key of keys) {
    const value = parseMeasure(cells[key], decimalYear);
    if (value === null) throw new Error(`Misura mancante ${key}`);
    total += value;
  }
  return total;
}

async function readDataset(datasetId) {
  const names = (await import("node:fs/promises")).readdir(rowsDir);
  const sorted = (await names).filter((name) => name.startsWith(`${datasetId}.`) && name.endsWith(".jsonl.gz")).sort();
  if (sorted.length === 0) throw new Error(`Nessuno shard per ${datasetId}`);
  const rows = [];
  for (const file of sorted) {
    const rl = createInterface({ input: createReadStream(join(rowsDir, file)).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line));
    }
  }
  return rows;
}

function institutionKey(name) {
  return name.trim().toLocaleUpperCase("it-IT");
}

const institutions = new Map();
const typeTotalsLatest = new Map();
let enteRowCount = 0;

for (const row of await readDataset(ENTE_ID)) {
  enteRowCount += 1;
  const cells = row.cells || row;
  const year = Number(cells.Anno);
  if (!YEARS.includes(year)) throw new Error(`Anno fuori perimetro: ${cells.Anno}`);
  const code = cells["Codice istituzione"];
  if (!/^[1-9]\d*$/.test(code)) throw new Error(`Codice istituzione non valido: ${code}`);
  const decimalYear = year >= 2021;
  const permanent = sumMeasures(cells, PERMANENT, decimalYear);
  const flexible = sumMeasures(cells, FLEXIBLE, decimalYear);
  const name = cells.Ente?.trim();
  const type = cells["Tipo istituzione"]?.trim();
  const bdap = cells["Codice ente BDAP"]?.trim() ?? "";
  if (!name || !type) throw new Error(`Denominazione o tipo mancanti per ${code}`);

  let inst = institutions.get(code);
  if (!inst) {
    inst = {
      code,
      type,
      bdap: bdap || null,
      names: new Set(),
      byYear: new Map(),
    };
    institutions.set(code, inst);
  }
  if (year === LATEST) {
    inst.type = type;
    inst.bdap = bdap || null;
  }
  if (inst.byYear.has(year)) throw new Error(`Duplicato ${code} ${year}`);
  inst.names.add(name);
  inst.byYear.set(year, {
    permanent: Math.round(permanent * (decimalYear ? 100 : 1)) / (decimalYear ? 100 : 1),
    flexible: Math.round(flexible * 100) / 100,
    name,
    sourceUrl: cells["URL fonte"],
  });
  if (year === LATEST) {
    const bucket = typeTotalsLatest.get(type) ?? { permanent: 0, flexible: 0, institutions: 0 };
    bucket.permanent += permanent;
    bucket.flexible += flexible;
    bucket.institutions += 1;
    typeTotalsLatest.set(type, bucket);
  }
}

const enteMeta = datasetMeta(ENTE_ID);
if (enteRowCount !== enteMeta.publicRows) {
  throw new Error(`Attese ${enteMeta.publicRows} righe ente, trovate ${enteRowCount}`);
}
if (institutions.size !== 12454) {
  throw new Error(`Attese 12454 istituzioni distinte, trovate ${institutions.size}`);
}

const search = [];
const comuneNameToCode = new Map();
const movers = [];

for (const inst of institutions.values()) {
  const latest = inst.byYear.get(LATEST);
  if (!latest) continue;
  const baseline = inst.byYear.get(BASELINE);
  let peakYear = LATEST;
  let peakPermanent = latest.permanent;
  for (const [year, point] of inst.byYear) {
    if (point.permanent > peakPermanent) {
      peakPermanent = point.permanent;
      peakYear = year;
    }
  }
  const series = [...inst.byYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, point]) => [year, point.name, point.permanent, point.flexible, point.sourceUrl]);
  const record = {
    code: inst.code,
    name: latest.name,
    type: inst.type,
    bdap: inst.bdap,
    permanentLatest: latest.permanent,
    flexibleLatest: latest.flexible,
    permanentBaseline: baseline?.permanent ?? null,
    peakPermanent,
    peakYear,
    nameVariants: [...inst.names].sort(),
    series,
  };
  search.push(record);
  if (inst.type === "COMUNI") {
    const key = institutionKey(latest.name);
    const previous = comuneNameToCode.get(key);
    if (previous === undefined) comuneNameToCode.set(key, inst.code);
    else if (previous !== inst.code) comuneNameToCode.set(key, null);
  }
  if (baseline && baseline.permanent > 0 && latest.permanent >= 0) {
    movers.push({
      code: inst.code,
      name: latest.name,
      type: inst.type,
      baseline: baseline.permanent,
      latest: latest.permanent,
      delta: latest.permanent - baseline.permanent,
    });
  }
}

search.sort((a, b) => a.name.localeCompare(b.name, "it"));
movers.sort((a, b) => b.delta - a.delta);
const growth = movers.filter((item) => item.delta > 0).slice(0, 12);
const shrink = [...movers].sort((a, b) => a.delta - b.delta).filter((item) => item.delta < 0).slice(0, 12);

const typeSeries = [];
for (const row of await readDataset(TIPO_ID)) {
  const cells = row.cells || row;
  const year = Number(cells.Anno);
  if (!YEARS.includes(year)) throw new Error(`Anno tipologia fuori perimetro: ${cells.Anno}`);
  const decimalYear = year >= 2021;
  typeSeries.push({
    year,
    type: cells["Tipo istituzione"],
    administrationClass: cells["Tipologia amministrazione"],
    permanent: sumMeasures(cells, PERMANENT, decimalYear),
    flexible: sumMeasures(cells, FLEXIBLE, decimalYear),
  });
}
const tipologiaMeta = datasetMeta(TIPO_ID);
if (typeSeries.length !== tipologiaMeta.publicRows) {
  throw new Error(`Attese ${tipologiaMeta.publicRows} righe tipologia, trovate ${typeSeries.length}`);
}

const nationalSeries = YEARS.map((year) => {
  const rows = typeSeries.filter((item) => item.year === year);
  return {
    year,
    permanent: rows.reduce((sum, item) => sum + item.permanent, 0),
    flexible: Math.round(rows.reduce((sum, item) => sum + item.flexible, 0) * 100) / 100,
    types: rows.length,
  };
});

mkdirSync(outDir, { recursive: true });
const shardDir = join(outDir, "shards");
mkdirSync(shardDir, { recursive: true });

const summaryPayload = {
  schemaVersion: 2,
  datasetId: ENTE_ID,
  tipologiaDatasetId: TIPO_ID,
  years: YEARS,
  baselineYear: BASELINE,
  latestYear: LATEST,
  institutionCount: institutions.size,
  publicRows: enteMeta.publicRows,
  searchableCount: search.length,
  catalogSha256: catalog.releaseSetSha256,
  rowsSha256: enteMeta.rowsSha256,
  sourceMetadata: enteMeta.sourceMetadata,
  caveats: enteMeta.caveats,
  licenseStatus: enteMeta.licenseStatus,
  nationalSeries,
  typeTotalsLatest: [...typeTotalsLatest.entries()]
    .map(([type, values]) => ({ type, ...values }))
    .sort((a, b) => b.permanent - a.permanent),
  growth,
  shrink,
};

const searchPayload = search.map(({ code, name, type, permanentLatest }) => ({
  code,
  name,
  type,
  permanentLatest,
}));

const exactNameToCode = new Map();
for (const record of search) {
  for (const name of [record.name, ...record.nameVariants]) {
    const key = institutionKey(name);
    const previous = exactNameToCode.get(key);
    if (previous === undefined) exactNameToCode.set(key, record.code);
    else if (previous !== record.code) exactNameToCode.set(key, null);
  }
}

const byCodePayload = Object.fromEntries(
  search.map(({ code, name, type, bdap, permanentLatest, flexibleLatest, permanentBaseline, peakPermanent, peakYear }) => [
    code,
    { code, name, type, bdap, permanentLatest, flexibleLatest, permanentBaseline, peakPermanent, peakYear },
  ]),
);

const resolvePayload = {
  schemaVersion: 1,
  comuneNameToCode: Object.fromEntries([...comuneNameToCode.entries()].filter(([, code]) => code !== null)),
  exactNameToCode: Object.fromEntries([...exactNameToCode.entries()].filter(([, code]) => code !== null)),
};

const shardBuckets = new Map();
for (const record of search) {
  const shardId = shardIdForCode(record.code);
  let bucket = shardBuckets.get(shardId);
  if (!bucket) {
    bucket = { schemaVersion: 1, bucket: Number(shardId), institutions: {} };
    shardBuckets.set(shardId, bucket);
  }
  const { series, ...summaryFields } = record;
  bucket.institutions[record.code] = { ...summaryFields, series };
}

const summaryJson = `${JSON.stringify(summaryPayload)}\n`;
const searchJson = `${JSON.stringify(searchPayload)}\n`;
const resolveJson = `${JSON.stringify(resolvePayload)}\n`;
const byCodeJson = `${JSON.stringify({ schemaVersion: 1, byCode: byCodePayload })}\n`;

writeFileSync(join(outDir, "summary.json"), summaryJson);
writeFileSync(join(outDir, "search.json"), searchJson);
writeFileSync(join(outDir, "resolve.json"), resolveJson);
writeFileSync(join(outDir, "by-code.json"), byCodeJson);

const shardManifest = { schemaVersion: 1, shardCount: SHARD_COUNT, buckets: [] };
let seriesBytes = 0;
for (let bucket = 0; bucket < SHARD_COUNT; bucket += 1) {
  const shardId = String(bucket).padStart(3, "0");
  const payload = shardBuckets.get(shardId) ?? { schemaVersion: 1, bucket, institutions: {} };
  const shardJson = `${JSON.stringify(payload)}\n`;
  seriesBytes += Buffer.byteLength(shardJson);
  writeFileSync(join(shardDir, `bucket-${shardId}.json`), shardJson);
  shardManifest.buckets.push({
    id: shardId,
    path: `shards/bucket-${shardId}.json`,
    bytes: Buffer.byteLength(shardJson),
    institutions: Object.keys(payload.institutions).length,
  });
}

const manifestJson = `${JSON.stringify(shardManifest)}\n`;
writeFileSync(join(shardDir, "manifest.json"), manifestJson);

writeFileSync(
  join(outDir, "meta.json"),
  `${JSON.stringify({
    schemaVersion: 2,
    datasetId: ENTE_ID,
    summaryPath: "summary.json",
    searchPath: "search.json",
    resolvePath: "resolve.json",
    byCodePath: "by-code.json",
    shardManifestPath: "shards/manifest.json",
    summaryBytes: Buffer.byteLength(summaryJson),
    searchBytes: Buffer.byteLength(searchJson),
    resolveBytes: Buffer.byteLength(resolveJson),
    byCodeBytes: Buffer.byteLength(byCodeJson),
    seriesBytes,
    sha256: createHash("sha256")
      .update(summaryJson)
      .update(searchJson)
      .update(resolveJson)
      .update(byCodeJson)
      .digest("hex"),
    institutionCount: search.length,
    generatedFromRowsSha256: enteMeta.rowsSha256,
  })}\n`,
);

console.log(
  `Wrote ${outDir} (${search.length} istituzioni; summary ${Buffer.byteLength(summaryJson)} B, search ${Buffer.byteLength(searchJson)} B, resolve ${Buffer.byteLength(resolveJson)} B, by-code ${Buffer.byteLength(byCodeJson)} B, series ${seriesBytes} B)`,
);
