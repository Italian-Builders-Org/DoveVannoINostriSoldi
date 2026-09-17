import "server-only";

import { createHash } from "node:crypto";
import rawSnapshot from "@/data/generated/rgs-state-budget-territorial-2023.json";
import {
  validateRgsTerritorialSnapshot,
  type RgsTerritoryLevel,
} from "@/lib/rgs-territorial-contract";

const ARTIFACT_INTEGRITY = Object.freeze({
  bytes: 405_199,
  sha256: "e9599e06e61ed09658ba7136dd6fb1fc9f8b13f2e1998fd84b3c8b384433a01e",
});

const serializedSnapshot = `${JSON.stringify(rawSnapshot)}\n`;
const actualArtifactIntegrity = {
  bytes: Buffer.byteLength(serializedSnapshot, "utf8"),
  sha256: createHash("sha256").update(serializedSnapshot, "utf8").digest("hex"),
};
if (
  actualArtifactIntegrity.bytes !== ARTIFACT_INTEGRITY.bytes ||
  actualArtifactIntegrity.sha256 !== ARTIFACT_INTEGRITY.sha256
) {
  throw new Error(
    `Artefatto RGS territoriale non riconosciuto: ${actualArtifactIntegrity.bytes} byte / ${actualArtifactIntegrity.sha256}`,
  );
}

export const rgsTerritorialSnapshot = validateRgsTerritorialSnapshot(rawSnapshot);

export const RGS_TERRITORIAL_MEASURE_IDS = [
  "absolute",
  "gdp-share",
  "per-inhabitant",
  "per-square-kilometre",
] as const;
export type RgsTerritorialMeasureId = typeof RGS_TERRITORIAL_MEASURE_IDS[number];

const MEASURE_INDEX: Record<RgsTerritorialMeasureId, number> = {
  absolute: 0,
  "gdp-share": 1,
  "per-inhabitant": 2,
  "per-square-kilometre": 3,
};

export const rgsTerritorialMeasures = Object.freeze(
  RGS_TERRITORIAL_MEASURE_IDS.map((id, index) => ({
    id,
    index,
    ...rgsTerritorialSnapshot.dimensions.measures[index],
  })),
);

export type RgsTerritorialQueryValue = string | string[] | number | undefined;
export type RgsTerritorialQuery = {
  level?: RgsTerritorialQueryValue;
  territory?: RgsTerritorialQueryValue;
  measure?: RgsTerritorialQueryValue;
  limit?: RgsTerritorialQueryValue;
  offset?: RgsTerritorialQueryValue;
};

export class RgsTerritorialQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RgsTerritorialQueryError";
  }
}

function single(value: RgsTerritorialQueryValue, label: string): string | number | undefined {
  if (Array.isArray(value)) {
    throw new RgsTerritorialQueryError(`Il parametro ${label} deve comparire una sola volta.`);
  }
  return value;
}

function textParam(value: RgsTerritorialQueryValue, label: string): string | undefined {
  const scalar = single(value, label);
  if (scalar === undefined || scalar === "") return undefined;
  if (typeof scalar !== "string" || scalar.trim().length > 200) {
    throw new RgsTerritorialQueryError(`Il parametro ${label} non è valido.`);
  }
  return scalar.normalize("NFKC").trim();
}

function integerParam(
  value: RgsTerritorialQueryValue,
  label: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const scalar = single(value, label);
  if (scalar === undefined || scalar === "") return fallback;
  const normalized = typeof scalar === "number" ? scalar : /^\d+$/.test(scalar.trim()) ? Number(scalar.trim()) : Number.NaN;
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new RgsTerritorialQueryError(
      `Il parametro ${label} deve essere un intero tra ${minimum} e ${maximum}.`,
    );
  }
  return normalized;
}

function levelParam(value: RgsTerritorialQueryValue): RgsTerritoryLevel {
  const level = textParam(value, "livello") ?? "region";
  if (level !== "national" && level !== "macroarea" && level !== "region") {
    throw new RgsTerritorialQueryError("Livello territoriale non disponibile.");
  }
  return level;
}

function measureParam(value: RgsTerritorialQueryValue): RgsTerritorialMeasureId {
  const measure = textParam(value, "misura") ?? "absolute";
  if (!RGS_TERRITORIAL_MEASURE_IDS.includes(measure as RgsTerritorialMeasureId)) {
    throw new RgsTerritorialQueryError("Misura territoriale non disponibile.");
  }
  return measure as RgsTerritorialMeasureId;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

function scaledInteger(value: number, scale: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(scale) || scale < 0) {
    throw new Error("Valore territoriale fuori contratto.");
  }
  const amount = BigInt(value);
  const divisor = BigInt(10) ** BigInt(scale);
  const whole = (amount / divisor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (scale === 0) return whole;
  const decimals = (amount % divisor).toString().padStart(scale, "0");
  return `${whole},${decimals}`;
}

export function formatRgsTerritorialValue(value: number, measureId: RgsTerritorialMeasureId): string {
  const measure = rgsTerritorialMeasures[MEASURE_INDEX[measureId]];
  const amount = scaledInteger(value, measure.scale);
  if (measure.publishedUnit === "million_eur") return `${amount} mln €`;
  if (measure.publishedUnit === "percent_of_gdp") return `${amount}%`;
  return `${amount} €`;
}

export function getRgsTerritorialSourceHealth() {
  return {
    status: "verified" as const,
    check: "offline-source-lock-and-snapshot-contract" as const,
    runtimeFetch: false as const,
    artifact: { schemaVersion: rgsTerritorialSnapshot.schemaVersion, ...ARTIFACT_INTEGRITY },
    source: {
      recordId: rgsTerritorialSnapshot.source.recordId,
      sourceBytes: rgsTerritorialSnapshot.source.sourceBytes,
      sourceSha256: rgsTerritorialSnapshot.source.sourceSha256,
      landingUrl: rgsTerritorialSnapshot.source.landingUrl,
      csvUrl: rgsTerritorialSnapshot.source.csvUrl,
      licenseStatus: rgsTerritorialSnapshot.source.licenseStatus,
      status: "verified" as const,
    },
  };
}

/** Rows per page when the caller does not ask for a size. */
export const RGS_TERRITORIAL_DEFAULT_LIMIT = 25;

export function queryRgsTerritorial(query: RgsTerritorialQuery = {}) {
  const level = levelParam(query.level);
  const requestedTerritory = textParam(query.territory, "territorio");
  const measureId = measureParam(query.measure);
  const measureIndex = MEASURE_INDEX[measureId];
  const limit = integerParam(query.limit, "limit", RGS_TERRITORIAL_DEFAULT_LIMIT, 1, 100);
  const offset = integerParam(query.offset, "offset", 0, 0, 100_000);
  const territories = rgsTerritorialSnapshot.dimensions.territories;
  const selectedTerritory = requestedTerritory
    ? territories.find((territory) => normalize(territory.label) === normalize(requestedTerritory))
    : undefined;
  if (requestedTerritory && !selectedTerritory) {
    throw new RgsTerritorialQueryError("Territorio non presente nello snapshot.");
  }
  if (selectedTerritory && selectedTerritory.level !== level) {
    throw new RgsTerritorialQueryError("Il territorio non appartiene al livello selezionato.");
  }

  const matchingRows = rgsTerritorialSnapshot.rows.filter((row) => {
    const territory = territories[row.territory];
    return territory.level === level && (!selectedTerritory || territory.label === selectedTerritory.label);
  });
  const rows = matchingRows.slice(offset, offset + limit).map((row) => {
    const territory = territories[row.territory];
    const value = row.values[measureIndex];
    return {
      id: `${row.territory}:${row.title}:${row.category}:${row.mission}:${measureId}`,
      storage: {
        territory: row.territory,
        title: row.title,
        category: row.category,
        mission: row.mission,
      },
      level: territory.level,
      territory: territory.label,
      title: rgsTerritorialSnapshot.dimensions.titles[row.title],
      category: rgsTerritorialSnapshot.dimensions.categories[row.category],
      mission: rgsTerritorialSnapshot.dimensions.missions[row.mission],
      measureId,
      value,
      formattedValue: formatRgsTerritorialValue(value, measureId),
    };
  });
  return {
    query: {
      level,
      territory: selectedTerritory?.label ?? null,
      measure: measureId,
    },
    measure: rgsTerritorialMeasures[measureIndex],
    rows,
    pagination: {
      total: matchingRows.length,
      offset,
      limit,
      returned: rows.length,
    },
  };
}
