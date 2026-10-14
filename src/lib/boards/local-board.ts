import {
  BOARDS_DOCUMENT_SCHEMA_VERSION,
  type BoardDocument,
  type BoardItemKind,
  type BoardLocalTable,
  type BoardTile,
  type BoardTileFrame,
  type BoardTileView,
} from "@/lib/data/boards-document";
import { paragraphHtml } from "@/lib/boards/board-html";
import {
  boardTileCatalogEntry,
  type BoardTileCatalogEntry,
} from "@/lib/boards/tile-catalog";

export function emptyBoardDocument(title = "La mia board"): BoardDocument {
  return {
    schemaVersion: BOARDS_DOCUMENT_SCHEMA_VERSION,
    title,
    layout: "free",
    tiles: [],
  };
}

function snap(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}

export function nextTileFrame(existing: readonly BoardTile[]): BoardTileFrame {
  const index = existing.length;
  const col = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: snap(40 + col * 380),
    y: snap(40 + row * 280),
    w: 360,
    h: 260,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDataTile(
  datasetId: string,
  existing: readonly BoardTile[],
  catalog: readonly BoardTileCatalogEntry[] = [],
  view?: BoardTileView,
  origin?: Readonly<{ x: number; y: number }>,
): BoardTile {
  const entry = boardTileCatalogEntry(datasetId, catalog);
  const base = nextTileFrame(existing);
  const frame = origin
    ? {
        x: Math.max(0, snap(origin.x - base.w / 2)),
        y: Math.max(0, snap(origin.y - base.h / 2)),
        w: base.w,
        h: base.h,
      }
    : base;
  return {
    id: newId("tile"),
    kind: "data",
    datasetId,
    view: view ?? entry.defaultView,
    filters: {},
    title: entry.label,
    frame,
    color: "#2f5d73",
  };
}

/** @deprecated */
export const createTile = createDataTile;

export function createLocalTile(
  table: BoardLocalTable,
  existing: readonly BoardTile[],
  view: BoardTileView = "table",
): BoardTile {
  const frame = nextTileFrame(existing);
  const stem = table.filename.replace(/\.[^.]+$/u, "").slice(0, 80) || "Dati importati";
  return {
    id: newId("local"),
    kind: "local",
    title: stem,
    subtitle: `${table.rows.length} righe · file locale`,
    localTable: table,
    view,
    frame: { ...frame, w: 420, h: 300 },
    color: "#b42332",
  };
}

/** Scorciatoie narrazione per redazioni e centri studi. */
export const BOARD_TOOL_PRESETS = [
  {
    id: "heading",
    label: "Titolo",
    blurb: "Intestazione formattabile",
    glyph: "T",
  },
  {
    id: "paragraph",
    label: "Paragrafo",
    blurb: "Nota, sommario, metodo…",
    glyph: "¶",
  },
  {
    id: "link",
    label: "Link",
    blurb: "URL HTTPS ufficiale",
    glyph: "↗",
  },
  {
    id: "image",
    label: "Immagine",
    blurb: "URL immagine pubblica",
    glyph: "▣",
  },
] as const;

export type BoardToolId = (typeof BOARD_TOOL_PRESETS)[number]["id"];

export function createContentTile(
  kind: Exclude<BoardItemKind, "data" | "local">,
  existing: readonly BoardTile[],
): BoardTile {
  const frame = nextTileFrame(existing);
  if (kind === "heading") {
    return {
      id: newId("heading"),
      kind,
      title: "Titolo di sezione",
      body: paragraphHtml("Titolo di sezione", "font-size: 1.6rem; font-weight: 650; letter-spacing: -0.03em;"),
      frame: { ...frame, w: 420, h: 120 },
      color: "#182b3a",
    };
  }
  if (kind === "note") {
    return {
      id: newId("note"),
      kind,
      title: "Paragrafo",
      body: paragraphHtml(
        "Scrivi qui: sommario, nota di contesto, metodo o caveat…",
        "font-size: 1rem; line-height: 1.45;",
      ),
      frame: { ...frame, w: 400, h: 140 },
      color: "#6ea8d8",
    };
  }
  if (kind === "link") {
    return {
      id: newId("link"),
      kind,
      title: "Fonte ufficiale",
      href: "https://www.dovevannoinostrisoldi.com/fonti",
      frame: { ...frame, w: 320, h: 160 },
      color: "#d4a35c",
    };
  }
  return {
    id: newId("image"),
    kind: "image",
    title: "Immagine",
    subtitle: "Incolla un URL HTTPS pubblico",
    imageUrl: "https://www.dovevannoinostrisoldi.com/brand/dvns-mark-transparent.png",
    frame: { ...frame, w: 320, h: 240 },
  };
}

export function createToolTile(toolId: BoardToolId, existing: readonly BoardTile[]): BoardTile {
  if (toolId === "heading") return createContentTile("heading", existing);
  if (toolId === "paragraph") return createContentTile("note", existing);
  if (toolId === "link") return createContentTile("link", existing);
  return createContentTile("image", existing);
}

export function moveTileFrame(
  frame: BoardTileFrame,
  dx: number,
  dy: number,
): BoardTileFrame {
  return {
    ...frame,
    x: Math.max(0, snap(frame.x + dx)),
    y: Math.max(0, snap(frame.y + dy)),
  };
}

export function resizeTileFrame(
  frame: BoardTileFrame,
  dw: number,
  dh: number,
): BoardTileFrame {
  return {
    ...frame,
    w: Math.max(160, snap(frame.w + dw)),
    h: Math.max(120, snap(frame.h + dh)),
  };
}

/** Ripara frame sotto i minimi dello schema (es. auto-fit testo). */
export function clampBoardTileFrames(document: BoardDocument): BoardDocument {
  let changed = false;
  const tiles = document.tiles.map((tile) => {
    if (!tile.frame) return tile;
    const w = Math.max(160, tile.frame.w);
    const h = Math.max(120, tile.frame.h);
    if (w === tile.frame.w && h === tile.frame.h) return tile;
    changed = true;
    return { ...tile, frame: { ...tile.frame, w, h } };
  });
  return changed ? { ...document, tiles } : document;
}
