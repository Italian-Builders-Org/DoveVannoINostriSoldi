import {
  datasetCatalog,
  type DatasetDescriptor,
  type DatasetId,
} from "@/lib/mcp/catalog";
import { datasetQuerySchema } from "@/lib/mcp/query-schema";

/**
 * The public served set is exactly the active MCP catalog: one card per active
 * dataset id, derived from the same `datasetCatalog` authority. No second
 * catalog or snapshot is created here.
 */
export const AGENTS_INDEX_PATH = "/for-agents";

const ACTIVE_DATASET_ID_SET = new Set<string>(datasetCatalog.map((dataset) => dataset.id));

const DVNS_PUBLIC_HOSTS = ["www.dovevannoinostrisoldi.com", "dovevannoinostrisoldi.com"];
/** HTTPS hosts declared by the active catalog itself: descriptor sources and publicMetadata references. */
const CATALOG_PUBLIC_HOSTS = new Set<string>();
for (const dataset of datasetCatalog) {
  const declaredUrls = [
    ...dataset.sources.map((source) => source.url),
    ...(dataset.publicMetadata?.references ?? []).map((reference) => reference.url),
  ];
  for (const declaredUrl of declaredUrls) {
    try {
      const url = new URL(declaredUrl);
      if (url.protocol === "https:" && url.hostname) {
        CATALOG_PUBLIC_HOSTS.add(normalizedHostname(url.hostname));
      }
    } catch {
      // Malformed declared urls stay visible as plain text; they never become links.
    }
  }
}

const ALLOWED_PUBLIC_HOSTS = new Set<string>([
  ...DVNS_PUBLIC_HOSTS,
  ...CATALOG_PUBLIC_HOSTS,
]);

const ALLOWED_LOCAL_PATHS = new Set<string>([
  AGENTS_INDEX_PATH,
  "/dati",
  "/api/mcp",
  "/api/territori/irpef",
  "/mcp",
  "/metodologia",
  "/fonti",
  "/territori/irpef",
  "/privacy",
  "/supporto",
]);

const NO_STABLE_PERIOD =
  "Periodo non rappresentato da un metadato stabile nel catalogo: dipende dai filtri e dalla risposta del dataset.";
const NO_STABLE_UNITS =
  "Unità non rappresentata da un metadato stabile nel catalogo: dipende dal campo e dalla risposta del dataset.";
const NO_STABLE_COVERAGE =
  "Copertura non rappresentata da un metadato stabile nel catalogo: dipende dalla risposta del dataset.";

const MARKDOWN_METACHARACTERS = /([\\`*_[\]<>|#])/g;
const FORBIDDEN_URL_RESULT = /[()\]\[`<>|\r\n]/;
const DANGEROUS_URL_CHARACTERS = /[()\]\[`<>|\s\u0000-\u001f\u007f]/g;
const LOCAL_DATASET_PATH_PREFIX = `${AGENTS_INDEX_PATH}/datasets/`;
const SAFE_DATASET_SLUG = /^[a-z0-9_]+$/;

export type AgentPublicFilter = Readonly<{ name: string; description: string }>;
export type AgentPublicSource = Readonly<{
  name: string;
  owner: string;
  url: string;
  cadence: string;
  license?: string;
}>;
export type AgentPublicReference = Readonly<{ label: string; url: string }>;

export type AgentPublicDoc = Readonly<{
  id: DatasetId;
  title: string;
  summary: string;
  availability: string;
  period: readonly string[];
  units: readonly string[];
  coverage: string;
  caveat: string;
  filters: readonly AgentPublicFilter[];
  queryNotes: readonly string[];
  exampleQuery: Record<string, unknown>;
  exampleError: string | null;
  sources: readonly AgentPublicSource[];
  declaredSourceUrls: readonly string[];
  declaredReferenceUrls: readonly string[];
  references: readonly AgentPublicReference[];
  mcpEndpoint: string;
  httpEndpoint: string | null;
  httpExampleQuery: Record<string, string | number> | null;
  methodologyUrl: string;
}>;

function escapeMarkdownText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ").replace(MARKDOWN_METACHARACTERS, "\\$1");
}

function safeInlineCode(value: string): string {
  return SAFE_DATASET_SLUG.test(value) ? value : "identificativo-non-valido";
}

const PRIVATE_HOSTNAMES = /^(?:localhost|.*\.localhost|.*\.local)$/;
const IPV4_HOSTNAME = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_HOSTNAME = /^\[[0-9a-f:]+\]$/i;

function normalizedHostname(hostname: string): string {
  return hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return (
    normalized.length === 0 ||
    PRIVATE_HOSTNAMES.test(normalized) ||
    IPV4_HOSTNAME.test(normalized) ||
    IPV6_HOSTNAME.test(normalized)
  );
}

function agentDatasetPath(datasetId: string): string {
  return `${LOCAL_DATASET_PATH_PREFIX}${datasetId}`;
}

function isAllowedLocalPath(pathname: string): boolean {
  if (ALLOWED_LOCAL_PATHS.has(pathname)) return true;
  if (!pathname.startsWith(LOCAL_DATASET_PATH_PREFIX)) return false;
  const slug = pathname.slice(LOCAL_DATASET_PATH_PREFIX.length);
  return SAFE_DATASET_SLUG.test(slug) && ACTIVE_DATASET_ID_SET.has(slug);
}

function percentEncodeCharacter(character: string): string {
  return [...new TextEncoder().encode(character)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}

function encodeDangerousUrlCharacters(value: string): string {
  return value.replace(DANGEROUS_URL_CHARACTERS, percentEncodeCharacter);
}

function sanitizeLocalPath(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value, "https://local.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://local.invalid") return null;
  if (!isAllowedLocalPath(parsed.pathname)) return null;
  const query = new URLSearchParams(parsed.search).toString();
  const result = query ? `${parsed.pathname}?${query}` : parsed.pathname;
  return FORBIDDEN_URL_RESULT.test(result) ? null : result;
}

function hasExplicitPort(value: string): boolean {
  const schemeIndex = value.indexOf("://");
  if (schemeIndex < 0) return false;
  const authority = value.slice(schemeIndex + 3).split(/[/?#]/, 1)[0];
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    return closingBracket >= 0 && hostAndPort.slice(closingBracket + 1).startsWith(":");
  }
  return hostAndPort.includes(":");
}

export function sanitizePublicUrl(value: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/")) return sanitizeLocalPath(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.port || hasExplicitPort(trimmed)) return null;
  if (isBlockedHostname(parsed.hostname)) return null;
  if (!ALLOWED_PUBLIC_HOSTS.has(normalizedHostname(parsed.hostname))) return null;
  const pathname = encodeDangerousUrlCharacters(parsed.pathname);
  const query = new URLSearchParams(parsed.search).toString();
  const fragment = parsed.hash ? `#${encodeDangerousUrlCharacters(parsed.hash.slice(1))}` : "";
  const result = `${parsed.origin}${pathname}${query ? `?${query}` : ""}${fragment}`;
  return FORBIDDEN_URL_RESULT.test(result) ? null : result;
}

function schemaDescription(schema: unknown): string | undefined {
  let current = schema as { description?: unknown; unwrap?: () => unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.description === "string" && current.description.length > 0) {
      return current.description;
    }
    if (typeof current.unwrap !== "function") return undefined;
    current = current.unwrap() as typeof current;
  }
  return undefined;
}

function filterDescription(name: string): string {
  const shape = datasetQuerySchema.shape as Record<string, unknown>;
  return schemaDescription(shape[name]) ?? "Filtro dichiarato dal dataset.";
}

function exampleQueryViolation(dataset: DatasetDescriptor): string | null {
  const keys = Object.keys(dataset.exampleQuery).filter((key) => key !== "dataset");
  const unknown = keys.filter((key) => !dataset.filters.includes(key));
  if (unknown.length > 0) {
    return `chiavi dell'esempio non dichiarate fra i filtri: ${unknown.join(", ")}`;
  }
  const parsed = datasetQuerySchema.safeParse(dataset.exampleQuery);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    return `esempio non conforme a datasetQuerySchema: ${issues}`;
  }
  return null;
}

function buildAgentPublicDoc(dataset: DatasetDescriptor): AgentPublicDoc {
  const facts = dataset.publicMetadata;
  const declaredSourceUrls = dataset.sources.map((source) => source.url);
  const declaredReferenceUrls = (facts?.references ?? []).map((reference) => reference.url);
  const sources = dataset.sources.flatMap((source) => {
    const url = sanitizePublicUrl(source.url);
    if (!url) return [];
    return [{
      name: source.name,
      owner: source.owner,
      url,
      cadence: source.cadence,
      ...(source.license ? { license: source.license } : {}),
    }];
  });
  const cadence = dataset.publicationCadence
    ? `; acquisizione e pubblicazione: ${dataset.publicationCadence}`
    : "";
  return {
    id: dataset.id,
    title: dataset.title,
    summary: dataset.summary,
    availability: `Integrazione attiva; ${
      dataset.freshness === "snapshot"
        ? "snapshot verificato, senza query live nel rendering"
        : dataset.liveFallback === "snapshot"
          ? "fonte ufficiale live con fallback allo snapshot verificato"
          : "fonte ufficiale live"
    }${cadence}.`,
    period: facts?.period ?? [NO_STABLE_PERIOD],
    units: facts?.units ?? [NO_STABLE_UNITS],
    coverage: facts?.coverage ?? NO_STABLE_COVERAGE,
    caveat: dataset.caveat ?? "Nessun caveat specifico dichiarato: conserva fonte, periodo e perimetro.",
    filters: dataset.filters.map((name) => ({ name, description: filterDescription(name) })),
    queryNotes: facts?.queryNotes ?? [],
    exampleQuery: JSON.parse(JSON.stringify(dataset.exampleQuery)) as Record<string, unknown>,
    exampleError: exampleQueryViolation(dataset),
    sources,
    declaredSourceUrls,
    declaredReferenceUrls,
    references: (facts?.references ?? []).flatMap((reference) => {
      const url = sanitizePublicUrl(reference.url);
      return url ? [{ label: reference.label, url }] : [];
    }),
    mcpEndpoint: "/api/mcp",
    httpEndpoint: dataset.id === "mef_irpef_comunale" ? "/api/territori/irpef" : null,
    httpExampleQuery:
      dataset.id === "mef_irpef_comunale"
        ? { anno: 2024, livello: "comune", codice: "001019" }
        : null,
    methodologyUrl: "/metodologia",
  };
}

const servedDocs = datasetCatalog.map(buildAgentPublicDoc);
const servedDocById = new Map<string, AgentPublicDoc>(servedDocs.map((doc) => [doc.id, doc]));

export function listAgentPublicDocs(): readonly AgentPublicDoc[] {
  return servedDocs;
}

export function getAgentPublicDoc(datasetId: string): AgentPublicDoc | null {
  return servedDocById.get(datasetId) ?? null;
}

function renderReferences(references: readonly AgentPublicReference[]): string[] {
  return references.flatMap((reference) => {
    const url = sanitizePublicUrl(reference.url);
    return url ? [`- [${escapeMarkdownText(reference.label)}](${url})`] : [];
  });
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function renderAgentIndexEntry(doc: AgentPublicDoc): string {
  const id = safeInlineCode(doc.id);
  const path = sanitizePublicUrl(agentDatasetPath(doc.id));
  const title = escapeMarkdownText(doc.title);
  return path ? `- [${title}](${path}) — \`${id}\`.` : `- ${title} — \`${id}\`.`;
}

export function renderAgentsIndexMarkdown(): string {
  const docs = listAgentPublicDocs();
  const lines: string[] = [
    "# DVNS · indice per agenti",
    "",
    "Questa superficie pubblica espone in Markdown UTF-8 una scheda per ogni dataset del catalogo MCP attivo. Serve a leggere metadati, fonti, filtri, periodo, unità e limiti senza dipendere dai widget interattivi.",
    "",
    `Il catalogo attivo comprende ${docs.length} dataset e l'indice ne elenca uno per identificativo. Per interrogare i dati usa \`list_datasets\` e \`query_dataset\` su \`/api/mcp\`: la query richiede un client MCP compatibile.`,
    "",
    "## Procedura d'uso",
    "",
    `1. Leggi questa pagina su \`${AGENTS_INDEX_PATH}\`.`,
    "2. Apri la scheda del dataset che ti serve.",
    "3. Per i dati chiama `list_datasets` e poi `query_dataset` su `/api/mcp` (Streamable HTTP, sola lettura).",
    "",
    "## Schede disponibili",
    "",
  ];
  if (docs.length === 0) {
    lines.push("Nessuna scheda disponibile.");
  } else {
    for (const doc of docs) {
      lines.push(renderAgentIndexEntry(doc));
    }
  }
  lines.push("", "## Accesso ai dati", "");
  lines.push("- Endpoint MCP: `/api/mcp` (Streamable HTTP, `POST`, sola lettura).");
  lines.push("- Strumenti: `list_datasets` per l'elenco, `query_dataset` per l'interrogazione.");
  lines.push("", "## Riferimenti", "");
  const indexReferences = renderReferences([
    { label: "Dati", url: "/dati" },
    { label: "Pagina MCP", url: "/mcp" },
    { label: "Metodologia", url: "/metodologia" },
    { label: "Registro delle fonti", url: "/fonti" },
    { label: "Endpoint MCP", url: "/api/mcp" },
  ]);
  lines.push(...indexReferences);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderAgentPublicDocMarkdown(doc: AgentPublicDoc): string {
  const lines: string[] = [
    `# ${escapeMarkdownText(doc.title)}`,
    "",
    `Identificativo dataset: \`${safeInlineCode(doc.id)}\`.`,
    "",
    escapeMarkdownText(doc.summary),
    "",
    "## Disponibilità",
    "",
    escapeMarkdownText(doc.availability),
    "",
    `Copertura: ${escapeMarkdownText(doc.coverage)}`,
    "",
    "## Periodo",
    "",
    ...doc.period.map((entry) => `- ${escapeMarkdownText(entry)}`),
    "",
    "## Unità e significato",
    "",
    ...doc.units.map((entry) => `- ${escapeMarkdownText(entry)}`),
    "",
    "## Fonti",
    "",
  ];
  const safeSources = doc.sources.flatMap((source) => {
    const url = sanitizePublicUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });
  if (safeSources.length === 0) {
    lines.push("Fonti indicate nella risposta del dataset.");
  } else {
    for (const source of safeSources) {
      const license = source.license ? ` Licenza: ${escapeMarkdownText(source.license)}.` : "";
      lines.push(
        `- [${escapeMarkdownText(source.name)}](${source.url}) — ${escapeMarkdownText(source.owner)}. Cadenza: ${escapeMarkdownText(source.cadence)}.${license}`,
      );
    }
  }
  lines.push("", "## Filtri accettati", "");
  if (doc.filters.length === 0) {
    lines.push("Nessun filtro: il dataset risponde senza parametri.");
  } else {
    for (const filter of doc.filters) {
      lines.push(`- ${escapeMarkdownText(filter.name)}: ${escapeMarkdownText(filter.description)}`);
    }
  }
  if (doc.queryNotes.length > 0) {
    lines.push("", "## Note sui filtri", "");
    lines.push(...doc.queryNotes.map((note) => `- ${escapeMarkdownText(note)}`));
  }
  lines.push("", "## Accesso ai dati", "");
  const mcpEndpoint = sanitizePublicUrl(doc.mcpEndpoint) ?? "/api/mcp";
  lines.push(`- MCP: \`${mcpEndpoint}\` (Streamable HTTP, \`POST\`, sola lettura). Chiama \`list_datasets\`, poi \`query_dataset\`.`);
  if (doc.httpEndpoint) {
    const httpUrl = sanitizePublicUrl(doc.httpEndpoint);
    if (httpUrl) {
      lines.push(
        `- API HTTP esistente: \`${httpUrl}\` (\`GET\`, JSON paginato) restituisce lo stesso snapshot; i nomi dei parametri sono in italiano e distinti dallo schema MCP condiviso.`,
      );
    }
  }
  if (doc.exampleError) {
    lines.push("", "## Eccezione MCP", "");
    lines.push(
      "L'esempio dichiarato dal descrittore non supera la validazione condivisa, quindi non è pubblicato come supportato:",
    );
    lines.push("", `Motivo: ${escapeMarkdownText(doc.exampleError)}`, "");
  } else {
    lines.push("", "## Esempio MCP", "");
    lines.push("Input conforme allo schema condiviso, riutilizzato dal descrittore del dataset:");
    const exampleJson = JSON.stringify(doc.exampleQuery, null, 2);
    const fence = "`".repeat(Math.max(3, longestBacktickRun(exampleJson) + 1));
    lines.push("", `${fence}json`, exampleJson, fence, "");
  }
  if (doc.httpEndpoint && doc.httpExampleQuery) {
    const httpUrl = sanitizePublicUrl(doc.httpEndpoint);
    if (httpUrl) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(doc.httpExampleQuery)) {
        searchParams.set(key, String(value));
      }
      const exampleUrl = `${httpUrl}?${searchParams.toString()}`;
      lines.push("## Esempio HTTP", "");
      lines.push(
        "Parametri italiani accettati dalla route; non sono gli stessi nomi dello schema MCP condiviso:",
      );
      lines.push("", `- \`GET ${exampleUrl}\``, "");
    }
  }
  lines.push("", "## Limiti", "", escapeMarkdownText(doc.caveat));
  const methodologyUrl = sanitizePublicUrl(doc.methodologyUrl) ?? "/metodologia";
  lines.push("", "## Metodologia", "");
  lines.push(
    `Copertura, note sui filtri e limiti di questa scheda derivano dal contratto del dataset. Metodo pubblico e provenienza: [Metodologia](${methodologyUrl}).`,
  );
  lines.push("", "## Riferimenti", "");
  lines.push(`- [Indice per agenti](${AGENTS_INDEX_PATH})`);
  lines.push(...renderReferences(doc.references));
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderAgentDatasetMarkdown(datasetId: string): string | null {
  const doc = getAgentPublicDoc(datasetId);
  return doc ? renderAgentPublicDocMarkdown(doc) : null;
}
