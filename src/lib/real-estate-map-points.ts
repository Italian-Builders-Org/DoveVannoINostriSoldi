import "server-only";

import { INTEGRATED_ROW_CHUNK_ROWS, integratedRowChunkCount, type IntegratedPublicRow } from "@/lib/integrated-source-contract";
import { selectSortedRows } from "@/lib/integrated-sorted-lookup";
import { loadIntegratedDatasetChunk, loadIntegratedSourceBundle } from "@/lib/integrated-sources";
import { queryMefMunicipalIrpef } from "@/lib/mef-irpef-snapshot";

export const REAL_ESTATE_POINTS_DATASET_ID = "mef-patrimonio-fabbricati-fermi-2023";

/** One published row: idle buildings of one owner, use and type in one municipality. */
export type RealEstateCountRow = Readonly<{
  region: string;
  municipality: string;
  cadastral: string;
  use: string;
  type: string;
  buildings: number;
  area: number;
}>;

/**
 * A region's municipalities and their idle buildings per use and type, in columns with shared
 * dictionaries. No position below the municipality is published (#609).
 */
export type RealEstateRegionData = Readonly<{
  uses: readonly string[];
  types: readonly string[];
  /** IRPEF 2024 taxpayers by cadastral code; null for municipalities merged away since the census. */
  municipalities: readonly Readonly<{ code: string; name: string; taxpayers: number | null }>[];
  cells: Readonly<{
    municipality: readonly number[];
    use: readonly number[];
    type: readonly number[];
    buildings: readonly number[];
    area: readonly number[];
  }>;
}>;

/** Municipalities where idle buildings are, for search: largest first. */
export type RealEstateMunicipalityIndex = Readonly<{
  code: readonly string[];
  name: readonly string[];
  region: readonly string[];
  count: readonly number[];
}>;

export type RealEstateNationalData = Readonly<{
  total: number;
  byRegion: Readonly<Record<string, number>>;
  byUse: Readonly<Record<string, number>>;
  municipalities: RealEstateMunicipalityIndex;
}>;

export const REGION_CODE_PATTERN = /^(0[1-9]|1[0-9]|20)$/;
const COUNT_PATTERN = /^[1-9][0-9]*$/;
const SURFACE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function cell(row: IntegratedPublicRow, column: string): string {
  const value = row.cells[column];
  if (typeof value !== "string") throw new Error(`Campo mancante nei fabbricati fermi: ${column}.`);
  return value;
}

/** Boundary check on the published rows: anything outside the ETL contract fails closed. */
export function countFromRow(row: IntegratedPublicRow): RealEstateCountRow {
  const region = cell(row, "Codice regione del bene"), buildings = cell(row, "Fabbricati");
  const area = cell(row, "Superficie di riferimento (m²)");
  if (!REGION_CODE_PATTERN.test(region) || !COUNT_PATTERN.test(buildings) || !SURFACE_PATTERN.test(area)) {
    throw new Error(`Riga non valida nei fabbricati fermi: ${row.sourceRow}.`);
  }
  return {
    region,
    municipality: cell(row, "Comune del bene"),
    cadastral: cell(row, "Codice catastale comune del bene"),
    use: cell(row, "Utilizzo del bene"),
    type: cell(row, "Tipologia bene"),
    buildings: Number(buildings),
    area: Number(area),
  };
}

function dictionary() {
  const values: string[] = [];
  const index = new Map<string, number>();
  return {
    values,
    id(value: string) {
      let id = index.get(value);
      if (id === undefined) {
        id = values.length;
        values.push(value);
        index.set(value, id);
      }
      return id;
    },
  };
}

let taxpayersByCode: ReadonlyMap<string, number> | null = null;

/**
 * IRPEF taxpayers by cadastral code, through the IRPEF query boundary. Nationwide, not per region:
 * the census can place a municipality in its former region (Montecopiolo, now in Emilia-Romagna).
 */
function taxpayersOf(cadastral: string): number | null {
  if (!taxpayersByCode) {
    const found = new Map<string, number>();
    for (let region = 1; region <= 20; region += 1) {
      for (let offset = 0, total = 1; offset < total; offset += 100) {
        const page = queryMefMunicipalIrpef({ level: "municipality", region: String(region).padStart(2, "0"), detail: "summary", limit: 100, offset });
        for (const record of page.data) {
          if (record.territory.level === "municipality") found.set(record.territory.cadastralCode, record.taxpayers);
        }
        total = page.pagination.total;
      }
    }
    taxpayersByCode = found;
  }
  return taxpayersByCode.get(cadastral) ?? null;
}

export function aggregateRealEstateRegion(rows: readonly RealEstateCountRow[]): RealEstateRegionData {
  const uses = dictionary(), types = dictionary();
  const municipalities: { code: string; name: string; taxpayers: number | null }[] = [];
  const municipalityIndex = new Map<string, number>();
  // Rows differ by owner too: the owner is summed away, municipality × use × type stays.
  const cells = new Map<string, { municipality: number; use: number; type: number; buildings: number; area: number }>();
  for (const row of rows) {
    let municipality = municipalityIndex.get(row.cadastral);
    if (municipality === undefined) {
      municipality = municipalities.length;
      municipalityIndex.set(row.cadastral, municipality);
      municipalities.push({ code: row.cadastral, name: row.municipality, taxpayers: taxpayersOf(row.cadastral) });
    }
    const use = uses.id(row.use), type = types.id(row.type);
    const key = `${municipality}|${use}|${type}`;
    const entry = cells.get(key) ?? { municipality, use, type, buildings: 0, area: 0 };
    entry.buildings += row.buildings;
    entry.area += row.area;
    cells.set(key, entry);
  }
  const list = [...cells.values()];
  return {
    uses: uses.values,
    types: types.values,
    municipalities,
    cells: {
      municipality: list.map((entry) => entry.municipality),
      use: list.map((entry) => entry.use),
      type: list.map((entry) => entry.type),
      buildings: list.map((entry) => entry.buildings),
      area: list.map((entry) => Math.round(entry.area * 100) / 100),
    },
  };
}

export function municipalityIndex(rows: readonly RealEstateCountRow[]): RealEstateMunicipalityIndex {
  const groups = new Map<string, { code: string; name: string; region: string; count: number }>();
  for (const row of rows) {
    const group = groups.get(row.cadastral) ?? { code: row.cadastral, name: row.municipality, region: row.region, count: 0 };
    group.count += row.buildings;
    groups.set(row.cadastral, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "it"));
  return {
    code: sorted.map((group) => group.code),
    name: sorted.map((group) => group.name),
    region: sorted.map((group) => group.region),
    count: sorted.map((group) => group.count),
  };
}

let loaded: Promise<readonly RealEstateCountRow[]> | null = null;

// Every chunk, once per process: only the national view needs it, and /patrimonio is prerendered at build.
function loadAll(): Promise<readonly RealEstateCountRow[]> {
  loaded ??= (async () => {
    const bundle = await loadIntegratedSourceBundle();
    const dataset = bundle.datasetsById.get(REAL_ESTATE_POINTS_DATASET_ID);
    if (!dataset) throw new Error(`Dataset ${REAL_ESTATE_POINTS_DATASET_ID} assente dal corpus.`);
    const rows: RealEstateCountRow[] = [];
    for (let ordinal = 0; ordinal < integratedRowChunkCount(dataset.publicRows); ordinal += 1) {
      const chunk = await loadIntegratedDatasetChunk(bundle, dataset, ordinal);
      chunk.rows.forEach((row, index) => {
        if (row.sourceRow !== ordinal * INTEGRATED_ROW_CHUNK_ROWS + index + 1) {
          throw new Error(`Ordine dei chunk divergente in ${dataset.id}.`);
        }
        rows.push(countFromRow(row));
      });
    }
    if (rows.length !== dataset.publicRows) throw new Error(`Righe caricate divergenti dal catalogo per ${dataset.id}.`);
    return rows;
  })();
  // A failed load must not stay cached for the whole process.
  loaded.catch(() => { loaded = null; });
  return loaded;
}

export async function getRealEstateNationalData(): Promise<RealEstateNationalData> {
  const rows = await loadAll();
  const byRegion: Record<string, number> = {}, byUse: Record<string, number> = {};
  for (const row of rows) {
    byRegion[row.region] = (byRegion[row.region] ?? 0) + row.buildings;
    byUse[row.use] = (byUse[row.use] ?? 0) + row.buildings;
  }
  return {
    total: rows.reduce((sum, row) => sum + row.buildings, 0),
    byRegion,
    byUse,
    municipalities: municipalityIndex(rows),
  };
}

// Rows are published sorted by region: a region reads only its own chunks.
export async function getRealEstateRegionData(regionCode: string): Promise<RealEstateRegionData> {
  const { rows } = await selectSortedRows(REAL_ESTATE_POINTS_DATASET_ID, "Codice regione del bene", regionCode);
  return aggregateRealEstateRegion(rows.map(countFromRow));
}
