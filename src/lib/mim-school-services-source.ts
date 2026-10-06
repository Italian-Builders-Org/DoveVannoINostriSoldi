import "server-only";

import spec from "../../scripts/etl/specs/mim-school-services.source.json";

/** Lightweight MIM metadata for UI that must not pull the integrated corpus NFT. */
export const schoolServicesSource = {
  datasetId: spec.datasetId,
  schoolYear: spec.schoolYearLabel,
  dataAsOf: spec.dataAsOf,
  landingUrl: spec.source.landingUrl,
} as const;
