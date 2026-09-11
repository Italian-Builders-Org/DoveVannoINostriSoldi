import { z } from "zod";

const OFFICIAL_API_PREFIX = "https://sdmx.oecd.org/";
const OFFICIAL_OECD_PREFIX = "https://www.oecd.org/";
const OFFICIAL_DOI_PREFIX = "https://doi.org/";
const OFFICIAL_CC_PREFIX = "https://creativecommons.org/";
const OFFICIAL_EXPLORER_PREFIX = "https://data-explorer.oecd.org/";

const officialApiUrl = z.string().refine((url) => url.startsWith(OFFICIAL_API_PREFIX), "URL API OECD non ufficiale");
const officialOecdUrl = z.string().refine((url) => url.startsWith(OFFICIAL_OECD_PREFIX), "URL OECD non ufficiale");
const officialDoiUrl = z.string().refine((url) => url.startsWith(OFFICIAL_DOI_PREFIX), "DOI non ufficiale");
const officialCcUrl = z.string().refine((url) => url.startsWith(OFFICIAL_CC_PREFIX), "URL licenza non ufficiale");
const officialExplorerUrl = z
  .string()
  .refine((url) => url.startsWith(OFFICIAL_EXPLORER_PREFIX), "URL Data Explorer non ufficiale");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const year = z.number().int().min(2000).max(2025);
const signedInt = z.number().int().safe();

const geographyCode = z.enum(["ITA", "FRA", "DEU", "ESP", "OECD_REP"]);
const measureCode = z.enum(["AV_TW", "AV_ITR", "AV_R_EMPEE_SSC", "AV_R_EMPER_SSC", "AV_RITEESSC", "NPATR"]);

const italyObservation = z
  .object({
    year,
    taxWedgeMillionths: signedInt,
    incomeTaxMillionths: signedInt,
    employeeSscMillionths: signedInt,
    employerSscMillionths: signedInt,
    incomeTaxAndEmployeeSscMillionths: signedInt,
    netPersonalAverageTaxMillionths: signedInt,
    lowWageTaxWedgeMillionths: signedInt,
  })
  .strict();

const peerObservation = z
  .object({
    geo: geographyCode,
    year,
    taxWedgeMillionths: signedInt,
  })
  .strict();

export const oecdTaxingWagesDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("oecd-taxing-wages"),
    period: z
      .object({
        from: z.literal(2000),
        to: z.literal(2025),
        peersFrom: z.literal(2015),
        peersTo: z.literal(2025),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(5),
    units: z
      .object({
        taxWedgeMillionths: z.string().min(1),
        componentMillionths: z.string().min(1),
      })
      .strict(),
    profile: z
      .object({
        householdType: z.literal("S_C0"),
        householdLabel: z.literal("Single person without children"),
        incomePrincipal: z.literal("AW100"),
        incomeSpouse: z.literal("_Z"),
        frequency: z.literal("A"),
      })
      .strict(),
    lowWageProfile: z
      .object({
        householdType: z.literal("S_C0"),
        incomePrincipal: z.literal("AW67"),
        incomeSpouse: z.literal("_Z"),
      })
      .strict(),
    geographies: z
      .array(
        z
          .object({
            code: geographyCode,
            label: z.string().min(1),
            kind: z.enum(["country", "aggregate"]),
          })
          .strict(),
      )
      .length(5),
    measures: z
      .array(
        z
          .object({
            code: measureCode,
            label: z.string().min(1),
            unit: z.enum(["PT_COS_LB", "PT_WG_EARN_G"]),
          })
          .strict(),
      )
      .length(6),
    italyObservations: z.array(italyObservation).length(26),
    peerObservations: z.array(peerObservation).length(55),
    coverage: z
      .object({
        expectedCells: z.literal(237),
        observedCells: z.literal(237),
        italyYears: z.literal(26),
        peerYears: z.literal(11),
        peerGeographies: z.literal(5),
      })
      .strict(),
    reconciliation: z
      .object({
        toleranceMillionths: z.literal(1),
        gapByYearMillionths: z.record(z.string(), signedInt),
        note: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const asset = z
  .object({
    filename: z.string().min(1),
    url: officialApiUrl,
    bytes: z.number().int().positive(),
    sha256,
    format: z.literal("sdmx-csv-with-labels"),
    note: z.string().min(1),
  })
  .strict();

export const oecdTaxingWagesMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("oecd-taxing-wages"),
    period: oecdTaxingWagesDataSchema.shape.period,
    referencePeriod: z.string().min(1),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.literal("OECD"),
        landingUrl: officialOecdUrl,
        dataExplorerUrl: officialExplorerUrl,
        apiHost: officialApiUrl,
        agencyId: z.literal("OECD.CTP.TPS"),
        dataflowId: z.literal("DSD_TAX_WAGES_COMP@DF_TW_COMP"),
        dataflowVersion: z.literal("2.1"),
        datasetLabel: z.string().min(1),
        publication: z
          .object({
            title: z.literal("Taxing Wages 2025"),
            doi: officialDoiUrl,
            citation: z.string().min(1),
          })
          .strict(),
        licenseId: z.literal("CC-BY-4.0"),
        licenseNote: z.string().min(1),
        termsUrl: officialCcUrl,
        oecdTermsUrl: officialOecdUrl,
        acquisition: z
          .object({
            acquiredAt: isoDate,
            checkedAt: isoDate,
            note: z.string().min(1),
          })
          .strict(),
        assets: z
          .object({
            "italy-wedge-aw100": asset,
            "italy-components-aw100": asset,
            "peers-wedge-aw100": asset,
            "italy-wedge-aw67": asset,
          })
          .strict(),
      })
      .strict(),
    semantics: z
      .object({
        soldi: z
          .object({
            applicable: z.literal(false),
            unit: z.literal("non applicabile"),
            nature: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        periodo: z
          .object({
            referencePeriod: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        provenance: z
          .object({
            holder: z.literal("OECD"),
            license: z.literal("CC-BY-4.0"),
            publicationDate: z.null(),
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            canonicalUrls: z.array(z.string().url()).min(3),
          })
          .strict(),
      })
      .strict(),
    coverage: oecdTaxingWagesDataSchema.shape.coverage,
    reconciliation: oecdTaxingWagesDataSchema.shape.reconciliation,
    integrity: z
      .object({
        sourceLockSha256: sha256,
        dataSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type OecdTaxingWagesData = z.infer<typeof oecdTaxingWagesDataSchema>;
export type OecdTaxingWagesMetadata = z.infer<typeof oecdTaxingWagesMetadataSchema>;
export type OecdTaxingWagesGeographyCode = z.infer<typeof geographyCode>;

export function validateOecdTaxingWagesData(value: unknown): OecdTaxingWagesData {
  const data = oecdTaxingWagesDataSchema.parse(value);
  const years = data.italyObservations.map((row) => row.year);
  if (years.length !== 26 || years[0] !== 2000 || years.at(-1) !== 2025) {
    throw new Error("oecd-taxing-wages: anni Italia incompleti");
  }
  for (let index = 1; index < years.length; index += 1) {
    if (years[index] !== years[index - 1]! + 1) {
      throw new Error("oecd-taxing-wages: anni Italia non contigui");
    }
  }
  for (const [yearKey, gap] of Object.entries(data.reconciliation.gapByYearMillionths)) {
    if (Math.abs(gap) > data.reconciliation.toleranceMillionths) {
      throw new Error(`oecd-taxing-wages: gap ${yearKey} oltre tolleranza`);
    }
  }
  return data;
}

export function validateOecdTaxingWagesMetadata(value: unknown): OecdTaxingWagesMetadata {
  return oecdTaxingWagesMetadataSchema.parse(value);
}
