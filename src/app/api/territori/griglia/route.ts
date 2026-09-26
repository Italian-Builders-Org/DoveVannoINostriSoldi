import { NextResponse } from "next/server";
import {
  istatPopulationGrid2021Data,
  istatPopulationGrid2021Metadata,
} from "@/lib/istat-population-grid-2021-snapshot";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      datasetId: istatPopulationGrid2021Data.datasetId,
      observedAt: istatPopulationGrid2021Data.observedAt,
      reference: istatPopulationGrid2021Data.reference,
      totals: istatPopulationGrid2021Data.totals,
      populationBands: istatPopulationGrid2021Data.populationBands,
      borderCells: istatPopulationGrid2021Data.borderCells,
      economicJoins: istatPopulationGrid2021Data.economicJoins,
      caveats: istatPopulationGrid2021Data.caveats,
      source: istatPopulationGrid2021Metadata.source,
      semantics: istatPopulationGrid2021Metadata.semantics,
      runtimeNetwork: istatPopulationGrid2021Metadata.runtimeNetwork,
      refreshWorkflow: istatPopulationGrid2021Metadata.refreshWorkflow,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
