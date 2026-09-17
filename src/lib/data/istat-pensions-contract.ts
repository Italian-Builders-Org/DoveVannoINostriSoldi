import { createHash } from "node:crypto";
import { z } from "zod";

export const ISTAT_PENSION_YEARS = [
  2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022,
] as const;

export const ISTAT_PENSION_CATEGORIES = [
  "ALL", "OLSEN1", "SURV", "DISAB1", "CIVDIS", "NOCONT", "COMP", "WAR",
] as const;

export const istatPensionCategorySchema = z.enum(ISTAT_PENSION_CATEGORIES);
export type IstatPensionCategory = z.infer<typeof istatPensionCategorySchema>;

const yearSchema = z.number().int().min(2012).max(2022);
const positiveCountSchema = z.number().int().positive();
const nonNegativeAmountSchema = z.number().int().nonnegative();
const nonNegativeMeanSchema = z.number().finite().nonnegative();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const istatPensionTerritoryKindSchema = z.enum([
  "totale", "country", "ripartizione", "regione", "provincia", "estero", "non-indicato",
]);

/** ITTOT, ITS e ITNI non sono luoghi: il contratto li marca, non li deduce. */
export const ISTAT_PENSION_NON_GEOGRAPHIC = ["ITTOT", "ITS", "ITNI"] as const;

export const istatPensionTerritorySchema = z.object({
  code: z.string().min(2).max(6),
  label: z.string().min(1),
  kind: istatPensionTerritoryKindSchema,
  geographic: z.boolean(),
  depth: z.number().int().min(0).max(3).optional(),
  parent: z.string().min(2).nullable().optional(),
}).strict();

const territoryCodeSchema = z.string().min(2).max(6);

export const istatPensionBenefitObservationSchema = z.object({
  territory: territoryCodeSchema,
  year: yearSchema,
  pensionType: istatPensionCategorySchema,
  pensionCount: positiveCountSchema,
  grossAnnualThousandEuros: nonNegativeAmountSchema,
  grossAnnualMeanEuros: nonNegativeMeanSchema,
}).strict();

export const istatPensionerObservationSchema = z.object({
  territory: territoryCodeSchema,
  year: yearSchema,
  pensionType: z.literal("ALL"),
  pensionerCount: positiveCountSchema,
  grossAnnualThousandEuros: nonNegativeAmountSchema,
  grossAnnualMeanEuros: nonNegativeMeanSchema,
}).strict();

export const istatPensionAmountReconciliationSchema = z.object({
  territory: territoryCodeSchema,
  year: yearSchema,
  categoryCount: z.number().int().positive(),
  totalCount: z.number().int().positive(),
  categoryGrossAnnualThousandEuros: nonNegativeAmountSchema,
  totalGrossAnnualThousandEuros: nonNegativeAmountSchema,
  deltaThousandEuros: z.number().int(),
}).strict();

export const istatPensionsDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-pensions"),
  period: z.object({ from: z.literal(2012), to: z.literal(2022) }).strict(),
  territories: z.array(istatPensionTerritorySchema).length(142),
  territorialIdentities: z.array(z.object({
    whole: territoryCodeSchema,
    parts: z.array(territoryCodeSchema).min(2),
    // Esatte sui conteggi; sugli importi vale il limite di arrotondamento.
    exactOn: z.literal("conteggi"),
    amountRounding: z.string().min(1),
    note: z.string().min(1),
  }).strict()).length(2),
  territorialNotes: z.object({
    nonGeographic: z.array(territoryCodeSchema).length(3),
    overlapping: z.record(z.string(), z.array(territoryCodeSchema)),
    partialCoverage: z.string().min(1),
  }).strict(),
  // La copertura NON e uniforme fra i due asset.
  partialCoverage: z.object({
    pensionBenefits: z.record(z.string(), z.tuple([z.number().int(), z.number().int()])),
    pensioners: z.record(z.string(), z.tuple([z.number().int(), z.number().int()])),
  }).strict(),
  pensionBenefits: z.object({
    observations: z.array(istatPensionBenefitObservationSchema).length(12224),
    amountReconciliations: z.array(istatPensionAmountReconciliationSchema).min(1),
  }).strict(),
  pensioners: z.object({
    observations: z.array(istatPensionerObservationSchema).length(1537),
  }).strict(),
  caveats: z.object({
    amounts: z.string().min(1),
    invalidityOverlap: z.string().min(1),
    nominal: z.string().min(1),
    nonGeographic: z.string().min(1),
    partialCoverage: z.string().min(1),
    derivedMean: z.string().min(1),
  }).strict(),
}).strict();

const assetColumnsSchema = z.array(z.string().min(1)).min(1);
const sourceAssetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  dataflowId: z.string().min(1),
  dsd: z.string().min(1),
  url: z.string().url(),
  queryKey: z.string().min(1),
  accept: z.literal("application/vnd.sdmx.data+csv;version=1.0.0"),
  format: z.literal("SDMX-CSV 1.0.0"),
  encoding: z.literal("UTF-8"),
  delimiter: z.literal(","),
  lineEnding: z.literal("CRLF"),
  bytes: z.number().int().positive(),
  sha256: sha256Schema,
  rawHeaderSha256: sha256Schema,
  rows: z.number().int().positive(),
  referencePeriod: z.object({ from: z.literal(2012), to: z.literal(2022) }).strict(),
  // La copertura territoriale non e uniforme fra i due asset: le province sarde
  // soppresse chiudono nel 2016 sulle pensioni e nel 2017 sui pensionati.
  partialCoverage: z.record(z.string(), z.tuple([z.number().int(), z.number().int()])).optional(),
  observedAt: z.string().datetime({ offset: true }),
  columns: assetColumnsSchema,
}).strict();

export const istatPensionsMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-pensions"),
  period: z.object({ from: z.literal(2012), to: z.literal(2022) }).strict(),
  source: z.object({
    owner: z.literal("Istat"),
    landingUrl: z.string().url(),
    licenseStatus: z.literal("not-declared"),
    licenseNote: z.string().min(1),
    assets: z.object({
      pensionBenefits: sourceAssetSchema,
      pensioners: sourceAssetSchema,
    }).strict(),
  }).strict(),
  transformation: z.object({
    version: z.literal(1),
    description: z.string().min(1),
    pensionBenefitsRows: z.literal(12224),
    pensionerRows: z.literal(1537),
    units: z.object({
      grossAnnualThousandEuros: z.literal("migliaia di euro"),
      grossAnnualMeanEuros: z.literal("euro"),
      counts: z.literal("unità"),
    }).strict(),
  }).strict(),
  overlap: z.object({
    dataset: z.literal("inps_invalidita_civile"),
    relation: z.string().min(1),
    additive: z.literal(false),
  }).strict(),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.string().min(1),
    dataArtifact: z.object({
      path: z.literal("src/data/generated/istat-pensions-2012-2022.data.json"),
      bytes: z.number().int().positive(),
      sha256: sha256Schema,
    }).strict(),
    sourceLockSha256: sha256Schema,
  }).strict(),
}).strict();

export type IstatPensionBenefitObservation = z.infer<typeof istatPensionBenefitObservationSchema>;
export type IstatPensionerObservation = z.infer<typeof istatPensionerObservationSchema>;
export type IstatPensionAmountReconciliation = z.infer<typeof istatPensionAmountReconciliationSchema>;
export type IstatPensionsData = z.infer<typeof istatPensionsDataSchema>;
export type IstatPensionsMetadata = z.infer<typeof istatPensionsMetadataSchema>;

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Valore non serializzabile nel data artifact ISTAT pensioni");
}

/**
 * Limite derivato, non scelto: il totale e pubblicato in MIGLIAIA di euro
 * arrotondate, quindi l'incertezza sulla media vale 500/conteggio euro, piu mezzo
 * centesimo per l'arrotondamento della media stessa. Nazionalmente e strettissimo;
 * su una cella con poche pensioni si allarga quanto la fonte impone, e non oltre.
 */
function meanBound(count: number): number {
  return 500 / count + 0.005;
}

function validateDataInvariants(data: IstatPensionsData, ctx: z.RefinementCtx): void {
  const territories = new Map(data.territories.map((entry) => [entry.code, entry]));
  const nonGeographic = new Set(
    data.territories.filter((entry) => entry.geographic === false).map((entry) => entry.code),
  );
  for (const code of ISTAT_PENSION_NON_GEOGRAPHIC) {
    if (!nonGeographic.has(code)) {
      addIssue(ctx, ["territories"], `${code} non e un territorio e deve restare marcato come tale`);
    }
  }
  if (nonGeographic.size !== ISTAT_PENSION_NON_GEOGRAPHIC.length) {
    addIssue(ctx, ["territories"], "Codici non geografici inattesi");
  }

  const inCoverage = (scope: "pensionBenefits" | "pensioners", code: string, year: number): boolean => {
    const span = data.partialCoverage[scope][code];
    if (!span) return true;
    return year >= span[0] && year <= span[1];
  };

  const byCell = new Map<string, IstatPensionBenefitObservation>();
  const benefitKeys = new Set<string>();
  for (const [index, row] of data.pensionBenefits.observations.entries()) {
    const path = ["pensionBenefits", "observations", index];
    const key = `${row.territory}|${row.year}|${row.pensionType}`;
    if (benefitKeys.has(key)) addIssue(ctx, path, `Osservazione duplicata: ${key}`);
    benefitKeys.add(key);
    if (!territories.has(row.territory)) addIssue(ctx, path, `Territorio fuori anagrafica: ${row.territory}`);
    // La riforma sarda del 2016 e un fatto dichiarato: un territorio non puo
    // comparire fuori dalla propria finestra.
    if (!inCoverage("pensionBenefits", row.territory, row.year)) {
      addIssue(ctx, path, `${row.territory} fuori dalla copertura dichiarata nel ${row.year}`);
    }
    byCell.set(`${row.territory}|${row.year}|${row.pensionType}`, row);
    const expectedMean = row.grossAnnualThousandEuros * 1000 / row.pensionCount;
    if (Math.abs(expectedMean - row.grossAnnualMeanEuros) > meanBound(row.pensionCount)) {
      addIssue(ctx, path, "La media non riconcilia col totale oltre il limite di arrotondamento");
    }
  }

  const reconciliationKeys = new Set<string>();
  for (const [index, reconciliation] of data.pensionBenefits.amountReconciliations.entries()) {
    const path = ["pensionBenefits", "amountReconciliations", index];
    const key = `${reconciliation.territory}|${reconciliation.year}`;
    if (reconciliationKeys.has(key)) addIssue(ctx, path, `Riconciliazione duplicata: ${key}`);
    reconciliationKeys.add(key);
    if (reconciliation.categoryCount !== reconciliation.totalCount) {
      addIssue(ctx, path, "La somma delle categorie non coincide col totale pensioni");
    }
    if (Math.abs(reconciliation.deltaThousandEuros) > 2) {
      addIssue(ctx, path, "Delta importi oltre l'arrotondamento ammesso dalla fonte");
    }
    const total = byCell.get(`${reconciliation.territory}|${reconciliation.year}|ALL`);
    const categories = ISTAT_PENSION_CATEGORIES.slice(1)
      .map((category) => byCell.get(`${reconciliation.territory}|${reconciliation.year}|${category}`));
    if (!total || categories.some((row) => !row)) continue;
    const rows = categories as IstatPensionBenefitObservation[];
    const categoryCount = rows.reduce((sum, row) => sum + row.pensionCount, 0);
    const categoryAmount = rows.reduce((sum, row) => sum + row.grossAnnualThousandEuros, 0);
    if (
      reconciliation.categoryCount !== categoryCount ||
      reconciliation.categoryGrossAnnualThousandEuros !== categoryAmount ||
      reconciliation.totalCount !== total.pensionCount ||
      reconciliation.totalGrossAnnualThousandEuros !== total.grossAnnualThousandEuros ||
      reconciliation.deltaThousandEuros !== total.grossAnnualThousandEuros - categoryAmount
    ) {
      addIssue(ctx, path, "Riconciliazione non coerente con le righe");
    }
  }

  const expectedReconciliations = new Set(
    data.pensionBenefits.observations
      .filter((row) => row.pensionType === "ALL" && ISTAT_PENSION_CATEGORIES.every(
        (category) => benefitKeys.has(`${row.territory}|${row.year}|${category}`),
      ))
      .map((row) => `${row.territory}|${row.year}`),
  );
  if (reconciliationKeys.size !== expectedReconciliations.size
    || [...expectedReconciliations].some((key) => !reconciliationKeys.has(key))) {
    addIssue(ctx, ["pensionBenefits", "amountReconciliations"], "Riconciliazioni incomplete o fuori perimetro");
  }

  // Le identita territoriali: ESATTE sui conteggi, limite di arrotondamento sugli
  // importi. ITTOT non e l'Italia, ed e qui che la differenza diventa verificabile.
  for (const [index, identity] of data.territorialIdentities.entries()) {
    const path = ["territorialIdentities", index];
    const amountBound = Math.ceil((identity.parts.length + 1) / 2);
    for (const year of ISTAT_PENSION_YEARS) {
      const total = byCell.get(`${identity.whole}|${year}|ALL`);
      if (!total) continue;
      const pieces = identity.parts.map((part) => byCell.get(`${part}|${year}|ALL`));
      if (pieces.some((piece) => !piece)) {
        addIssue(ctx, path, `Identita ${identity.whole}: manca una parte nel ${year}`);
        continue;
      }
      const rows = pieces as IstatPensionBenefitObservation[];
      if (total.pensionCount !== rows.reduce((sum, row) => sum + row.pensionCount, 0)) {
        addIssue(ctx, path, `Identita ${identity.whole} non esatta sui conteggi nel ${year}`);
      }
      const delta = Math.abs(
        total.grossAnnualThousandEuros - rows.reduce((sum, row) => sum + row.grossAnnualThousandEuros, 0),
      );
      if (delta > amountBound) {
        addIssue(ctx, path, `Identita ${identity.whole}: scarto ${delta} migliaia nel ${year}, oltre l'arrotondamento`);
      }
    }
  }

  const pensionerKeys = new Set<string>();
  for (const [index, row] of data.pensioners.observations.entries()) {
    const path = ["pensioners", "observations", index];
    const key = `${row.territory}|${row.year}`;
    if (pensionerKeys.has(key)) addIssue(ctx, path, `Osservazione pensionati duplicata: ${key}`);
    pensionerKeys.add(key);
    if (!territories.has(row.territory)) addIssue(ctx, path, `Territorio fuori anagrafica: ${row.territory}`);
    if (!inCoverage("pensioners", row.territory, row.year)) {
      addIssue(ctx, path, `${row.territory} fuori dalla copertura dichiarata nel ${row.year}`);
    }
    const expectedMean = row.grossAnnualThousandEuros * 1000 / row.pensionerCount;
    if (Math.abs(expectedMean - row.grossAnnualMeanEuros) > meanBound(row.pensionerCount)) {
      addIssue(ctx, path, "La media pensionati non riconcilia oltre il limite di arrotondamento");
    }
  }
}

export const validatedIstatPensionsDataSchema = istatPensionsDataSchema.superRefine(validateDataInvariants);

export function validateIstatPensionsSnapshot(input: unknown): IstatPensionsData {
  return validatedIstatPensionsDataSchema.parse(input);
}

export function validateIstatPensionsMetadata(input: unknown): IstatPensionsMetadata {
  const metadata = istatPensionsMetadataSchema.parse(input);
  if (!metadata.source.landingUrl.startsWith("https://esploradati.istat.it/")) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "landingUrl"], message: "Landing URL ISTAT non ufficiale" }]);
  }
  const benefits = metadata.source.assets.pensionBenefits;
  const pensioners = metadata.source.assets.pensioners;
  if (benefits.id !== "istat-pension-benefits-2012-2022" || benefits.title !== "Istat - Pensioni (Casellario dei pensionati)" || pensioners.id !== "istat-pensioners-2012-2022" || pensioners.title !== "Istat - Pensionati (Casellario dei pensionati)") {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "assets"], message: "Titolo/ID sorgente non autorizzati" }]);
  }
  if (benefits.dataflowId !== "IT1,46_813,1.0" || benefits.dsd !== "DCAR_PENSIONI2" || pensioners.dataflowId !== "IT1,46_812,1.0" || pensioners.dsd !== "DCAR_PENSIONATI2") {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "assets"], message: "Dataflow/DSD ISTAT non autorizzati" }]);
  }
  const expectedBenefitsUrl = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,46_813,1.0/A..P_NSNU+ANP_NS+AMEP_NS.ALL+OLSEN1+SURV+DISAB1+CIVDIS+NOCONT+COMP+WAR.TOTAL.9.9.TOTAL.99";
  const expectedPensionersUrl = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,46_812,1.0/A..P_RSNU+ANP_RS+AMEP_RS.ALL.TOTAL.9.TOTAL";
  if (benefits.queryKey !== "A..P_NSNU+ANP_NS+AMEP_NS.ALL+OLSEN1+SURV+DISAB1+CIVDIS+NOCONT+COMP+WAR.TOTAL.9.9.TOTAL.99" || pensioners.queryKey !== "A..P_RSNU+ANP_RS+AMEP_RS.ALL.TOTAL.9.TOTAL" || benefits.url !== expectedBenefitsUrl || pensioners.url !== expectedPensionersUrl) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "assets"], message: "Query key ISTAT non autorizzata o wildcard" }]);
  }
  if (benefits.bytes !== 3035542 || benefits.sha256 !== "7c18d7a3c4c952a71913dda4d29b2529d8900753fb5ae04a50e031f0b4896f26" || pensioners.bytes !== 345803 || pensioners.sha256 !== "376d151aa54f7c282fede4a9980c1fe027746962f0def63ff566e74ea19ffdf1") {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "assets"], message: "Hash/byte size raw ISTAT non autorizzati" }]);
  }
  if (benefits.queryKey.toLowerCase().includes("all/") || pensioners.queryKey.toLowerCase() === "all" || benefits.queryKey.toLowerCase() === "all" || !benefits.url.endsWith(benefits.queryKey) || !pensioners.url.endsWith(pensioners.queryKey)) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "assets"], message: "Query wildcard non ammessa" }]);
  }
  return metadata;
}

export function validateIstatPensionsBundle(data: unknown, metadata: unknown): { data: IstatPensionsData; metadata: IstatPensionsMetadata } {
  const validatedMetadata = validateIstatPensionsMetadata(metadata);
  const serializedData = canonicalJson(data);
  const actualBytes = Buffer.byteLength(serializedData, "utf8");
  const actualSha256 = createHash("sha256").update(serializedData, "utf8").digest("hex");
  if (
    actualBytes !== validatedMetadata.integrity.dataArtifact.bytes ||
    actualSha256 !== validatedMetadata.integrity.dataArtifact.sha256
  ) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["integrity", "dataArtifact"],
      message: "Binding byte/SHA-256 del data artifact non valido",
    }]);
  }
  const validatedData = validateIstatPensionsSnapshot(data);
  return { data: validatedData, metadata: validatedMetadata };
}
