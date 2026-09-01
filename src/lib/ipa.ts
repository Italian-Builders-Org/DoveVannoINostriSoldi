import { fetchOfficialSource } from "@/lib/data/source-fetch";

const IPA_DATASTORE_SEARCH =
  "https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search";
const IPA_DATASTORE_SEARCH_SQL =
  "https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search_sql";

const IPA_SEARCH_MAX_QUERY_LENGTH = 180;
const IPA_SEARCH_MAX_QUERY_TOKENS = 12;
const IPA_SEARCH_MAX_LIMIT = 100;

export const IPA_ENTI_RESOURCE_ID = "d09adf99-dc10-4349-8c53-27b1e5aa97b6";
export const IPA_ENTI_DATASET_URL = "https://www.indicepa.gov.it/ipa-dati/dataset/enti";
export const IPA_LICENSE = "CC BY 4.0";

export type IpaEntity = {
  codiceIpa: string;
  denominazione: string;
  codiceFiscale: string | null;
  tipologia: string | null;
  codiceCategoria: string | null;
  codiceNatura: string | null;
  codiceAteco: string | null;
  inLiquidazione: boolean | null;
  codiceMiur: string | null;
  codiceIstat: string | null;
  acronimo: string | null;
  responsabile: {
    nome: string | null;
    cognome: string | null;
    titolo: string | null;
  };
  sede: {
    codiceComuneIstat: string | null;
    codiceCatastaleComune: string | null;
    cap: string | null;
    indirizzo: string | null;
  };
  email: Array<{
    indirizzo: string;
    tipo: string | null;
  }>;
  sitoIstituzionale: string | null;
  social: {
    facebook: string | null;
    linkedin: string | null;
    twitter: string | null;
    youtube: string | null;
  };
  dataAggiornamento: string | null;
};

type IpaRawEntity = {
  Codice_IPA?: unknown;
  Denominazione_ente?: unknown;
  Codice_fiscale_ente?: unknown;
  Tipologia?: unknown;
  Codice_Categoria?: unknown;
  Codice_natura?: unknown;
  Codice_ateco?: unknown;
  Ente_in_liquidazione?: unknown;
  Codice_MIUR?: unknown;
  Codice_ISTAT?: unknown;
  Acronimo?: unknown;
  Nome_responsabile?: unknown;
  Cognome_responsabile?: unknown;
  Titolo_responsabile?: unknown;
  Codice_comune_ISTAT?: unknown;
  Codice_catastale_comune?: unknown;
  CAP?: unknown;
  Indirizzo?: unknown;
  Mail1?: unknown;
  Tipo_Mail1?: unknown;
  Mail2?: unknown;
  Tipo_Mail2?: unknown;
  Mail3?: unknown;
  Tipo_Mail3?: unknown;
  Mail4?: unknown;
  Tipo_Mail4?: unknown;
  Mail5?: unknown;
  Tipo_Mail5?: unknown;
  Sito_istituzionale?: unknown;
  Url_facebook?: unknown;
  Url_linkedin?: unknown;
  Url_twitter?: unknown;
  Url_youtube?: unknown;
  Data_aggiornamento?: unknown;
  [key: string]: unknown;
};

type CkanDatastoreResponse = {
  success?: boolean;
  result?: {
    total?: number;
    records?: IpaRawEntity[];
  };
};

type CkanSqlResponse = {
  success?: boolean;
  result?: {
    records?: IpaRawEntity[];
  };
};

export type IpaSearchResult = {
  total: number;
  records: IpaEntity[];
  observedAt: string;
  sourceUrl: string;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function requiredText(value: unknown, fallback: string): string {
  return text(value) ?? fallback;
}

function liquidazione(value: unknown): boolean | null {
  const normalized = text(value)?.toUpperCase();
  if (normalized === "S") return true;
  if (normalized === "N") return false;
  return null;
}

function externalUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeEntity(record: IpaRawEntity): IpaEntity {
  const email: IpaEntity["email"] = [];

  for (let index = 1; index <= 5; index += 1) {
    const indirizzo = text(record[`Mail${index}`]);
    if (!indirizzo) continue;

    email.push({
      indirizzo,
      tipo: text(record[`Tipo_Mail${index}`]),
    });
  }

  return {
    codiceIpa: requiredText(record.Codice_IPA, "codice-ipa-non-disponibile"),
    denominazione: requiredText(record.Denominazione_ente, "Denominazione non disponibile"),
    codiceFiscale: text(record.Codice_fiscale_ente),
    tipologia: text(record.Tipologia),
    codiceCategoria: text(record.Codice_Categoria),
    codiceNatura: text(record.Codice_natura),
    codiceAteco: text(record.Codice_ateco),
    inLiquidazione: liquidazione(record.Ente_in_liquidazione),
    codiceMiur: text(record.Codice_MIUR),
    codiceIstat: text(record.Codice_ISTAT),
    acronimo: text(record.Acronimo),
    responsabile: {
      nome: text(record.Nome_responsabile),
      cognome: text(record.Cognome_responsabile),
      titolo: text(record.Titolo_responsabile),
    },
    sede: {
      codiceComuneIstat: text(record.Codice_comune_ISTAT),
      codiceCatastaleComune: text(record.Codice_catastale_comune),
      cap: text(record.CAP),
      indirizzo: text(record.Indirizzo),
    },
    email,
    sitoIstituzionale: externalUrl(record.Sito_istituzionale),
    social: {
      facebook: externalUrl(record.Url_facebook),
      linkedin: externalUrl(record.Url_linkedin),
      twitter: externalUrl(record.Url_twitter),
      youtube: externalUrl(record.Url_youtube),
    },
    dataAggiornamento: text(record.Data_aggiornamento),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function tokenSearchPredicate(token: string): string {
  // The IPA gateway documents SQL search but rejects PostgreSQL regex
  // operators at its web-application firewall. ILIKE is supported and keeps
  // the query useful for any incomplete token, including a token in the
  // middle of a compound institution name. Exact prefix quality is decided
  // locally by the deterministic ranking layer.
  const pattern = sqlLiteral(`%${token}%`);
  return [
    `"Denominazione_ente" ILIKE ${pattern}`,
    `"Acronimo" ILIKE ${pattern}`,
    `"Codice_IPA" ILIKE ${pattern}`,
    `"Tipologia" ILIKE ${pattern}`,
  ].join(" OR ");
}

function normalizedQueryTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, IPA_SEARCH_MAX_QUERY_TOKENS);
}

async function datastoreRequest(
  params: URLSearchParams,
  signal?: AbortSignal,
  fetchOptions: Readonly<{ maxRetries?: number; timeoutMs?: number }> = {},
): Promise<IpaSearchResult> {
  params.set("resource_id", IPA_ENTI_RESOURCE_ID);

  const url = `${IPA_DATASTORE_SEARCH}?${params.toString()}`;
  const response = await fetchOfficialSource("ipa", url, {
    kind: "data",
    headers: { Accept: "application/json" },
    signal,
    tags: ["dataset:ipa-enti"],
    maxRetries: fetchOptions.maxRetries,
    timeoutMs: fetchOptions.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`IPA upstream HTTP ${response.status}`);
  }

  const payload = (await response.json()) as CkanDatastoreResponse;

  if (!payload.success || !payload.result || !Array.isArray(payload.result.records)) {
    throw new Error("Risposta IPA non valida");
  }

  return {
    total: typeof payload.result.total === "number" ? payload.result.total : 0,
    records: payload.result.records.map(normalizeEntity),
    observedAt: new Date().toISOString(),
    sourceUrl: url,
  };
}

export async function searchIpaEntities(options: {
  query?: string;
  limit?: number;
  offset?: number;
  categoryCode?: string;
  natureCode?: string;
  signal?: AbortSignal;
} = {}): Promise<IpaSearchResult> {
  const params = new URLSearchParams();
  params.set("limit", String(clamp(options.limit ?? 20, 0, 100)));
  params.set("offset", String(clamp(options.offset ?? 0, 0, 1_000_000)));

  const query = options.query?.trim();
  if (query) params.set("q", query.slice(0, IPA_SEARCH_MAX_QUERY_LENGTH));

  const filters: Record<string, string> = {};
  const categoryCode = options.categoryCode?.trim().slice(0, 20);
  const natureCode = options.natureCode?.trim().slice(0, 20);
  if (categoryCode) filters.Codice_Categoria = categoryCode;
  if (natureCode) filters.Codice_natura = natureCode;
  if (Object.keys(filters).length > 0) params.set("filters", JSON.stringify(filters));

  return datastoreRequest(params, options.signal);
}

/**
 * Search IPA by deterministic token prefixes.
 *
 * CKAN's datastore `q` parameter is a full-text query and does not reliably
 * return a name when the user has typed only its beginning (for example
 * `Jes` for `Jesolo`). The SQL endpoint is still read-only here: the resource
 * id is fixed, query tokens are normalized/escaped, the result count is
 * bounded, and the ordering is explicit. This function is intentionally
 * separate from the general `/api/enti` adapter so its narrow prefix contract
 * cannot change the semantics of existing exact/full-text API consumers.
 */
export async function searchIpaEntitiesByPrefix(options: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<IpaSearchResult> {
  const query = options.query.trim().slice(0, IPA_SEARCH_MAX_QUERY_LENGTH);
  const queryTokens = normalizedQueryTokens(query);
  const limit = clamp(options.limit ?? 20, 1, IPA_SEARCH_MAX_LIMIT);

  if (queryTokens.length === 0) {
    return searchIpaEntities({ limit, signal: options.signal });
  }

  const predicates = queryTokens.map(tokenSearchPredicate).map((predicate) => `(${predicate})`);
  const sql = [
    `SELECT *`,
    `FROM "${IPA_ENTI_RESOURCE_ID}"`,
    `WHERE ${predicates.join(" AND ")}`,
    `ORDER BY lower("Denominazione_ente"), lower("Codice_IPA")`,
    `LIMIT ${limit}`,
  ].join(" ");
  const sourceUrl = `${IPA_DATASTORE_SEARCH_SQL}?${new URLSearchParams({ sql }).toString()}`;
  const response = await fetchOfficialSource("ipa", sourceUrl, {
    kind: "data",
    headers: { Accept: "application/json" },
    signal: options.signal,
    tags: ["dataset:ipa-enti", "view:global-search"],
  });

  if (!response.ok) {
    throw new Error(`IPA SQL upstream HTTP ${response.status}`);
  }

  const payload = (await response.json()) as CkanSqlResponse;
  if (!payload.success || !Array.isArray(payload.result?.records)) {
    throw new Error("Risposta di ricerca per prefisso IPA non valida");
  }

  const records = payload.result.records;

  return {
    // The SQL adapter is deliberately bounded and reports the returned match
    // count. COUNT(*) OVER() is rejected by the IPA gateway even though the
    // underlying CKAN endpoint supports ordinary read-only SELECT queries.
    total: records.length,
    records: records.map(normalizeEntity),
    observedAt: new Date().toISOString(),
    sourceUrl,
  };
}

export async function getIpaCentralAdministrations(): Promise<IpaSearchResult> {
  return searchIpaEntities({ categoryCode: "C1", limit: 50 });
}

export async function getIpaEntityByCode(
  codiceIpa: string,
  signal?: AbortSignal,
): Promise<IpaEntity | null> {
  const normalized = codiceIpa.trim().slice(0, 100);
  if (!normalized) return null;

  const params = new URLSearchParams({
    limit: "1",
    filters: JSON.stringify({ Codice_IPA: normalized }),
  });

  // Page and API lookups must not retry a 500: each extra attempt is billed
  // compute while crawlers and clients retry the same URL.
  const result = await datastoreRequest(params, signal, { maxRetries: 0, timeoutMs: 4_000 });
  return result.records[0] ?? null;
}

export async function getIpaRegistryStats(): Promise<{
  total: number;
  observedAt: string;
}> {
  const result = await searchIpaEntities({ limit: 0 });
  return { total: result.total, observedAt: result.observedAt };
}
