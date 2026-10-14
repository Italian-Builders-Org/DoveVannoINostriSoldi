import {
  BOARD_TILE_FEATURED_IDS,
  type BoardTileView,
} from "@/lib/data/boards-document";
import {
  boardDatasetCategory,
  type BoardDatasetCategoryId,
} from "@/lib/boards/tile-categories";

export type BoardTileCatalogEntry = {
  id: string;
  label: string;
  blurb: string;
  defaultView: BoardTileView;
  featured: boolean;
  category: BoardDatasetCategoryId;
  filters: readonly string[];
};

const FEATURED = new Set<string>(BOARD_TILE_FEATURED_IDS);

const FEATURED_DEFAULT_VIEW: Partial<Record<string, BoardTileView>> = {
  debito_pubblico_italiano: "line",
  siope_comuni: "line",
  siope_entrate_comuni: "line",
  openbdap_spesa_stato: "line",
  openbdap_ssn_storico_nazionale: "line",
  opencivitas_fabbisogni: "table",
  consulenti_incarichi: "table",
  inps_pensioni_vigenti: "kpi",
  inps_invalidita_civile: "kpi",
  eurostat_cofog: "bar",
  istat_cofog: "bar",
  cpt_finanza_regionale: "table",
};

export function defaultViewForFilters(filters: readonly string[]): BoardTileView {
  if (filters.includes("year") || filters.length === 0) return "line";
  if (filters.includes("region")) return "bar";
  return "table";
}

export function sortBoardCatalog(
  entries: readonly BoardTileCatalogEntry[],
): BoardTileCatalogEntry[] {
  return [...entries].sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    return left.label.localeCompare(right.label, "it");
  });
}

export function isFeaturedBoardDataset(id: string): boolean {
  return FEATURED.has(id);
}

export function featuredDefaultView(id: string, filters: readonly string[]): BoardTileView {
  return FEATURED_DEFAULT_VIEW[id] ?? defaultViewForFilters(filters);
}

export function boardTileCatalogEntry(
  id: string,
  catalog: readonly BoardTileCatalogEntry[] = [],
): BoardTileCatalogEntry {
  const hit = catalog.find((entry) => entry.id === id);
  if (hit) return hit;
  return {
    id,
    label: id,
    blurb: "Dataset del catalogo pubblico DVNS.",
    defaultView: featuredDefaultView(id, []),
    featured: FEATURED.has(id),
    category: boardDatasetCategory(id),
    filters: [],
  };
}
