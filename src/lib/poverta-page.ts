import "server-only";

import {
  istatPovertaData,
  istatPovertaMetadata,
  queryIstatPovertaAssoluta,
} from "@/lib/istat-poverta-snapshot";
import {
  istatPovertaRelativaData,
  istatPovertaRelativaMetadata,
} from "@/lib/istat-poverta-relativa-snapshot";
import {
  istatPovertaSogliaAssolutaData,
  istatPovertaSogliaAssolutaMetadata,
} from "@/lib/istat-poverta-soglia-assoluta-snapshot";
import {
  istatPovertaSogliaRelativaData,
  istatPovertaSogliaRelativaMetadata,
} from "@/lib/istat-poverta-soglia-relativa-snapshot";
import type { IstatPovertaData, IstatPovertaMetadata } from "@/lib/data/istat-poverta-contract";

/**
 * Vista di pagina per la povertà: aggrega, non reinventa.
 *
 * Due scelte editoriali sono codificate qui invece di essere lasciate al markup:
 *
 * - **le due famiglie restano separate**. Assoluta e relativa sono entrambe
 *   percentuali di famiglie, quindi starebbero sullo stesso asse, ma misurano cose
 *   diverse e gli insiemi non sono annidati. La vista non produce mai un totale, una
 *   differenza fra le due, né una struttura che inviti a sovrapporle;
 * - **le ripartizioni escludono i compositi**. Nord e Mezzogiorno esistono nella
 *   fonte come aggregazioni di ripartizioni che sono già in tabella: elencarli
 *   accanto alle loro parti sarebbe un doppio conteggio visivo. Vengono dichiarati,
 *   non mostrati in riga;
 * - **la soglia monetaria resta un contesto separato**. È un importo mensile in
 *   euro, non un’incidenza: non si somma né si confronta con le percentuali sopra.
 */

const TENTHS = 10;

/** Fixed profile with complete regional coverage in the latest absolute-threshold year. */
const THRESHOLD_HOUSEHOLD_TYPOLOGY = "40";
const THRESHOLD_MUNICIPALITY_SIZE = "INH_OTH_UN5000";

export type PovertaSeriesPoint = Readonly<{ year: number; households: number | null; individuals: number | null }>;
export type PovertaAreaRow = Readonly<{ code: string; label: string; households: number | null }>;

export type PovertaFamilyView = Readonly<{
  key: "assoluta" | "relativa";
  title: string;
  /** Definizione della fonte, non una parafrasi nostra. */
  definition: string;
  datasetId: string;
  period: IstatPovertaData["period"];
  latestYear: number;
  series: readonly PovertaSeriesPoint[];
  areas: readonly PovertaAreaRow[];
  householdMeasureLabel: string;
  individualMeasureLabel: string;
  caveats: readonly string[];
  source: Readonly<{ landingUrl: string; dataflowId: string; licenseId: string; observedAt: string }>;
}>;

export type PovertaThresholdRegionRow = Readonly<{
  code: string;
  label: string;
  /** Monthly threshold in euro cents; null stays distinct from zero. */
  valueHundredths: number | null;
}>;

export type PovertaAbsoluteThresholdView = Readonly<{
  datasetId: string;
  year: number;
  householdTypology: Readonly<{ code: string; label: string }>;
  municipalitySize: Readonly<{ code: string; label: string }>;
  regions: readonly PovertaThresholdRegionRow[];
  caveats: readonly string[];
  source: Readonly<{ landingUrl: string; dataflowId: string; licenseId: string; observedAt: string }>;
}>;

export type PovertaRelativeThresholdRow = Readonly<{
  code: string;
  label: string;
  valueHundredths: number;
}>;

export type PovertaRelativeThresholdView = Readonly<{
  datasetId: string;
  year: number;
  excludedYear: number;
  excludedYearReason: string;
  rows: readonly PovertaRelativeThresholdRow[];
  caveats: readonly string[];
  source: Readonly<{ landingUrl: string; dataflowId: string; licenseId: string; observedAt: string }>;
}>;

export type PovertaPageView = Readonly<{
  families: readonly PovertaFamilyView[];
  /** Ripartizioni escluse dalle tabelle perché contengono già le altre righe. */
  excludedComposites: readonly PovertaAreaRow[];
  absoluteThreshold: PovertaAbsoluteThresholdView;
  relativeThreshold: PovertaRelativeThresholdView;
  latestYear: number;
}>;

function value(tenths: number | null): number | null {
  return tenths === null ? null : tenths / TENTHS;
}

function buildFamily(
  key: "assoluta" | "relativa",
  title: string,
  definition: string,
  data: IstatPovertaData,
  metadata: IstatPovertaMetadata,
): PovertaFamilyView {
  const token = key === "assoluta" ? "POVASS" : "POVREL";
  const householdRate = `INCID_${token}_FAM`;
  const individualRate = `INCID_${token}_INDIV`;
  const byCell = new Map(
    data.observations.map((row) => [`${row.measure}/${row.territory}/${row.year}`, row.valueTenths]),
  );
  const latestYear = data.period.to;

  const series: PovertaSeriesPoint[] = [];
  for (let year = data.period.from; year <= data.period.to; year += 1) {
    series.push({
      year,
      households: value(byCell.get(`${householdRate}/IT/${year}`) ?? null),
      individuals: value(byCell.get(`${individualRate}/IT/${year}`) ?? null),
    });
  }

  // Solo le ripartizioni che partizionano davvero: i compositi restano fuori.
  const areas = data.territories
    .filter((territory) => territory.kind === "macro")
    .map((territory) => ({
      code: territory.code,
      label: territory.label,
      households: value(byCell.get(`${householdRate}/${territory.code}/${latestYear}`) ?? null),
    }));

  const measures = new Map(data.measures.map((measure) => [measure.code, measure.label]));
  return {
    key,
    title,
    definition,
    datasetId: data.datasetId,
    period: data.period,
    latestYear,
    series,
    areas,
    householdMeasureLabel: measures.get(householdRate) ?? householdRate,
    individualMeasureLabel: measures.get(individualRate) ?? individualRate,
    caveats: data.caveats,
    source: {
      landingUrl: metadata.source.landingUrl,
      dataflowId: metadata.source.dataflowId,
      licenseId: metadata.source.licenseId,
      observedAt: metadata.observedAt,
    },
  };
}

function buildAbsoluteThreshold(): PovertaAbsoluteThresholdView {
  const data = istatPovertaSogliaAssolutaData;
  const metadata = istatPovertaSogliaAssolutaMetadata;
  const year = data.period.to;
  const householdTypology = data.householdTypologies.find((item) => item.code === THRESHOLD_HOUSEHOLD_TYPOLOGY);
  const municipalitySize = data.municipalitySizes.find((item) => item.code === THRESHOLD_MUNICIPALITY_SIZE);
  if (!householdTypology || !municipalitySize) {
    throw new Error("Profilo di soglia assoluta non trovato nello snapshot.");
  }

  const byTerritory = new Map(
    data.observations
      .filter((row) =>
        row.year === year
        && row.householdTypology === THRESHOLD_HOUSEHOLD_TYPOLOGY
        && row.municipalitySize === THRESHOLD_MUNICIPALITY_SIZE)
      .map((row) => [row.territory, row.valueHundredths]),
  );

  const regions = data.territories
    .filter((territory) => territory.kind === "regione")
    .map((territory) => ({
      code: territory.code,
      label: territory.label,
      valueHundredths: byTerritory.has(territory.code) ? (byTerritory.get(territory.code) ?? null) : null,
    }));

  if (regions.length !== 20) {
    throw new Error("La soglia assoluta deve elencare le 20 regioni nell’ordine della fonte.");
  }
  if (regions.some((row) => row.valueHundredths === null)) {
    throw new Error("Il profilo di contesto della soglia assoluta deve avere copertura regionale completa.");
  }

  return {
    datasetId: data.datasetId,
    year,
    householdTypology: { code: householdTypology.code, label: householdTypology.label },
    municipalitySize: { code: municipalitySize.code, label: municipalitySize.label },
    regions,
    caveats: data.caveats,
    source: {
      landingUrl: metadata.source.landingUrl,
      dataflowId: metadata.source.dataflowId,
      licenseId: metadata.source.licenseId,
      observedAt: metadata.source.acquisitionDate,
    },
  };
}

function buildRelativeThreshold(): PovertaRelativeThresholdView {
  const data = istatPovertaSogliaRelativaData;
  const metadata = istatPovertaSogliaRelativaMetadata;
  const year = data.period.to;
  const byComposition = new Map(
    data.observations
      .filter((row) => row.year === year)
      .map((row) => [row.householdComposition, row.valueHundredths]),
  );
  const rows = data.householdCompositions.map((composition) => {
    const value = byComposition.get(composition.code);
    if (value === undefined) {
      throw new Error(`Soglia relativa ${year}: manca l'ampiezza ${composition.code}.`);
    }
    return { code: composition.code, label: composition.label, valueHundredths: value };
  });
  if (rows.length !== 7) {
    throw new Error("La soglia relativa deve elencare le 7 ampiezze familiari pubblicate.");
  }
  return {
    datasetId: data.datasetId,
    year,
    excludedYear: data.excludedYear,
    excludedYearReason: data.excludedYearReason,
    rows,
    caveats: data.caveats,
    source: {
      landingUrl: metadata.source.landingUrl,
      dataflowId: metadata.source.dataflowId,
      licenseId: metadata.source.licenseId,
      observedAt: metadata.source.acquisitionDate,
    },
  };
}

export function buildPovertaPageView(): PovertaPageView {
  const assoluta = buildFamily(
    "assoluta",
    "Povertà assoluta",
    "Famiglie la cui spesa mensile è inferiore al valore di un paniere di beni e servizi considerati essenziali.",
    istatPovertaData,
    istatPovertaMetadata,
  );
  const relativa = buildFamily(
    "relativa",
    "Povertà relativa",
    "Famiglie la cui spesa per consumi è inferiore a una soglia calcolata sulla spesa media delle famiglie italiane.",
    istatPovertaRelativaData,
    istatPovertaRelativaMetadata,
  );

  const excludedComposites = istatPovertaData.territories
    .filter((territory) => territory.kind === "composite")
    .map((territory) => ({ code: territory.code, label: territory.label, households: null }));

  return {
    families: [assoluta, relativa],
    excludedComposites,
    absoluteThreshold: buildAbsoluteThreshold(),
    relativeThreshold: buildRelativeThreshold(),
    latestYear: assoluta.latestYear,
  };
}

/** Riesporta la query per gli smoke test della pagina. */
export { queryIstatPovertaAssoluta };
