import { z } from "zod";
import { CANONICAL_REGION_NAMES } from "@/lib/region-query";

export const SIOPE_RECEIPT_TITLES = {
  "0": "Incassi da regolarizzare",
  "1": "Entrate correnti di natura tributaria, contributiva e perequativa",
  "2": "Trasferimenti correnti",
  "3": "Entrate extratributarie",
  "4": "Entrate in conto capitale",
  "5": "Entrate da riduzione di attività finanziarie",
  "6": "Accensione prestiti",
  "7": "Anticipazioni da istituto tesoriere/cassiere",
  "9": "Entrate per conto terzi e partite di giro",
} as const;
export const SIOPE_RECEIPT_TITLE_ORDER = Object.keys(SIOPE_RECEIPT_TITLES);
const MONTH_LABELS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

const text = z.string().trim().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cents = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const euros = z.number().finite().refine((value) =>
  Number.isSafeInteger(Math.round(value * 100)) &&
  value === Math.round(value * 100) / 100,
"Importo EUR non rappresentabile in centesimi sicuri");
const timestamp = text.refine((value) => !Number.isNaN(Date.parse(value)), "Data non valida");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const year = z.union([z.literal(2024), z.literal(2025), z.literal(2026)]);
const month = z.number().int().min(1).max(12);
const region = text.refine((value) => CANONICAL_REGION_NAMES.some((name) => name === value), "Regione IPA non canonica");
const population = count.min(2).nullable();
const titleCode = z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "9"]);
const titleLabels = z.record(titleCode, text);
const SIOPE_BASE = "https://www.siope.it/documenti/siope2/open/last";
const IPA_URL = "https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt";

const summarySchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.literal("municipal-receipts"),
  flow: z.literal("entrate"),
  unit: z.literal("EUR"),
  accountingBasis: z.literal("cash"),
  year,
  generatedAt: timestamp,
  latestMonth: month,
  latestMonthLabel: text,
  totalCollected: euros,
  receiptsWithPopulation: euros,
  populationCovered: count,
  nationalPerCapita: euros.nullable(),
  coverage: z.object({
    activeSiopeMunicipalities: count.positive(),
    matchedToIpaRegion: count,
    unmatchedToIpaRegion: count,
    withMovements: count.positive(),
    withRegion: count,
    withoutRegion: count,
    receiptsWithoutRegion: euros,
    movementRows: count.positive(),
    includedMovementRows: count.positive(),
    malformedRows: z.literal(0),
    withPopulation: count,
    withoutPopulation: count,
  }).strict(),
  monthly: z.array(z.object({ month, label: text, flow: euros, cumulative: euros }).strict()).min(1).max(12),
  regions: z.array(z.object({
    region,
    value: euros,
    perCapitaValue: euros,
    population,
    perCapita: euros.nullable(),
    municipalities: count.positive(),
    municipalitiesWithPopulation: count,
  }).strict()).length(20),
  titles: z.array(z.object({ code: titleCode, label: text, value: euros }).strict()).min(1),
  source: z.object({
    siopeOwner: text,
    siopeMovementsUrl: z.string().url(),
    siopeRegistryUrl: z.literal(`${SIOPE_BASE}/SIOPE_ANAGRAFICHE.zip`),
    ipaUrl: z.literal(IPA_URL),
    siopeMovementsLastModified: timestamp.nullable(),
    siopeRegistryLastModified: timestamp.nullable(),
    ipaLastModified: timestamp.nullable(),
    siopeMovementsEtag: text.nullable(),
    siopeRegistryEtag: text.nullable(),
    ipaEtag: text.nullable(),
    siopeMovementsSha256: sha256,
    siopeRegistrySha256: sha256,
    ipaSha256: sha256,
    observedAt: z.iso.datetime({ offset: true }),
    publicationDate: z.null(),
    acquisitionDate: z.iso.datetime({ offset: true }),
    checkedAt: z.iso.datetime({ offset: true }),
    license: z.literal("not-declared"),
  }).strict(),
  methodology: z.object({
    measure: text,
    periodicity: text,
    territorialJoin: text,
    populationSource: text,
    populationReference: text,
    populationSourceLastModified: timestamp.nullable(),
    perCapitaCoverage: text,
    warning: text,
  }).strict(),
}).strict();

const detailSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.literal("municipal-receipts-detail"),
  flow: z.literal("entrate"),
  unit: z.literal("EUR-cent"),
  accountingBasis: z.literal("cash"),
  year,
  latestMonth: month,
  generatedAt: timestamp,
  titleOrder: z.array(titleCode).length(9),
  titleLabels,
  columns: z.tuple([
    z.literal("taxCode"), z.literal("codiceIpa"), z.literal("name"), z.literal("province"),
    z.literal("region"), z.literal("population"), z.literal("totalCents"), z.literal("titleCents"),
  ]),
  coverage: z.object({
    activeMunicipalities: count.positive(),
    withMovements: count.positive(),
    withoutMovements: count,
    withPopulation: count,
    withRegion: count,
    withIpaIdentifier: count,
  }).strict(),
  municipalities: z.array(z.tuple([
    z.string().regex(/^\d{11}$/), z.string().regex(/^[A-Za-z0-9_]+$/).nullable(), text, text,
    region.nullable(), population, cents.nullable(), z.array(cents).length(9).nullable(),
  ])).min(1),
  methodology: z.object({ join: text, absence: text, amounts: text }).strict(),
}).strict();

export type SiopeMunicipalReceiptsSnapshot = z.infer<typeof summarySchema>;
export type SiopeMunicipalReceiptsDetail = z.infer<typeof detailSchema>;
export type SiopeReceiptsPeriod = {
  year: number;
  startMonth: 1;
  endMonth: number;
  completeness: "complete" | "partial";
};

export function siopeReceiptsPeriod(snapshot: { year: number; latestMonth: number; generatedAt: string }): SiopeReceiptsPeriod {
  return {
    year: snapshot.year,
    startMonth: 1,
    endMonth: snapshot.latestMonth,
    completeness: snapshot.latestMonth === 12 && new Date(snapshot.generatedAt).getUTCFullYear() > snapshot.year
      ? "complete" : "partial",
  };
}

function equal(actual: unknown, expected: unknown, field: string) {
  if (actual !== expected) throw new Error(`SIOPE entrate: ${field} non riconciliato`);
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => {
    const result = total + value;
    if (!Number.isSafeInteger(result)) throw new Error("SIOPE entrate: somma fuori intervallo sicuro");
    return result;
  }, 0);
}
const toCents = (value: number) => Math.round(value * 100);
function unique(values: readonly string[], field: string) {
  equal(new Set(values).size, values.length, field);
}
function perCapita(amount: number, residents: number | null): number | null {
  return residents ? Math.round(amount / residents) : null;
}

export function validateSiopeReceiptsArtifacts(rawSummary: unknown, rawDetail: unknown, expectedYear: number) {
  const snapshot = summarySchema.parse(rawSummary);
  const detail = detailSchema.parse(rawDetail);
  equal(snapshot.year, expectedYear, "anno snapshot");
  equal(detail.year, expectedYear, "anno dettaglio");
  equal(detail.latestMonth, snapshot.latestMonth, "periodo dettaglio");
  equal(snapshot.latestMonthLabel, MONTH_LABELS[snapshot.latestMonth - 1], "ultimo mese");
  const observation = new Date(snapshot.generatedAt);
  if (snapshot.year > observation.getUTCFullYear() ||
      (snapshot.year === observation.getUTCFullYear() && snapshot.latestMonth > observation.getUTCMonth() + 1)) {
    throw new Error("SIOPE entrate: periodo successivo all’osservazione");
  }
  equal(detail.generatedAt, snapshot.generatedAt, "acquisizione dettaglio");
  equal(snapshot.source.observedAt, snapshot.generatedAt, "osservazione");
  if (Date.parse(snapshot.source.acquisitionDate) > Date.parse(snapshot.source.observedAt) ||
      Date.parse(snapshot.source.checkedAt) < Date.parse(snapshot.source.acquisitionDate)) {
    throw new Error("SIOPE entrate: ordine delle date di provenienza non valido");
  }
  equal(snapshot.source.siopeMovementsUrl, `${SIOPE_BASE}/SIOPE_ENTRATE.${expectedYear}.zip`, "URL movimenti");
  equal(snapshot.methodology.populationSourceLastModified, snapshot.source.siopeRegistryLastModified, "fonte popolazione");
  equal(detail.titleOrder.join(","), SIOPE_RECEIPT_TITLE_ORDER.join(","), "ordine Titoli");
  for (const code of SIOPE_RECEIPT_TITLE_ORDER) {
    equal(detail.titleLabels[code as keyof typeof SIOPE_RECEIPT_TITLES], SIOPE_RECEIPT_TITLES[code as keyof typeof SIOPE_RECEIPT_TITLES], `etichetta Titolo ${code}`);
  }
  unique(snapshot.regions.map((row) => row.region), "Regioni duplicate");
  unique(snapshot.titles.map((row) => row.code), "Titoli duplicati");
  unique(detail.municipalities.map((row) => row[0]), "codici fiscali duplicati");
  unique(detail.municipalities.flatMap((row) => row[1] === null ? [] : [row[1]]), "codici IPA duplicati");

  const rows = detail.municipalities;
  for (const row of rows) {
    equal(row[6] === null, row[7] === null, `assenza ${row[0]}`);
    if (row[7] !== null) equal(sum(row[7]), row[6], `Titoli del Comune ${row[0]}`);
  }
  const observed = rows.filter((row) => row[6] !== null);
  const withPopulation = observed.filter((row) => row[5] !== null);
  const withoutRegion = observed.filter((row) => row[4] === null);
  const total = sum(observed.map((row) => row[6]!));
  equal(total, toCents(snapshot.totalCollected), "totale nazionale");
  equal(sum(withPopulation.map((row) => row[6]!)), toCents(snapshot.receiptsWithPopulation), "incassi con popolazione");
  equal(sum(withPopulation.map((row) => row[5]!)), snapshot.populationCovered, "popolazione");
  equal(snapshot.nationalPerCapita === null ? null : toCents(snapshot.nationalPerCapita),
    perCapita(toCents(snapshot.receiptsWithPopulation), snapshot.populationCovered), "pro capite nazionale");
  const coverage = snapshot.coverage;
  equal(rows.length, coverage.activeSiopeMunicipalities, "Comuni attivi");
  equal(observed.length, coverage.withMovements, "Comuni con movimenti");
  equal(withoutRegion.length, coverage.withoutRegion, "Comuni senza Regione");
  equal(observed.length - withoutRegion.length, coverage.withRegion, "Comuni con Regione");
  equal(sum(withoutRegion.map((row) => row[6]!)), toCents(coverage.receiptsWithoutRegion), "incassi senza Regione");
  equal(withPopulation.length, coverage.withPopulation, "Comuni con popolazione");
  equal(observed.length - withPopulation.length, coverage.withoutPopulation, "Comuni senza popolazione");
  equal(rows.filter((row) => row[4] !== null).length, coverage.matchedToIpaRegion, "join IPA");
  equal(rows.length - coverage.matchedToIpaRegion, coverage.unmatchedToIpaRegion, "join IPA assente");
  if (coverage.includedMovementRows > coverage.movementRows || coverage.includedMovementRows < observed.length) {
    throw new Error("SIOPE entrate: conteggi delle righe movimento non validi");
  }
  equal(detail.coverage.activeMunicipalities, rows.length, "copertura dettaglio");
  equal(detail.coverage.withMovements, observed.length, "movimenti dettaglio");
  equal(detail.coverage.withoutMovements, rows.length - observed.length, "assenze dettaglio");
  equal(detail.coverage.withPopulation, rows.filter((row) => row[5] !== null).length, "popolazione dettaglio");
  equal(detail.coverage.withRegion, coverage.matchedToIpaRegion, "Regioni dettaglio");
  equal(detail.coverage.withIpaIdentifier, rows.filter((row) => row[1] !== null).length, "identificativi IPA");

  equal(snapshot.monthly.length, snapshot.latestMonth, "copertura mesi consecutivi");
  let cumulative = 0;
  for (const [index, point] of snapshot.monthly.entries()) {
    equal(point.month, index + 1, "ordine mesi");
    equal(point.label, MONTH_LABELS[index], "etichetta mese");
    cumulative = sum([cumulative, toCents(point.flow)]);
    equal(toCents(point.cumulative), cumulative, "cumulato mensile");
  }
  equal(cumulative, total, "flussi mensili");
  equal(sum(snapshot.regions.map((row) => toCents(row.value))) + toCents(coverage.receiptsWithoutRegion), total, "totale Regioni");
  equal(sum(snapshot.titles.map((row) => toCents(row.value))), total, "totale Titoli");
  for (const item of snapshot.regions) {
    const regional = observed.filter((row) => row[4] === item.region);
    const covered = regional.filter((row) => row[5] !== null);
    equal(toCents(item.value), sum(regional.map((row) => row[6]!)), `totale ${item.region}`);
    equal(item.municipalities, regional.length, `Comuni ${item.region}`);
    equal(item.municipalitiesWithPopulation, covered.length, `copertura ${item.region}`);
    equal(item.population, covered.length ? sum(covered.map((row) => row[5]!)) : null, `popolazione ${item.region}`);
    equal(toCents(item.perCapitaValue), sum(covered.map((row) => row[6]!)), `numeratore ${item.region}`);
    equal(item.perCapita === null ? null : toCents(item.perCapita), perCapita(toCents(item.perCapitaValue), item.population), `pro capite ${item.region}`);
  }
  for (const [index, code] of detail.titleOrder.entries()) {
    const amount = sum(observed.map((row) => row[7]![index]));
    const title = snapshot.titles.find((row) => row.code === code);
    equal(title ? toCents(title.value) : 0, amount, `Titolo ${code}`);
    if (title) equal(title.label, detail.titleLabels[code], `etichetta Titolo ${code}`);
  }
  return { snapshot, detail };
}
