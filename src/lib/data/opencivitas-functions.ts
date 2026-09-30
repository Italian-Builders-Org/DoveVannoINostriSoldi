// Shape shared by the per-year OpenCivitas function registries (2018, 2019).
// Crypto-free on purpose: the MCP catalog imports the registries.
export type OpenCivitasFunctionSource = {
  referenceYear: number;
  publishedAt: string;
  modifiedAt: string;
  datasetPageUrl: string;
  license: string;
  licenseUrl: string;
  owner: string;
  publisher: string;
  municipalities: number;
  regionCounts: Record<string, number>;
  files: { data: { url: string; bytes: number; sha256: string } };
  nationalTotals: { reproportioned: boolean };
};

export type OpenCivitasFunctionDescriptor = {
  datasetId: string;
  family: string;
  function: string;
  label: string;
  referenceYear: number;
  /** Total-services release of the same year, never summed with the function. */
  totalFamily: string;
  totalDatasetId: string;
  totalApiPath: string;
  apiPath: string;
  /** Pinned independently of the Python adapter. */
  semanticSha256: string;
  source: OpenCivitasFunctionSource;
  exclusionNote: string;
};
