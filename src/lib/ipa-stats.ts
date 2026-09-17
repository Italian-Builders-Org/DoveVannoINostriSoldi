import { fetchOfficialSource } from "@/lib/data/source-fetch";
import { IPA_ENTI_RESOURCE_ID } from "@/lib/ipa";
import {
  ipaRuntimeFetchOptions,
  type IpaRuntimeFetchOptions,
} from "@/lib/ipa-runtime-fetch";

const IPA_DATASTORE_SQL =
  "https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search_sql";

export type IpaTypeStat = {
  label: string;
  value: number;
};

type SqlRecord = {
  Tipologia?: unknown;
  totale?: unknown;
};

type SqlResponse = {
  success?: boolean;
  result?: {
    records?: SqlRecord[];
  };
};

function count(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getIpaTypeDistribution(
  limit = 8,
  options: IpaRuntimeFetchOptions = {},
): Promise<{
  records: IpaTypeStat[];
  observedAt: string;
  sourceUrl: string;
}> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 15);
  const sql = [
    `SELECT "Tipologia", COUNT(*) AS totale`,
    `FROM "${IPA_ENTI_RESOURCE_ID}"`,
    `WHERE "Tipologia" IS NOT NULL AND "Tipologia" <> ''`,
    `GROUP BY "Tipologia"`,
    `ORDER BY totale DESC`,
    `LIMIT ${safeLimit}`,
  ].join(" ");

  const sourceUrl = `${IPA_DATASTORE_SQL}?${new URLSearchParams({ sql }).toString()}`;
  const response = await fetchOfficialSource("ipa", sourceUrl, {
    kind: "data",
    headers: { Accept: "application/json" },
    tags: ["dataset:ipa-enti", "view:ipa-types"],
    ...ipaRuntimeFetchOptions(options),
  });

  const payload = (await response.json()) as SqlResponse;
  if (!payload.success || !Array.isArray(payload.result?.records)) {
    throw new Error("Risposta aggregata IPA non valida");
  }

  return {
    records: payload.result.records
      .map((record) => ({
        label:
          typeof record.Tipologia === "string" && record.Tipologia.trim()
            ? record.Tipologia.trim()
            : "Non classificato",
        value: count(record.totale),
      }))
      .filter((record) => record.value > 0),
    observedAt: new Date().toISOString(),
    sourceUrl,
  };
}
