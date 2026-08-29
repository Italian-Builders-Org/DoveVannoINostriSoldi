import "server-only";

import rawSnapshot from "@/data/generated/istat-enterprise-turnover-2024.json";
import {
  validateIstatTurnoverSnapshot,
  type IstatMacroSector,
  type IstatMetricFormat,
  type IstatMetricId,
  type IstatTurnoverObservation,
  type IstatTurnoverSnapshot,
} from "@/lib/istat-turnover-contract";

export const istatTurnoverSnapshot: IstatTurnoverSnapshot = validateIstatTurnoverSnapshot(rawSnapshot);

export const ISTAT_TURNOVER_ALL = "ALL" as const;

export type IstatMetricDefinition = Readonly<{
  id: IstatMetricId;
  label: string;
  metricLabel: string;
  shortLabel: string;
  unit: string;
  format: IstatMetricFormat;
  description: string;
  caveat: string;
}>;

export const ISTAT_METRICS: readonly IstatMetricDefinition[] = [
  {
    id: "turnover",
    label: "Fatturato aggregato (ISTAT)",
    metricLabel: "Fatturato aggregato",
    shortLabel: "Fatturato",
    unit: "migliaia di euro",
    format: "thousand-euro",
    description: (
      "Fatturato aggregato delle imprese per territorio e macro-settore economico (Stima anticipata ISTAT 2024, "
      + "Registro Frame Territoriale Anticipato, ATECO 2007 agg. 2022, unità locali con almeno un dipendente)."
    ),
    caveat: "Il fatturato è espresso in migliaia di euro e classificato in ATECO 2007 aggiornamento 2022. I dati sono aggregati per territorio e non identificano singole aziende o persone fisiche.",
  },
  {
    id: "istat_local_units",
    label: "Unità locali (ISTAT)",
    metricLabel: "Unità locali (ISTAT)",
    shortLabel: "Unità locali",
    unit: "unità locali",
    format: "integer",
    description: (
      "Numero di unità locali di imprese con almeno un dipendente per territorio e macro-settore economico "
      + "(Stima anticipata ISTAT 2024, Registro Frame Territoriale Anticipato)."
    ),
    caveat: "I dati si riferiscono alle sole unità locali di imprese con almeno un dipendente del Registro Frame Territoriale Anticipato 2024; non rappresentano l'universo completo delle sedi attive.",
  },
  {
    id: "istat_employees",
    label: "Addetti (ISTAT)",
    metricLabel: "Addetti (ISTAT)",
    shortLabel: "Addetti",
    unit: "addetti",
    format: "decimal",
    description: (
      "Addetti complessivi (dipendenti e indipendenti) operanti nelle unità locali con almeno un dipendente "
      + "per territorio e macro-settore economico (Stima anticipata ISTAT 2024, Registro Frame Territoriale Anticipato)."
    ),
    caveat: "Numero medio annuo di addetti registrati nelle unità locali con almeno un dipendente. Dati aggregati a livello regionale e di macro-settore.",
  },
  {
    id: "istat_value_added",
    label: "Valore aggiunto aggregato (ISTAT)",
    metricLabel: "Valore aggiunto aggregato",
    shortLabel: "Valore aggiunto",
    unit: "migliaia di euro",
    format: "thousand-euro",
    description: (
      "Valore aggiunto aggregato a prezzi base per territorio e macro-settore economico (Stima anticipata ISTAT 2024, "
      + "Registro Frame Territoriale Anticipato, ATECO 2007 agg. 2022, unità locali con almeno un dipendente)."
    ),
    caveat: "Il valore aggiunto misura la ricchezza netta creata dall'attività produttiva aggregata sul territorio regionale al netto dei consumi intermedi.",
  },
  {
    id: "istat_value_added_per_employee",
    label: "Valore aggiunto per addetto (ISTAT)",
    metricLabel: "Valore aggiunto per addetto",
    shortLabel: "Valore aggiunto per addetto",
    unit: "euro per addetto",
    format: "euro-per-employee",
    description: (
      "Produttività apparente del lavoro: rapporto tra il valore aggiunto aggregato e il totale degli addetti "
      + "nelle unità locali con almeno un dipendente (Stima anticipata ISTAT 2024)."
    ),
    caveat: "Indicatore derivato: valore aggiunto diviso per il numero di addetti. È una media statistica aggregata territoriale/macro-settoriale e non riflette la redditività di una specifica singola impresa.",
  },
  {
    id: "istat_turnover_per_employee",
    label: "Fatturato per addetto (ISTAT)",
    metricLabel: "Fatturato per addetto",
    shortLabel: "Fatturato per addetto",
    unit: "euro per addetto",
    format: "euro-per-employee",
    description: (
      "Fatturato medio per addetto: rapporto tra fatturato aggregato e addetti nelle unità locali con almeno un "
      + "dipendente per territorio e macro-settore (Stima anticipata ISTAT 2024)."
    ),
    caveat: "Indicatore derivato: fatturato diviso per il numero di addetti. È una media statistica territoriale/macro-settoriale e non riflette il fatturato di una specifica singola azienda.",
  },
] as const;

const metricById = new Map<IstatMetricId, IstatMetricDefinition>(
  ISTAT_METRICS.map((m) => [m.id, m]),
);

const ISTAT_METRIC_ALIASES = new Map<string, IstatMetricId>([
  ["turnover", "turnover"],
  ["turnover_istat", "turnover"],
  ["company_turnover_istat", "turnover"],
  ["fatturato", "turnover"],
  ["istat_local_units", "istat_local_units"],
  ["local_units_istat", "istat_local_units"],
  ["local_units", "istat_local_units"],
  ["istat_employees", "istat_employees"],
  ["employees_istat", "istat_employees"],
  ["istat_value_added", "istat_value_added"],
  ["value_added_istat", "istat_value_added"],
  ["value_added", "istat_value_added"],
  ["istat_value_added_per_employee", "istat_value_added_per_employee"],
  ["value_added_per_employee", "istat_value_added_per_employee"],
  ["produttivita", "istat_value_added_per_employee"],
  ["istat_turnover_per_employee", "istat_turnover_per_employee"],
  ["turnover_per_employee", "istat_turnover_per_employee"],
]);

export function isIstatMetric(metric: string | undefined): boolean {
  if (!metric) return false;
  return ISTAT_METRIC_ALIASES.has(metric.trim().toLowerCase());
}

export function normalizeIstatMetric(value: string | undefined): IstatMetricId {
  if (!value) return "turnover";
  return ISTAT_METRIC_ALIASES.get(value.trim().toLowerCase()) ?? "turnover";
}

export function istatMetricOptions() {
  return ISTAT_METRICS.map(({ id, label, description }) => ({ id, label, description }));
}

export type IstatTurnoverDatasetQuery = Readonly<{
  dataset?: string;
  period?: string;
  region?: string;
  sector?: string;
  limit?: number;
  offset?: number;
}>;

const regionByCode = new Map(istatTurnoverSnapshot.regions.map((region) => [region.code, region]));
const macroSectorByCode = new Map(istatTurnoverSnapshot.macroSectors.map((sector) => [sector.code, sector]));

// Build fast index: regionCode -> macroSector -> Observation
const observationMap = new Map<string, IstatTurnoverObservation>();
for (const observation of istatTurnoverSnapshot.observations) {
  observationMap.set(`${observation.geographyCode}|${observation.macroSector}`, observation);
}

function normalizeRegionCode(value: string | undefined): string {
  if (!value || value.trim().toLowerCase() === "all") return "ALL";
  const trimmed = value.trim();
  if (regionByCode.has(trimmed)) return trimmed;
  const match = istatTurnoverSnapshot.regions.find(
    (region) => region.name.localeCompare(trimmed, "it", { sensitivity: "base" }) === 0,
  );
  return match?.code ?? "ALL";
}

function normalizeSectorCode(value: string | undefined): IstatMacroSector {
  if (!value || value.trim().toLowerCase() === "all") return "ALL";
  const upper = value.trim().toUpperCase();
  if (upper === "INDUSTRIA" || upper === "SERVIZI" || upper === "ALL") return upper;
  if (upper === "INDUSTRY") return "INDUSTRIA";
  if (upper === "SERVICES") return "SERVIZI";
  return "ALL";
}

export function istatTurnoverRegionOptions() {
  return istatTurnoverSnapshot.regions;
}

export function istatTurnoverSectorOptions() {
  return istatTurnoverSnapshot.macroSectors;
}

export function istatTurnoverSource() {
  return istatTurnoverSnapshot.source;
}

export function queryIstatTurnoverDataset(query: IstatTurnoverDatasetQuery = {}) {
  const period = query.period?.trim();
  if (period && period !== "2024") {
    throw new Error(`Periodo non disponibile per il dataset ISTAT fatturato. Periodo valido: 2024.`);
  }

  const regionFilter = query.region?.trim();
  const normalizedRegion = normalizeRegionCode(regionFilter);
  if (regionFilter && regionFilter.toLowerCase() !== "all" && normalizedRegion === "ALL") {
    throw new Error(`Regione non trovata nel dataset ISTAT fatturato: ${regionFilter}.`);
  }

  const sectorFilter = query.sector?.trim();
  const normalizedSector = normalizeSectorCode(sectorFilter);
  if (sectorFilter && sectorFilter.toLowerCase() !== "all" && normalizedSector === "ALL" && sectorFilter.toUpperCase() !== "ALL") {
    const valid = istatTurnoverSnapshot.macroSectors.map((s) => s.code).join(", ");
    throw new Error(`Settore non valido nel dataset ISTAT fatturato: ${sectorFilter}. Codici ammessi: ${valid}.`);
  }

  let observations = istatTurnoverSnapshot.observations;

  if (normalizedRegion !== "ALL") {
    observations = observations.filter((obs) => obs.geographyCode === normalizedRegion);
  }

  if (normalizedSector !== "ALL") {
    observations = observations.filter((obs) => obs.macroSector === normalizedSector);
  } else if (sectorFilter === undefined || sectorFilter.toLowerCase() === "all" || sectorFilter.toUpperCase() === "ALL") {
    // If no specific sector filter is given, return all macro-sectors or total according to request
  }

  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)));
  const offset = Math.min(100_000, Math.max(0, Math.trunc(query.offset ?? 0)));
  const items = observations.slice(offset, offset + limit);

  return {
    schemaVersion: 1,
    dataset: "company_turnover_istat",
    observationType: "aggregate",
    geographyLevel: "region",
    atecoVersion: istatTurnoverSnapshot.atecoVersion,
    period: "2024",
    unit: "migliaia di euro",
    query: {
      period: "2024",
      region: normalizedRegion,
      sector: normalizedSector,
    },
    pagination: {
      total: observations.length,
      offset,
      limit,
      returned: items.length,
      hasMore: offset + items.length < observations.length,
      nextOffset: offset + items.length < observations.length ? offset + items.length : null,
    },
    data: items,
    national: istatTurnoverSnapshot.national,
    provenance: [istatTurnoverSnapshot.source],
    caveat: (
      "I dati sono aggregati a livello regionale per macro-settore (ATECO 2007 agg. 2022) dal Registro Frame "
      + "Territoriale Anticipato ISTAT 2024. Coprono le unità locali con almeno un dipendente (non l'universo delle "
      + "sedi attive). Non contengono nomi, identificativi, codici fiscali, partite IVA o fatturati di singole aziende."
    ),
  };
}

function extractObservationValue(obs: IstatTurnoverObservation | undefined, metricId: IstatMetricId): number | null {
  if (!obs) return null;
  switch (metricId) {
    case "turnover":
      return obs.value;
    case "istat_local_units":
      return obs.localUnits ?? null;
    case "istat_employees":
      return obs.employees ?? null;
    case "istat_value_added":
      return obs.valueAddedThousandEuro ?? null;
    case "istat_value_added_per_employee": {
      const va = obs.valueAddedThousandEuro;
      const emp = obs.employees;
      if (va === undefined || emp === undefined || emp <= 0) return null;
      return (va * 1000) / emp;
    }
    case "istat_turnover_per_employee": {
      const to = obs.value;
      const emp = obs.employees;
      if (to === undefined || emp === undefined || emp <= 0) return null;
      return (to * 1000) / emp;
    }
  }
}

function extractNationalValue(metricId: IstatMetricId, sector: IstatMacroSector): number {
  const nat = istatTurnoverSnapshot.national;
  if (sector === "INDUSTRIA") {
    switch (metricId) {
      case "turnover":
        return nat.industryTurnoverThousandEuro;
      case "istat_local_units":
        return nat.industryLocalUnits;
      case "istat_employees":
        return nat.industryEmployees;
      case "istat_value_added":
        return nat.industryValueAddedThousandEuro;
      case "istat_value_added_per_employee":
        return (nat.industryValueAddedThousandEuro * 1000) / nat.industryEmployees;
      case "istat_turnover_per_employee":
        return (nat.industryTurnoverThousandEuro * 1000) / nat.industryEmployees;
    }
  }
  if (sector === "SERVIZI") {
    switch (metricId) {
      case "turnover":
        return nat.servicesTurnoverThousandEuro;
      case "istat_local_units":
        return nat.servicesLocalUnits;
      case "istat_employees":
        return nat.servicesEmployees;
      case "istat_value_added":
        return nat.servicesValueAddedThousandEuro;
      case "istat_value_added_per_employee":
        return (nat.servicesValueAddedThousandEuro * 1000) / nat.servicesEmployees;
      case "istat_turnover_per_employee":
        return (nat.servicesTurnoverThousandEuro * 1000) / nat.servicesEmployees;
    }
  }
  // ALL
  switch (metricId) {
    case "turnover":
      return nat.turnoverThousandEuro;
    case "istat_local_units":
      return nat.localUnits;
    case "istat_employees":
      return nat.employees;
    case "istat_value_added":
      return nat.valueAddedThousandEuro;
    case "istat_value_added_per_employee":
      return (nat.valueAddedThousandEuro * 1000) / nat.employees;
    case "istat_turnover_per_employee":
      return (nat.turnoverThousandEuro * 1000) / nat.employees;
  }
}

export type IstatTurnoverView = Readonly<{
  metric: IstatMetricId;
  metricLabel: string;
  metricShortLabel: string;
  metricUnit: string;
  metricFormat: IstatMetricFormat;
  metricDescription: string;
  period: "2024";
  periodLabel: string;
  region: string;
  sector: IstatMacroSector;
  selectedRegion: { code: string; name: string; value: number | null } | null;
  selectedSectorLabel: string;
  nationalValue: number;
  regionPoints: Array<{ code: string; name: string; value: number | null }>;
  ranking: Array<{ code: string; name: string; value: number | null }>;
  sectorBreakdown: Array<{ code: string; label: string; value: number | null }>;
  sources: [IstatTurnoverSnapshot["source"]];
  caveats: string[];
  matchedObservationCount: number;
}>;

export function getIstatTurnoverView(
  filters: { metric?: string; region?: string; sector?: string } = {},
): IstatTurnoverView {
  const metricId = normalizeIstatMetric(filters.metric);
  const definition = metricById.get(metricId)!;
  const normalizedRegion = normalizeRegionCode(filters.region);
  const normalizedSector = normalizeSectorCode(filters.sector);

  const regionPoints = istatTurnoverSnapshot.regions.map((region) => {
    const obs = observationMap.get(`${region.code}|${normalizedSector}`);
    return {
      code: region.code,
      name: region.name,
      value: extractObservationValue(obs, metricId),
    };
  });

  const ranking = [...regionPoints].sort((left, right) => (right.value ?? -1) - (left.value ?? -1));

  // Sector breakdown for the selected region or national
  const sectorBreakdown = (["INDUSTRIA", "SERVIZI"] as const).map((sectorCode) => {
    const label = macroSectorByCode.get(sectorCode)?.label ?? sectorCode;
    if (normalizedRegion === "ALL") {
      const nationalVal = extractNationalValue(metricId, sectorCode);
      return { code: sectorCode, label, value: nationalVal };
    }
    const obs = observationMap.get(`${normalizedRegion}|${sectorCode}`);
    return { code: sectorCode, label, value: extractObservationValue(obs, metricId) };
  });

  const selectedRegion = normalizedRegion === "ALL"
    ? null
    : regionPoints.find((region) => region.code === normalizedRegion) ?? null;

  let nationalValue: number;
  if (normalizedRegion === "ALL") {
    nationalValue = extractNationalValue(metricId, normalizedSector);
  } else {
    nationalValue = selectedRegion?.value ?? 0;
  }

  const selectedSectorLabel = macroSectorByCode.get(normalizedSector)?.label ?? "Tutti i settori (Industria e Servizi)";

  return {
    metric: metricId,
    metricLabel: definition.metricLabel,
    metricShortLabel: definition.shortLabel,
    metricUnit: definition.unit,
    metricFormat: definition.format,
    metricDescription: definition.description,
    period: "2024",
    periodLabel: "Anno 2024",
    region: normalizedRegion,
    sector: normalizedSector,
    selectedRegion,
    selectedSectorLabel,
    nationalValue,
    regionPoints,
    ranking,
    sectorBreakdown,
    sources: [istatTurnoverSnapshot.source],
    caveats: [
      istatTurnoverSnapshot.source.caveat,
      definition.caveat,
      "I dati sono aggregati per regione e macro-settore: non identificano aziende, persone fisiche o ricavi esatti di singole società.",
    ],
    matchedObservationCount: normalizedRegion === "ALL" ? 20 : 1,
  };
}
