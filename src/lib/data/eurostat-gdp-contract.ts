import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const nonNegativeInt = z.number().int().nonnegative();
const finiteInt = z.number().int().finite();

const quarterlyObservationSchema = z.object({
  period: z.string().regex(/^\d{4}-Q[1-4]$/),
  nominalMillionEuroTenths: finiteInt,
  realMillionEuroTenths: finiteInt,
  yoyGrowthTenths: finiteInt,
  qoqGrowthTenths: finiteInt,
  finalConsumptionShareTenths: finiteInt,
  grossFixedCapitalFormationShareTenths: finiteInt,
  exportsShareTenths: finiteInt,
  importsShareTenths: finiteInt,
  flags: z.record(z.string(), nonEmptyString).optional(),
});

const peerObservationSchema = z.object({
  geo: z.enum(["DE", "ES", "FR", "IT"]),
  period: z.string().regex(/^\d{4}-Q[1-4]$/),
  yoyGrowthTenths: finiteInt,
  flag: nonEmptyString.optional(),
});

const annualObservationSchema = z.object({
  period: z.string().regex(/^\d{4}$/),
  nominalMillionEuroTenths: finiteInt,
  realMillionEuroTenths: finiteInt,
  yoyGrowthTenths: finiteInt,
  flags: z.record(z.string(), nonEmptyString).optional(),
});

export const eurostatGdpDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("eurostat-gdp"),
    period: z.object({
      quarterly: z.object({ from: nonEmptyString, to: nonEmptyString }),
      annual: z.object({ from: nonEmptyString, to: nonEmptyString }),
      peers: z.object({ from: nonEmptyString, to: nonEmptyString }),
    }),
    caveats: z.array(nonEmptyString).min(4),
    flags: z.array(nonEmptyString),
    units: z.object({
      levels: z.literal("tenths of million euro"),
      growth: z.literal("tenths of a percentage point"),
      shares: z.literal("tenths of a percentage point of GDP"),
    }),
    geographies: z
      .array(
        z.object({
          code: z.enum(["IT", "FR", "DE", "ES"]),
          label: nonEmptyString,
          kind: z.literal("country"),
        }),
      )
      .min(4),
    quarterlyObservations: z.array(quarterlyObservationSchema).min(1),
    peerObservations: z.array(peerObservationSchema).min(1),
    annualObservations: z.array(annualObservationSchema).min(1),
    coverage: z.object({
      expectedCells: nonNegativeInt,
      observedCells: nonNegativeInt,
      flaggedCells: nonNegativeInt,
    }),
  })
  .superRefine((data, context) => {
    if (data.coverage.expectedCells !== data.coverage.observedCells) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "eurostat-gdp: copertura incompleta",
      });
    }
    const quarters = data.quarterlyObservations.map((row) => row.period);
    if (quarters[0] !== data.period.quarterly.from || quarters.at(-1) !== data.period.quarterly.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "eurostat-gdp: estremi trimestrali divergenti",
      });
    }
  });

export const eurostatGdpMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-gdp"),
  period: eurostatGdpDataSchema.shape.period,
  referencePeriod: nonEmptyString,
  observedAt: nonEmptyString,
  source: z.object({
    owner: nonEmptyString,
    landingUrl: z.string().url(),
    annualLandingUrl: z.string().url(),
    informationUrl: z.string().url(),
    licenseId: z.literal("CC-BY-4.0"),
    licenseNote: nonEmptyString,
    termsUrl: z.string().url(),
    acquisition: z.object({
      acquiredAt: nonEmptyString,
      checkedAt: nonEmptyString,
    }),
    assets: z.record(z.string(), z.object({
      filename: nonEmptyString,
      datasetCode: nonEmptyString,
      url: z.string().url(),
      bytes: nonNegativeInt,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sourceUpdated: nonEmptyString,
      structure: z.object({
        id: nonEmptyString,
        agencyId: z.literal("ESTAT"),
        version: nonEmptyString,
      }),
    })),
  }),
  coverage: z.object({
    observedAt: nonEmptyString,
    note: nonEmptyString,
  }),
  semantics: z.object({
    soldi: z.object({
      applicable: z.literal(true),
      unit: nonEmptyString,
      nature: nonEmptyString,
      note: nonEmptyString,
    }),
    periodo: z.object({
      referencePeriod: nonEmptyString,
      note: nonEmptyString,
    }),
    provenance: z.object({
      holder: nonEmptyString,
      canonicalUrls: z.array(z.string().url()).min(3),
      publicationDate: nonEmptyString,
      acquisitionDate: nonEmptyString,
      checkedAt: nonEmptyString,
      license: z.literal("CC-BY-4.0"),
      hashes: nonEmptyString,
    }),
  }),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: nonEmptyString,
    dataArtifact: z.object({
      path: z.literal("src/data/generated/eurostat-gdp-2015-2026.data.json"),
      bytes: nonNegativeInt,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    sourceLockSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export type EurostatGdpData = z.infer<typeof eurostatGdpDataSchema>;
export type EurostatGdpMetadata = z.infer<typeof eurostatGdpMetadataSchema>;

export function validateEurostatGdpData(value: unknown): EurostatGdpData {
  return eurostatGdpDataSchema.parse(value);
}

export function validateEurostatGdpMetadata(value: unknown): EurostatGdpMetadata {
  return eurostatGdpMetadataSchema.parse(value);
}
