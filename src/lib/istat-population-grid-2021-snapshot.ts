import "server-only";

import dataArtifact from "@/data/generated/istat-population-grid-2021.data.json";
import metadataArtifact from "@/data/generated/istat-population-grid-2021.meta.json";
import { assertIstatPopulationGrid2021Data } from "@/lib/data/istat-population-grid-2021-contract";

function assertMetadataRuntimeGuards(value: unknown): asserts value is typeof metadataArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata: oggetto atteso");
  }
  const record = value as Record<string, unknown>;
  if (record.datasetId !== "istat-population-grid-2021") {
    throw new Error("metadata.datasetId inatteso");
  }
  if (record.refreshWorkflow !== null) {
    throw new Error("metadata.refreshWorkflow: deve restare null (niente bot di refresh)");
  }
  if (record.runtimeNetwork !== false) {
    throw new Error("metadata.runtimeNetwork: deve essere false");
  }
}

assertMetadataRuntimeGuards(metadataArtifact);

export const istatPopulationGrid2021Data = assertIstatPopulationGrid2021Data(dataArtifact);
export const istatPopulationGrid2021Metadata = metadataArtifact;
