/**
 * Contratto delle ricette DVNS Boards (schemaVersion 1).
 * Salva layout e filtri, non i fatti: i numeri si rileggono dal layer pubblico.
 * Spec: docs/DVNS_BOARDS.md
 */

export const BOARDS_DOCUMENT_SCHEMA_VERSION = 1 as const;

export const BOARD_TILE_VIEWS = ["kpi", "table", "line", "bar"] as const;
export type BoardTileView = (typeof BOARD_TILE_VIEWS)[number];

export const BOARD_LAYOUTS = ["grid", "free"] as const;
export type BoardLayout = (typeof BOARD_LAYOUTS)[number];

export const BOARD_ITEM_KINDS = ["data", "note", "link", "image", "local", "heading"] as const;
export type BoardItemKind = (typeof BOARD_ITEM_KINDS)[number];

/** Tabella CSV/TSV caricata dall’utente e salvata nella ricetta board. */
export type BoardLocalTable = {
  filename: string;
  importedAt: string;
  headers: string[];
  rows: string[][];
  labelColumn: string;
  valueColumns: string[];
};

/** Posizione libera sulla board (unità CSS px, snap consigliato 20). */
export type BoardTileFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Scorciatoie in evidenza nella sidebar (non sono un allowlist esclusivo).
 * Il composer ammette ogni id in ACTIVE_DATASET_IDS.
 */
export const BOARD_TILE_FEATURED_IDS = [
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

/** @deprecated Usa BOARD_TILE_FEATURED_IDS; restano i 12 storici per i test. */
export const BOARD_TILE_V1_DATASET_IDS = BOARD_TILE_FEATURED_IDS;
export type BoardTileV1DatasetId = (typeof BOARD_TILE_FEATURED_IDS)[number];

export type BoardTileFilters = Record<string, string | number | boolean | null>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;
const DATASET_ID = /^[a-z][a-z0-9_]*$/u;

export type BoardTile = {
  id: string;
  kind: BoardItemKind;
  /** Obbligatorio se layout === "free". */
  frame?: BoardTileFrame;
  title?: string;
  subtitle?: string;
  /** Colore accento del grafico / bordo (#rrggbb). */
  color?: string;
  // data
  datasetId?: string;
  view?: BoardTileView;
  filters?: BoardTileFilters;
  // note
  body?: string;
  // link
  href?: string;
  // image (solo HTTPS pubblico)
  imageUrl?: string;
  // local CSV/TSV importato dall’utente
  localTable?: BoardLocalTable;
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

function optionalText(value: unknown, path: string, max = 500): string | undefined {
  if (value === undefined) return undefined;
  const out = text(value, path);
  if (out.length > max) {
    throw new Error(`BoardDocument: ${path} troppo lungo (max ${max})`);
  }
  return out;
}

function assertHttpsUrl(value: unknown, path: string): string {
  const raw = text(value, path);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`BoardDocument: ${path} non è un URL valido`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`BoardDocument: ${path} richiede HTTPS`);
  }
  return url.toString();
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
      raw !== null
      && typeof raw !== "string"
      && typeof raw !== "number"
      && typeof raw !== "boolean"
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

function assertFrame(value: unknown, path: string): BoardTileFrame {
  if (!isPlainObject(value)) {
    throw new Error(`BoardDocument: ${path} deve essere un oggetto`);
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const w = Number(value.w);
  const h = Number(value.h);
  for (const [name, n] of [
    ["x", x],
    ["y", y],
    ["w", w],
    ["h", h],
  ] as const) {
    if (!Number.isFinite(n) || n < 0 || n > 20_000) {
      throw new Error(`BoardDocument: ${path}.${name} non valido`);
    }
  }
  if (w < 160 || h < 120) {
    throw new Error(`BoardDocument: ${path} troppo piccolo (min 160×120)`);
  }
  return { x, y, w, h };
}

function assertTile(value: unknown, path: string): BoardTile {
  if (!isPlainObject(value)) {
    throw new Error(`BoardDocument: ${path} deve essere un oggetto`);
  }
  const id = text(value.id, `${path}.id`);
  const kindRaw = value.kind === undefined ? "data" : text(value.kind, `${path}.kind`);
  if (!(BOARD_ITEM_KINDS as readonly string[]).includes(kindRaw)) {
    throw new Error(`BoardDocument: kind non supportato: ${kindRaw}`);
  }
  const kind = kindRaw as BoardItemKind;
  const tile: BoardTile = { id, kind };

  const title = optionalText(value.title, `${path}.title`, 120);
  if (title) tile.title = title;
  const subtitle = optionalText(value.subtitle, `${path}.subtitle`, 240);
  if (subtitle) tile.subtitle = subtitle;

  if (value.color !== undefined) {
    const color = text(value.color, `${path}.color`);
    if (!HEX_COLOR.test(color)) {
      throw new Error(`BoardDocument: ${path}.color deve essere #rrggbb`);
    }
    tile.color = color.toLowerCase();
  }
  if (value.frame !== undefined) {
    tile.frame = assertFrame(value.frame, `${path}.frame`);
  }

  if (kind === "data") {
    const datasetId = text(value.datasetId, `${path}.datasetId`);
    if (!DATASET_ID.test(datasetId)) {
      throw new Error(`BoardDocument: datasetId non valido: ${datasetId}`);
    }
    const view = text(value.view ?? "line", `${path}.view`);
    if (!(BOARD_TILE_VIEWS as readonly string[]).includes(view)) {
      throw new Error(`BoardDocument: vista non supportata: ${view}`);
    }
    tile.datasetId = datasetId;
    tile.view = view as BoardTileView;
    tile.filters = assertFilters(value.filters ?? {}, `${path}.filters`);
    return tile;
  }

  if (kind === "heading") {
    tile.title = optionalText(value.title, `${path}.title`, 120) ?? "Titolo di sezione";
    if (value.body !== undefined) {
      if (typeof value.body !== "string") {
        throw new Error(`BoardDocument: ${path}.body richiede una stringa`);
      }
      if (value.body.length > 8_000) {
        throw new Error(`BoardDocument: ${path}.body troppo lungo (max 8000)`);
      }
      tile.body = value.body;
    }
    return tile;
  }

  if (kind === "note") {
    if (value.body !== undefined && typeof value.body !== "string") {
      throw new Error(`BoardDocument: ${path}.body richiede una stringa`);
    }
    const body = typeof value.body === "string" ? value.body : "";
    if (body.length > 8_000) {
      throw new Error(`BoardDocument: ${path}.body troppo lungo (max 8000)`);
    }
    tile.body = body;
    return tile;
  }

  if (kind === "link") {
    tile.href = assertHttpsUrl(value.href, `${path}.href`);
    if (!tile.title) tile.title = tile.href;
    return tile;
  }

  if (kind === "local") {
    tile.localTable = assertLocalTable(value.localTable, `${path}.localTable`);
    const view = text(value.view ?? "table", `${path}.view`);
    if (!(BOARD_TILE_VIEWS as readonly string[]).includes(view)) {
      throw new Error(`BoardDocument: vista non supportata: ${view}`);
    }
    tile.view = view as BoardTileView;
    if (!tile.title) tile.title = tile.localTable.filename;
    return tile;
  }

  // image
  tile.imageUrl = assertHttpsUrl(value.imageUrl, `${path}.imageUrl`);
  return tile;
}

function assertLocalTable(value: unknown, path: string): BoardLocalTable {
  if (!isPlainObject(value)) {
    throw new Error(`BoardDocument: ${path} deve essere un oggetto`);
  }
  const filename = text(value.filename, `${path}.filename`);
  if (filename.length > 120) {
    throw new Error(`BoardDocument: ${path}.filename troppo lungo`);
  }
  const importedAt = text(value.importedAt, `${path}.importedAt`);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(importedAt)) {
    throw new Error(`BoardDocument: ${path}.importedAt non è una data ISO`);
  }
  if (!Array.isArray(value.headers) || value.headers.length === 0 || value.headers.length > 24) {
    throw new Error(`BoardDocument: ${path}.headers non valido`);
  }
  const headers = value.headers.map((header, index) => {
    const out = text(header, `${path}.headers[${index}]`);
    if (out.length > 80) {
      throw new Error(`BoardDocument: ${path}.headers[${index}] troppo lungo`);
    }
    return out;
  });
  if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 500) {
    throw new Error(`BoardDocument: ${path}.rows non valido (1–500)`);
  }
  const rows = value.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== headers.length) {
      throw new Error(`BoardDocument: ${path}.rows[${rowIndex}] lunghezza incoerente`);
    }
    return row.map((cell, cellIndex) => {
      if (typeof cell !== "string") {
        throw new Error(`BoardDocument: ${path}.rows[${rowIndex}][${cellIndex}] richiede stringa`);
      }
      if (cell.length > 80) {
        throw new Error(`BoardDocument: ${path}.rows[${rowIndex}][${cellIndex}] troppo lungo`);
      }
      return cell;
    });
  });
  const labelColumn = text(value.labelColumn, `${path}.labelColumn`);
  if (!headers.includes(labelColumn)) {
    throw new Error(`BoardDocument: ${path}.labelColumn assente nelle headers`);
  }
  if (!Array.isArray(value.valueColumns) || value.valueColumns.length === 0 || value.valueColumns.length > 3) {
    throw new Error(`BoardDocument: ${path}.valueColumns richiede 1–3 colonne`);
  }
  const valueColumns = value.valueColumns.map((column, index) => {
    const out = text(column, `${path}.valueColumns[${index}]`);
    if (!headers.includes(out)) {
      throw new Error(`BoardDocument: ${path}.valueColumns[${index}] assente nelle headers`);
    }
    return out;
  });
  return { filename, importedAt, headers, rows, labelColumn, valueColumns };
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
  if (value.tiles.length > 64) {
    throw new Error("BoardDocument: massimo 64 elementi per board");
  }
  const seen = new Set<string>();
  const layoutKind = layout as BoardLayout;
  const tiles = value.tiles.map((tile, index) => {
    const parsed = assertTile(tile, `tiles[${index}]`);
    if (seen.has(parsed.id)) {
      throw new Error(`BoardDocument: tile id duplicato: ${parsed.id}`);
    }
    seen.add(parsed.id);
    if (layoutKind === "free" && !parsed.frame) {
      throw new Error(`BoardDocument: tiles[${index}].frame obbligatorio con layout free`);
    }
    return parsed;
  });
  return {
    schemaVersion: BOARDS_DOCUMENT_SCHEMA_VERSION,
    title,
    layout: layoutKind,
    tiles,
  };
}

/** Controllo sintattico lato client; l’API verifica l’appartenenza al catalogo MCP. */
export function isPlausibleBoardDatasetId(id: string): boolean {
  return DATASET_ID.test(id);
}
