import rawManifest from "../../docs/research/data/anac-cigs-2025-2026-08-20.json";

const SHA256 = /^[a-f0-9]{64}$/;
const ANAC_HOST = "dati.anticorruzione.it";

function isOfficialAnacUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ANAC_HOST;
  } catch {
    return false;
  }
}

export function assertAnacCigManifest(candidate: typeof rawManifest = rawManifest) {
  if (candidate.schemaVersion !== 1 || candidate.referenceYear !== 2025) {
    throw new Error("Manifest ANAC CIG: schema o anno di riferimento inatteso.");
  }
  if (!candidate.coverage.completeYear || candidate.coverage.missingMonths.length > 0) {
    throw new Error("Manifest ANAC CIG: la copertura annuale non è completa.");
  }
  if (
    candidate.coverage.observedMonths.length !== 12 ||
    candidate.coverage.observedMonths.some((month, index) => month !== index + 1)
  ) {
    throw new Error("Manifest ANAC CIG: mesi osservati non validi.");
  }
  if (
    candidate.inputs.length !== 12 ||
    candidate.inputs.some(
      (input) =>
        input.bytes <= 0 ||
        !SHA256.test(input.sha256) ||
        !isOfficialAnacUrl(input.resourcePageUrl) ||
        !isOfficialAnacUrl(input.resourceUrl) ||
        !/^2026-01-16$/.test(input.sourceLastModified) ||
        input.sourcePublishedAt !== null,
    )
  ) {
    throw new Error("Manifest ANAC CIG: integrità degli input non valida.");
  }
  if (candidate.population.records !== candidate.population.uniqueCigs) {
    throw new Error("Manifest ANAC CIG: i record non riconciliano con i CIG unici.");
  }
  const procedureRecords = Object.values(candidate.procedureChoice.allLabels).reduce(
    (sum, records) => sum + records,
    0,
  );
  if (procedureRecords !== candidate.population.records) {
    throw new Error("Manifest ANAC CIG: la partizione delle procedure non riconcilia.");
  }
  if (
    candidate.procedureChoice.directAward.records !==
      candidate.procedureChoice.allLabels["AFFIDAMENTO DIRETTO"] ||
    candidate.procedureChoice.directAwardFamily.records <
      candidate.procedureChoice.directAward.records ||
    candidate.procedureChoice.directAwardFamily.records > candidate.population.records
  ) {
    throw new Error("Manifest ANAC CIG: aggregati delle procedure incoerenti.");
  }
  if (
    candidate.population.servicesAndSupplies > candidate.population.records ||
    candidate.servicesAndSuppliesBelow140000.records > candidate.population.servicesAndSupplies ||
    candidate.servicesAndSuppliesBelow140000.directAwardRecords >
      candidate.servicesAndSuppliesBelow140000.records ||
    candidate.servicesAndSuppliesBelow140000.directAwardFamilyRecords >
      candidate.servicesAndSuppliesBelow140000.records ||
    candidate.thresholdBand135000To140000.servicesAndSuppliesRecords >
      candidate.population.servicesAndSupplies ||
    candidate.thresholdBand135000To140000.directAwardRecords >
      candidate.thresholdBand135000To140000.servicesAndSuppliesRecords ||
    candidate.thresholdBand135000To140000.strictContractRecords >
      candidate.thresholdBand135000To140000.servicesAndSuppliesRecords
  ) {
    throw new Error("Manifest ANAC CIG: sottoinsiemi oltre il denominatore.");
  }
  if (Object.values(candidate.exactContractAmounts).some((records) => records < 0)) {
    throw new Error("Manifest ANAC CIG: conteggio importo negativo.");
  }
  return candidate;
}

const manifest = assertAnacCigManifest();

export const availableAnacCigYears = [manifest.referenceYear] as const;

export const anacCigSnapshot = {
  ...manifest,
  observedAt: "2026-08-20",
  provenance: {
    owner: "Autorità Nazionale Anticorruzione",
    datasetUrl: "https://dati.anticorruzione.it/opendata/dataset/cig-2025",
    catalogUrl: "https://dati.anticorruzione.it/opendata/dataset",
    analyticsUrl: "https://dati.anticorruzione.it/superset/dashboard/appalti/",
    ocdsDocumentationUrl: "https://dati.anticorruzione.it/opendata/ocds_it",
    ocdsSwaggerUrl: "https://dati.anticorruzione.it/opendata/ocds/api/ui",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    replicationMethodologyUrl:
      "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/blob/main/docs/research/ANAC_2025_REPLICATION.md",
  },
  methodology: {
    freshness:
      "Snapshot annuale verificato sui dodici file mensili CIG 2025; non è una query live BDNCP.",
    screeningOnly:
      "Concentrazioni, procedure e importi vicini alle soglie indicano cosa verificare: non provano spreco, illecito, corruzione o frazionamento.",
    supplierLimitation:
      "I file CIG non bastano per attribuire importi o concentrazione a un fornitore; servono aggiudicazioni e aggiudicatari collegati con identificativi ufficiali.",
  },
} as const;

export function getAnacCigSnapshot(year = manifest.referenceYear) {
  if (year !== manifest.referenceYear) {
    throw new Error(`Lo snapshot ANAC CIG è disponibile solo per il ${manifest.referenceYear}.`);
  }
  return anacCigSnapshot;
}
