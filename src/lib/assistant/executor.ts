import type { DatasetQuery } from "@/lib/mcp/catalog";
import { queryPublicDataset } from "@/lib/mcp/datasets";
import {
  ASSISTANT_DEFAULT_TIMEOUT_MS,
  assistantFailure,
  parseAssistantRequest,
  type AssistantAnswer,
  type AssistantFact,
  type AssistantRequest,
  type AssistantResponse,
} from "@/lib/assistant/contracts";
import { isAssistantIntent, parseAssistantIntent } from "@/lib/assistant/intent";
import { compareSiopeAnswers } from "@/lib/assistant/comparison";
import { partialMonthOf } from "@/lib/siope-calendar";

type QueryOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type AssistantDatasetQuery = (
  query: DatasetQuery,
  options?: QueryOptions,
) => Promise<unknown>;

export type AssistantExecutorOptions = Readonly<{
  queryDataset?: AssistantDatasetQuery;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

class AssistantTimeoutError extends Error {
  constructor() {
    super("assistant_timeout");
    this.name = "AssistantTimeoutError";
  }
}

class AssistantAbortError extends Error {
  constructor() {
    super("assistant_aborted");
    this.name = "AssistantAbortError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}: oggetto inatteso`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: lista inattesa`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}: testo inatteso`);
  }
  return value;
}

function number(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label}: numero inatteso`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const result = number(value, label, minimum);
  if (!Number.isSafeInteger(result)) throw new Error(`${label}: intero inatteso`);
  return result;
}

function optionalNumber(value: unknown, label: string, minimum = 0): number | null {
  if (value === null || value === undefined) return null;
  return number(value, label, minimum);
}

function ratio(value: unknown, label: string): number {
  const result = number(value, label);
  if (result > 1) throw new Error(`${label}: quota oltre 1`);
  return result;
}

function optionalRatio(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return ratio(value, label);
}

function monthLabel(month: number | null): string {
  if (month === null) return "anno completo";
  const names = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
  ];
  return names[month - 1] ?? `mese ${month}`;
}

function cumulativeYearLabel(year: number, endMonth: number): string {
  return endMonth === 12 ? `anno completo ${year}` : `gennaio–${monthLabel(endMonth)} ${year}`;
}

function fact(label: string, value: number, unit: AssistantFact["unit"]): AssistantFact {
  return { label, value, unit };
}

function period(year: number, month: number | null, label?: string) {
  return { year, month, label: label ?? `${monthLabel(month)} ${year}` };
}

function source(owner: unknown, url: unknown, observedAt: unknown) {
  const sourceUrl = text(url, "source.url");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("source.url: URL non valida");
  }
  if (parsedUrl.protocol !== "https:") throw new Error("source.url: HTTPS atteso");
  const observed = text(observedAt, "source.observedAt");
  if (Number.isNaN(Date.parse(observed))) throw new Error("source.observedAt: data non valida");
  return {
    owner: text(owner, "source.owner"),
    url: sourceUrl,
    observedAt: observed,
  };
}

function sourceLink(value: unknown, label: string): Record<string, unknown> {
  return record(value, label);
}

function siopeAnswer(query: DatasetQuery, value: unknown): AssistantAnswer {
  const snapshot = record(value, "SIOPE risposta");
  const year = integer(snapshot.year, "SIOPE.year", 2000);
  if (year !== query.year) throw new Error("SIOPE: anno diverso dalla richiesta");
  const latestMonth = integer(snapshot.latestMonth, "SIOPE.latestMonth", 1);
  if (latestMonth > 12) throw new Error("SIOPE.latestMonth fuori intervallo");
  const sourceRecord = record(snapshot.source, "SIOPE.source");
  const provenance = source(sourceRecord.siopeOwner, sourceRecord.siopeMovementsUrl, sourceRecord.observedAt);
  const periodLabel = partialMonthOf(year, latestMonth, provenance.observedAt) === null
    ? cumulativeYearLabel(year, latestMonth)
    : `gennaio–${monthLabel(latestMonth)} ${year} · ultimo mese parziale`;
  const coverage = record(snapshot.coverage, "SIOPE.coverage");
  const caveats = [
    "Sono pagamenti di cassa SIOPE dei Comuni, non tasse pagate dai residenti.",
    "Il totale nazionale include anche movimenti di enti senza abbinamento regionale IPA; non vengono distribuiti artificialmente.",
  ];

  if (query.region !== undefined) {
    const regions = list(snapshot.regions, "SIOPE.regions");
    const region = regions.length === 1 ? record(regions[0], "SIOPE.region") : null;
    if (!region) throw new Error("Aggregato regionale non disponibile");
    const regionName = text(region.region, "SIOPE.region.region");
    if (regionName !== query.region) throw new Error("SIOPE: Regione diversa dalla richiesta");
    const regionValue = number(region.value, "SIOPE.region.value");
    const population = region.population === null
      ? null
      : integer(region.population, "SIOPE.region.population");
    const municipalities = integer(region.municipalities, "SIOPE.region.municipalities");
    const perCapita = optionalNumber(region.perCapita, "SIOPE.region.perCapita");
    const share = optionalRatio(region.share, "SIOPE.region.share");
    if (share !== null) caveats.push("La quota regionale è calcolata sull’aggregato regionale abbinato a IPA, non sull’intero totale nazionale.");
    return {
      dataset: "siope_comuni",
      period: period(year, latestMonth, periodLabel),
      observation: {
        label: "Pagamenti SIOPE dei Comuni",
        value: regionValue,
        unit: "euro",
        scope: regionName,
      },
      source: provenance,
      caveats,
      facts: [
        fact("Comuni con movimenti nell’aggregato", municipalities, "count"),
        ...(population === null ? [] : [fact("Popolazione usata per il pro capite", population, "count")]),
        ...(perCapita === null ? [] : [fact("Pagamenti pro capite", perCapita, "euro")]),
        ...(share === null ? [] : [fact("Quota Titolo 1 sull’aggregato", share * 100, "percent")]),
      ],
    };
  }

  const totalPaid = number(snapshot.totalPaid, "SIOPE.totalPaid");
  const distribution = record(snapshot.distribution, "SIOPE.distribution");
  const nationalShare = optionalRatio(distribution.nationalShareAll, "SIOPE.distribution.nationalShareAll");
  const withoutRegion = integer(coverage.withoutRegion, "SIOPE.coverage.withoutRegion");
  const paymentsWithoutRegion = number(coverage.paymentsWithoutRegion, "SIOPE.coverage.paymentsWithoutRegion");
  return {
    dataset: "siope_comuni",
    period: period(year, latestMonth, periodLabel),
    observation: {
      label: "Pagamenti SIOPE dei Comuni",
      value: totalPaid,
      unit: "euro",
      scope: "Italia",
    },
    source: provenance,
    caveats: [
      ...caveats,
      `${withoutRegion} Comuni con movimenti (${paymentsWithoutRegion.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}) non sono regionalizzati nel join IPA.`,
    ],
    facts: [
      fact("Comuni con movimenti", integer(coverage.withMovements, "SIOPE.coverage.withMovements"), "count"),
      ...(nationalShare === null ? [] : [fact("Quota Titolo 1 sul totale", nationalShare * 100, "percent")]),
    ],
  };
}

function stateAnswer(value: unknown): AssistantAnswer {
  const snapshot = record(value, "OpenBDAP risposta");
  const periodRecord = record(snapshot.period, "OpenBDAP.period");
  const year = integer(periodRecord.year, "OpenBDAP.period.year", 2000);
  const month = periodRecord.month === null ? null : integer(periodRecord.month, "OpenBDAP.period.month", 1);
  if (month !== null && month > 12) throw new Error("OpenBDAP.period.month fuori intervallo");
  const releaseKind = text(periodRecord.releaseKind, "OpenBDAP.period.releaseKind");
  if (releaseKind !== "monthly" && releaseKind !== "consuntivo") {
    throw new Error("OpenBDAP.period.releaseKind inatteso");
  }
  if ((releaseKind === "monthly") !== (month !== null)) {
    throw new Error("OpenBDAP.period: mese e tipo di rilascio non coerenti");
  }
  const totalPaid = number(snapshot.totalPaid, "OpenBDAP.totalPaid");
  const sources = record(snapshot.sources, "OpenBDAP.sources");
  const mission = sourceLink(sources.mission, "OpenBDAP.sources.mission");
  const counts = record(snapshot.counts, "OpenBDAP.counts");
  const warnings = list(snapshot.warnings, "OpenBDAP.warnings").map((item) => text(item, "OpenBDAP.warning"));
  return {
    dataset: "openbdap_spesa_stato",
    period: period(year, month, text(periodRecord.label, "OpenBDAP.period.label")),
    observation: {
      label: "Pagamenti dello Stato",
      value: totalPaid,
      unit: "euro",
      scope: releaseKind === "consuntivo" ? "Consuntivo annuale" : "Rilascio mensile cumulato",
    },
    source: source(
      "OpenBDAP · Ragioneria Generale dello Stato",
      mission.csvUrl,
      snapshot.observedAt,
    ),
    caveats: [
      releaseKind === "consuntivo"
        ? "È il consuntivo annuale OpenBDAP: pagamenti contabilizzati, non costi economici o residui fiscali."
        : "È un rilascio mensile cumulato dal 1° gennaio al mese indicato: pagamenti contabilizzati, non costi economici o residui fiscali.",
      ...warnings,
    ],
    facts: [
      fact("Missioni disponibili", integer(counts.missions, "OpenBDAP.counts.missions"), "count"),
      fact("Amministrazioni disponibili", integer(counts.administrations, "OpenBDAP.counts.administrations"), "count"),
    ],
  };
}

function irpefAnswer(query: DatasetQuery, value: unknown): AssistantAnswer {
  const result = record(value, "MEF IRPEF risposta");
  const periodRecord = record(result.period, "MEF.period");
  const year = integer(periodRecord.taxYear, "MEF.period.taxYear", 2000);
  const matchedTotals = record(result.matchedTotals, "MEF.matchedTotals");
  const measures = record(matchedTotals.measures, "MEF.matchedTotals.measures");
  const netTax = record(measures.netTaxDeclared, "MEF.netTaxDeclared");
  const coverage = text(netTax.coverage, "MEF.netTaxDeclared.coverage");
  if (coverage !== "complete" && coverage !== "partial") {
    throw new Error("MEF.netTaxDeclared.coverage inattesa");
  }
  const amountCents = coverage === "complete"
    ? integer(netTax.amountCents, "MEF.netTaxDeclared.amountCents")
    : integer(netTax.knownAmountCents, "MEF.netTaxDeclared.knownAmountCents");
  const amount = amountCents / 100;
  const sourceRecord = record(record(result.provenance, "MEF.provenance").source, "MEF.source");
  const scope = query.region ?? "Regioni selezionate";
  const caveats = list(result.caveats, "MEF.caveats").map((item) => text(item, "MEF.caveat"));
  if (coverage === "partial") {
    caveats.unshift("L’ammontare è noto soltanto per le righe non soppresse; le celle oscurate non sono zero e non vengono stimate.");
  }
  return {
    dataset: "mef_irpef_comunale",
    period: period(year, null, `anno d’imposta ${year} · dichiarazioni ${integer(periodRecord.declarationYear, "MEF.period.declarationYear")}`),
    observation: {
      label: coverage === "complete" ? "Imposta netta dichiarata" : "Imposta netta dichiarata · ammontare noto",
      value: amount,
      unit: "euro",
      scope,
    },
    source: source(sourceRecord.owner, sourceRecord.landingUrl, periodRecord.observedAt),
    caveats,
    facts: [
      fact("Contribuenti", integer(matchedTotals.taxpayers, "MEF.matchedTotals.taxpayers"), "count"),
      fact("Dichiaranti con ammontare noto", integer(
        coverage === "complete" ? netTax.frequency : netTax.knownFrequency,
        "MEF.netTaxDeclared.frequency",
      ), "count"),
      ...(coverage === "partial"
        ? [fact("Righe con soppressione", integer(netTax.suppressedRows, "MEF.netTaxDeclared.suppressedRows"), "count")]
        : []),
    ],
  };
}

function buildAnswer(query: DatasetQuery, value: unknown): AssistantAnswer {
  switch (query.dataset) {
    case "siope_comuni": return siopeAnswer(query, value);
    case "openbdap_spesa_stato": return stateAnswer(value);
    case "mef_irpef_comunale": return irpefAnswer(query, value);
    default: throw new Error("Dataset non previsto dall’assistente deterministico");
  }
}

async function queryWithTimeout(
  queryDataset: AssistantDatasetQuery,
  queries: readonly DatasetQuery[],
  options: AssistantExecutorOptions,
): Promise<unknown[]> {
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? ASSISTANT_DEFAULT_TIMEOUT_MS, 15_000));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeParentListener: () => void = () => undefined;

  const result = new Promise<unknown[]>((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AssistantTimeoutError());
    }, timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
        reject(new AssistantAbortError());
        return;
      }
      const abortParent = () => {
        controller.abort(options.signal?.reason);
        reject(new AssistantAbortError());
      };
      options.signal.addEventListener("abort", abortParent, { once: true });
      removeParentListener = () => options.signal?.removeEventListener("abort", abortParent);
    }

    Promise.all(queries.map((query) => queryDataset(query, { signal: controller.signal }))).then(resolve, reject);
  });

  try {
    return await result;
  } finally {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
    removeParentListener();
  }
}

export async function executeAssistant(
  request: AssistantRequest,
  options: AssistantExecutorOptions = {},
): Promise<AssistantResponse> {
  const safeRequest = parseAssistantRequest(request);
  const parsed = parseAssistantIntent(safeRequest.prompt);
  if (!isAssistantIntent(parsed)) return parsed;

  const queryDataset = options.queryDataset ?? queryPublicDataset;
  try {
    const queries = parsed.kind === "siope_comparison" ? parsed.queries : [parsed.query];
    const data = await queryWithTimeout(queryDataset, queries, options);
    if (parsed.kind === "siope_comparison") {
      return {
        ok: true,
        kind: "comparison",
        comparison: compareSiopeAnswers([
          buildAnswer(parsed.queries[0], data[0]),
          buildAnswer(parsed.queries[1], data[1]),
        ]),
      };
    }
    return { ok: true, kind: "answer", answer: buildAnswer(parsed.query, data[0]) };
  } catch (error) {
    if (error instanceof AssistantTimeoutError) {
      return assistantFailure(
        "unavailable",
        "timeout",
        "La fonte non ha risposto entro il tempo disponibile. Riprova più tardi o consulta la scheda del dataset.",
      );
    }
    if (error instanceof AssistantAbortError) {
      return assistantFailure("unavailable", "data_unavailable", "La richiesta è stata interrotta. Nessun dato è stato salvato.");
    }
    return assistantFailure(
      "unavailable",
      "data_unavailable",
      "Il dato richiesto non è disponibile in questo momento. Non provo a stimarlo: consulta la fonte e la metodologia del dataset.",
    );
  }
}
