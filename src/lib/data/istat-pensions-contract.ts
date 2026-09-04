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

export const istatPensionBenefitObservationSchema = z.object({
  year: yearSchema,
  pensionType: istatPensionCategorySchema,
  pensionCount: positiveCountSchema,
  grossAnnualThousandEuros: nonNegativeAmountSchema,
  grossAnnualMeanEuros: nonNegativeMeanSchema,
}).strict();

export const istatPensionerObservationSchema = z.object({
  year: yearSchema,
  pensionType: z.literal("ALL"),
  pensionerCount: positiveCountSchema,
  grossAnnualThousandEuros: nonNegativeAmountSchema,
  grossAnnualMeanEuros: nonNegativeMeanSchema,
}).strict();

export const istatPensionAmountReconciliationSchema = z.object({
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
  pensionBenefits: z.object({
    observations: z.array(istatPensionBenefitObservationSchema).length(88),
    amountReconciliations: z.array(istatPensionAmountReconciliationSchema).length(11),
  }).strict(),
  pensioners: z.object({
    observations: z.array(istatPensionerObservationSchema).length(11),
  }).strict(),
  caveats: z.object({
    amounts: z.string().min(1),
    invalidityOverlap: z.string().min(1),
    nominal: z.string().min(1),
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
    pensionBenefitsRows: z.literal(88),
    pensionerRows: z.literal(11),
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

function validateDataInvariants(data: IstatPensionsData, ctx: z.RefinementCtx): void {
  const expectedYears = new Set(ISTAT_PENSION_YEARS);
  const benefitKeys = new Set<string>();
  const byYearCategory = new Map<string, IstatPensionBenefitObservation>();

  for (const [index, row] of data.pensionBenefits.observations.entries()) {
    const key = `${row.year}|${row.pensionType}`;
    if (benefitKeys.has(key)) addIssue(ctx, ["pensionBenefits", "observations", index], `Osservazione duplicata: ${key}`);
    benefitKeys.add(key);
    byYearCategory.set(key, row);
    const expectedMean = row.grossAnnualThousandEuros * 1000 / row.pensionCount;
    if (Math.abs(expectedMean - row.grossAnnualMeanEuros) > 0.01) {
      addIssue(ctx, ["pensionBenefits", "observations", index], "La media non riconcilia con totale lordo e conteggio");
    }
  }

  const expectedBenefitKeys = new Set(
    ISTAT_PENSION_YEARS.flatMap((year) => ISTAT_PENSION_CATEGORIES.map((category) => `${year}|${category}`)),
  );
  if (benefitKeys.size !== expectedBenefitKeys.size || [...expectedBenefitKeys].some((key) => !benefitKeys.has(key))) {
    addIssue(ctx, ["pensionBenefits", "observations"], "Copertura pensioni incompleta o con categorie/anni inattesi");
  }

  const reconciliationsByYear = new Map<number, IstatPensionAmountReconciliation>();
  for (const [index, reconciliation] of data.pensionBenefits.amountReconciliations.entries()) {
    if (reconciliationsByYear.has(reconciliation.year)) {
      addIssue(ctx, ["pensionBenefits", "amountReconciliations", index], `Riconciliazione duplicata: ${reconciliation.year}`);
    }
    reconciliationsByYear.set(reconciliation.year, reconciliation);
    if (reconciliation.categoryCount !== reconciliation.totalCount) {
      addIssue(ctx, ["pensionBenefits", "amountReconciliations", index], "La somma delle categorie non coincide col totale pensioni");
    }
    if (Math.abs(reconciliation.deltaThousandEuros) > 2) {
      addIssue(ctx, ["pensionBenefits", "amountReconciliations", index], "Delta importi oltre l'arrotondamento ammesso dalla fonte");
    }
    const categories = ISTAT_PENSION_CATEGORIES.slice(1).map((category) => byYearCategory.get(`${reconciliation.year}|${category}`));
    const total = byYearCategory.get(`${reconciliation.year}|ALL`);
    if (!total || categories.some((row) => !row)) continue;
    const categoryRows = categories as IstatPensionBenefitObservation[];
    const categoryCount = categoryRows.reduce((sum, row) => sum + row.pensionCount, 0);
    const categoryAmount = categoryRows.reduce((sum, row) => sum + row.grossAnnualThousandEuros, 0);
    if (reconciliation.categoryCount !== categoryCount || reconciliation.categoryGrossAnnualThousandEuros !== categoryAmount || reconciliation.totalCount !== total.pensionCount || reconciliation.totalGrossAnnualThousandEuros !== total.grossAnnualThousandEuros || reconciliation.deltaThousandEuros !== total.grossAnnualThousandEuros - categoryAmount) {
      addIssue(ctx, ["pensionBenefits", "amountReconciliations", reconciliation.year], "Riconciliazione non coerente con le righe");
    }
  }
  if (reconciliationsByYear.size !== expectedYears.size || [...expectedYears].some((year) => !reconciliationsByYear.has(year))) {
    addIssue(ctx, ["pensionBenefits", "amountReconciliations"], "Riconciliazioni incomplete");
  }

  const pensionerYears = new Set<number>();
  for (const [index, row] of data.pensioners.observations.entries()) {
    if (pensionerYears.has(row.year)) addIssue(ctx, ["pensioners", "observations", index], `Osservazione pensionati duplicata: ${row.year}`);
    pensionerYears.add(row.year);
    const expectedMean = row.grossAnnualThousandEuros * 1000 / row.pensionerCount;
    if (Math.abs(expectedMean - row.grossAnnualMeanEuros) > 0.01) {
      addIssue(ctx, ["pensioners", "observations", index], "La media pensionati non riconcilia con totale lordo e conteggio");
    }
  }
  if (pensionerYears.size !== expectedYears.size || [...expectedYears].some((year) => !pensionerYears.has(year))) {
    addIssue(ctx, ["pensioners", "observations"], "Copertura pensionati incompleta");
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
  const expectedBenefitsUrl = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,46_813,1.0/A.IT.P_NSNU+ANP_NS+AMEP_NS.ALL+OLSEN1+SURV+DISAB1+CIVDIS+NOCONT+COMP+WAR.TOTAL.9.9.TOTAL.99";
  const expectedPensionersUrl = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,46_812,1.0/A.IT.P_RSNU+ANP_RS+AMEP_RS.ALL.TOTAL.9.TOTAL";
  if (benefits.queryKey !== "A.IT.P_NSNU+ANP_NS+AMEP_NS.ALL+OLSEN1+SURV+DISAB1+CIVDIS+NOCONT+COMP+WAR.TOTAL.9.9.TOTAL.99" || pensioners.queryKey !== "A.IT.P_RSNU+ANP_RS+AMEP_RS.ALL.TOTAL.9.TOTAL" || benefits.url !== expectedBenefitsUrl || pensioners.url !== expectedPensionersUrl) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["source", "assets"], message: "Query key ISTAT non autorizzata o wildcard" }]);
  }
  if (benefits.bytes !== 21835 || benefits.sha256 !== "e6479f690a4030dfbab3a19b07b8822ffc5d553bfaa94b70165ea81c0d0b1325" || pensioners.bytes !== 2685 || pensioners.sha256 !== "1d11b46a3cf52456766487b566d3a371a36b32d15c3a79a7631ef146716fbd72") {
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
