/**
 * Contratto delle ricette DVNS Boards (schemaVersion 1).
 * Salva layout e filtri, non i fatti: i numeri si rileggono dal layer pubblico.
 * Spec: docs/DVNS_BOARDS.md
 */

export const BOARDS_DOCUMENT_SCHEMA_VERSION = 1 as const;

export const BOARD_TILE_VIEWS = ["kpi", "table", "line", "bar"] as const;
export type BoardTileView = (typeof BOARD_TILE_VIEWS)[number];

export const BOARD_LAYOUTS = ["grid"] as const;
export type BoardLayout = (typeof BOARD_LAYOUTS)[number];

/** Dataset MCP ammessi nel composer v1 (catalogo attivo, filtri semplici). */
export const BOARD_TILE_V1_DATASET_IDS = [
  "debito_pubblico_italiano",
  "siope_comuni",
  "siope_entrate_comuni",
  "openbdap_spesa_stato",
  "openbdap_ssn_storico_nazionale",
  "opencivitas_fabbisogni",
  "consulenti_incarichi",
  "inps_pensioni_vigenti",
  "inps_invalidita_civile",
  "eurostat_cofog",
  "istat_cofog",
  "cpt_finanza_regionale",
] as const;

export type BoardTileV1DatasetId = (typeof BOARD_TILE_V1_DATASET_IDS)[number];

export type BoardTileFilters = Record<string, string | number | boolean | null>;

export type BoardTile = {
  id: string;
  datasetId: BoardTileV1DatasetId;
  view: BoardTileView;
  filters: BoardTileFilters;
  title?: string;
};

export type BoardDocument = {
  schemaVersion: typeof BOARDS_DOCUMENT_SCHEMA_VERSION;
  title: string;
  layout: BoardLayout;
  tiles: BoardTile[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`BoardDocument: ${path} richiede una stringa non vuota`);
  }
  return value.trim();
}

function assertFilters(value: unknown, path: string): BoardTileFilters {
  if (!isPlainObject(value)) {
    throw new Error(`BoardDocument: ${path} deve essere un oggetto`);
  }
  const out: BoardTileFilters = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]*$/u.test(key)) {
      throw new Error(`BoardDocument: filtro non ammissibile in ${path}: ${key}`);
    }
    if (
      raw !== null &&
      typeof raw !== "string" &&
      typeof raw !== "number" &&
      typeof raw !== "boolean"
    ) {
      throw new Error(`BoardDocument: valore filtro non supportato in ${path}.${key}`);
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      throw new Error(`BoardDocument: numero non finito in ${path}.${key}`);
    }
    out[key] = raw;
  }
  return out;
}

function assertTile(value: unknown, path: string): BoardTile {
  if (!isPlainObject(value)) {
    throw new Error(`BoardDocument: ${path} deve essere un oggetto`);
  }
  const id = text(value.id, `${path}.id`);
  const datasetId = text(value.datasetId, `${path}.datasetId`);
  if (!(BOARD_TILE_V1_DATASET_IDS as readonly string[]).includes(datasetId)) {
    throw new Error(`BoardDocument: dataset non in catalogo tile v1: ${datasetId}`);
  }
  const view = text(value.view, `${path}.view`);
  if (!(BOARD_TILE_VIEWS as readonly string[]).includes(view)) {
    throw new Error(`BoardDocument: vista non supportata: ${view}`);
  }
  const tile: BoardTile = {
    id,
    datasetId: datasetId as BoardTileV1DatasetId,
    view: view as BoardTileView,
    filters: assertFilters(value.filters ?? {}, `${path}.filters`),
  };
  if (value.title !== undefined) {
    tile.title = text(value.title, `${path}.title`);
  }
  return tile;
}

/** Valida una ricetta board; fail-closed su schema, dataset o filtri. */
export function assertBoardDocument(value: unknown): BoardDocument {
  if (!isPlainObject(value)) {
    throw new Error("BoardDocument: root deve essere un oggetto");
  }
  if (value.schemaVersion !== BOARDS_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(
      `BoardDocument: schemaVersion ${String(value.schemaVersion)} non supportata (attesa ${BOARDS_DOCUMENT_SCHEMA_VERSION})`,
    );
  }
  const title = text(value.title, "title");
  const layout = text(value.layout, "layout");
  if (!(BOARD_LAYOUTS as readonly string[]).includes(layout)) {
    throw new Error(`BoardDocument: layout non supportato: ${layout}`);
  }
  if (!Array.isArray(value.tiles)) {
    throw new Error("BoardDocument: tiles deve essere un array");
  }
  if (value.tiles.length > 48) {
    throw new Error("BoardDocument: massimo 48 tile per board");
  }
  const seen = new Set<string>();
  const tiles = value.tiles.map((tile, index) => {
    const parsed = assertTile(tile, `tiles[${index}]`);
    if (seen.has(parsed.id)) {
      throw new Error(`BoardDocument: tile id duplicato: ${parsed.id}`);
    }
    seen.add(parsed.id);
    return parsed;
  });
  return {
    schemaVersion: BOARDS_DOCUMENT_SCHEMA_VERSION,
    title,
    layout: layout as BoardLayout,
    tiles,
  };
}
