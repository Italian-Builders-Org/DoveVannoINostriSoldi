/** Categorie leggibili per esplorare il catalogo board (oltre la ricerca). */

export const BOARD_DATASET_CATEGORIES = [
  { id: "comuni", label: "Comuni e territori" },
  { id: "stato", label: "Stato e bilancio" },
  { id: "sanita", label: "Sanità" },
  { id: "lavoro", label: "Lavoro e welfare" },
  { id: "fisco", label: "Fisco" },
  { id: "appalti", label: "Appalti e progetti" },
  { id: "sociale", label: "Società e benessere" },
  { id: "europa", label: "Confronti UE" },
  { id: "altro", label: "Altro" },
] as const;

export type BoardDatasetCategoryId = (typeof BOARD_DATASET_CATEGORIES)[number]["id"];

const CATEGORY_LABEL = Object.fromEntries(
  BOARD_DATASET_CATEGORIES.map((item) => [item.id, item.label]),
) as Record<BoardDatasetCategoryId, string>;

export function boardDatasetCategoryLabel(id: BoardDatasetCategoryId): string {
  return CATEGORY_LABEL[id] ?? "Altro";
}

/** Assegna una categoria cittadina a partire dall'id dataset MCP. */
export function boardDatasetCategory(datasetId: string): BoardDatasetCategoryId {
  const id = datasetId.toLowerCase();

  if (
    id.startsWith("siope_asl")
    || id.startsWith("openbdap_ssn")
    || id.startsWith("salute_")
    || id.startsWith("aifa_")
    || id.startsWith("eurostat_sha")
  ) {
    return "sanita";
  }

  if (
    id.startsWith("inps_")
    || id.startsWith("istat_pension")
    || id.startsWith("inl_")
  ) {
    return "lavoro";
  }

  if (
    id.startsWith("mef_")
    || id.startsWith("eu_vat")
    || id.startsWith("eurostat_taxag")
  ) {
    return "fisco";
  }

  if (
    id.startsWith("anac_")
    || id.startsWith("consip_")
    || id.startsWith("opencoesione_")
    || id.startsWith("opencup_")
    || id.startsWith("pnrr_")
    || id.includes("opere_pubbliche")
  ) {
    return "appalti";
  }

  if (
    id.startsWith("istat_poverta")
    || id.startsWith("istat_bes")
    || id.startsWith("eurostat_arope")
  ) {
    return "sociale";
  }

  if (
    id.startsWith("eurostat_cofog")
    || id.startsWith("eurostat_conti")
    || id.startsWith("istat_cofog")
    || id.startsWith("istat_epea")
  ) {
    return "europa";
  }

  if (
    id.startsWith("openbdap_")
    || id.startsWith("debito_")
  ) {
    return "stato";
  }

  if (
    id.startsWith("siope_comuni")
    || id.startsWith("siope_entrate")
    || id.startsWith("opencivitas_")
    || id.startsWith("cpt_")
    || id.startsWith("istat_permessi")
    || id.startsWith("siope_province")
    || id.startsWith("siope_regioni")
    || id.startsWith("siope_citta")
    || id.startsWith("siope_inventario")
  ) {
    return "comuni";
  }

  return "altro";
}

export type BoardCatalogGroup = {
  id: BoardDatasetCategoryId | "featured";
  label: string;
  entries: readonly { id: string; label: string; blurb: string; featured: boolean }[];
};

export function groupBoardCatalogByCategory<T extends {
  id: string;
  label: string;
  blurb: string;
  featured: boolean;
  category: BoardDatasetCategoryId;
}>(
  entries: readonly T[],
  options: { includeFeaturedGroup?: boolean } = {},
): BoardCatalogGroup[] {
  const includeFeatured = options.includeFeaturedGroup !== false;
  const groups: BoardCatalogGroup[] = [];

  if (includeFeatured) {
    const featured = entries.filter((entry) => entry.featured);
    if (featured.length > 0) {
      groups.push({ id: "featured", label: "In evidenza", entries: featured });
    }
  }

  for (const category of BOARD_DATASET_CATEGORIES) {
    const items = entries.filter((entry) => entry.category === category.id);
    if (items.length === 0) continue;
    groups.push({ id: category.id, label: category.label, entries: items });
  }

  return groups;
}
