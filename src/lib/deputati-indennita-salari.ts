import cameraRaw from "@/data/generated/camera-trattamento-economico.json";
import hicpRaw from "@/data/generated/eurostat-hicp-annuale.json";
import foiRaw from "@/data/generated/istat-foi-annuale.json";
import contractualRaw from "@/data/generated/istat-retribuzioni-contrattuali.json";
import { istatBesData, istatBesMetadata } from "@/lib/istat-bes-snapshot";
import {
  parseEurostatHicpAnnualSnapshot,
  parseIstatContractualWagesSnapshot,
  parseIstatFoiAnnualSnapshot,
  type EurostatHicpAnnualSnapshot,
  type IstatContractualWagesSnapshot,
  type IstatFoiAnnualSnapshot,
} from "@/lib/data/annual-price-wage-indices-contract";
import {
  parseCameraTrattamentoEconomicoSnapshot,
  type CameraTrattamentoComponent,
  type CameraTrattamentoEconomicoSnapshot,
} from "@/lib/data/camera-trattamento-economico-contract";

/**
 * Deputies' gross monthly indemnity (institutional rate, Camera) against the
 * ISTAT contractual wage index per employee, both as indices with the first
 * common year = 100, nominal and deflated with FOI (the index the Camera uses)
 * and, as a check, with HICP. Every value comes from a committed snapshot; a
 * missing year in any series stops the build instead of being interpolated.
 */

const INDEMNITY_ID = "indennita-parlamentare-lordo";
/** First year the Camera page states the indemnity amount for. */
const FIRST_YEAR = 2005;

export type IndemnityYear = { year: number; amountCents: number };

export function buildIndemnityAnnualSeries(
  camera: CameraTrattamentoEconomicoSnapshot,
  fromYear: number,
  toYear: number,
): IndemnityYear[] {
  const steps = camera.history
    .filter((step) => step.componentId === INDEMNITY_ID)
    .map((step) => {
      if (step.fromYear === null) throw new Error("gradino dell'indennità senza anno di inizio");
      return { fromYear: step.fromYear, amountCents: step.amountCents };
    });
  const first = steps[0];
  if (!first || fromYear < first.fromYear) {
    throw new Error(`indennità non documentata per il ${fromYear}: la Camera parte dal ${first?.fromYear ?? "nessun anno"}`);
  }
  if (steps.at(-1)!.amountCents !== camera.summary.indemnityGrossMonthlyCents) {
    throw new Error("l'ultimo gradino dell'indennità non coincide con l'importo in vigore");
  }
  const series: IndemnityYear[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    const step = steps.findLast((candidate) => candidate.fromYear <= year)!;
    series.push({ year, amountCents: step.amountCents });
  }
  return series;
}

export type ComparisonRow = {
  year: number;
  indemnityCents: number;
  /** Indices, first year = 100. */
  indemnityNominal: number;
  contractualNominal: number;
  prices: number;
  pricesHicp: number;
  indemnityReal: number;
  contractualReal: number;
  indemnityRealHicp: number;
  contractualRealHicp: number;
};

export type ComparisonSource = {
  id: "camera" | "contractual" | "effective" | "foi" | "hicp";
  owner: string;
  title: string;
  url: string;
  license: string;
  acquiredOn: string;
  period: string;
};

export type DeputiesVsWagesComparison = {
  baseYear: number;
  lastYear: number;
  rows: ComparisonRow[];
  headline: {
    indemnityFirstCents: number;
    indemnityLastCents: number;
    indemnityNominalPct: number;
    indemnityRealPct: number;
    contractualNominalPct: number;
    contractualRealPct: number;
    pricesPct: number;
    indemnityRealHicpPct: number;
    contractualRealHicpPct: number;
  };
  /**
   * Second lens on wages: average annual pay actually received by employees
   * (ISTAT BES 04BEC002P, Italy, both sexes). It reflects composition (part-time,
   * sectors) and covers fewer years, so it is a check, not the main series.
   */
  effectiveWages: {
    fromYear: number;
    toYear: number;
    firstEuro: number;
    lastEuro: number;
    nominalPct: number;
    realPct: number;
  };
  freeze: CameraTrattamentoEconomicoSnapshot["freeze"];
  steps: { componentId: string; label: string; fromYear: number | null; fromDate: string | null; amountCents: number; derived: boolean; evidence: string }[];
  components: CameraTrattamentoComponent[];
  sources: ComparisonSource[];
  caveats: { camera: string[]; contractual: string[]; foi: string[]; hicp: string[] };
};

export type EffectiveWageObservation = { year: number; euro: number };

type Inputs = {
  /** BES average annual pay of employees, Italy, total; contiguous years. */
  effective: readonly EffectiveWageObservation[];
  camera: CameraTrattamentoEconomicoSnapshot;
  foi: IstatFoiAnnualSnapshot;
  hicp: EurostatHicpAnnualSnapshot;
  contractual: IstatContractualWagesSnapshot;
  effectiveSource?: ComparisonSource;
};

function lookup<T extends { year: number }>(rows: readonly T[], name: string) {
  const byYear = new Map(rows.map((row) => [row.year, row]));
  return (year: number): T => {
    const row = byYear.get(year);
    if (!row) throw new Error(`${name}: manca l'anno ${year}`);
    return row;
  };
}

const pct = (index: number) => index - 100;

export function buildDeputiesVsWagesComparison(input: Inputs): DeputiesVsWagesComparison {
  const lastYear = Math.min(
    input.contractual.observations.at(-1)!.year,
    input.foi.observations.at(-1)!.year,
    input.hicp.observations.at(-1)!.year,
  );
  const baseYear = Math.max(FIRST_YEAR, input.contractual.observations[0]!.year);
  const indemnity = buildIndemnityAnnualSeries(input.camera, baseYear, lastYear);
  const foi = lookup(input.foi.observations, "FOI");
  const hicp = lookup(input.hicp.observations, "HICP");
  const contractual = lookup(input.contractual.observations, "retribuzioni contrattuali");

  const base = {
    indemnity: indemnity[0]!.amountCents,
    foi: foi(baseYear).base2025.foiHundredths,
    hicp: hicp(baseYear).indexTenths,
    contractual: contractual(baseYear).indexTenths,
  };

  const rows = indemnity.map(({ year, amountCents }): ComparisonRow => {
    const indemnityNominal = (amountCents / base.indemnity) * 100;
    const contractualNominal = (contractual(year).indexTenths / base.contractual) * 100;
    const prices = (foi(year).base2025.foiHundredths / base.foi) * 100;
    const pricesHicp = (hicp(year).indexTenths / base.hicp) * 100;
    return {
      year,
      indemnityCents: amountCents,
      indemnityNominal,
      contractualNominal,
      prices,
      pricesHicp,
      indemnityReal: (indemnityNominal / prices) * 100,
      contractualReal: (contractualNominal / prices) * 100,
      indemnityRealHicp: (indemnityNominal / pricesHicp) * 100,
      contractualRealHicp: (contractualNominal / pricesHicp) * 100,
    };
  });
  const last = rows.at(-1)!;

  if (input.effective.length < 2) throw new Error("retribuzione media BES: servono almeno due anni");
  for (let index = 1; index < input.effective.length; index += 1) {
    if (input.effective[index]!.year !== input.effective[index - 1]!.year + 1) {
      throw new Error(`retribuzione media BES: anni non consecutivi dopo il ${input.effective[index - 1]!.year}`);
    }
  }
  const effectiveFirst = input.effective[0]!;
  const effectiveLast = input.effective.at(-1)!;
  const effectivePrices = foi(effectiveLast.year).base2025.foiHundredths / foi(effectiveFirst.year).base2025.foiHundredths;
  const effectiveNominal = effectiveLast.euro / effectiveFirst.euro;

  const labels = new Map(input.camera.components.map((component) => [component.id, component.label]));
  const cameraSource = input.camera.source;
  const hicpProvenance = input.hicp.semantics.provenance;
  const foiProvenance = input.foi.semantics.provenance;
  const contractualProvenance = input.contractual.semantics.provenance;

  return {
    baseYear,
    lastYear,
    rows,
    headline: {
      indemnityFirstCents: indemnity[0]!.amountCents,
      indemnityLastCents: last.indemnityCents,
      indemnityNominalPct: pct(last.indemnityNominal),
      indemnityRealPct: pct(last.indemnityReal),
      contractualNominalPct: pct(last.contractualNominal),
      contractualRealPct: pct(last.contractualReal),
      pricesPct: pct(last.prices),
      indemnityRealHicpPct: pct(last.indemnityRealHicp),
      contractualRealHicpPct: pct(last.contractualRealHicp),
    },
    effectiveWages: {
      fromYear: effectiveFirst.year,
      toYear: effectiveLast.year,
      firstEuro: effectiveFirst.euro,
      lastEuro: effectiveLast.euro,
      nominalPct: (effectiveNominal - 1) * 100,
      realPct: (effectiveNominal / effectivePrices - 1) * 100,
    },
    freeze: input.camera.freeze,
    steps: input.camera.history.map((step) => ({
      componentId: step.componentId,
      label: labels.get(step.componentId) ?? step.componentId,
      fromYear: step.fromYear,
      fromDate: step.fromDate,
      amountCents: step.amountCents,
      derived: step.basis === "derived",
      evidence: step.evidence,
    })),
    components: input.camera.components,
    sources: [
      {
        id: "camera",
        owner: cameraSource.owner,
        title: "Trattamento economico dei deputati",
        url: cameraSource.pageUrl,
        license: cameraSource.license,
        acquiredOn: cameraSource.observedDate,
        period: input.camera.referencePeriod,
      },
      {
        id: "contractual",
        owner: contractualProvenance.holder,
        title: "Indice delle retribuzioni contrattuali per dipendente, totale economia",
        url: contractualProvenance.url,
        license: contractualProvenance.license,
        acquiredOn: contractualProvenance.acquisitionDate,
        period: input.contractual.referencePeriod,
      },
      ...(input.effectiveSource ? [input.effectiveSource] : []),
      {
        id: "foi",
        owner: foiProvenance.holder,
        title: "Prezzi al consumo per le famiglie di operai e impiegati (FOI), medie annue",
        url: foiProvenance.landingUrl,
        license: foiProvenance.license,
        acquiredOn: foiProvenance.acquisitionDate,
        period: input.foi.referencePeriod,
      },
      {
        id: "hicp",
        owner: hicpProvenance.holder,
        title: "Indice armonizzato dei prezzi al consumo (HICP), Italia, medie annue",
        url: hicpProvenance.landingUrl,
        license: hicpProvenance.license,
        acquiredOn: hicpProvenance.acquisitionDate,
        period: input.hicp.referencePeriod,
      },
    ],
    caveats: {
      camera: input.camera.caveats,
      contractual: input.contractual.caveats,
      foi: input.foi.caveats,
      hicp: input.hicp.caveats,
    },
  };
}

let cached: DeputiesVsWagesComparison | null = null;

export function getDeputiesVsWagesComparison(): DeputiesVsWagesComparison {
  const effective = istatBesData.observations
    .filter((row) => row.indicator === "04BEC002P" && row.territory === "IT" && row.sex === "T")
    // A missing value is dropped here and then fails the contiguity check: never read as zero.
    .flatMap((row) => (row.valueTenths === null ? [] : [{ year: row.year, euro: row.valueTenths / 10 }]))
    .toSorted((left, right) => left.year - right.year);
  const besSource = istatBesMetadata.source;
  cached ??= buildDeputiesVsWagesComparison({
    effective,
    effectiveSource: {
      id: "effective",
      owner: besSource.owner,
      title: "Retribuzione media annua dei lavoratori dipendenti (BES dei territori)",
      url: besSource.landingUrl,
      license: besSource.licenseId,
      acquiredOn: besSource.acquisition.acquiredAt,
      period: `${effective[0]?.year ?? "?"}-${effective.at(-1)?.year ?? "?"}`,
    },
    camera: parseCameraTrattamentoEconomicoSnapshot(cameraRaw),
    foi: parseIstatFoiAnnualSnapshot(foiRaw),
    hicp: parseEurostatHicpAnnualSnapshot(hicpRaw),
    contractual: parseIstatContractualWagesSnapshot(contractualRaw),
  });
  return cached;
}
