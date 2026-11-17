import { datasetCatalog } from "@/lib/mcp/catalog";
import { mobilityLiveToolsCatalog } from "@/lib/mcp/mobility-live-catalog";

export const dvnsMcpCatalogPayload = {
  datasets: datasetCatalog,
  mobilityLiveTools: mobilityLiveToolsCatalog,
} as const;