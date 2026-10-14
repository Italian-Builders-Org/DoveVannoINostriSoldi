import "server-only";
import { datasetCatalog } from "@/lib/mcp/catalog";
import type { BoardTileCatalogEntry } from "@/lib/boards/tile-catalog";
import {
  featuredDefaultView,
  isFeaturedBoardDataset,
  sortBoardCatalog,
} from "@/lib/boards/tile-catalog";
import { boardDatasetCategory } from "@/lib/boards/tile-categories";

/** Solo server: costruisce l’indice board dal catalogo MCP senza esporlo al client bundle. */
export function buildBoardTileCatalog(): BoardTileCatalogEntry[] {
  const entries = datasetCatalog.map((dataset) => ({
    id: dataset.id,
    label: dataset.title,
    blurb: dataset.summary,
    defaultView: featuredDefaultView(dataset.id, dataset.filters),
    featured: isFeaturedBoardDataset(dataset.id),
    category: boardDatasetCategory(dataset.id),
    filters: dataset.filters,
  }));
  return sortBoardCatalog(entries);
}
