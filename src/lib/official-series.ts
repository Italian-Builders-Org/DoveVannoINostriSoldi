import "server-only";

import { eurostatCofogMetadata, queryEurostatCofog } from "@/lib/eurostat-cofog-snapshot";
import { getGovernmentScorecardV6SupplementalSnapshot } from "@/lib/data/government-scorecard-page-contract";

export type OfficialPoint = Readonly<{ period: string; value: number; status: string; breakBefore: boolean }>;
export type OfficialSeries = Readonly<{
  id: string;
  label: string;
  family: string;
  unit: "MIO_EUR" | "PC_GDP" | "RCH_A";
  unitLabel: string;
  frequency: "annual" | "monthly";
  scope: string;
  points: readonly OfficialPoint[];
  source: Readonly<{ owner: string; dataset: string; url: string; queryUrl: string; acquiredAt: string; updatedAt: string; checkedAt: string | null; sha256: string; termsUrl: string }>;
}>;

export const DEFAULT_OFFICIAL_SERIES = ["cofog-GF02-MIO_EUR", "cofog-GF03-MIO_EUR"] as const;

/** Only projections of the two existing, validated snapshot boundaries. */
export function getOfficialSeriesCatalog(): readonly OfficialSeries[] {
  const cofog = queryEurostatCofog({ geo: "IT" });
  const catalog: OfficialSeries[] = [];
  for (const unit of ["MIO_EUR", "PC_GDP"] as const) {
    const asset = eurostatCofogMetadata.source.assets[unit === "MIO_EUR" ? "mio-eur" : "pc-gdp"];
    for (const entry of cofog.functions) {
      catalog.push({
        id: `cofog-${entry.code}-${unit}`,
        label: `${entry.label} · Italia`,
        family: `cofog-${unit}`,
        unit,
        unitLabel: unit === "MIO_EUR" ? "milioni di euro correnti" : "% del PIL",
        frequency: "annual",
        scope: "Spesa delle PA (S13), competenza economica SEC 2010",
        points: cofog.observations.filter((point) => point.function === entry.code).map((point) => ({
          period: String(point.year),
          value: unit === "MIO_EUR" ? point.amountCents / 100_000_000 : point.shareOfGdpHundredths / 100,
          status: point.flag ? cofog.flags[point.flag] : "Nessun flag della fonte",
          breakBefore: point.flag === "b",
        })),
        source: {
          owner: eurostatCofogMetadata.source.owner,
          dataset: eurostatCofogMetadata.source.datasetCode,
          url: eurostatCofogMetadata.source.landingUrl,
          queryUrl: asset.url,
          acquiredAt: eurostatCofogMetadata.semantics.provenance.acquisitionDate,
          updatedAt: asset.sourceUpdated,
          checkedAt: eurostatCofogMetadata.semantics.provenance.checkedAt,
          sha256: asset.sha256,
          termsUrl: eurostatCofogMetadata.source.termsUrl,
        },
      });
    }
  }
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const inflation = snapshot.series.find((series) => series.indicator_id === "inflation");
  const source = snapshot.sources.find((entry) => entry.id === "eurostat:prc_hicp_minr");
  if (!inflation || !source) throw new Error("Catalogo serie: IPCA o provenienza assente.");
  const names: Record<string, string> = { IT: "Italia", FR: "Francia", DE: "Germania", ES: "Spagna" };
  for (const geography of inflation.geographies) {
    catalog.push({
      id: `hicp-${geography.geography}`,
      label: `IPCA totale · ${names[geography.geography]}`,
      family: "hicp-total-annual-change",
      unit: "RCH_A",
      unitLabel: "% rispetto allo stesso mese dell’anno precedente",
      frequency: "monthly",
      scope: "Prezzi al consumo armonizzati, paniere totale (COICOP TOTAL)",
      points: geography.points.map((point) => ({
        period: point.period,
        value: point.value,
        status: `${point.status === "estimated" ? "Stimato dalla fonte" : point.status === "provisional" ? "Provvisorio" : "Osservato"}${point.upstream_status_or_null ? ` (flag ${point.upstream_status_or_null})` : ""}`,
        breakBefore: point.upstream_status_or_null?.includes("b") ?? false,
      })),
      source: {
        owner: source.owner,
        dataset: source.dataset_code,
        url: source.landing_url,
        queryUrl: source.query_url,
        acquiredAt: source.retrieved_at,
        updatedAt: source.upstream_updated_at,
        checkedAt: null,
        sha256: source.raw_sha256,
        termsUrl: source.terms_url,
      },
    });
  }
  return catalog;
}

export type OfficialComparison =
  | { ok: false; message: string; selected: readonly OfficialSeries[] }
  | { ok: true; selected: readonly OfficialSeries[]; rows: readonly { period: string; points: readonly (OfficialPoint | null)[] }[] };

/** Refuse incompatible semantics as well as units/frequency. Calendar slots are
 * labels only: absent observations stay null; values are never interpolated. */
export function compareOfficialSeries(catalog: readonly OfficialSeries[], requested: readonly string[]): OfficialComparison {
  const selected = [...new Set(requested)].flatMap((id) => catalog.find((series) => series.id === id) ?? []);
  const reject = (message: string): OfficialComparison => ({ ok: false, message, selected });
  if (requested.length < 2 || requested.length > 4) return reject("Scegli da due a quattro serie.");
  if (new Set(requested).size !== requested.length) return reject("Scegli serie diverse: la selezione contiene duplicati.");
  if (selected.length !== requested.length) return reject("Una serie richiesta non appartiene al catalogo verificato.");
  const first = selected[0];
  if (selected.some((series) => series.unit !== first.unit || series.frequency !== first.frequency || series.family !== first.family || series.scope !== first.scope)) {
    return reject("Confronto non disponibile: unità, frequenza o significato delle serie non sono compatibili. Scegli serie della stessa famiglia.");
  }
  const ordinal = (period: string) => first.frequency === "annual" ? Number(period) : Number(period.slice(0, 4)) * 12 + Number(period.slice(5)) - 1;
  for (const series of selected) {
    if (!series.points.length || series.points.some((point, index) =>
      !Number.isFinite(point.value) ||
      !(first.frequency === "annual" ? /^\d{4}$/ : /^\d{4}-(0[1-9]|1[0-2])$/).test(point.period) ||
      (index > 0 && ordinal(point.period) <= ordinal(series.points[index - 1].period)))) {
      return reject("Serie non valida: periodi duplicati, ordine inatteso o osservazioni mancanti/non valide.");
    }
  }
  const start = Math.min(...selected.map((series) => ordinal(series.points[0].period)));
  const end = Math.max(...selected.map((series) => ordinal(series.points.at(-1)!.period)));
  if (end - start > 1200) return reject("Intervallo non supportato dal confronto.");
  const maps = selected.map((series) => new Map(series.points.map((point) => [point.period, point])));
  const rows = Array.from({ length: end - start + 1 }, (_, index) => {
    const n = start + index;
    const period = first.frequency === "annual" ? String(n) : `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
    return { period, points: maps.map((points) => points.get(period) ?? null) };
  });
  if (!rows.some((row) => row.points.every((point) => point !== null))) return reject("Le serie non hanno un periodo osservato comune.");
  return { ok: true, selected, rows };
}

export function parseOfficialSeriesSelection(value: string | string[] | undefined): string[] {
  return value === undefined ? [...DEFAULT_OFFICIAL_SERIES] : (typeof value === "string" ? [value] : value).filter((id) => id !== "");
}

/** Segments stop before a source break and on every absent calendar point. */
export function officialSeriesSegments(points: readonly (OfficialPoint | null)[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point || point.breakBefore) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (point) current.push(index);
  }
  if (current.length) segments.push(current);
  return segments;
}
