import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const year = z.number().int().min(1900).max(9999).nullable();
const money = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .max(100)
  .nullable();
const operatorRef = z.string().regex(/^op-\d{8}$/);
const authorityRef = z.string().regex(/^authority-\d{8}$/);
const text = z.string().max(500).nullable();

function amountMatchesStatus(value: string | null, status: string): boolean {
  if (["missing", "invalid", "conflicting"].includes(status))
    return value === null;
  if (value === null) return false;
  const nonzero = /[1-9]/.test(value);
  if (status === "zero") return !nonzero;
  return (
    nonzero &&
    (status === "negative" ? value.startsWith("-") : !value.startsWith("-"))
  );
}

export const historyProcedureSchema = z
  .object({
    cigYear: z.number().int().min(2007).max(2025),
    prevalent: z.boolean(),
    state: text,
    lotAmount: money,
    lotAmountStatus: z.enum([
      "positive",
      "zero",
      "negative",
      "missing",
      "invalid",
    ]),
    category: text,
    procedure: text,
    realization: text,
    description: text,
    cpvCode: text,
    cpvLabel: text,
    authorityRef: authorityRef.nullable(),
    authorityLabel: text,
  })
  .strict()
  .refine(
    (row) => amountMatchesStatus(row.lotAmount, row.lotAmountStatus),
    "Stato importo lotto incoerente",
  );

export const historyAwardSchema = z
  .object({
    cig: z.string().regex(/^[A-Z0-9]{10}$/),
    awardId: z.string().regex(/^\d+$/).max(100),
    awardedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    amount: money,
    amountStatus: z.enum([
      "positive-exact-cent",
      "positive-subcent",
      "zero",
      "negative",
      "missing",
      "invalid",
      "conflicting",
    ]),
    attribution: z.enum(["single-operator", "multipart"]),
    procedure: historyProcedureSchema.nullable(),
  })
  .strict()
  .refine(
    (row) => amountMatchesStatus(row.amount, row.amountStatus),
    "Stato importo aggiudicazione incoerente",
  );

export const historyBlockSchema = z
  .object({
    ref: operatorRef,
    start: count,
    awards: z.array(historyAwardSchema).min(1).max(100),
  })
  .strict();

export const historySummarySchema = z
  .object({
    ref: operatorRef,
    name: z.string().min(1).max(1000),
    nameVariants: count.positive(),
    awardCount: count.positive(),
    yearMin: year,
    yearMax: year,
    attributedAwardCount: count,
    attributedValue: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .max(100),
    yearly: z
      .array(
        z
          .object({
            year,
            awardCount: count.positive(),
            attributedAwardCount: count,
            attributedValue: z
              .string()
              .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
              .max(100)
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    distinctContractingAuthorityCount: count,
    awardsWithoutAuthority: count,
    awardsWithoutCigMatch: count,
    authorities: z.array(
      z
        .object({
          ref: authorityRef,
          label: text,
          awardCount: count.positive(),
        })
        .strict(),
    ),
    screening2025: z
      .object({
        matchedCigs: count,
        classifiableCigs: count,
        below140000: count,
        band135000To140000: count,
        directBelow140000: count,
        missingProcedureBelow140000: count,
        excludedCigs: count,
      })
      .strict(),
    detail: z
      .object({
        blockSize: z.literal(100),
        blocks: z.array(
          z
            .object({
              offset: count,
              bytes: count.positive().max(1_048_576),
              rows: count.positive().max(100),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict(),
        ),
        filterRows: z.array(
          z.tuple([year, authorityRef.nullable(), text, money]),
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      record.yearly.reduce((sum, row) => sum + row.awardCount, 0) !==
        record.awardCount ||
      new Set(record.yearly.map((row) => row.year)).size !==
        record.yearly.length
    )
      fail("Serie annuale non riconciliata");
    if (
      record.yearly.reduce((sum, row) => sum + row.attributedAwardCount, 0) !==
      record.attributedAwardCount
    )
      fail("Conteggio attribuibile non riconciliato");
    for (const row of record.yearly) {
      if (
        row.attributedAwardCount > row.awardCount ||
        (row.attributedAwardCount === 0) !== (row.attributedValue === null)
      )
        fail("Valore attribuibile annuale incoerente");
    }
    const values = record.yearly.map((row) => row.attributedValue ?? "0");
    const allValues = [...values, record.attributedValue];
    if (
      allValues.length <= 201 &&
      allValues.every(
        (value) =>
          value.length <= 100 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value),
      )
    ) {
      const scale = Math.max(
        ...allValues.map((value) => (value.split(".")[1] ?? "").length),
      );
      const units = (value: string) => {
        const [whole, fraction = ""] = value.split(".");
        return BigInt(whole + fraction.padEnd(scale, "0"));
      };
      if (
        values.reduce((sum, value) => sum + units(value), BigInt(0)) !==
        units(record.attributedValue)
      )
        fail("Valore totale non riconciliato con gli anni");
    }

    if (
      record.authorities.length !== record.distinctContractingAuthorityCount ||
      new Set(record.authorities.map((row) => row.ref)).size !==
        record.authorities.length ||
      record.authorities.reduce((sum, row) => sum + row.awardCount, 0) +
        record.awardsWithoutAuthority !==
        record.awardCount ||
      record.awardsWithoutCigMatch > record.awardsWithoutAuthority
    )
      fail("Copertura enti non riconciliata");
    const screening = record.screening2025;
    if (
      screening.classifiableCigs + screening.excludedCigs !==
        screening.matchedCigs ||
      screening.matchedCigs > record.awardCount ||
      screening.below140000 > screening.classifiableCigs ||
      screening.band135000To140000 > screening.below140000 ||
      screening.directBelow140000 + screening.missingProcedureBelow140000 >
        screening.below140000
    )
      fail("Screening CIG non riconciliato");
    if (
      record.detail.filterRows.length !== record.awardCount ||
      record.detail.blocks.reduce((sum, block) => sum + block.rows, 0) !==
        record.awardCount ||
      record.detail.blocks.some(
        (block, i, blocks) => i < blocks.length - 1 && block.rows !== 100,
      )
    )
      fail("Paginazione incompleta");
    for (let i = 1; i < record.detail.blocks.length; i++) {
      const previous = record.detail.blocks[i - 1];
      if (record.detail.blocks[i].offset !== previous.offset + previous.bytes)
        fail("Blocchi non contigui");
    }
  });

export type OperatorHistorySummary = z.infer<typeof historySummarySchema>;
export type OperatorHistoryAward = z.infer<typeof historyAwardSchema>;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z
  .object({ id: z.string().regex(/^[a-f0-9]{2}$/), bytes: count, sha256: hash })
  .strict();
export const historyManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataset: z.literal("anac-operator-history"),
    observedAt: z.string().datetime(),
    generatedAt: z.string().datetime(),
    totals: z.object({ operators: count, awardRelations: count }).strict(),
    coverage: z
      .object({
        rows: count,
        prevalentRows: count,
        matchedCigs: count,
        conflictingCigs: count,
      })
      .strict(),
    sourceIndexSha256: hash,
    sourceCigSpecSha256: hash,
    shards: z.array(fileSchema).length(256),
    packs: z.array(fileSchema).length(256),
  })
  .strict();
