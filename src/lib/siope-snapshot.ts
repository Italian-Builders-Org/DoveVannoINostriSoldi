import { partialMonthOf } from "@/lib/siope-calendar";
import snapshot2024 from "@/data/generated/siope-municipal-2024.json";
import snapshot2025 from "@/data/generated/siope-municipal-2025.json";
import snapshot2026 from "@/data/generated/siope-municipal.json";

export type SiopeMunicipalMonthlyPoint = {
  month: number;
  label: string;
  flow: number;
  cumulative: number;
};

export type SiopeRegionPoint = {
  region: string;
  value: number;
  perCapitaValue: number;
  population: number | null;
  perCapita: number | null;
  municipalities: number;
  municipalitiesWithPopulation: number;
};

export type SiopeSpendingTitle = {
  code: string;
  label: string;
  value: number;
};

export type SiopeMunicipalityPoint = {
  name: string;
  province: string;
  region: string;
  codiceFiscale: string;
  population: number | null;
  value: number;
  perCapita: number | null;
};

export type SiopeQuantiles = {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
};

export type SiopeDistributionGroup = {
  municipalities: number;
  population: number;
  titleAmount: number;
  totalAmount: number;
  share: number | null;
  perCapita: {
    municipalityWeighted: SiopeQuantiles;
    residentWeighted: SiopeQuantiles;
  };
};

export type SiopeMunicipalDistribution = {
  schemaVersion: 2;
  measure: {
    titleCode: "1";
    titleLabel: string;
    metric: string;
    shareDenominator: string;
    quantileMethod: string;
  };
  period: {
    year: number;
    startMonth: number;
    endMonth: number;
    completeness: "complete" | "partial";
  };
  coverage: {
    municipalitiesWithMovements: number;
    municipalitiesWithValidPopulation: number;
    populationCovered: number;
    municipalitiesWithoutPopulation: number;
    municipalitiesWithRegion: number;
    municipalitiesWithoutRegion: number;
    municipalitiesWithValidPopulationAndRegion: number;
    paymentsWithoutPopulation: number;
    titlePaymentsWithoutPopulation: number;
    populationRegionalized: number;
    paymentsWithoutRegion: number;
    titlePaymentsWithoutRegion: number;
    paymentsWithPopulationWithoutRegion: number;
    titlePaymentsWithPopulationWithoutRegion: number;
  };
  nationalShareAll: number | null;
  nationalShareCovered: number | null;
  perCapita: SiopeDistributionGroup["perCapita"];
  populationBands: Array<SiopeDistributionGroup & { id: string; label: string }>;
  regions: Array<SiopeDistributionGroup & { region: string }>;
  provenance: {
    siopeMovementsUrl: string;
    siopeRegistryUrl: string;
    ipaUrl: string;
    siopeMovementsLastModified: string | null;
    siopeRegistryLastModified: string | null;
    ipaLastModified: string | null;
    siopeMovementsEtag: string | null;
    siopeRegistryEtag: string | null;
    ipaEtag: string | null;
    siopeMovementsSha256: string | null;
    siopeRegistrySha256: string | null;
    ipaSha256: string | null;
    observedAt: string;
  };
};

export type SiopeMunicipalSnapshot = {
  schemaVersion: 3;
  generatedAt: string;
  scope: "municipalities";
  year: number;
  latestMonth: number;
  latestMonthLabel: string;
  totalPaid: number;
  paymentsWithPopulation: number;
  populationCovered: number;
  nationalPerCapita: number | null;
  coverage: {
    activeSiopeMunicipalities: number;
    matchedToIpaRegion: number;
    withMovements: number;
    withRegion: number;
    withoutRegion: number;
    paymentsWithoutRegion: number;
    unmatchedToIpaRegion: number;
    movementRows: number;
    includedMovementRows: number;
    malformedRows: number;
    withPopulation: number;
    withoutPopulation: number;
  };
  monthly: SiopeMunicipalMonthlyPoint[];
  regions: SiopeRegionPoint[];
  titles: SiopeSpendingTitle[];
  topMunicipalities: SiopeMunicipalityPoint[];
  topMunicipalitiesByValue: SiopeMunicipalityPoint[];
  topMunicipalitiesByPerCapita: SiopeMunicipalityPoint[];
  /** Full-population aggregates produced by the verified raw-data refresh. */
  distribution: SiopeMunicipalDistribution;
  source: {
    siopeOwner: string;
    siopeMovementsUrl: string;
    siopeRegistryUrl: string;
    ipaUrl: string;
    siopeMovementsLastModified: string | null;
    siopeRegistryLastModified: string | null;
    ipaLastModified: string | null;
    siopeMovementsEtag: string | null;
    siopeRegistryEtag: string | null;
    ipaEtag: string | null;
    siopeMovementsSha256: string;
    siopeRegistrySha256: string;
    ipaSha256: string;
    observedAt: string;
  };
  methodology: {
    measure: string;
    periodicity: string;
    territorialJoin: string;
    populationSource: string;
    populationReference: string;
    populationSourceLastModified: string | null;
    perCapitaCoverage: string;
    warning: string;
  };
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const EXPECTED_BAND_IDS = [
  "under-1000",
  "1000-4999",
  "5000-19999",
  "20000-49999",
  "50000-99999",
  "100000-249999",
  "250000-499999",
  "500000-plus",
] as const;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field}: numero finito fuori intervallo`);
  }
  return value;
}

function count(value: unknown, field: string): number {
  const result = finite(value, field);
  if (!Number.isSafeInteger(result)) throw new Error(`${field}: intero sicuro atteso`);
  return result;
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}: testo atteso`);
  return value;
}

function close(actual: number, expected: number, field: string, tolerance = 0.25) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${field}: ${actual} non riconcilia con ${expected}`);
  }
}

function assertQuantiles(value: unknown, field: string): SiopeQuantiles {
  const item = record(value, field);
  const names = ["p10", "p25", "p50", "p75", "p90"] as const;
  const result = Object.fromEntries(names.map((name) => {
    const point = item[name];
    if (point === null) return [name, null];
    return [name, finite(point, `${field}.${name}`)];
  })) as SiopeQuantiles;
  const present = names.map((name) => result[name]).filter((point): point is number => point !== null);
  if (present.some((point, index) => index > 0 && point < present[index - 1])) {
    throw new Error(`${field}: quantili non monotoni`);
  }
  return result;
}

function assertPerCapita(value: unknown, field: string): SiopeDistributionGroup["perCapita"] {
  const item = record(value, field);
  return {
    municipalityWeighted: assertQuantiles(
      item.municipalityWeighted,
      `${field}.municipalityWeighted`,
    ),
    residentWeighted: assertQuantiles(item.residentWeighted, `${field}.residentWeighted`),
  };
}

function assertQuantilePresence(
  perCapita: SiopeDistributionGroup["perCapita"],
  hasMunicipalities: boolean,
  field: string,
) {
  for (const [weighting, quantiles] of Object.entries(perCapita)) {
    const values = Object.values(quantiles);
    if (hasMunicipalities ? values.some((value) => value === null) : values.some((value) => value !== null)) {
      throw new Error(`${field}.${weighting}: presenza dei quantili non coerente con i Comuni`);
    }
  }
}

function assertGroup(value: unknown, field: string): SiopeDistributionGroup {
  const item = record(value, field);
  const municipalities = count(item.municipalities, `${field}.municipalities`);
  const population = count(item.population, `${field}.population`);
  const titleAmount = finite(item.titleAmount, `${field}.titleAmount`);
  const totalAmount = finite(item.totalAmount, `${field}.totalAmount`);
  if (titleAmount > totalAmount + 0.01) throw new Error(`${field}: Titolo 1 supera il totale`);
  const share = item.share === null ? null : finite(item.share, `${field}.share`);
  if (share !== null && share > 1) throw new Error(`${field}.share: quota oltre 1`);
  if (totalAmount === 0 ? share !== null : share === null) {
    throw new Error(`${field}.share: quota e denominatore non coerenti`);
  }
  if (share !== null) {
    close(share, titleAmount / totalAmount, `${field}.share`, 0.00000002);
  }
  if ((municipalities === 0) !== (population === 0)) {
    throw new Error(`${field}: popolazione e Comuni vuoti non coerenti`);
  }
  const perCapita = assertPerCapita(item.perCapita, `${field}.perCapita`);
  assertQuantilePresence(perCapita, municipalities > 0, `${field}.perCapita`);
  return {
    municipalities,
    population,
    titleAmount,
    totalAmount,
    share,
    perCapita,
  };
}

export function assertSiopeDistributionIntegrity(value: unknown, expectedYear: number) {
  const snapshot = record(value, `SIOPE ${expectedYear}`);
  if (snapshot.schemaVersion !== 3 || snapshot.scope !== "municipalities") {
    throw new Error(`SIOPE ${expectedYear}: snapshot v3 comunale atteso`);
  }
  if (snapshot.year !== expectedYear) throw new Error(`SIOPE ${expectedYear}: anno inatteso`);
  const latestMonth = count(snapshot.latestMonth, `SIOPE ${expectedYear}.latestMonth`);
  if (latestMonth < 1 || latestMonth > 12) throw new Error(`SIOPE ${expectedYear}: mese inatteso`);
  const totalPaid = finite(snapshot.totalPaid, `SIOPE ${expectedYear}.totalPaid`);
  const paymentsWithPopulation = finite(
    snapshot.paymentsWithPopulation,
    `SIOPE ${expectedYear}.paymentsWithPopulation`,
  );
  const populationCovered = count(
    snapshot.populationCovered,
    `SIOPE ${expectedYear}.populationCovered`,
  );
  const coverage = record(snapshot.coverage, `SIOPE ${expectedYear}.coverage`);
  const activeMunicipalities = count(
    coverage.activeSiopeMunicipalities,
    `SIOPE ${expectedYear}.coverage.activeSiopeMunicipalities`,
  );
  const matchedToIpaRegion = count(
    coverage.matchedToIpaRegion,
    `SIOPE ${expectedYear}.coverage.matchedToIpaRegion`,
  );
  const unmatchedToIpaRegion = count(
    coverage.unmatchedToIpaRegion,
    `SIOPE ${expectedYear}.coverage.unmatchedToIpaRegion`,
  );
  const source = record(snapshot.source, `SIOPE ${expectedYear}.source`);
  const observedAt = nonEmptyText(source.observedAt, `SIOPE ${expectedYear}.source.observedAt`);
  if (Number.isNaN(new Date(observedAt).getTime())) throw new Error(`SIOPE ${expectedYear}: observedAt non valido`);
  if (snapshot.generatedAt !== observedAt) throw new Error(`SIOPE ${expectedYear}: generatedAt divergente`);
  const expectedSourceUrls = {
    siopeMovementsUrl: `https://www.siope.it/documenti/siope2/open/last/SIOPE_USCITE.${expectedYear}.zip`,
    siopeRegistryUrl: "https://www.siope.it/documenti/siope2/open/last/SIOPE_ANAGRAFICHE.zip",
    ipaUrl: "https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt",
  } as const;
  for (const [field, expected] of Object.entries(expectedSourceUrls)) {
    if (source[field] !== expected) throw new Error(`SIOPE ${expectedYear}.source.${field}: URL inatteso`);
  }
  for (const hashField of ["siopeMovementsSha256", "siopeRegistrySha256", "ipaSha256"]) {
    if (!SHA256_PATTERN.test(nonEmptyText(source[hashField], `SIOPE ${expectedYear}.source.${hashField}`))) {
      throw new Error(`SIOPE ${expectedYear}.source.${hashField}: SHA-256 non valido`);
    }
  }
  for (const modifiedField of [
    "siopeMovementsLastModified",
    "siopeRegistryLastModified",
    "ipaLastModified",
  ]) {
    nonEmptyText(source[modifiedField], `SIOPE ${expectedYear}.source.${modifiedField}`);
  }
  for (const etagField of ["siopeMovementsEtag", "siopeRegistryEtag", "ipaEtag"]) {
    nonEmptyText(source[etagField], `SIOPE ${expectedYear}.source.${etagField}`);
  }

  const distribution = record(snapshot.distribution, `SIOPE ${expectedYear}.distribution`);
  if (distribution.schemaVersion !== 2) throw new Error(`SIOPE ${expectedYear}: distribution v2 attesa`);
  const measure = record(distribution.measure, `SIOPE ${expectedYear}.distribution.measure`);
  if (measure.titleCode !== "1" || measure.titleLabel !== "Spese correnti") {
    throw new Error(`SIOPE ${expectedYear}: misura della distribuzione inattesa`);
  }
  if (
    measure.metric !== "pagamenti del Titolo 1 per abitante del Comune" ||
    measure.shareDenominator !==
      "tutti i pagamenti SIOPE degli enti riconosciuti come Comuni dall'anagrafica SIOPE nel periodo" ||
    measure.quantileMethod !==
      "nearest-rank pesato: prima osservazione la cui cumulata raggiunge p·peso totale"
  ) {
    throw new Error(`SIOPE ${expectedYear}: semantica della distribuzione inattesa`);
  }

  const period = record(distribution.period, `SIOPE ${expectedYear}.distribution.period`);
  if (period.year !== expectedYear || period.startMonth !== 1 || period.endMonth !== latestMonth) {
    throw new Error(`SIOPE ${expectedYear}: periodo della distribuzione non riconciliato`);
  }
  const expectedCompleteness = partialMonthOf(expectedYear, latestMonth, observedAt) === null
    ? "complete"
    : "partial";
  if (period.completeness !== expectedCompleteness) {
    throw new Error(`SIOPE ${expectedYear}: completezza della distribuzione inattesa`);
  }

  const distributionCoverage = record(
    distribution.coverage,
    `SIOPE ${expectedYear}.distribution.coverage`,
  );
  const withMovements = count(coverage.withMovements, `SIOPE ${expectedYear}.coverage.withMovements`);
  const withPopulation = count(coverage.withPopulation, `SIOPE ${expectedYear}.coverage.withPopulation`);
  const withoutPopulation = count(coverage.withoutPopulation, `SIOPE ${expectedYear}.coverage.withoutPopulation`);
  const withRegion = count(coverage.withRegion, `SIOPE ${expectedYear}.coverage.withRegion`);
  const withoutRegion = count(coverage.withoutRegion, `SIOPE ${expectedYear}.coverage.withoutRegion`);
  const snapshotPaymentsWithoutRegion = finite(
    coverage.paymentsWithoutRegion,
    `SIOPE ${expectedYear}.coverage.paymentsWithoutRegion`,
  );
  const municipalitiesWithRegion = count(
    distributionCoverage.municipalitiesWithRegion,
    `SIOPE ${expectedYear}.distribution.coverage.municipalitiesWithRegion`,
  );
  const municipalitiesWithoutRegion = count(
    distributionCoverage.municipalitiesWithoutRegion,
    `SIOPE ${expectedYear}.distribution.coverage.municipalitiesWithoutRegion`,
  );
  const municipalitiesWithValidPopulationAndRegion = count(
    distributionCoverage.municipalitiesWithValidPopulationAndRegion,
    `SIOPE ${expectedYear}.distribution.coverage.municipalitiesWithValidPopulationAndRegion`,
  );
  const populationRegionalized = count(
    distributionCoverage.populationRegionalized,
    `SIOPE ${expectedYear}.distribution.coverage.populationRegionalized`,
  );
  if (
    distributionCoverage.municipalitiesWithMovements !== withMovements ||
    distributionCoverage.municipalitiesWithValidPopulation !== withPopulation ||
    distributionCoverage.municipalitiesWithoutPopulation !== withoutPopulation ||
    distributionCoverage.populationCovered !== populationCovered ||
    municipalitiesWithRegion !== withRegion ||
    municipalitiesWithoutRegion !== withoutRegion ||
    matchedToIpaRegion + unmatchedToIpaRegion !== activeMunicipalities ||
    withRegion + withoutRegion !== withMovements ||
    withRegion > matchedToIpaRegion ||
    withoutRegion > unmatchedToIpaRegion ||
    municipalitiesWithValidPopulationAndRegion > withPopulation ||
    withPopulation - municipalitiesWithValidPopulationAndRegion > withoutRegion ||
    populationRegionalized > populationCovered
  ) {
    throw new Error(`SIOPE ${expectedYear}: copertura della distribuzione non riconciliata`);
  }
  const paymentsWithoutPopulation = finite(
    distributionCoverage.paymentsWithoutPopulation,
    `SIOPE ${expectedYear}.distribution.coverage.paymentsWithoutPopulation`,
  );
  const titlePaymentsWithoutPopulation = finite(
    distributionCoverage.titlePaymentsWithoutPopulation,
    `SIOPE ${expectedYear}.distribution.coverage.titlePaymentsWithoutPopulation`,
  );
  const paymentsWithoutRegion = finite(
    distributionCoverage.paymentsWithoutRegion,
    `SIOPE ${expectedYear}.distribution.coverage.paymentsWithoutRegion`,
  );
  const titlePaymentsWithoutRegion = finite(
    distributionCoverage.titlePaymentsWithoutRegion,
    `SIOPE ${expectedYear}.distribution.coverage.titlePaymentsWithoutRegion`,
  );
  const paymentsWithPopulationWithoutRegion = finite(
    distributionCoverage.paymentsWithPopulationWithoutRegion,
    `SIOPE ${expectedYear}.distribution.coverage.paymentsWithPopulationWithoutRegion`,
  );
  const titlePaymentsWithPopulationWithoutRegion = finite(
    distributionCoverage.titlePaymentsWithPopulationWithoutRegion,
    `SIOPE ${expectedYear}.distribution.coverage.titlePaymentsWithPopulationWithoutRegion`,
  );
  close(paymentsWithPopulation + paymentsWithoutPopulation, totalPaid, `SIOPE ${expectedYear}: pagamenti coperti`);
  close(paymentsWithoutRegion, snapshotPaymentsWithoutRegion, `SIOPE ${expectedYear}: pagamenti non regionalizzati`);
  if (
    paymentsWithPopulationWithoutRegion > paymentsWithoutRegion ||
    titlePaymentsWithoutRegion > paymentsWithoutRegion ||
    titlePaymentsWithPopulationWithoutRegion > titlePaymentsWithoutRegion ||
    titlePaymentsWithPopulationWithoutRegion > paymentsWithPopulationWithoutRegion
  ) {
    throw new Error(`SIOPE ${expectedYear}: copertura non regionalizzata incoerente`);
  }

  const shareAll = finite(distribution.nationalShareAll, `SIOPE ${expectedYear}.distribution.nationalShareAll`);
  const shareCovered = finite(
    distribution.nationalShareCovered,
    `SIOPE ${expectedYear}.distribution.nationalShareCovered`,
  );
  if (shareAll > 1 || shareCovered > 1) throw new Error(`SIOPE ${expectedYear}: quota nazionale oltre 1`);
  const nationalPerCapita = assertPerCapita(
    distribution.perCapita,
    `SIOPE ${expectedYear}.distribution.perCapita`,
  );
  assertQuantilePresence(
    nationalPerCapita,
    withPopulation > 0,
    `SIOPE ${expectedYear}.distribution.perCapita`,
  );

  if (!Array.isArray(distribution.populationBands) || distribution.populationBands.length !== EXPECTED_BAND_IDS.length) {
    throw new Error(`SIOPE ${expectedYear}: otto fasce di popolazione attese`);
  }
  const bands = distribution.populationBands.map((item, index) => {
    const band = record(item, `SIOPE ${expectedYear}.distribution.populationBands[${index}]`);
    if (band.id !== EXPECTED_BAND_IDS[index]) throw new Error(`SIOPE ${expectedYear}: fascia inattesa`);
    nonEmptyText(band.label, `SIOPE ${expectedYear}.distribution.populationBands[${index}].label`);
    return assertGroup(band, `SIOPE ${expectedYear}.distribution.populationBands[${index}]`);
  });
  if (!Array.isArray(distribution.regions) || distribution.regions.length !== 20) {
    throw new Error(`SIOPE ${expectedYear}: venti Regioni attese nella distribuzione`);
  }
  const regionNames = new Set<string>();
  const regions = distribution.regions.map((item, index) => {
    const region = record(item, `SIOPE ${expectedYear}.distribution.regions[${index}]`);
    const name = nonEmptyText(region.region, `SIOPE ${expectedYear}.distribution.regions[${index}].region`);
    if (regionNames.has(name)) throw new Error(`SIOPE ${expectedYear}: Regione duplicata`);
    regionNames.add(name);
    return assertGroup(region, `SIOPE ${expectedYear}.distribution.regions[${index}]`);
  });
  if (!Array.isArray(snapshot.regions) || snapshot.regions.length !== 20) {
    throw new Error(`SIOPE ${expectedYear}: venti Regioni snapshot attese`);
  }
  const snapshotRegionNames = new Set(snapshot.regions.map((item, index) =>
    nonEmptyText(record(item, `SIOPE ${expectedYear}.regions[${index}]`).region, `SIOPE ${expectedYear}.regions[${index}].region`)));
  if (
    snapshotRegionNames.size !== regionNames.size ||
    [...regionNames].some((name) => !snapshotRegionNames.has(name))
  ) {
    throw new Error(`SIOPE ${expectedYear}: geografia della distribuzione divergente`);
  }

  const sum = (items: SiopeDistributionGroup[], field: "municipalities" | "population" | "titleAmount" | "totalAmount") =>
    items.reduce((total, item) => total + item[field], 0);
  if (
    sum(bands, "municipalities") !== withPopulation ||
    sum(regions, "municipalities") !== municipalitiesWithValidPopulationAndRegion ||
    sum(bands, "population") !== populationCovered ||
    sum(regions, "population") !== populationRegionalized
  ) {
    throw new Error(`SIOPE ${expectedYear}: fasce o Regioni non riconciliate`);
  }
  const coveredTitle = sum(bands, "titleAmount");
  const coveredTotal = sum(bands, "totalAmount");
  const regionalizedCoveredTitle = sum(regions, "titleAmount");
  const regionalizedCoveredTotal = sum(regions, "totalAmount");
  close(coveredTotal, paymentsWithPopulation, `SIOPE ${expectedYear}: totale coperto`);
  close(
    regionalizedCoveredTotal + paymentsWithPopulationWithoutRegion,
    coveredTotal,
    `SIOPE ${expectedYear}: totale coperto regionalizzato`,
  );
  close(
    regionalizedCoveredTitle + titlePaymentsWithPopulationWithoutRegion,
    coveredTitle,
    `SIOPE ${expectedYear}: Titolo 1 coperto regionalizzato`,
  );
  const titles = Array.isArray(snapshot.titles) ? snapshot.titles : [];
  const titleOne = titles.find((item) => record(item, `SIOPE ${expectedYear}.titles`).code === "1");
  if (!titleOne) throw new Error(`SIOPE ${expectedYear}: Titolo 1 assente`);
  const titleOneValue = finite(record(titleOne, `SIOPE ${expectedYear}.title1`).value, `SIOPE ${expectedYear}.title1.value`);
  close(coveredTitle + titlePaymentsWithoutPopulation, titleOneValue, `SIOPE ${expectedYear}: Titolo 1 coperto`);
  const snapshotRegionalTotal = (snapshot.regions as unknown[]).reduce<number>(
    (total, item, index) => total + finite(
      record(item, `SIOPE ${expectedYear}.regions[${index}]`).value,
      `SIOPE ${expectedYear}.regions[${index}].value`,
    ),
    0,
  );
  close(
    snapshotRegionalTotal + paymentsWithoutRegion,
    totalPaid,
    `SIOPE ${expectedYear}: totale regionale`,
  );
  close(shareAll, titleOneValue / totalPaid, `SIOPE ${expectedYear}: quota nazionale`, 0.00000002);
  close(shareCovered, coveredTitle / coveredTotal, `SIOPE ${expectedYear}: quota coperta`, 0.00000002);

  const provenance = record(distribution.provenance, `SIOPE ${expectedYear}.distribution.provenance`);
  for (const field of [
    "siopeMovementsUrl",
    "siopeRegistryUrl",
    "ipaUrl",
    "siopeMovementsLastModified",
    "siopeRegistryLastModified",
    "ipaLastModified",
    "siopeMovementsEtag",
    "siopeRegistryEtag",
    "ipaEtag",
    "siopeMovementsSha256",
    "siopeRegistrySha256",
    "ipaSha256",
    "observedAt",
  ]) {
    if (provenance[field] !== source[field]) {
      throw new Error(`SIOPE ${expectedYear}: provenance divergente per ${field}`);
    }
  }
}

/**
 * The generated file is validated by the SIOPE ETL workflow before it can be
 * committed. Keeping it as a versioned build input makes web requests cheap,
 * deterministic and independent from a 50+ MB upstream download.
 */
const rawSnapshots = {
  2024: snapshot2024,
  2025: snapshot2025,
  2026: snapshot2026,
} as const;

for (const [year, snapshot] of Object.entries(rawSnapshots)) {
  assertSiopeDistributionIntegrity(snapshot, Number(year));
}

const snapshots = rawSnapshots as unknown as Record<number, SiopeMunicipalSnapshot>;

export const availableSiopeYears = Object.keys(snapshots)
  .map(Number)
  .sort((left, right) => right - left);

export function getSiopeMunicipalSnapshot(year?: number): SiopeMunicipalSnapshot {
  if (year && year in snapshots) {
    return snapshots[year];
  }
  return snapshots[2026];
}

export const siopeMunicipalSnapshot = getSiopeMunicipalSnapshot();

/** The month that is still filling up, if there is one. See siope-calendar. */
export function partialMonth(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): number | null {
  return partialMonthOf(data.year, data.latestMonth, data.source.observedAt);
}

/** The months whose totals the source considers settled. */
export function completedMonths(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): SiopeMunicipalMonthlyPoint[] {
  const partial = partialMonth(data);
  return data.monthly.filter((point) => point.month !== partial);
}

export function regionsByPerCapita(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): SiopeRegionPoint[] {
  return [...data.regions]
    .sort((left, right) => {
      if (left.perCapita === null && right.perCapita === null) {
        return left.region.localeCompare(right.region, "it-IT");
      }
      if (left.perCapita === null) return 1;
      if (right.perCapita === null) return -1;
      return right.perCapita - left.perCapita || left.region.localeCompare(right.region, "it-IT");
    });
}

export function municipalitiesByPerCapita(
  data: SiopeMunicipalSnapshot = siopeMunicipalSnapshot,
): SiopeMunicipalityPoint[] {
  return data.topMunicipalitiesByPerCapita;
}

export function siopeTitleShare(
  data: SiopeMunicipalSnapshot,
  titleCode: string,
): number | null {
  if (data.totalPaid <= 0) return null;
  const value = data.titles.find((title) => title.code === titleCode)?.value;
  return value === undefined ? null : value / data.totalPaid;
}
