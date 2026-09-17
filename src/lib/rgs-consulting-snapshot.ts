import "server-only";

import { createHash } from "node:crypto";
import rawSnapshot from "@/data/generated/rgs-consulting-payments-2024-2025.json";
import {
  validateRgsConsultingSnapshot,
  type RgsConsultingRow,
} from "@/lib/rgs-consulting-contract";

const ARTIFACT_INTEGRITY = Object.freeze({
  bytes: 279_635,
  sha256: "5997f6c02b1e83bd9a8ab9974b0cf0573584b48fc72b8b69633218c3df5e5650",
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
    `Artefatto RGS consulenze non riconosciuto: ${actualArtifactIntegrity.bytes} byte / ${actualArtifactIntegrity.sha256}`,
  );
}

export const rgsConsultingSnapshot = validateRgsConsultingSnapshot(rawSnapshot);
export const rgsConsultingAdministrations = Object.freeze(
  [...new Set(rgsConsultingSnapshot.rows.map((row) => row.administration))]
    .sort((left, right) => left.localeCompare(right, "it")),
);

export type RgsConsultingQueryValue = string | string[] | number | undefined;
export type RgsConsultingQuery = {
  year?: RgsConsultingQueryValue;
  administration?: RgsConsultingQueryValue;
  limit?: RgsConsultingQueryValue;
  offset?: RgsConsultingQueryValue;
};

export class RgsConsultingQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RgsConsultingQueryError";
  }
}

function single(value: RgsConsultingQueryValue, label: string): string | number | undefined {
  if (Array.isArray(value)) {
    throw new RgsConsultingQueryError(`Il parametro ${label} deve comparire una sola volta.`);
  }
  return value;
}

function integerParam(
  value: RgsConsultingQueryValue,
  label: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const scalar = single(value, label);
  if (scalar === undefined || scalar === "") return fallback;
  const normalized = typeof scalar === "number" ? scalar : /^\d+$/.test(scalar.trim()) ? Number(scalar.trim()) : Number.NaN;
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new RgsConsultingQueryError(
      `Il parametro ${label} deve essere un intero tra ${minimum} e ${maximum}.`,
    );
  }
  return normalized;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
}

function yearParam(value: RgsConsultingQueryValue): 2024 | 2025 | undefined {
  const scalar = single(value, "anno");
  if (scalar === undefined || scalar === "") return undefined;
  const year = typeof scalar === "number" ? scalar : /^\d{4}$/.test(scalar.trim()) ? Number(scalar.trim()) : Number.NaN;
  if (year !== 2024 && year !== 2025) {
    throw new RgsConsultingQueryError("Anno non disponibile: usare 2024 o 2025.");
  }
  return year;
}

function administrationParam(value: RgsConsultingQueryValue): string | undefined {
  const scalar = single(value, "amministrazione");
  if (scalar === undefined || scalar === "") return undefined;
  if (typeof scalar !== "string" || scalar.trim().length > 200) {
    throw new RgsConsultingQueryError("Amministrazione non valida.");
  }
  const match = rgsConsultingAdministrations.find(
    (administration) => normalizedText(administration) === normalizedText(scalar),
  );
  if (!match) throw new RgsConsultingQueryError("Amministrazione non presente nello snapshot.");
  return match;
}

export function formatRgsEuroCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Importo RGS non valido.");
  }
  const value = BigInt(cents);
  const centsPerEuro = BigInt(100);
  const euros = (value / centsPerEuro).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = (value % centsPerEuro).toString().padStart(2, "0");
  return `${euros},${decimals} €`;
}

export function getRgsConsultingSourceHealth() {
  return {
    status: "verified" as const,
    check: "offline-source-lock-and-snapshot-contract" as const,
    runtimeFetch: false as const,
    artifact: { schemaVersion: rgsConsultingSnapshot.schemaVersion, ...ARTIFACT_INTEGRITY },
    resources: rgsConsultingSnapshot.source.resources.map((resource) => ({
      year: resource.year,
      datasetId: resource.datasetId,
      sourceBytes: resource.sourceBytes,
      sourceSha256: resource.sourceSha256,
      landingUrl: resource.landingUrl,
      csvUrl: resource.csvUrl,
      status: "verified" as const,
    })),
  };
}

export function queryRgsConsulting(query: RgsConsultingQuery = {}) {
  const year = yearParam(query.year);
  const administration = administrationParam(query.administration);
  const limit = integerParam(query.limit, "limit", 25, 1, 100);
  const offset = integerParam(query.offset, "offset", 0, 0, 10_000);
  const matchingRows: RgsConsultingRow[] = rgsConsultingSnapshot.rows.filter(
    (row) => (!year || row.year === year) && (!administration || row.administration === administration),
  );
  const rows = matchingRows.slice(offset, offset + limit);
  return {
    query: { year: year ?? null, administration: administration ?? null },
    rows,
    totals: {
      paidCashCents: matchingRows.reduce((sum, row) => sum + row.paidCashCents, 0),
      zeroPaidRows: matchingRows.filter((row) => row.paidCashCents === 0).length,
    },
    pagination: {
      total: matchingRows.length,
      offset,
      limit,
      returned: rows.length,
    },
  };
}
