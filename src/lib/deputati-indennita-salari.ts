import cameraRaw from "@/data/generated/camera-trattamento-economico.json";
import hicpRaw from "@/data/generated/eurostat-hicp-annuale.json";
import foiRaw from "@/data/generated/istat-foi-annuale.json";
import contractualRaw from "@/data/generated/istat-retribuzioni-contrattuali.json";
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
  id: "camera" | "contractual" | "foi" | "hicp";
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
  freeze: CameraTrattamentoEconomicoSnapshot["freeze"];
  steps: { componentId: string; label: string; fromYear: number | null; fromDate: string | null; amountCents: number; derived: boolean; evidence: string }[];
  components: CameraTrattamentoComponent[];
  sources: ComparisonSource[];
  caveats: { camera: string[]; contractual: string[]; foi: string[]; hicp: string[] };
};

type Inputs = {
  camera: CameraTrattamentoEconomicoSnapshot;
  foi: IstatFoiAnnualSnapshot;
  hicp: EurostatHicpAnnualSnapshot;
  contractual: IstatContractualWagesSnapshot;
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
  cached ??= buildDeputiesVsWagesComparison({
    camera: parseCameraTrattamentoEconomicoSnapshot(cameraRaw),
    foi: parseIstatFoiAnnualSnapshot(foiRaw),
    hicp: parseEurostatHicpAnnualSnapshot(hicpRaw),
    contractual: parseIstatContractualWagesSnapshot(contractualRaw),
  });
  return cached;
}
