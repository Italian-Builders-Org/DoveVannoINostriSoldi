import "server-only";

import { toItalyMap } from "@/lib/italy-map-projection";
import { INTEGRATED_ROW_CHUNK_ROWS, integratedRowChunkCount, type IntegratedPublicRow } from "@/lib/integrated-source-contract";
import { selectSortedRows } from "@/lib/integrated-sorted-lookup";
import { loadIntegratedDatasetChunk, loadIntegratedSourceBundle } from "@/lib/integrated-sources";

export const REAL_ESTATE_POINTS_DATASET_ID = "mef-patrimonio-fabbricati-fermi-2023";

export type RealEstatePointRow = Readonly<{
  lat: number;
  lon: number;
  /** ISTAT region code of the asset ("01"–"20"), as in the regional map geometry. */
  regione: string;
  uso: string;
  tipologia: string;
  ente: string;
  comune: string;
  codiceComune: string;
  precisione: string;
  mq: number | null;
}>;

/** Column-oriented points with shared dictionaries, so repeated strings cross the network once. */
export type RealEstateMapPoints = Readonly<{
  x: readonly number[];
  y: readonly number[];
  use: readonly number[];
  type: readonly number[];
  municipality: readonly number[];
  entity: readonly number[];
  area: readonly (number | null)[];
  /** Georeferenced only to the municipality: drawn as a hollow mark. */
  approximate: readonly boolean[];
  uses: readonly string[];
  types: readonly string[];
  municipalities: readonly string[];
  entities: readonly string[];
}>;

/** Municipalities where idle buildings are, for search: largest first. */
export type RealEstateMunicipalityIndex = Readonly<{
  name: readonly string[];
  region: readonly string[];
  count: readonly number[];
}>;

export type RealEstateNationalData = Readonly<{
  total: number;
  byRegion: Readonly<Record<string, number>>;
  municipalities: RealEstateMunicipalityIndex;
}>;

export const REGION_CODE_PATTERN = /^(0[1-9]|1[0-9]|20)$/;

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

const round = (value: number) => Math.round(value * 100) / 100;

export function projectRealEstatePoints(rows: readonly RealEstatePointRow[]): RealEstateMapPoints {
  const uses = dictionary(), types = dictionary(), municipalities = dictionary(), entities = dictionary();
  const points = {
    x: [] as number[], y: [] as number[], use: [] as number[], type: [] as number[],
    municipality: [] as number[], entity: [] as number[], area: [] as (number | null)[], approximate: [] as boolean[],
  };
  for (const row of rows) {
    const [x, y] = toItalyMap(row.lat, row.lon);
    points.x.push(round(x));
    points.y.push(round(y));
    points.use.push(uses.id(row.uso));
    points.type.push(types.id(row.tipologia));
    points.municipality.push(municipalities.id(row.comune));
    points.entity.push(entities.id(row.ente));
    points.area.push(row.mq);
    points.approximate.push(row.precisione === "COMUNE");
  }
  return {
    ...points,
    uses: uses.values, types: types.values, municipalities: municipalities.values, entities: entities.values,
  };
}

export function municipalityIndex(rows: readonly RealEstatePointRow[]): RealEstateMunicipalityIndex {
  const groups = new Map<string, { name: string; region: string; count: number }>();
  for (const row of rows) {
    const group = groups.get(row.codiceComune) ?? { name: row.comune, region: row.regione, count: 0 };
    group.count += 1;
    groups.set(row.codiceComune, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "it"));
  return {
    name: sorted.map((group) => group.name),
    region: sorted.map((group) => group.region),
    count: sorted.map((group) => group.count),
  };
}

const COORDINATE_PATTERN = /^[0-9]{1,2}\.[0-9]+$/;
const SURFACE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function cell(row: IntegratedPublicRow, column: string): string {
  const value = row.cells[column];
  if (typeof value !== "string") throw new Error(`Campo mancante nei fabbricati fermi: ${column}.`);
  return value;
}

/** Boundary check on the published rows: anything outside the ETL contract fails closed. */
export function pointFromRow(row: IntegratedPublicRow): RealEstatePointRow {
  const lat = cell(row, "Latitudine"), lon = cell(row, "Longitudine"), mq = cell(row, "Superficie di riferimento (m²)");
  const regione = cell(row, "Codice regione del bene");
  if (!COORDINATE_PATTERN.test(lat) || !COORDINATE_PATTERN.test(lon) || !REGION_CODE_PATTERN.test(regione)) {
    throw new Error(`Posizione non valida nei fabbricati fermi, riga ${row.sourceRow}.`);
  }
  if (mq !== "" && !SURFACE_PATTERN.test(mq)) throw new Error(`Superficie non valida nei fabbricati fermi, riga ${row.sourceRow}.`);
  return {
    lat: Number(lat),
    lon: Number(lon),
    regione,
    uso: cell(row, "Utilizzo del bene"),
    tipologia: cell(row, "Tipologia bene"),
    ente: cell(row, "Ente"),
    comune: cell(row, "Comune del bene"),
    codiceComune: cell(row, "Codice catastale comune del bene"),
    precisione: cell(row, "Precisione georeferenziazione"),
    mq: mq === "" ? null : Number(mq),
  };
}

type Loaded = Readonly<{ rows: readonly RealEstatePointRow[]; byRegion: ReadonlyMap<string, RealEstatePointRow[]> }>;
let loaded: Promise<Loaded> | null = null;

// Every chunk, once per process: only the national view needs it, and /patrimonio is prerendered at build.
function load(): Promise<Loaded> {
  loaded ??= (async () => {
    const bundle = await loadIntegratedSourceBundle();
    const dataset = bundle.datasetsById.get(REAL_ESTATE_POINTS_DATASET_ID);
    if (!dataset) throw new Error(`Dataset ${REAL_ESTATE_POINTS_DATASET_ID} assente dal corpus.`);
    const rows: RealEstatePointRow[] = [];
    const byRegion = new Map<string, RealEstatePointRow[]>();
    for (let ordinal = 0; ordinal < integratedRowChunkCount(dataset.publicRows); ordinal += 1) {
      const chunk = await loadIntegratedDatasetChunk(bundle, dataset, ordinal);
      chunk.rows.forEach((row, index) => {
        if (row.sourceRow !== ordinal * INTEGRATED_ROW_CHUNK_ROWS + index + 1) {
          throw new Error(`Ordine dei chunk divergente in ${dataset.id}.`);
        }
        const point = pointFromRow(row);
        rows.push(point);
        const list = byRegion.get(point.regione) ?? [];
        list.push(point);
        byRegion.set(point.regione, list);
      });
    }
    if (rows.length !== dataset.publicRows) throw new Error(`Righe caricate divergenti dal catalogo per ${dataset.id}.`);
    return { rows, byRegion };
  })();
  // A failed load must not stay cached for the whole process.
  loaded.catch(() => { loaded = null; });
  return loaded;
}

export async function getRealEstateNationalData(): Promise<RealEstateNationalData> {
  const data = await load();
  return {
    total: data.rows.length,
    byRegion: Object.fromEntries([...data.byRegion].map(([code, rows]) => [code, rows.length])),
    municipalities: municipalityIndex(data.rows),
  };
}

// Rows are published sorted by region: a region reads only its own chunks.
export async function getRealEstateRegionPoints(regionCode: string): Promise<RealEstateMapPoints> {
  const { rows } = await selectSortedRows(REAL_ESTATE_POINTS_DATASET_ID, "Codice regione del bene", regionCode);
  return projectRealEstatePoints(rows.map(pointFromRow));
}
