import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";
import { compactEuro, exactEuro, integer } from "@/lib/format";

const RECIPIENT_HEADERS = [
  "ragione_sociale",
  "contraente",
  "aggiudicatario",
  "nome_studio",
  "nome_o_ditta",
  "nome",
  "beneficiario",
  "fornitore",
] as const;

const SERVICE_HEADERS = [
  "settore_cpv",
  "oggetto",
  "tipo",
  "categoria",
  "servizio",
  "funzione",
] as const;

const COUNT_HEADERS = ["n_aggiudicazioni", "n_atti", "n_enti"] as const;

const AMOUNT_HEADER =
  /^(importo|valore|spesa|spese|pagato|impegnato|residui|previsioni|compenso|corrispettivo|totale|ammontare|canone|costo|finanziamento|erogato|liquidato|euro)\b/i;
const AMOUNT_UNIT_SUFFIX = /(?:^|_)(eur|euro)(?:_|$)/i;
const AMOUNT_PLACEHOLDER = /^(n\.?d\.?|-|—|–|n\/a|na)$/i;
const AMOUNT_VALUE = /^-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^-?\d+(?:[.,]\d+)?$/;

export const INSIGHT_TOP_N = 8;
export const INSIGHT_RECURRENCE_N = 6;

export type InsightColumnRoles = Readonly<{
  recipient: string | null;
  amount: string | null;
  service: string | null;
  count: string | null;
}>;

export type InsightRecipient = Readonly<{
  name: string;
  totalEuro: number;
  rows: number;
  awards: number;
  services: readonly string[];
}>;

export type DatasetInsights = Readonly<{
  datasetId: string;
  capable: boolean;
  roles: InsightColumnRoles;
  scannedRows: number;
  publicRows: number;
  rowsWithAmount: number;
  rowsWithRecipient: number;
  totalEuro: number;
  topRecipients: readonly InsightRecipient[];
  multiService: readonly InsightRecipient[];
  headline: string | null;
  coverageNote: string;
  chartPoints: readonly Readonly<{ label: string; value: number }>[];
}>;

function pickFirst(headers: readonly string[], candidates: readonly string[]): string | null {
  const set = new Set(headers);
  for (const candidate of candidates) {
    if (set.has(candidate)) return candidate;
  }
  return null;
}

function preferredAmountHeader(headers: readonly string[]): string | null {
  const preferred = [
    "importo_totale",
    "importo_somma",
    "importo_euro",
    "importo",
    "importo_annuo",
    "importo_primo",
    "pagato",
    "impegnato",
    "canone_annuo_eur",
    "costo_totale_eur",
  ];
  const hit = pickFirst(headers, preferred);
  if (hit) return hit;
  return headers.find((header) => looksLikeAmountHeader(header)) ?? null;
}

/** True when a public column name is an amount, including `*_eur` and canoni. */
export function looksLikeAmountHeader(header: string): boolean {
  const normalized = header.replace(/[_-]+/g, " ").trim();
  return AMOUNT_HEADER.test(normalized) || AMOUNT_UNIT_SUFFIX.test(header);
}

function isAmountPlaceholder(value: string): boolean {
  return AMOUNT_PLACEHOLDER.test(value.trim());
}

/**
 * Columns whose header is monetary and whose visible cells are amounts or
 * placeholders such as `n.d.`. A single non-numeric cell keeps the column as
 * text, so years, mq and codes are never shown as euro.
 */
export function amountColumnKeys(
  headers: readonly string[],
  rows: readonly Readonly<{ cells: Readonly<Record<string, string | null>> }>[],
): ReadonlySet<string> {
  return new Set(
    headers.filter((header) => {
      if (!looksLikeAmountHeader(header)) return false;
      let sawNumber = false;
      for (const row of rows) {
        const raw = row.cells[header];
        if (raw == null) continue;
        const trimmed = raw.trim();
        if (trimmed === "" || isAmountPlaceholder(trimmed)) continue;
        if (parseInsightAmount(trimmed) === null) return false;
        sawNumber = true;
      }
      return sawNumber;
    }),
  );
}

/** Formats a cell as euro, or null when the value is missing or not a number. */
export function formatIntegratedAmountCell(value: string | null | undefined): string | null {
  const parsed = parseInsightAmount(value);
  if (parsed === null) return null;
  return exactEuro(parsed);
}

/** Detects recipient / amount / service columns from public headers. */
export function detectInsightRoles(headers: readonly string[]): InsightColumnRoles {
  return {
    recipient: pickFirst(headers, RECIPIENT_HEADERS),
    amount: preferredAmountHeader(headers),
    service: pickFirst(headers, SERVICE_HEADERS),
    count: pickFirst(headers, COUNT_HEADERS),
  };
}

/** True when the dataset can support a top-recipient reading. */
export function isInsightCapable(headers: readonly string[], queryable: boolean): boolean {
  if (!queryable) return false;
  const roles = detectInsightRoles(headers);
  return roles.recipient !== null && roles.amount !== null;
}

/** Parses Italian/EU amount strings; returns null when the cell is not a number. */
export function parseInsightAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || !AMOUNT_VALUE.test(trimmed)) return null;
  const normalized = trimmed
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:[.,]|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function cellText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseCount(value: string | null | undefined): number {
  const amount = parseInsightAmount(value);
  if (amount === null || amount <= 0) return 1;
  return Math.round(amount);
}

type MutableRecipient = {
  name: string;
  totalEuro: number;
  rows: number;
  awards: number;
  services: Set<string>;
};

export function emptyInsights(
  datasetId: string,
  roles: InsightColumnRoles,
  publicRows: number,
  capable: boolean,
): DatasetInsights {
  return {
    datasetId,
    capable,
    roles,
    scannedRows: 0,
    publicRows,
    rowsWithAmount: 0,
    rowsWithRecipient: 0,
    totalEuro: 0,
    topRecipients: [],
    multiService: [],
    headline: null,
    coverageNote: capable
      ? "Nessuna riga con destinatario e importo leggibile in questo passaggio."
      : "Questo dataset non espone insieme destinatario e importo pubblici.",
    chartPoints: [],
  };
}

function finalizeRecipients(map: Map<string, MutableRecipient>): InsightRecipient[] {
  return [...map.values()]
    .map((entry) => ({
      name: entry.name,
      totalEuro: entry.totalEuro,
      rows: entry.rows,
      awards: entry.awards,
      services: [...entry.services].sort((a, b) => a.localeCompare(b, "it")),
    }))
    .sort(
      (left, right) =>
        right.totalEuro - left.totalEuro ||
        right.awards - left.awards ||
        left.name.localeCompare(right.name, "it"),
    );
}

function buildHeadline(top: InsightRecipient | undefined, rowsWithAmount: number): string | null {
  if (!top || rowsWithAmount === 0) return null;
  const awardsLabel =
    top.awards === 1 ? "1 affidamento o atto" : `${integer(top.awards)} affidamenti o atti`;
  if (top.services.length > 1) {
    return `${top.name} compare per ${exactEuro(top.totalEuro)} su ${awardsLabel}, in ${integer(top.services.length)} settori o servizi.`;
  }
  if (top.services.length === 1) {
    return `${top.name} compare per ${exactEuro(top.totalEuro)} su ${awardsLabel} nel settore ${top.services[0]}.`;
  }
  return `${top.name} compare per ${exactEuro(top.totalEuro)} su ${awardsLabel}.`;
}

function buildCoverageNote(
  rowsWithAmount: number,
  scannedRows: number,
  publicRows: number,
  exhausted: boolean,
): string {
  const scope = exhausted
    ? `su ${integer(rowsWithAmount)} righe con importo leggibile di ${integer(publicRows)} pubbliche`
    : `su ${integer(rowsWithAmount)} righe con importo leggibile nelle ${integer(scannedRows)} esaminate di ${integer(publicRows)} pubbliche`;
  return `Somma parziale ${scope}. I valori senza importo leggibile restano fuori dal totale.`;
}

/** Aggregates recipient totals from already-loaded public rows. */
export function aggregateRecipientInsights(
  datasetId: string,
  headers: readonly string[],
  rows: readonly IntegratedPublicRow[],
  options: {
    publicRows: number;
    scannedRows?: number;
    exhausted?: boolean;
    topN?: number;
  },
): DatasetInsights {
  const roles = detectInsightRoles(headers);
  const capable = roles.recipient !== null && roles.amount !== null;
  if (!capable || !roles.recipient || !roles.amount) {
    return emptyInsights(datasetId, roles, options.publicRows, false);
  }

  const recipients = new Map<string, MutableRecipient>();
  let rowsWithAmount = 0;
  let rowsWithRecipient = 0;
  let totalEuro = 0;

  for (const row of rows) {
    const name = cellText(row.cells[roles.recipient]);
    if (name) rowsWithRecipient += 1;
    const amount = parseInsightAmount(row.cells[roles.amount]);
    if (amount === null) continue;
    rowsWithAmount += 1;
    totalEuro += amount;
    if (!name) continue;

    const key = name.toLocaleLowerCase("it-IT");
    const existing = recipients.get(key) ?? {
      name,
      totalEuro: 0,
      rows: 0,
      awards: 0,
      services: new Set<string>(),
    };
    existing.totalEuro += amount;
    existing.rows += 1;
    existing.awards += roles.count ? parseCount(row.cells[roles.count]) : 1;
    const service = roles.service ? cellText(row.cells[roles.service]) : null;
    if (service) existing.services.add(service);
    recipients.set(key, existing);
  }

  const ranked = finalizeRecipients(recipients);
  const topN = options.topN ?? INSIGHT_TOP_N;
  const topRecipients = ranked.slice(0, topN);
  const multiService = ranked
    .filter((entry) => entry.services.length > 1)
    .slice(0, INSIGHT_RECURRENCE_N);
  const scannedRows = options.scannedRows ?? rows.length;
  const exhausted = options.exhausted ?? scannedRows >= options.publicRows;

  return {
    datasetId,
    capable: true,
    roles,
    scannedRows,
    publicRows: options.publicRows,
    rowsWithAmount,
    rowsWithRecipient,
    totalEuro,
    topRecipients,
    multiService,
    headline: buildHeadline(topRecipients[0], rowsWithAmount),
    coverageNote: buildCoverageNote(rowsWithAmount, scannedRows, options.publicRows, exhausted),
    chartPoints: topRecipients.map((entry) => ({
      label: entry.name,
      value: entry.totalEuro,
    })),
  };
}

/** Short catalog badge without loading rows. */
export function insightCapabilityBadge(headers: readonly string[], queryable: boolean): string | null {
  if (!isInsightCapable(headers, queryable)) return null;
  return "Con destinatari e importi";
}

export function formatInsightTeaser(insights: DatasetInsights): string | null {
  if (!insights.capable || !insights.topRecipients[0]) return null;
  const top = insights.topRecipients[0];
  return `${top.name}: ${compactEuro(top.totalEuro)}`;
}
