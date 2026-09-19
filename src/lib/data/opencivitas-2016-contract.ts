import { createHash } from "node:crypto";
import { MUNICIPALITY_COLUMNS, type OpenCivitasMunicipality } from "@/lib/data/opencivitas-municipality";

export type OpenCivitas2016Snapshot = {
  schemaVersion: 1;
  transformVersion: 1;
  scope: "ordinary-statute-municipalities-total-services-fc30-2016";
  referenceYear: 2016;
  publishedAt: string;
  modifiedAt: string;
  generatedAt: string;
  coverage: { municipalities: number; regions: number; regionNames: string[]; territorialScope: string };
  municipalities: OpenCivitasMunicipality[];
  source: {
    owner: string; publisher: string; dataset: string;
    landingUrl: string; datasetUrl: string; dataUrl: string; entitiesUrl: string; indicatorsUrl: string;
    license: string; licenseUrl: string; observedAt: string; declaredCadence: string;
    family: "FC30TOT"; releaseVersion: 1; releaseVersionReason: string;
    csvEncoding: string; csvDecimalSeparator: string;
    sha256: { data: string; entities: string; indicators: string };
    bytes: { data: number; entities: number; indicators: number };
  };
  methodology: {
    differenceMeaning: string; serviceMeaning: string; perCapitaMeaning: string;
    coverageWarning: string; rankingWarning: string; yearSeparationWarning: string;
    nationalDifferenceWarning: string; sourceFormatNote: string;
  };
};

const SEMANTIC_SHA256 = "45163242b0c3f31479def3d327c48bd64ab0c1e2f03b00a3b4342aad78f0d9ee";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertOpenCivitas2016Snapshot(value: unknown): OpenCivitas2016Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("FC30TOT: oggetto snapshot atteso");
  }
  const record = value as Record<string, unknown>;
  const source = record.source as Record<string, unknown> | undefined;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("FC30TOT: fonte attesa");
  }
  const observed = record.generatedAt;
  if (typeof observed !== "string" || observed !== source.observedAt ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(observed) ||
      !Number.isFinite(Date.parse(observed)) || Date.parse(observed) < Date.parse("2019-05-23T00:00:00Z") ||
      new Date(Date.UTC(Number(observed.slice(0, 4)), Number(observed.slice(5, 7)) - 1, Number(observed.slice(8, 10)))).toISOString().slice(0, 10) !== observed.slice(0, 10)) {
    throw new Error("FC30TOT: timestamp di acquisizione non valido");
  }
  const semantic: Record<string, unknown> = { ...record, source: { ...source } };
  delete semantic.generatedAt;
  delete (semantic.source as Record<string, unknown>).observedAt;
  if (createHash("sha256").update(canonicalJson(semantic)).digest("hex") !== SEMANTIC_SHA256) {
    throw new Error("FC30TOT: SHA-256 semantico diverso dal rilascio verificato");
  }
  if (!Array.isArray(record.municipalityColumns) ||
      record.municipalityColumns.length !== MUNICIPALITY_COLUMNS.length ||
      record.municipalityColumns.some((column, index) => column !== MUNICIPALITY_COLUMNS[index])) {
    throw new Error("FC30TOT: modello comunale non coerente con il rilascio");
  }
  const municipalityRows = record.municipalityRows;
  const metadata = { ...record };
  delete metadata.municipalityRows;
  delete metadata.municipalityColumns;
  const municipalities = (municipalityRows as unknown[][]).map((row) =>
    Object.fromEntries(MUNICIPALITY_COLUMNS.map((column, index) => [column, structuredClone(row[index])])) as OpenCivitasMunicipality);
  return { ...structuredClone(metadata), municipalities } as OpenCivitas2016Snapshot;
}
