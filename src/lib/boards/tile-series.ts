import type { BoardTileFilters } from "@/lib/data/boards-document";
import { boardTileCatalogEntry } from "@/lib/boards/tile-catalog";

export type BoardSeriesMeta = {
  id: string;
  label: string;
};

export type BoardSeriesPoint = {
  label: string;
  values: Record<string, number>;
};

export type BoardTileProvenance = {
  readAt: string;
  periodLabel: string;
  caveat: string | null;
  sourceIds: string[];
  datasetId: string;
};

export type BoardTileSeriesPayload = {
  datasetId: string;
  title: string;
  periodLabel: string;
  unitLabel: string;
  caveat: string | null;
  provenance: BoardTileProvenance;
  series: BoardSeriesMeta[];
  points: BoardSeriesPoint[];
  kpi: { label: string; value: number; formatted: string } | null;
};

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  useGrouping: "always",
});

const monthIt = new Intl.DateTimeFormat("it-IT", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function valuePoint(label: string, value: number): BoardSeriesPoint {
  return { label, values: { value } };
}

function notNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function centsToEuro(cents: number): number {
  return cents / 100;
}

function formatEuro(value: number): string {
  return euro.format(value);
}

type BoardTileSeriesDraft = Omit<BoardTileSeriesPayload, "provenance">;

function attachProvenance(draft: BoardTileSeriesDraft): BoardTileSeriesPayload {
  return {
    ...draft,
    provenance: {
      readAt: new Date().toISOString(),
      periodLabel: draft.periodLabel,
      caveat: draft.caveat,
      sourceIds: [],
      datasetId: draft.datasetId,
    },
  };
}

type BoardTileSeriesWithBundles = BoardTileSeriesDraft & {
  bundles?: Record<string, BoardSeriesPoint[]>;
};

function stripSeriesBundles(draft: BoardTileSeriesWithBundles): BoardTileSeriesDraft {
  const next = { ...draft };
  delete next.bundles;
  return next;
}

function emptyPayload(datasetId: string, message: string): BoardTileSeriesDraft {
  const entry = boardTileCatalogEntry(datasetId);
  return {
    datasetId,
    title: entry.label,
    periodLabel: "—",
    unitLabel: "euro",
    caveat: message,
    series: [],
    points: [],
    kpi: null,
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function firstString(...candidates: unknown[]): string | null {
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstCaveat(raw: Record<string, unknown>, fallback: string | null = null): string | null {
  if (typeof raw.caveat === "string" && raw.caveat.trim()) return raw.caveat;
  if (Array.isArray(raw.caveats) && typeof raw.caveats[0] === "string") return raw.caveats[0];
  if (isRecord(raw.methodology) && typeof raw.methodology.caveat === "string") {
    return raw.methodology.caveat;
  }
  return fallback;
}

function nestedNumber(value: unknown): number | null {
  const direct = asNumber(value);
  if (direct !== null) return direct;
  if (isRecord(value)) return asNumber(value.value);
  return null;
}

function moneyFromRow(row: Record<string, unknown>): number | null {
  // MEF IVA: values[] con amountCents annidati
  if (Array.isArray(row.values)) {
    for (const item of row.values) {
      if (!isRecord(item)) continue;
      const amount = nestedNumber(item.amountCents);
      if (amount !== null) return centsToEuro(amount);
    }
  }
  const cents =
    nestedNumber(row.totalCents)
    ?? nestedNumber(row.amountCents)
    ?? nestedNumber(row.valueCents)
    ?? nestedNumber(row.paidCents)
    ?? nestedNumber(row.interestExpenseCents)
    ?? nestedNumber(row.revenueCents)
    ?? nestedNumber(row.expenditureCents)
    ?? nestedNumber(row.balanceCents)
    ?? nestedNumber(row.historicalSpendingCents)
    ?? nestedNumber(row.standardSpendingCents)
    ?? nestedNumber(row.differenceCents)
    ?? nestedNumber(row.amountKnownCents)
    ?? nestedNumber(row.spendCents)
    ?? nestedNumber(row.convenzionataSpendCents)
    ?? nestedNumber(row.traceabilitySpendCents)
    ?? nestedNumber(row.complianceGapCents)
    ?? nestedNumber(row.vatRevenueCents)
    ?? nestedNumber(row.vttlCents);
  if (cents !== null) return centsToEuro(cents);
  const milli = asNumber(row.amountMilli);
  if (milli !== null) return milli / 1000;
  if (typeof row.attributedValue === "string" && row.attributedValue.trim()) {
    const parsed = Number(row.attributedValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return (
    asNumber(row.value)
    ?? asNumber(row.amount)
    ?? asNumber(row.amountEur)
    ?? asNumber(row.total)
    ?? asNumber(row.totalPaid)
    ?? asNumber(row.totalCollected)
    ?? asNumber(row.flow)
    ?? asNumber(row.perCapita)
    ?? asNumber(row.paid)
    ?? asNumber(row.effectivePayments)
    ?? asNumber(row.grossAnnualMeanEuros)
  );
}

function countFromRow(row: Record<string, unknown>): number | null {
  const tenths = asNumber(row.valueTenths) ?? asNumber(row.rateTenths);
  if (tenths !== null) return tenths / 10;
  const hundredths = asNumber(row.valueHundredths);
  if (hundredths !== null) return hundredths / 100;
  return (
    asNumber(row.studentCount)
    ?? asNumber(row.pensionCount)
    ?? asNumber(row.pensionerCount)
    ?? asNumber(row.assignments)
    ?? asNumber(row.personsThousands)
    ?? asNumber(row.rows)
    ?? asNumber(row.ordersKnown)
    ?? asNumber(row.inspections)
    ?? asNumber(row.householdCount)
    ?? asNumber(row.childrenCount)
    ?? asNumber(row.count)
    ?? asNumber(row.authorizedHours)
    ?? asNumber(row.awardCount)
    ?? asNumber(row.declaringAdministrations)
    ?? asNumber(row.projects)
    ?? (isRecord(row.taxpayers) ? asNumber(row.taxpayers.value) : null)
  );
}

function labelFromRow(row: Record<string, unknown>): string | null {
  if (typeof row.year === "number") return String(row.year);
  if (typeof row.period === "string") return row.period;
  return firstString(
    row.label,
    row.labelIt,
    row.schemeLabelIt,
    row.pathwayLabel,
    row.sectorLabel,
    row.geographyName,
    row.regionName,
    row.month,
    row.region,
    row.name,
    row.denominazione,
    row.referenceDate,
    row.code,
    row.codiceIpa,
    row.function,
    row.naItem,
    row.scheme,
    row.channel,
    row.key,
    row.id,
    row.ref,
  );
}

export type ProjectedBoardTile = BoardTileSeriesDraft & {
  bundles?: Record<string, BoardSeriesPoint[]>;
};

function projectDebt(raw: unknown): BoardTileSeriesDraft {
  if (!isRecord(raw) || !isRecord(raw.stock)) {
    return emptyPayload("debito_pubblico_italiano", "Risposta debito non valida.");
  }
  const stock = raw.stock;
  const history = Array.isArray(stock.history) ? stock.history : [];
  const stockPoints: BoardSeriesPoint[] = [];
  for (const row of history) {
    if (!isRecord(row)) continue;
    if (typeof row.referenceDate !== "string" || typeof row.totalCents !== "number") continue;
    stockPoints.push({
      label: monthIt.format(new Date(`${row.referenceDate}T00:00:00Z`)),
      values: { stock: centsToEuro(row.totalCents) },
    });
  }

  const interest = isRecord(raw.citizenImpact) && isRecord(raw.citizenImpact.annualInterest)
    ? raw.citizenImpact.annualInterest
    : null;
  const interestHistory = interest && Array.isArray(interest.history) ? interest.history : [];
  const interestPoints: BoardSeriesPoint[] = [];
  for (const row of interestHistory) {
    if (!isRecord(row)) continue;
    if (typeof row.year !== "number" || typeof row.interestExpenseCents !== "number") continue;
    interestPoints.push({
      label: String(row.year),
      values: { interest: centsToEuro(row.interestExpenseCents) },
    });
  }

  const totalCents = typeof stock.totalCents === "number" ? stock.totalCents : null;
  const ref = typeof stock.referenceDate === "string" ? stock.referenceDate : null;

  return {
    datasetId: "debito_pubblico_italiano",
    title: "Debito pubblico",
    periodLabel: ref ? `Stock al ${ref}` : "Stock Maastricht",
    unitLabel: "euro",
    caveat: Array.isArray(raw.caveats) ? String(raw.caveats[0] ?? "") || null : null,
    series: [
      { id: "stock", label: "Stock mensile" },
      ...(interestPoints.length > 0 ? [{ id: "interest", label: "Interessi annuali" }] : []),
    ],
    points: stockPoints,
    kpi: totalCents === null
      ? null
      : {
          label: "Stock corrente",
          value: centsToEuro(totalCents),
          formatted: formatEuro(centsToEuro(totalCents)),
        },
  };
}

/** Internal: debt needs two alternate point sets selectable by series id. */
function projectDebtBundled(raw: unknown): BoardTileSeriesDraft & {
  bundles: Record<string, BoardSeriesPoint[]>;
} {
  const base = projectDebt(raw);
  if (!isRecord(raw) || !isRecord(raw.stock)) {
    return { ...base, bundles: {} };
  }
  const history = Array.isArray(raw.stock.history) ? raw.stock.history : [];
  const stockPoints: BoardSeriesPoint[] = [];
  for (const row of history) {
    if (!isRecord(row)) continue;
    if (typeof row.referenceDate !== "string" || typeof row.totalCents !== "number") continue;
    stockPoints.push({
      label: monthIt.format(new Date(`${row.referenceDate}T00:00:00Z`)),
      values: { stock: centsToEuro(row.totalCents) },
    });
  }
  const interest = isRecord(raw.citizenImpact) && isRecord(raw.citizenImpact.annualInterest)
    ? raw.citizenImpact.annualInterest
    : null;
  const interestHistory = interest && Array.isArray(interest.history) ? interest.history : [];
  const interestPoints: BoardSeriesPoint[] = [];
  for (const row of interestHistory) {
    if (!isRecord(row)) continue;
    if (typeof row.year !== "number" || typeof row.interestExpenseCents !== "number") continue;
    interestPoints.push({
      label: String(row.year),
      values: { interest: centsToEuro(row.interestExpenseCents) },
    });
  }
  return {
    ...base,
    points: stockPoints,
    bundles: { stock: stockPoints, interest: interestPoints },
  };
}

function projectSiope(
  datasetId: string,
  raw: unknown,
  mode: "monthly" | "regions",
): BoardTileSeriesDraft & { bundles: Record<string, BoardSeriesPoint[]> } {
  // MCP receipts wrap the national snapshot under `national`.
  const source = isRecord(raw) && isRecord(raw.national)
    && (Array.isArray(raw.national.monthly) || typeof raw.national.totalCollected === "number")
    ? raw.national
    : raw;
  if (!isRecord(source)) {
    return { ...emptyPayload(datasetId, "Risposta SIOPE non valida."), bundles: {} };
  }
  const year = typeof source.year === "number" ? source.year : null;
  const monthly = Array.isArray(source.monthly) ? source.monthly : [];
  const regions = Array.isArray(source.regions) ? source.regions : [];

  const monthlyPoints: BoardSeriesPoint[] = [];
  for (const row of monthly) {
    if (!isRecord(row)) continue;
    const label = typeof row.label === "string" ? row.label : String(row.month ?? "");
    const flow = typeof row.flow === "number" ? row.flow : null;
    if (flow === null || !label) continue;
    monthlyPoints.push({ label, values: { flow } });
  }

  const regionPoints: BoardSeriesPoint[] = [];
  const sorted = regions
    .filter(isRecord)
    .map((row) => ({
      region: typeof row.region === "string" ? row.region : "",
      value: typeof row.value === "number" ? row.value : null,
    }))
    .filter((row) => row.region && row.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 12);
  for (const row of sorted) {
    regionPoints.push({ label: row.region, values: { region: row.value! } });
  }

  const total = typeof source.totalPaid === "number"
    ? source.totalPaid
    : typeof source.totalCollected === "number"
      ? source.totalCollected
      : null;

  const entry = boardTileCatalogEntry(datasetId);
  return {
    datasetId,
    title: entry.label,
    periodLabel: year ? `Anno ${year}` : "SIOPE",
    unitLabel: "euro",
    caveat: firstCaveat(source, isRecord(raw) ? firstCaveat(raw) : null),
    series: [
      { id: "flow", label: "Flusso mensile" },
      { id: "region", label: "Regioni (top)" },
    ],
    points: mode === "regions" ? regionPoints : monthlyPoints,
    kpi: total === null
      ? null
      : {
          label: datasetId === "siope_comuni" ? "Totale pagamenti" : "Totale incassi",
          value: total,
          formatted: formatEuro(total),
        },
    bundles: {
      flow: monthlyPoints,
      region: regionPoints,
    },
  };
}

function projectSsn(raw: unknown): BoardTileSeriesDraft & { bundles: Record<string, BoardSeriesPoint[]> } {
  if (!isRecord(raw) || !Array.isArray(raw.years)) {
    return { ...emptyPayload("openbdap_ssn_storico_nazionale", "Serie SSN non disponibile."), bundles: {} };
  }
  const seriesDefs: BoardSeriesMeta[] = [
    { id: "productionCosts", label: "Costi produzione" },
    { id: "personnelCost", label: "Personale" },
    { id: "purchasedServices", label: "Acquisto servizi" },
  ];
  const points: BoardSeriesPoint[] = [];
  for (const row of raw.years) {
    if (!isRecord(row) || typeof row.year !== "number" || !isRecord(row.values)) continue;
    const values: Record<string, number> = {};
    for (const meta of seriesDefs) {
      const cents = row.values[meta.id];
      if (typeof cents === "number") values[meta.id] = centsToEuro(cents);
    }
    if (Object.keys(values).length === 0) continue;
    points.push({ label: String(row.year), values });
  }
  const last = points.at(-1);
  const kpiValue = last?.values.productionCosts ?? null;
  return {
    datasetId: "openbdap_ssn_storico_nazionale",
    title: "OpenBDAP SSN",
    periodLabel: points.length ? `${points[0]!.label}–${points.at(-1)!.label}` : "SSN",
    unitLabel: "euro",
    caveat: "Competenza economica nazionale, non cassa.",
    series: seriesDefs,
    points,
    kpi: kpiValue === null || kpiValue === undefined
      ? null
      : {
          label: "Costi produzione (ultimo anno)",
          value: kpiValue,
          formatted: formatEuro(kpiValue),
        },
    bundles: { all: points },
  };
}

function functionLabelMap(raw: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(raw.functions)) return map;
  for (const row of raw.functions) {
    if (!isRecord(row)) continue;
    const code = firstString(row.code);
    const label = firstString(row.label, row.name);
    if (code && label) map.set(code, label);
  }
  return map;
}

function projectCofog(
  datasetId: string,
  raw: unknown,
): ProjectedBoardTile {
  if (!isRecord(raw) || !Array.isArray(raw.observations)) {
    return { ...emptyPayload(datasetId, "Osservazioni COFOG non disponibili."), bundles: {} };
  }
  const labels = functionLabelMap(raw);
  const observations = raw.observations.filter(isRecord);
  const totalCodes = new Set(["TOTAL", "G", "GF"]);
  const byYearTotal = new Map<number, number>();
  const byFunctionLatest = new Map<string, { year: number; value: number }>();
  let latestYear = -Infinity;

  for (const row of observations) {
    const year = asNumber(row.year);
    const cents = asNumber(row.amountCents);
    const fn = firstString(row.function) ?? "TOTAL";
    if (year === null || cents === null) continue;
    if (year > latestYear) latestYear = year;
    if (totalCodes.has(fn) || fn === "TOTAL" || fn === "G") {
      byYearTotal.set(year, centsToEuro(cents));
    }
    const prev = byFunctionLatest.get(fn);
    if (!prev || year >= prev.year) {
      byFunctionLatest.set(fn, { year, value: centsToEuro(cents) });
    }
  }

  const timelinePoints: BoardSeriesPoint[] = [...byYearTotal.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ label: String(year), values: { total: value } }));

  const functionPoints: BoardSeriesPoint[] = [...byFunctionLatest.entries()]
    .filter(([code]) => !totalCodes.has(code))
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 16)
    .map(([code, item]) => ({
      label: labels.get(code) ?? code,
      values: { function: item.value },
    }));

  const preferFunctions = timelinePoints.length < 2 && functionPoints.length >= 2;
  const points = preferFunctions ? functionPoints : (timelinePoints.length >= 2 ? timelinePoints : functionPoints);
  const series: BoardSeriesMeta[] = [];
  if (timelinePoints.length >= 2) series.push({ id: "total", label: "Totale nel tempo" });
  if (functionPoints.length >= 1) series.push({ id: "function", label: "Per funzione" });

  const entry = boardTileCatalogEntry(datasetId);
  const lastTotal = timelinePoints.at(-1)?.values.total
    ?? functionPoints[0]?.values.function
    ?? null;
  const period = typeof raw.period === "string"
    ? raw.period
    : Number.isFinite(latestYear) && latestYear > 0
      ? `Anno ${latestYear}`
      : "COFOG";

  if (points.length === 0) {
    return { ...emptyPayload(datasetId, "Nessuna osservazione COFOG plotabile."), bundles: {} };
  }

  return {
    datasetId,
    title: entry.label,
    periodLabel: period,
    unitLabel: "euro",
    caveat: firstCaveat(raw, entry.blurb),
    series: series.length > 0 ? series : [{ id: preferFunctions ? "function" : "total", label: "Valore" }],
    points,
    kpi: lastTotal === null
      ? null
      : {
          label: preferFunctions ? "Prima funzione" : "Totale ultimo anno",
          value: lastTotal,
          formatted: formatEuro(lastTotal),
        },
    bundles: {
      total: timelinePoints,
      function: functionPoints,
    },
  };
}

function projectConsulenti(raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw)) {
    return { ...emptyPayload("consulenti_incarichi", "Risposta consulenti non valida."), bundles: {} };
  }
  const external = Array.isArray(raw.externalAppointments) ? raw.externalAppointments : [];
  const employee = Array.isArray(raw.employeeAppointments) ? raw.employeeAppointments : [];
  const byYear = new Map<number, BoardSeriesPoint>();

  for (const row of external) {
    if (!isRecord(row) || typeof row.year !== "number") continue;
    const paid = asNumber(row.paidCents);
    if (paid === null) continue;
    const point = byYear.get(row.year) ?? { label: String(row.year), values: {} };
    point.values.external = centsToEuro(paid);
    if (typeof row.assignments === "number") point.values.externalCount = row.assignments;
    byYear.set(row.year, point);
  }
  for (const row of employee) {
    if (!isRecord(row) || typeof row.year !== "number") continue;
    const paid = asNumber(row.paidCents);
    if (paid === null) continue;
    const point = byYear.get(row.year) ?? { label: String(row.year), values: {} };
    point.values.employee = centsToEuro(paid);
    if (typeof row.assignments === "number") point.values.employeeCount = row.assignments;
    byYear.set(row.year, point);
  }

  const points = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, point]) => point);
  if (points.length === 0) {
    return { ...emptyPayload("consulenti_incarichi", "Serie incarichi non disponibile."), bundles: {} };
  }

  const last = points.at(-1)!;
  const kpiValue = (last.values.external ?? 0) + (last.values.employee ?? 0);
  const entry = boardTileCatalogEntry("consulenti_incarichi");
  return {
    datasetId: "consulenti_incarichi",
    title: entry.label,
    periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
    unitLabel: "euro",
    caveat: firstCaveat(raw, "L'anno più recente può essere parziale."),
    series: [
      { id: "external", label: "Incarichi esterni (compensi)" },
      { id: "employee", label: "Incarichi a dipendenti (compensi)" },
    ],
    points,
    kpi: {
      label: `Compensi ${last.label}`,
      value: kpiValue,
      formatted: formatEuro(kpiValue),
    },
    bundles: { all: points },
  };
}

function projectInpsInvalidity(raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw) || !isRecord(raw.spending) || !Array.isArray(raw.spending.series)) {
    return { ...emptyPayload("inps_invalidita_civile", "Serie invalidità civile non disponibile."), bundles: {} };
  }
  const points: BoardSeriesPoint[] = [];
  for (const row of raw.spending.series) {
    if (!isRecord(row) || typeof row.year !== "number") continue;
    const cents = asNumber(row.amountCents);
    if (cents === null) continue;
    points.push({ label: String(row.year), values: { spending: centsToEuro(cents) } });
  }
  if (points.length === 0) {
    return { ...emptyPayload("inps_invalidita_civile", "Serie invalidità civile vuota."), bundles: {} };
  }
  const last = points.at(-1)!.values.spending;
  const entry = boardTileCatalogEntry("inps_invalidita_civile");
  return {
    datasetId: "inps_invalidita_civile",
    title: entry.label,
    periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
    unitLabel: "euro",
    caveat: firstCaveat(raw, entry.blurb),
    series: [{ id: "spending", label: "Uscite annuali" }],
    points,
    kpi: { label: "Ultimo anno", value: last, formatted: formatEuro(last) },
    bundles: { spending: points },
  };
}

function projectInpsPensions(raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw) || !isRecord(raw.stock)) {
    return { ...emptyPayload("inps_pensioni_vigenti", "Stock pensioni non disponibile."), bundles: {} };
  }
  const stock = raw.stock;
  const count = asNumber(stock.pensionCount);
  const millionTenths = asNumber(stock.amountMillionTenths);
  const amountEuro = millionTenths !== null ? (millionTenths / 10) * 1_000_000 : null;

  const categoryPoints: BoardSeriesPoint[] = [];
  if (isRecord(raw.nature) && Array.isArray(raw.nature.items)) {
    for (const row of raw.nature.items) {
      if (!isRecord(row)) continue;
      const label = firstString(row.label, row.id);
      const n = asNumber(row.pensionCount);
      if (!label || n === null) continue;
      categoryPoints.push({ label, values: { pensions: n } });
    }
  }

  const entry = boardTileCatalogEntry("inps_pensioni_vigenti");
  const asOf = typeof raw.asOf === "string" ? raw.asOf : null;
  const points = categoryPoints.length > 0
    ? categoryPoints
    : amountEuro !== null
      ? [{ label: "Importo annuo", values: { amount: amountEuro } }]
      : count !== null
        ? [{ label: "Pensioni vigenti", values: { pensions: count } }]
        : [];

  if (points.length === 0) {
    return { ...emptyPayload("inps_pensioni_vigenti", "Dati pensioni non plotabili."), bundles: {} };
  }

  return {
    datasetId: "inps_pensioni_vigenti",
    title: entry.label,
    periodLabel: asOf ? `Al ${asOf}` : "Stock INPS",
    unitLabel: categoryPoints.length > 0 ? "prestazioni" : "euro",
    caveat: firstCaveat(raw, entry.blurb),
    series: categoryPoints.length > 0
      ? [{ id: "pensions", label: "Numero prestazioni" }]
      : amountEuro !== null
        ? [{ id: "amount", label: "Importo annuo" }]
        : [{ id: "pensions", label: "Pensioni vigenti" }],
    points,
    kpi: count !== null
      ? { label: "Pensioni vigenti", value: count, formatted: new Intl.NumberFormat("it-IT").format(count) }
      : amountEuro !== null
        ? { label: "Importo annuo", value: amountEuro, formatted: formatEuro(amountEuro) }
        : null,
    bundles: { pensions: categoryPoints },
  };
}

function projectCpt(raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) {
    return { ...emptyPayload("cpt_finanza_regionale", "Righe CPT non disponibili."), bundles: {} };
  }
  const year = typeof raw.year === "number" ? raw.year : null;
  const expenditure: BoardSeriesPoint[] = [];
  const revenue: BoardSeriesPoint[] = [];
  for (const row of raw.rows) {
    if (!isRecord(row)) continue;
    const region = firstString(row.region);
    if (!region) continue;
    const exp = asNumber(row.expenditureCents);
    const rev = asNumber(row.revenueCents);
    if (exp !== null) expenditure.push({ label: region, values: { expenditure: centsToEuro(exp) } });
    if (rev !== null) revenue.push({ label: region, values: { revenue: centsToEuro(rev) } });
  }
  expenditure.sort((a, b) => (b.values.expenditure ?? 0) - (a.values.expenditure ?? 0));
  revenue.sort((a, b) => (b.values.revenue ?? 0) - (a.values.revenue ?? 0));
  if (expenditure.length === 0 && revenue.length === 0) {
    return { ...emptyPayload("cpt_finanza_regionale", "Nessuna regione CPT plotabile."), bundles: {} };
  }
  const entry = boardTileCatalogEntry("cpt_finanza_regionale");
  const points = expenditure.length > 0 ? expenditure : revenue;
  const top = points[0]!;
  const topValue = top.values.expenditure ?? top.values.revenue ?? 0;
  return {
    datasetId: "cpt_finanza_regionale",
    title: entry.label,
    periodLabel: year ? `Anno ${year}` : "CPT",
    unitLabel: "euro",
    caveat: firstCaveat(raw, entry.blurb),
    series: [
      ...(expenditure.length ? [{ id: "expenditure", label: "Spesa" }] : []),
      ...(revenue.length ? [{ id: "revenue", label: "Entrate" }] : []),
    ],
    points,
    kpi: { label: top.label, value: topValue, formatted: formatEuro(topValue) },
    bundles: { expenditure, revenue },
  };
}

function projectOpenCivitas(datasetId: string, raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw)) {
    return { ...emptyPayload(datasetId, "Risposta OpenCivitas non valida."), bundles: {} };
  }
  const rows = Array.isArray(raw.data) ? raw.data : [];
  const points: BoardSeriesPoint[] = [];
  for (const row of rows.slice(0, 24)) {
    if (!isRecord(row)) continue;
    const label = firstString(row.name, row.istatCode);
    const historical = asNumber(row.historicalSpendingCents);
    const standard = asNumber(row.standardSpendingCents);
    if (!label || (historical === null && standard === null)) continue;
    const values: Record<string, number> = {};
    if (historical !== null) values.historical = centsToEuro(historical);
    if (standard !== null) values.standard = centsToEuro(standard);
    points.push({ label, values });
  }
  if (points.length === 0) {
    return {
      ...emptyPayload(
        datasetId,
        "Nessun Comune nella selezione: imposta il filtro regione (es. CALABRIA) nell'inspector.",
      ),
      bundles: {},
    };
  }
  const year = typeof raw.referenceYear === "number" ? raw.referenceYear : null;
  const entry = boardTileCatalogEntry(datasetId);
  const first = points[0]!.values.historical ?? points[0]!.values.standard ?? 0;
  return {
    datasetId,
    title: entry.label,
    periodLabel: year ? `Anno ${year}` : "OpenCivitas",
    unitLabel: "euro",
    caveat: firstCaveat(raw, "Selezione limitata ai filtri della tile (regione/limite)."),
    series: [
      { id: "historical", label: "Spesa storica" },
      { id: "standard", label: "Fabbisogno standard" },
    ],
    points,
    kpi: { label: points[0]!.label, value: first, formatted: formatEuro(first) },
    bundles: { all: points },
  };
}

function projectOpenbdapState(raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw)) {
    return { ...emptyPayload("openbdap_spesa_stato", "Risposta OpenBDAP non valida."), bundles: {} };
  }
  const missions = Array.isArray(raw.missions) ? raw.missions : [];
  const points: BoardSeriesPoint[] = [];
  for (const row of missions) {
    if (!isRecord(row)) continue;
    const label = firstString(row.label, row.name, row.code);
    const paid = asNumber(row.totalPaid) ?? moneyFromRow(row);
    if (!label || paid === null) continue;
    points.push({ label, values: { mission: paid } });
  }
  points.sort((a, b) => (b.values.mission ?? 0) - (a.values.mission ?? 0));
  const total = asNumber(raw.totalPaid);
  if (points.length === 0 && total === null) {
    return { ...emptyPayload("openbdap_spesa_stato", "Missioni OpenBDAP non disponibili."), bundles: {} };
  }
  const entry = boardTileCatalogEntry("openbdap_spesa_stato");
  const year = typeof raw.year === "number" ? raw.year : null;
  const month = typeof raw.month === "number" ? raw.month : null;
  return {
    datasetId: "openbdap_spesa_stato",
    title: entry.label,
    periodLabel: year ? (month ? `${month}/${year}` : `Anno ${year}`) : "OpenBDAP",
    unitLabel: "euro",
    caveat: firstCaveat(raw, entry.blurb),
    series: [{ id: "mission", label: "Spesa per missione" }],
    points: points.length > 0
      ? points.slice(0, 16)
      : [{ label: "Totale", values: { mission: total! } }],
    kpi: total === null
      ? null
      : { label: "Totale pagato", value: total, formatted: formatEuro(total) },
    bundles: { mission: points },
  };
}

function pointsFromArray(
  rows: unknown[],
  valueKey = "value",
): BoardSeriesPoint[] {
  const points: BoardSeriesPoint[] = [];
  for (const row of rows.slice(0, 48)) {
    if (!isRecord(row)) continue;
    const label = labelFromRow(row);
    if (!label) continue;
    const euroValue = moneyFromRow(row);
    if (euroValue !== null) {
      points.push({ label, values: { [valueKey]: euroValue } });
      continue;
    }
    const count = countFromRow(row);
    if (count !== null) {
      points.push({ label, values: { [valueKey]: count } });
    }
  }
  return points;
}

function projectParlamento(raw: unknown): ProjectedBoardTile {
  if (!isRecord(raw) || !Array.isArray(raw.chambers)) {
    return { ...emptyPayload("parlamento_bilanci", "Bilanci parlamentari non disponibili."), bundles: {} };
  }
  const points: BoardSeriesPoint[] = [];
  for (const chamber of raw.chambers) {
    if (!isRecord(chamber) || !Array.isArray(chamber.statements)) continue;
    const name = firstString(chamber.name, chamber.id) ?? "Camera";
    for (const statement of chamber.statements) {
      if (!isRecord(statement) || typeof statement.year !== "number") continue;
      const values = isRecord(statement.values) ? statement.values : null;
      const paid = values ? asNumber(values.effectivePayments) : null;
      if (paid === null) continue;
      // Unità ufficiali: milioni di euro
      points.push({
        label: `${statement.year} · ${name}`,
        values: { payments: paid * 1_000_000 },
      });
    }
  }
  if (points.length === 0) {
    return { ...emptyPayload("parlamento_bilanci", "Nessun consuntivo plotabile."), bundles: {} };
  }
  const entry = boardTileCatalogEntry("parlamento_bilanci");
  const last = points.at(-1)!.values.payments;
  return {
    datasetId: "parlamento_bilanci",
    title: entry.label,
    periodLabel: "Consuntivi istituzionali",
    unitLabel: "euro",
    caveat: firstCaveat(raw, typeof raw.rounding === "string" ? raw.rounding : entry.blurb),
    series: [{ id: "payments", label: "Pagamenti effettivi" }],
    points,
    kpi: { label: "Ultimo punto", value: last, formatted: formatEuro(last) },
    bundles: { payments: points },
  };
}

/** Heuristica fail-soft su risposte MCP eterogenee. */
function projectGeneric(datasetId: string, raw: unknown): ProjectedBoardTile {
  const entry = boardTileCatalogEntry(datasetId);

  // Cataloghi piatte (es. registro_fonti): array di oggetti con name/area
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isRecord)) {
    const byArea = new Map<string, number>();
    for (const row of raw) {
      const label = firstString(row.area, row.domain, row.owner, row.name) ?? "Fonte";
      byArea.set(label, (byArea.get(label) ?? 0) + 1);
    }
    const points = [...byArea.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([label, value]) => ({ label, values: { value } }));
    if (points.length >= 1) {
      return {
        datasetId,
        title: entry.label,
        periodLabel: "Catalogo fonti",
        unitLabel: "fonti",
        caveat: entry.blurb,
        series: [{ id: "value", label: "Fonti" }],
        points,
        kpi: {
          label: "Fonti catalogate",
          value: raw.length,
          formatted: raw.length.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }

  if (!isRecord(raw)) {
    return { ...emptyPayload(datasetId, "Risposta non strutturata."), bundles: {} };
  }

  // Wrapper SIOPE-like
  if (isRecord(raw.national) && (Array.isArray(raw.national.monthly) || Array.isArray(raw.national.regions))) {
    return projectSiope(datasetId, raw, "monthly");
  }

  // Nested spending.series (INPS-like)
  if (isRecord(raw.spending) && Array.isArray(raw.spending.series)) {
    const points = pointsFromArray(raw.spending.series, "value");
    if (points.length >= 2) {
      const last = points.at(-1)!.values.value;
      return {
        datasetId,
        title: entry.label,
        periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Valore" }],
        points,
        kpi: { label: "Ultimo punto", value: last, formatted: formatEuro(last) },
        bundles: { value: points },
      };
    }
  }

  // Appointments-style dual series
  if (Array.isArray(raw.externalAppointments) || Array.isArray(raw.employeeAppointments)) {
    return projectConsulenti({ ...raw, datasetId: "consulenti_incarichi" });
  }

  // OpenBDAP legislature cycles → annual totals
  if (Array.isArray(raw.cycles)) {
    const points: BoardSeriesPoint[] = [];
    for (const cycle of raw.cycles) {
      if (!isRecord(cycle) || !Array.isArray(cycle.years)) continue;
      for (const yearRow of cycle.years) {
        if (!isRecord(yearRow) || typeof yearRow.year !== "number") continue;
        const paid = asNumber(yearRow.totalPaid);
        if (paid === null) continue;
        points.push({ label: String(yearRow.year), values: { value: paid } });
      }
    }
    if (points.length >= 2) {
      const last = points.at(-1)!.values.value;
      return {
        datasetId,
        title: entry.label,
        periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Spesa annuale" }],
        points,
        kpi: { label: "Ultimo anno", value: last, formatted: formatEuro(last) },
        bundles: { value: points },
      };
    }
  }

  // Integrated corpus rows: cells as array OR record keyed by header
  if (
    Array.isArray(raw.rows)
    && raw.rows.length > 0
    && isRecord(raw.rows[0])
    && raw.rows[0].cells != null
    && isRecord(raw.dataset)
    && Array.isArray(raw.dataset.headers)
  ) {
    const corpusRows = raw.rows;
    const headers = raw.dataset.headers.map((h) => String(h));
    const amountHeader = headers.find((h) =>
      /amount|importo|cents|spesa|pagat|finanz/i.test(h) && !/data\s*fine/i.test(h),
    );
    const regionHeader =
      headers.find((h) => /descrizione missione/i.test(h))
      ?? headers.find((h) => h === "region" || /regione/i.test(h))
      ?? headers.find((h) => /^missione$/i.test(h));
    const entityHeader =
      headers.find((h) => h === "entityName" || h === "name")
      ?? headers.find((h) => /^(ente|contraente|denominazione|oggetto)$/i.test(h))
      ?? headers.find((h) => /^cup$/i.test(h));
    const hasYear = headers.includes("year") || headers.includes("Anno");
    const hasMonth = headers.includes("month");
    const amountIsCents = amountHeader ? /cents/i.test(amountHeader) : false;

    function cellValue(cells: unknown, header: string | undefined): string | null {
      if (!header) return null;
      if (Array.isArray(cells)) {
        const idx = headers.indexOf(header);
        if (idx < 0 || cells[idx] == null) return null;
        return String(cells[idx]);
      }
      if (isRecord(cells) && cells[header] != null) return String(cells[header]);
      return null;
    }

    if (amountHeader) {
      const accumulate = (pickLabel: (cells: unknown) => string | null) => {
        const byKey = new Map<string, number>();
        for (const row of corpusRows) {
          if (!isRecord(row)) continue;
          const amountRaw = cellValue(row.cells, amountHeader);
          if (amountRaw === null || !amountRaw.trim()) continue;
          const normalized = amountRaw.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
          const amount = Number(normalized);
          if (!Number.isFinite(amount)) continue;
          const euroValue = amountIsCents ? centsToEuro(amount) : amount;
          const label = pickLabel(row.cells);
          if (!label) continue;
          byKey.set(label, (byKey.get(label) ?? 0) + euroValue);
        }
        return byKey;
      };

      let byKey = accumulate((cells) => {
        if (hasYear && hasMonth) {
          const y = cellValue(cells, "year") ?? cellValue(cells, "Anno");
          const m = cellValue(cells, "month");
          if (y && m) return `${m.padStart(2, "0")}/${y}`;
        }
        return null;
      });
      // Poche serie temporali (es. pagina concentrata su un mese): preferisci regioni/enti.
      if (byKey.size < 3 && regionHeader) {
        byKey = accumulate((cells) => cellValue(cells, regionHeader));
      }
      if (byKey.size < 3 && entityHeader) {
        byKey = accumulate((cells) => cellValue(cells, entityHeader));
      }
      if (byKey.size === 0) {
        byKey = accumulate((cells) =>
          cellValue(cells, regionHeader)
          ?? cellValue(cells, entityHeader)
          ?? cellValue(cells, "year")
          ?? cellValue(cells, "Anno")
          ?? "Selezione",
        );
      }

      const points = [...byKey.entries()]
        .sort((a, b) => {
          if (/^\d{2}\/\d{4}$/u.test(a[0]) && /^\d{2}\/\d{4}$/u.test(b[0])) {
            const [am, ay] = a[0].split("/");
            const [bm, by] = b[0].split("/");
            return Number(ay) * 12 + Number(am) - (Number(by) * 12 + Number(bm));
          }
          return b[1] - a[1];
        })
        .map(([label, value]) => ({ label, values: { value } }))
        .slice(0, 48);
      if (points.length >= 1) {
        const sum = points.reduce((acc, point) => acc + (point.values.value ?? 0), 0);
        return {
          datasetId,
          title: entry.label,
          periodLabel: "Selezione corrente",
          unitLabel: "euro",
          caveat: firstCaveat(raw, "Aggregato sulla pagina restituita dall’API, non sul corpus intero."),
          series: [{ id: "value", label: "Importo" }],
          points,
          kpi: { label: "Somma selezione", value: sum, formatted: formatEuro(sum) },
          bundles: { value: points },
        };
      }
    }
  }

  // COFOG / Eurostat / SHA / AROPE / AIFA / BES observations
  if (Array.isArray(raw.observations) && raw.observations.length > 0) {
    const sample = raw.observations.find(isRecord);
    if (sample) {
      if (sample.function !== undefined && nestedNumber(sample.amountCents) !== null) {
        return projectCofog(datasetId, raw);
      }

      // AIFA-like: many ATC×region cells → aggregate by region
      if (
        sample.convenzionataSpendCents !== undefined
        || sample.traceabilitySpendCents !== undefined
      ) {
        const byRegion = new Map<string, number>();
        for (const row of raw.observations) {
          if (!isRecord(row)) continue;
          const region = firstString(row.regionCode, row.region) ?? "IT";
          const spend =
            nestedNumber(row.convenzionataSpendCents)
            ?? nestedNumber(row.traceabilitySpendCents)
            ?? 0;
          byRegion.set(region, (byRegion.get(region) ?? 0) + centsToEuro(spend));
        }
        const points = [...byRegion.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([label, value]) => ({ label, values: { value } }));
        if (points.length >= 1) {
          const top = points[0]!.values.value;
          return {
            datasetId,
            title: entry.label,
            periodLabel: typeof sample.year === "number" ? `Anno ${sample.year}` : "AIFA",
            unitLabel: "euro",
            caveat: firstCaveat(raw, entry.blurb),
            series: [{ id: "value", label: "Spesa convenzionata" }],
            points,
            kpi: { label: points[0]!.label, value: top, formatted: formatEuro(top) },
            bundles: { value: points },
          };
        }
      }

      // BES / povertà: scale × indicator × year (preferisci totale T)
      if (
        sample.indicator !== undefined
        && (sample.valueTenths !== undefined || sample.valueHundredths !== undefined)
      ) {
        const indicator = firstString(sample.indicator) ?? "";
        const preferred = raw.observations.filter(
          (row) =>
            isRecord(row)
            && row.indicator === indicator
            && (row.sex === "T" || row.sex === undefined || row.sex === null),
        );
        const pool = preferred.length >= 2
          ? preferred
          : raw.observations.filter((row) => isRecord(row) && row.indicator === indicator);
        const byYear = new Map<number, number>();
        for (const row of pool) {
          if (!isRecord(row) || typeof row.year !== "number") continue;
          const tenths = asNumber(row.valueTenths);
          const hundredths = asNumber(row.valueHundredths);
          if (tenths !== null) byYear.set(row.year, tenths / 10);
          else if (hundredths !== null) byYear.set(row.year, hundredths / 100);
        }
        const points = [...byYear.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([year, value]) => ({ label: String(year), values: { value } }));
        if (points.length >= 1) {
          const last = points.at(-1)!.values.value;
          const indicatorMeta = Array.isArray(raw.indicators)
            ? raw.indicators.find((item) => isRecord(item) && item.code === indicator)
            : null;
          const indicatorLabel = isRecord(indicatorMeta)
            ? firstString(indicatorMeta.label, indicatorMeta.code) ?? indicator
            : indicator;
          return {
            datasetId,
            title: entry.label,
            periodLabel: points.length >= 2
              ? `${points[0]!.label}–${points.at(-1)!.label}`
              : points[0]!.label,
            unitLabel: "indice",
            caveat: firstCaveat(raw, entry.blurb),
            series: [{ id: "value", label: indicatorLabel }],
            points,
            kpi: {
              label: "Ultimo punto",
              value: last,
              formatted: last.toLocaleString("it-IT", { maximumFractionDigits: 1 }),
            },
            bundles: { value: points },
          };
        }
      }

      let filtered = raw.observations;
      if (sample.naItem !== undefined) {
        const code = firstString(sample.naItem);
        if (code) filtered = raw.observations.filter((row) => isRecord(row) && row.naItem === code);
      } else if (sample.scheme !== undefined) {
        const preferred = raw.observations.filter((row) => isRecord(row) && row.scheme === "TOT_HF");
        if (preferred.length >= 2) filtered = preferred;
      } else if (sample.territory !== undefined) {
        const preferred = raw.observations.filter((row) => isRecord(row) && row.territory === "IT");
        if (preferred.length >= 1) filtered = preferred;
      }
      const points = pointsFromArray(filtered, "value");
      if (points.length >= 1) {
        const last = points.at(-1)!.values.value;
        const isRate = sample.rateTenths !== undefined || sample.valueTenths !== undefined;
        return {
          datasetId,
          title: entry.label,
          periodLabel: points.length >= 2
            ? `${points[0]!.label}–${points.at(-1)!.label}`
            : points[0]!.label,
          unitLabel: isRate ? "%" : "euro",
          caveat: firstCaveat(raw, entry.blurb),
          series: [{ id: "value", label: "Valore" }],
          points,
          kpi: {
            label: "Ultimo punto",
            value: last,
            formatted: isRate
              ? `${last.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`
              : formatEuro(last),
          },
          bundles: { value: points },
        };
      }
    }
  }

  // SSN conto economico annuale: barre per regione sui costi di produzione
  if (
    isRecord(raw.national)
    && isRecord(raw.national.values)
    && Array.isArray(raw.regions)
    && raw.regions.length > 0
  ) {
    const points: BoardSeriesPoint[] = [];
    for (const region of raw.regions.slice(0, 24)) {
      if (!isRecord(region) || !isRecord(region.values)) continue;
      const label = firstString(region.name, region.code);
      const cents = asNumber(region.values.productionCosts);
      if (!label || cents === null) continue;
      points.push({ label, values: { value: centsToEuro(cents) } });
    }
    if (points.length >= 1) {
      points.sort((a, b) => b.values.value - a.values.value);
      const top = points[0]!.values.value;
      const nationalCents = asNumber(raw.national.values.productionCosts);
      return {
        datasetId,
        title: entry.label,
        periodLabel: typeof raw.referenceYear === "number" ? `Anno ${raw.referenceYear}` : "SSN",
        unitLabel: "euro",
        caveat: firstCaveat(raw, "Costi di produzione per regione (competenza economica)."),
        series: [{ id: "value", label: "Costi di produzione" }],
        points,
        kpi: nationalCents === null
          ? { label: points[0]!.label, value: top, formatted: formatEuro(top) }
          : {
            label: "Nazionale",
            value: centsToEuro(nationalCents),
            formatted: formatEuro(centsToEuro(nationalCents)),
          },
        bundles: { value: points },
      };
    }
  }

  if (Array.isArray(raw.chambers)) {
    return projectParlamento(raw);
  }

  // Legge di bilancio storica: stanziamenti per missione (ultimo anno)
  if (Array.isArray(raw.allocations) && raw.allocations.length > 0) {
    const years = raw.allocations
      .map((row) => (isRecord(row) && typeof row.year === "number" ? row.year : null))
      .filter((year): year is number => year !== null);
    const latest = years.length > 0 ? Math.max(...years) : null;
    const points = raw.allocations
      .filter((row) => isRecord(row) && (latest === null || row.year === latest))
      .map((row): BoardSeriesPoint | null => {
        if (!isRecord(row)) return null;
        const label = firstString(row.mission, row.label);
        const amount = asNumber(row.amountEur);
        if (!label || amount === null) return null;
        return valuePoint(label, amount);
      })
      .filter(notNull)
      .sort((a, b) => b.values.value - a.values.value)
      .slice(0, 24);
    if (points.length >= 1) {
      const top = points[0]!.values.value;
      return {
        datasetId,
        title: entry.label,
        periodLabel: latest !== null ? `Anno ${latest}` : "Stanziamenti",
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Stanziamento" }],
        points,
        kpi: { label: points[0]!.label, value: top, formatted: formatEuro(top) },
        bundles: { value: points },
      };
    }
  }

  // OpenCoesione: serie annuale pagamenti / temi
  if (Array.isArray(raw.annualSeries) && raw.annualSeries.length >= 2) {
    const points = raw.annualSeries
      .map((row): BoardSeriesPoint | null => {
        if (!isRecord(row) || typeof row.year !== "number") return null;
        const cents = asNumber(row.paymentsCents) ?? asNumber(row.commitmentsCents);
        if (cents === null) return null;
        return valuePoint(String(row.year), centsToEuro(cents));
      })
      .filter(notNull);
    if (points.length >= 2) {
      const last = points.at(-1)!.values.value;
      return {
        datasetId,
        title: entry.label,
        periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Pagamenti" }],
        points,
        kpi: { label: "Ultimo anno", value: last, formatted: formatEuro(last) },
        bundles: { value: points },
      };
    }
  }
  if (Array.isArray(raw.themes) && raw.themes.length > 0) {
    const points = raw.themes
      .map((row): BoardSeriesPoint | null => {
        if (!isRecord(row)) return null;
        const label = firstString(row.label, row.slug);
        const cents = asNumber(row.publicCostCents) ?? asNumber(row.paymentsCents);
        if (!label || cents === null) return null;
        return valuePoint(label, centsToEuro(cents));
      })
      .filter(notNull)
      .sort((a, b) => b.values.value - a.values.value)
      .slice(0, 24);
    if (points.length >= 1) {
      const top = points[0]!.values.value;
      return {
        datasetId,
        title: entry.label,
        periodLabel: "Temi",
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Costo pubblico" }],
        points,
        kpi: { label: points[0]!.label, value: top, formatted: formatEuro(top) },
        bundles: { value: points },
      };
    }
  }

  // Controlli / segnali
  if (Array.isArray(raw.signals) && raw.signals.length > 0) {
    const points = raw.signals
      .map((row): BoardSeriesPoint | null => {
        if (!isRecord(row)) return null;
        const label = firstString(row.label, row.id, row.area);
        const value = asNumber(row.value);
        if (!label || value === null) return null;
        return valuePoint(label, value);
      })
      .filter(notNull)
      .slice(0, 24);
    if (points.length >= 1) {
      const first = points[0]!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: typeof raw.reviewedAt === "string" ? `Rivisti ${raw.reviewedAt.slice(0, 10)}` : "Segnali",
        unitLabel: "indice",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Segnale" }],
        points,
        kpi: {
          label: first.label,
          value: first.values.value,
          formatted: first.values.value.toLocaleString("it-IT", { maximumFractionDigits: 1 }),
        },
        bundles: { value: points },
      };
    }
  }

  // MEF tax gap: gap medio per tributo nell'anno
  if (Array.isArray(raw.taxRows) && raw.taxRows.length > 0) {
    const points: BoardSeriesPoint[] = [];
    for (const taxRow of raw.taxRows) {
      if (!isRecord(taxRow) || !Array.isArray(taxRow.series)) continue;
      const label = firstString(taxRow.sourceLabel, taxRow.id);
      if (!label) continue;
      for (const point of taxRow.series) {
        if (!isRecord(point) || typeof point.year !== "number" || !isRecord(point.gap)) continue;
        const min = asNumber(point.gap.minCents);
        const max = asNumber(point.gap.maxCents);
        const value = asNumber(point.gap.valueCents);
        const cents = value ?? (min !== null && max !== null ? (min + max) / 2 : null);
        if (cents === null) continue;
        points.push({ label: `${point.year} · ${label}`, values: { value: centsToEuro(cents) } });
      }
    }
    if (points.length >= 1) {
      const top = [...points].sort((a, b) => b.values.value - a.values.value)[0]!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: "Tax gap",
        unitLabel: "euro",
        caveat: firstCaveat(raw, "Gap stimato: dove c'è un intervallo si usa il punto medio."),
        series: [{ id: "value", label: "Gap" }],
        points: points.slice(0, 24),
        kpi: { label: top.label, value: top.values.value, formatted: formatEuro(top.values.value) },
        bundles: { value: points },
      };
    }
  }

  // ISTAT pensioni
  if (Array.isArray(raw.pensioners) && raw.pensioners.length > 0) {
    const points = pointsFromArray(raw.pensioners, "value");
    if (points.length >= 1) {
      const last = points.at(-1)!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: points[0]!.label,
        unitLabel: "persone",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Pensionati" }],
        points,
        kpi: {
          label: "Pensionati",
          value: last.values.value,
          formatted: last.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }
  if (Array.isArray(raw.pensionBenefits) && raw.pensionBenefits.length > 0) {
    const points = pointsFromArray(raw.pensionBenefits, "value");
    if (points.length >= 1) {
      const last = points.at(-1)!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: points[0]!.label,
        unitLabel: "prestazioni",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Prestazioni" }],
        points,
        kpi: {
          label: "Prestazioni",
          value: last.values.value,
          formatted: last.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }

  // MEF partecipazioni
  if (Array.isArray(raw.topCompaniesByDeclaringAdministrations)) {
    const points = pointsFromArray(raw.topCompaniesByDeclaringAdministrations, "value").slice(0, 20);
    if (points.length >= 1) {
      const top = points[0]!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: typeof raw.referenceYear === "number" ? `Anno ${raw.referenceYear}` : "Partecipazioni",
        unitLabel: "enti",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Amministrazioni dichiaranti" }],
        points,
        kpi: {
          label: top.label,
          value: top.values.value,
          formatted: top.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }
  if (isRecord(raw.totals)) {
    const participationRecords = asNumber(raw.totals.participationRecords);
    const declaringAdministrations = asNumber(raw.totals.declaringAdministrations);
    const participatedOrganizations = asNumber(raw.totals.participatedOrganizations);
    const points: BoardSeriesPoint[] = [];
    if (participationRecords !== null) {
      points.push({ label: "Partecipazioni", values: { value: participationRecords } });
    }
    if (declaringAdministrations !== null) {
      points.push({ label: "Enti dichiaranti", values: { value: declaringAdministrations } });
    }
    if (participatedOrganizations !== null) {
      points.push({ label: "Società", values: { value: participatedOrganizations } });
    }
    if (points.length >= 1) {
      return {
        datasetId,
        title: entry.label,
        periodLabel: typeof raw.referenceYear === "number" ? `Anno ${raw.referenceYear}` : "Sintesi",
        unitLabel: "conteggio",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Totale" }],
        points,
        kpi: {
          label: points[0]!.label,
          value: points[0]!.values.value,
          formatted: points[0]!.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }

  // PNRR asili totals
  if (isRecord(raw.totals) && asNumber(raw.totals.totalFundingCents) !== null) {
    const items: Array<[string, string]> = [
      ["Finanziamento totale", "totalFundingCents"],
      ["Quota PNRR", "pnrrFundingCents"],
      ["Importo gara", "tenderAmountCents"],
      ["Aggiudicato", "awardAmountCents"],
    ];
    const points: BoardSeriesPoint[] = [];
    for (const [label, key] of items) {
      const cents = asNumber(raw.totals[key]);
      if (cents === null) continue;
      points.push({ label, values: { value: centsToEuro(cents) } });
    }
    if (points.length >= 1) {
      return {
        datasetId,
        title: entry.label,
        periodLabel: typeof raw.referenceDate === "string" ? raw.referenceDate : "PNRR",
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Importo" }],
        points,
        kpi: {
          label: points[0]!.label,
          value: points[0]!.values.value,
          formatted: formatEuro(points[0]!.values.value),
        },
        bundles: { value: points },
      };
    }
  }

  // ANAC CIG snapshot: quote affidamenti
  if (isRecord(raw.servicesAndSuppliesBelow140000)) {
    const block = raw.servicesAndSuppliesBelow140000;
    const share = asNumber(block.directAwardSharePercent);
    const records = asNumber(block.records);
    const direct = asNumber(block.directAwardRecords);
    const points: BoardSeriesPoint[] = [];
    if (share !== null) points.push({ label: "Quota affidamenti diretti %", values: { value: share } });
    if (direct !== null) points.push({ label: "Affidamenti diretti", values: { value: direct } });
    if (records !== null) points.push({ label: "Procedure sotto soglia", values: { value: records } });
    if (points.length >= 1) {
      return {
        datasetId,
        title: entry.label,
        periodLabel: typeof raw.referenceYear === "number" ? `Anno ${raw.referenceYear}` : "ANAC",
        unitLabel: "indice",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Indicatore" }],
        points,
        kpi: {
          label: points[0]!.label,
          value: points[0]!.values.value,
          formatted: points[0]!.values.value.toLocaleString("it-IT", { maximumFractionDigits: 1 }),
        },
        bundles: { value: points },
      };
    }
  }

  // ISTAT permessi costruire: tavola nazionale
  if (isRecord(raw.tables)) {
    for (const table of Object.values(raw.tables)) {
      if (!isRecord(table) || !Array.isArray(table.years)) continue;
      const points: BoardSeriesPoint[] = [];
      for (const yearRow of table.years) {
        if (!isRecord(yearRow) || typeof yearRow.year !== "number") continue;
        const fabbricati = isRecord(yearRow.fabbricati) && isRecord(yearRow.fabbricati.numero)
          ? asNumber(yearRow.fabbricati.numero.value)
          : null;
        if (fabbricati === null) continue;
        points.push({ label: String(yearRow.year), values: { value: fabbricati } });
      }
      if (points.length >= 1) {
        const last = points.at(-1)!;
        return {
          datasetId,
          title: entry.label,
          periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
          unitLabel: "fabbricati",
          caveat: firstCaveat(raw, entry.blurb),
          series: [{ id: "value", label: "Fabbricati" }],
          points,
          kpi: {
            label: "Ultimo anno",
            value: last.values.value,
            formatted: last.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
          },
          bundles: { value: points },
        };
      }
    }
  }

  // MEF IRPEF dettaglio: tavole dimensionali (classe × regione)
  if (Array.isArray(raw.tables) && raw.tables.length > 0) {
    const tableWrap = raw.tables.find(
      (item) => isRecord(item) && Array.isArray(item.rows) && isRecord(item.schema),
    );
    if (tableWrap && isRecord(tableWrap) && isRecord(tableWrap.schema) && Array.isArray(tableWrap.rows)) {
      const measures = Array.isArray(tableWrap.schema.measures) ? tableWrap.schema.measures : [];
      const dimensions = Array.isArray(tableWrap.schema.dimensions)
        ? tableWrap.schema.dimensions.map((d) => String(d))
        : [];
      const countIdx = measures.findIndex(
        (m) => isRecord(m) && /numero contribuenti/i.test(String(m.name ?? "")),
      );
      const amountIdx = measures.findIndex(
        (m) => isRecord(m) && m.nature === "ammontare" && /imponibile|complessivo|imposta/i.test(String(m.name ?? "")),
      );
      const measureIdx = countIdx >= 0 ? countIdx : amountIdx;
      const regionDimIdx = dimensions.findIndex((d) => /regione/i.test(d));
      if (measureIdx >= 0 && regionDimIdx >= 0) {
        const byRegion = new Map<string, number>();
        for (const row of tableWrap.rows) {
          if (!isRecord(row) || !Array.isArray(row.keys) || !Array.isArray(row.values)) continue;
          const region = firstString(row.keys[regionDimIdx]);
          const value = asNumber(row.values[measureIdx]);
          if (!region || value === null) continue;
          byRegion.set(region, (byRegion.get(region) ?? 0) + value);
        }
        const points = [...byRegion.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([label, value]) => ({ label, values: { value } }));
        if (points.length >= 1) {
          const top = points[0]!;
          const moneyish = countIdx < 0 && amountIdx >= 0;
          return {
            datasetId,
            title: entry.label,
            periodLabel: isRecord(tableWrap.table) && typeof tableWrap.table.taxYear === "number"
              ? `Anno d'imposta ${tableWrap.table.taxYear}`
              : "IRPEF dettaglio",
            unitLabel: moneyish ? "euro" : "contribuenti",
            caveat: firstCaveat(raw, entry.blurb),
            series: [{ id: "value", label: moneyish ? "Ammontare" : "Contribuenti" }],
            points,
            kpi: {
              label: top.label,
              value: top.values.value,
              formatted: moneyish
                ? formatEuro(top.values.value)
                : top.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
            },
            bundles: { value: points },
          };
        }
      }
    }
  }

  // MEF IRPEF comunale: comuni selezionati o sintesi nazionale
  if (Array.isArray(raw.data) && raw.data.length > 0 && isRecord(raw.data[0]) && isRecord(raw.data[0].measures)) {
    const points = raw.data
      .map((row): BoardSeriesPoint | null => {
        if (!isRecord(row) || !isRecord(row.territory) || !isRecord(row.measures)) return null;
        const label = firstString(row.territory.name, row.territory.code);
        const net = isRecord(row.measures.netTaxDeclared)
          ? asNumber(row.measures.netTaxDeclared.amountCents)
          : null;
        const comprehensive = isRecord(row.measures.comprehensiveIncome)
          ? asNumber(row.measures.comprehensiveIncome.amountCents)
          : null;
        const cents = net ?? comprehensive;
        if (!label || cents === null) return null;
        return valuePoint(label, centsToEuro(cents));
      })
      .filter(notNull)
      .sort((a, b) => b.values.value - a.values.value)
      .slice(0, 24);
    if (points.length >= 1) {
      const top = points[0]!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: isRecord(raw.period) && typeof raw.period.taxYear === "number"
          ? `Anno d'imposta ${raw.period.taxYear}`
          : "IRPEF",
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Imposta netta" }],
        points,
        kpi: { label: top.label, value: top.values.value, formatted: formatEuro(top.values.value) },
        bundles: { value: points },
      };
    }
  }
  if (isRecord(raw.national) && isRecord(raw.national.assigned) && isRecord(raw.national.assigned.measures)) {
    const measures = raw.national.assigned.measures;
    const labels: Record<string, string> = {
      comprehensiveIncome: "Reddito complessivo",
      taxableIncome: "Reddito imponibile",
      netTaxDeclared: "Imposta netta",
      regionalSurtaxDue: "Addizionale regionale",
      municipalSurtaxDue: "Addizionale comunale",
    };
    const points: BoardSeriesPoint[] = [];
    for (const [key, measure] of Object.entries(measures)) {
      if (!isRecord(measure)) continue;
      const cents =
        asNumber(measure.amountCents)
        ?? asNumber(measure.knownAmountCents)
        ?? (isRecord(measure.amountCents) ? asNumber(measure.amountCents.value) : null);
      if (cents === null) continue;
      points.push({ label: labels[key] ?? key, values: { value: centsToEuro(cents) } });
    }
    if (points.length >= 1) {
      const top = points[0]!;
      return {
        datasetId,
        title: entry.label,
        periodLabel: isRecord(raw.period) && typeof raw.period.taxYear === "number"
          ? `Anno d'imposta ${raw.period.taxYear}`
          : "IRPEF",
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Importo" }],
        points,
        kpi: { label: top.label, value: top.values.value, formatted: formatEuro(top.values.value) },
        bundles: { value: points },
      };
    }
  }

  // IPA struttura organizzativa
  if (isRecord(raw.unitaOrganizzative) && Array.isArray(raw.unitaOrganizzative.records)) {
    const points = raw.unitaOrganizzative.records
      .map((row): BoardSeriesPoint | null => {
        if (!isRecord(row)) return null;
        const label = firstString(row.denominazione, row.codice);
        if (!label) return null;
        return valuePoint(label, 1);
      })
      .filter(notNull)
      .slice(0, 24);
    const total = asNumber(raw.unitaOrganizzative.total) ?? points.length;
    if (points.length >= 1 || total > 0) {
      return {
        datasetId,
        title: entry.label,
        periodLabel: firstString(raw.codiceIpa) ? `IPA ${raw.codiceIpa}` : "Struttura",
        unitLabel: "unità",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Unità organizzative" }],
        points: points.length >= 1 ? points : [{ label: "Totale", values: { value: total } }],
        kpi: {
          label: "Unità organizzative",
          value: total,
          formatted: total.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }

  // Dispositivi medici: hit di ricerca
  if (Array.isArray(raw.hits) && raw.hits.length > 0) {
    const byMaker = new Map<string, number>();
    for (const hit of raw.hits) {
      if (!isRecord(hit)) continue;
      const label = firstString(hit.manufacturer, hit.name, hit.ref) ?? "Dispositivo";
      byMaker.set(label, (byMaker.get(label) ?? 0) + 1);
    }
    const points = [...byMaker.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([label, value]) => ({ label, values: { value } }));
    if (points.length >= 1) {
      const matched = asNumber(raw.matched) ?? points.reduce((sum, p) => sum + p.values.value, 0);
      return {
        datasetId,
        title: entry.label,
        periodLabel: firstString(raw.normalizedQuery, raw.query) ? `Query «${raw.normalizedQuery ?? raw.query}»` : "Dispositivi",
        unitLabel: "dispositivi",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Hit" }],
        points,
        kpi: {
          label: "Match",
          value: matched,
          formatted: matched.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
        },
        bundles: { value: points },
      };
    }
  }

  // IPA enti: conteggio per tipologia sulla pagina
  if (Array.isArray(raw.records) && raw.records.length > 0) {
    const sample = raw.records.find(isRecord);
    if (sample && (sample.denominazione !== undefined || sample.codiceIpa !== undefined)) {
      const byType = new Map<string, number>();
      for (const row of raw.records) {
        if (!isRecord(row)) continue;
        const label = firstString(row.tipologia, row.codiceCategoria, row.denominazione) ?? "Ente";
        byType.set(label, (byType.get(label) ?? 0) + 1);
      }
      const points = [...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([label, value]) => ({ label, values: { value } }));
      if (points.length >= 1) {
        const total = typeof raw.total === "number" ? raw.total : points.reduce((sum, p) => sum + p.values.value, 0);
        return {
          datasetId,
          title: entry.label,
          periodLabel: "Selezione corrente",
          unitLabel: "enti",
          caveat: firstCaveat(raw, "Conteggio sulla pagina restituita; total è il match completo della query."),
          series: [{ id: "value", label: "Enti" }],
          points,
          kpi: {
            label: "Match",
            value: total,
            formatted: total.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
          },
          bundles: { value: points },
        };
      }
    }
  }

  // Osservazioni INPS/INL: aggrega per anno sul primo campo numerico utile
  if (Array.isArray(raw.observations) && raw.observations.length > 0) {
    const sample = raw.observations.find(isRecord);
    if (sample && (sample.inspections !== undefined || sample.count !== undefined || sample.authorizedHours !== undefined || sample.householdCount !== undefined || sample.measure !== undefined)) {
      const byYear = new Map<number, number>();
      for (const row of raw.observations) {
        if (!isRecord(row) || typeof row.year !== "number") continue;
        // Preferisci Italia / totale quando presente
        const territory = firstString(row.territory, row.territorio, row.region);
        if (territory && !/^(ITALIA|IT|Italia)$/iu.test(territory) && raw.observations.length > 40) {
          // per serie molto lunghe tieni solo IT se disponibile, altrimenti tutto
          const hasItaly = raw.observations.some(
            (item) =>
              isRecord(item)
              && typeof item.year === "number"
              && /^(ITALIA|IT|Italia)$/iu.test(firstString(item.territory, item.territorio, item.region) ?? ""),
          );
          if (hasItaly && !/^(ITALIA|IT|Italia)$/iu.test(territory)) continue;
        }
        const value =
          asNumber(row.inspections)
          ?? asNumber(row.authorizedHours)
          ?? asNumber(row.householdCount)
          ?? asNumber(row.count)
          ?? (asNumber(row.amountMilli) !== null ? asNumber(row.amountMilli)! / 1000 : null);
        if (value === null) continue;
        byYear.set(row.year, (byYear.get(row.year) ?? 0) + value);
      }
      const points = [...byYear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, value]) => ({ label: String(year), values: { value } }));
      if (points.length >= 1) {
        const last = points.at(-1)!;
        const moneyish = sample.amountMilli !== undefined;
        return {
          datasetId,
          title: entry.label,
          periodLabel: points.length >= 2
            ? `${points[0]!.label}–${points.at(-1)!.label}`
            : points[0]!.label,
          unitLabel: moneyish ? "euro" : "conteggio",
          caveat: firstCaveat(raw, entry.blurb),
          series: [{ id: "value", label: moneyish ? "Importo" : "Valore" }],
          points,
          kpi: {
            label: "Ultimo anno",
            value: last.values.value,
            formatted: moneyish
              ? formatEuro(last.values.value)
              : last.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
          },
          bundles: { value: points },
        };
      }
    }
  }

  // Posti letto / corpus rows con celle Anno + regione
  if (Array.isArray(raw.rows) && raw.rows.length > 0) {
    const sample = raw.rows.find((row) => isRecord(row) && isRecord(row.cells));
    if (sample && isRecord(sample) && isRecord(sample.cells)) {
      const cells = sample.cells;
      const regionKey = Object.keys(cells).find((key) => /regione/iu.test(key) && /descrizione|nome/iu.test(key))
        ?? Object.keys(cells).find((key) => /regione/iu.test(key));
      const bedsKey = Object.keys(cells).find((key) => /posti letto/iu.test(key) && /ordinari|total/iu.test(key))
        ?? Object.keys(cells).find((key) => /posti letto/iu.test(key));
      if (regionKey && bedsKey) {
        const byRegion = new Map<string, number>();
        for (const row of raw.rows) {
          if (!isRecord(row) || !isRecord(row.cells)) continue;
          const region = firstString(row.cells[regionKey]);
          const bedsRaw = firstString(row.cells[bedsKey]) ?? String(row.cells[bedsKey] ?? "");
          const beds = Number(bedsRaw.replace(/\./gu, "").replace(",", ".").trim());
          if (!region || !Number.isFinite(beds)) continue;
          byRegion.set(region, (byRegion.get(region) ?? 0) + beds);
        }
        const points = [...byRegion.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([label, value]) => ({ label, values: { value } }));
        if (points.length >= 1) {
          const top = points[0]!;
          return {
            datasetId,
            title: entry.label,
            periodLabel: "Selezione corrente",
            unitLabel: "posti letto",
            caveat: firstCaveat(raw, "Aggregato sulla pagina restituita, non sul corpus intero."),
            series: [{ id: "value", label: "Posti letto" }],
            points,
            kpi: {
              label: top.label,
              value: top.values.value,
              formatted: top.values.value.toLocaleString("it-IT", { maximumFractionDigits: 0 }),
            },
            bundles: { value: points },
          };
        }
      }
    }
  }

  const candidates = [
    raw.history,
    raw.years,
    raw.points,
    raw.series,
    raw.monthly,
    raw.regions,
    raw.rows,
    raw.data,
    raw.missions,
    raw.items,
    raw.stockSeries,
    raw.municipalities,
    raw.totals,
    raw.byRegion,
    raw.records,
    raw.topCompaniesByDeclaringAdministrations,
  ].filter(Array.isArray) as unknown[][];

  for (const rows of candidates) {
    const points = pointsFromArray(rows, "value");
    if (points.length >= 2) {
      const last = points.at(-1)!.values.value;
      return {
        datasetId,
        title: entry.label,
        periodLabel: `${points[0]!.label}–${points.at(-1)!.label}`,
        unitLabel: "euro",
        caveat: firstCaveat(raw, entry.blurb),
        series: [{ id: "value", label: "Valore" }],
        points,
        kpi: { label: "Ultimo punto", value: last, formatted: formatEuro(last) },
        bundles: { value: points },
      };
    }
  }

  // KPI singolo da campi tipici
  const kpiRaw =
    asNumber(raw.totalCents)
    ?? (isRecord(raw.stock) ? asNumber(raw.stock.totalCents) ?? asNumber(raw.stock.pensionCount) : null)
    ?? asNumber(raw.totalPaid)
    ?? asNumber(raw.totalCollected);
  if (kpiRaw !== null) {
    const display = Math.abs(kpiRaw) > 1e11 ? centsToEuro(kpiRaw) : kpiRaw;
    return {
      datasetId,
      title: entry.label,
      periodLabel: typeof raw.year === "number" ? `Anno ${raw.year}` : "Sintesi",
      unitLabel: "euro",
      caveat: "Sintesi automatica dalla risposta MCP; verifica la scheda fonte.",
      series: [{ id: "value", label: "Valore" }],
      points: [{ label: "Totale", values: { value: display } }],
      kpi: { label: "Totale", value: display, formatted: formatEuro(display) },
      bundles: {},
    };
  }

  return {
    ...emptyPayload(
      datasetId,
      "Serie non ancora mappata in automatico: i dati restano interrogabili via MCP/API.",
    ),
    bundles: {},
  };
}

/**
 * Proietta la risposta MCP in serie plotabili. Fail-soft: payload vuoto + caveat.
 */
export function projectBoardTileSeries(
  datasetId: string,
  raw: unknown,
  filters: BoardTileFilters = {},
): BoardTileSeriesPayload {
  const series_key = typeof filters.series_key === "string" ? filters.series_key : null;
  let projected: ProjectedBoardTile;

  switch (datasetId) {
    case "debito_pubblico_italiano":
      projected = projectDebtBundled(raw);
      break;
    case "siope_comuni":
    case "siope_entrate_comuni":
      projected = projectSiope(
        datasetId,
        raw,
        series_key === "region" ? "regions" : "monthly",
      );
      break;
    case "openbdap_ssn_storico_nazionale":
      projected = projectSsn(raw);
      break;
    case "openbdap_spesa_stato":
      projected = projectOpenbdapState(raw);
      break;
    case "eurostat_cofog":
    case "istat_cofog":
      projected = projectCofog(datasetId, raw);
      break;
    case "consulenti_incarichi":
      projected = projectConsulenti(raw);
      break;
    case "inps_invalidita_civile":
      projected = projectInpsInvalidity(raw);
      break;
    case "inps_pensioni_vigenti":
      projected = projectInpsPensions(raw);
      break;
    case "cpt_finanza_regionale":
      projected = projectCpt(raw);
      break;
    case "parlamento_bilanci":
      projected = projectParlamento(raw);
      break;
    default:
      projected = datasetId.startsWith("opencivitas_")
        ? projectOpenCivitas(datasetId, raw)
        : projectGeneric(datasetId, raw);
  }

  if (projected.bundles && series_key && projected.bundles[series_key]) {
    const points = projected.bundles[series_key]!;
    const activeSeries = projected.series.filter((item) =>
      points.some((point) => item.id in point.values),
    );
    return attachProvenance({
      ...stripSeriesBundles(projected),
      points,
      series: activeSeries.length > 0 ? activeSeries : projected.series,
    });
  }

  // For debt default stock; for SSN keep all series on same points
  if (projected.bundles?.stock && !series_key) {
    return attachProvenance({
      ...stripSeriesBundles(projected),
      points: projected.bundles.stock,
      series: projected.series.filter((item) => item.id === "stock" || item.id === "interest"),
    });
  }

  // COFOG: with year filter prefer function breakdown when available
  if (
    !series_key
    && projected.bundles?.function
    && projected.bundles.function.length >= 2
    && (filters.year !== undefined && filters.year !== null && filters.year !== "")
  ) {
    return attachProvenance({
      ...stripSeriesBundles(projected),
      points: projected.bundles.function,
      series: projected.series.filter((item) => item.id === "function"),
    });
  }

  return attachProvenance(stripSeriesBundles(projected));
}

export function resolveActiveSeriesIds(
  payload: BoardTileSeriesPayload,
  filters: BoardTileFilters,
): string[] {
  const series_key = typeof filters.series_key === "string" ? filters.series_key : null;
  if (series_key && payload.series.some((item) => item.id === series_key)) {
    const hasInPoints = payload.points.some((point) => series_key in point.values);
    if (hasInPoints) return [series_key];
  }
  if (payload.series.length === 0) return [];
  const present = payload.series
    .map((item) => item.id)
    .filter((id) => payload.points.some((point) => id in point.values));
  return present.length > 0 ? present : [payload.series[0]!.id];
}
