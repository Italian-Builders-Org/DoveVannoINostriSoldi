import { fetchOfficialSource } from "@/lib/data/source-fetch";
import {
  MOP_DATASET_ID,
  normalizeCup,
  normalizeMopRow,
  parseMopDatasetMetadata,
  parseMopSchema,
  type MopDatasetMetadata,
  type MopSchemaContract,
  type PublicWork,
} from "@/lib/data/bdap-public-works-contract";

const BASE_URL = "https://bdap-opendata.rgs.mef.gov.it";
const DATASET_URL = `${BASE_URL}/content/progetti-opere-pubbliche-mop-totale`;
const ODATA_BASE = `${BASE_URL}/ODataProxy`;
const ENCODED_DATASET_ID = encodeURIComponent(MOP_DATASET_ID);
const METADATA_URL = `${ODATA_BASE}/MdData('${ENCODED_DATASET_ID}')?%24format=json`;
const COLUMNS_URL = `${ODATA_BASE}/MdData('${ENCODED_DATASET_ID}')/DataColumns?%24format=json`;

export type PublicWorksLookup = {
  query: { cup: string };
  observedAt: string;
  count: number;
  works: PublicWork[];
  source: {
    owner: "Ragioneria Generale dello Stato";
    dataset: "Progetti Opere Pubbliche MOP - Totale";
    landingUrl: string;
    endpoint: string;
    datasetId: string;
    sourceLastUpdate: string;
    referenceDate: string;
    declaredCadence: "periodica";
    platformCheckCadence: "ogni ora";
    license: "CC BY";
  };
};

type ODataRows = {
  d?: {
    results?: unknown;
  };
};

async function jsonFrom(
  url: string,
  kind: "discovery" | "data",
  tags: string[],
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchOfficialSource("openbdap", url, {
    kind,
    headers: { Accept: "application/json" },
    tags: ["dataset:mop", ...tags],
    signal,
  });
  if (!response.ok) throw new Error(`OpenBDAP MOP HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("OpenBDAP MOP non ha restituito JSON");
  }
  return response.json();
}

export async function discoverMopDataset(options: { signal?: AbortSignal } = {}): Promise<{
  metadata: MopDatasetMetadata;
  schema: MopSchemaContract;
}> {
  const [metadataPayload, columnsPayload] = await Promise.all([
    jsonFrom(METADATA_URL, "discovery", ["metadata:mop"], options.signal),
    jsonFrom(COLUMNS_URL, "discovery", ["schema:mop"], options.signal),
  ]);
  return {
    metadata: parseMopDatasetMetadata(metadataPayload),
    schema: parseMopSchema(columnsPayload),
  };
}

export async function getPublicWorksByCup(
  rawCup: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorksLookup> {
  const cup = normalizeCup(rawCup);
  const observedAt = new Date().toISOString();
  const { metadata, schema } = await discoverMopDataset(options);
  const filter = `${schema.fields.cup} eq '${cup}'`;
  const query = new URLSearchParams({
    "$filter": filter,
    "$top": "20",
    "$format": "json",
  });
  const endpoint = `${ODATA_BASE}/MdData('${ENCODED_DATASET_ID}')/DataRows?${query.toString()}`;
  const payload = (await jsonFrom(endpoint, "data", [`cup:${cup}`], options.signal)) as ODataRows;
  if (!Array.isArray(payload.d?.results)) throw new Error("OpenBDAP MOP: elenco risultati non valido");
  const works = payload.d.results.map((row) => normalizeMopRow(row, schema.fields, observedAt.slice(0, 10)));
  if (works.some((work) => work.cup !== cup)) throw new Error("OpenBDAP MOP: la risposta contiene un CUP diverso dalla ricerca");

  return {
    query: { cup },
    observedAt,
    count: works.length,
    works,
    source: {
      owner: "Ragioneria Generale dello Stato",
      dataset: "Progetti Opere Pubbliche MOP - Totale",
      landingUrl: DATASET_URL,
      endpoint,
      datasetId: metadata.datasetId,
      sourceLastUpdate: metadata.sourceLastUpdate,
      referenceDate: metadata.referenceDate,
      declaredCadence: "periodica",
      platformCheckCadence: "ogni ora",
      license: "CC BY",
    },
  };
}
