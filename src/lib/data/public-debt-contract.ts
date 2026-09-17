import { z } from "zod";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const TOLERANCE_CENTS = 10_000_000;
const HOLDER_SHARE_TOLERANCE_BASIS_POINTS = 5;
const money = z.number().int().min(-MAX_SAFE).max(MAX_SAFE);
const nonnegativeMoney = money.nonnegative();
const basisPoints = z.number().int().min(0).max(10_000);
const isoDate = z.iso.date();
const timestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/, "timestamp ISO atteso")
  .refine((value) => Number.isFinite(Date.parse(value)), "timestamp ISO atteso");
const utcTimestamp = timestamp.refine((value) => value.endsWith("Z"), "timestamp UTC atteso");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS atteso");
const officialUrl = (hostname: string, pathname: string) => httpsUrl.refine((value) => {
  const url = new URL(value);
  return url.hostname === hostname && url.pathname === pathname;
}, "URL ufficiale atteso");

const bankSourceSchema = z.object({
  id: z.literal("bancaditalia"),
  owner: z.literal("Banca d'Italia"),
  title: z.literal("Finanza pubblica: fabbisogno e debito"),
  landingUrl: officialUrl("www.bancaditalia.it", "/pubblicazioni/finanza-pubblica/index.html"),
  bdsUrl: officialUrl("www.bancaditalia.it", "/statistiche/basi-dati/bds/"),
  termsUrl: officialUrl("www.bancaditalia.it", "/statistiche/condizioni-utilizzo/"),
  retrievedAt: utcTimestamp,
  cadence: z.literal("mensile"),
  expectedLagDays: z.literal(45),
  cubes: z.array(z.object({
    id: z.enum(["TCCE0125", "TCCE0175", "TCCE0200", "TCCE0325"]),
    exportUrl: httpsUrl.refine((value) => new URL(value).hostname === "a2a.bancaditalia.it"),
    bytes: z.number().int().positive().safe(),
    sha256,
  }).strict()).length(4),
}).strict();

const eurostatSourceSchema = z.object({
  id: z.literal("eurostat"),
  owner: z.literal("Eurostat"),
  title: z.literal("Government revenue, expenditure and main aggregates"),
  datasetCode: z.literal("gov_10a_main"),
  datasetUrl: officialUrl("ec.europa.eu", "/eurostat/databrowser/view/gov_10a_main/default/table"),
  apiUrl: httpsUrl.refine((value) => {
    const url = new URL(value);
    return url.hostname === "ec.europa.eu" && url.pathname === "/eurostat/api/dissemination/statistics/1.0/data/gov_10a_main";
  }),
  termsUrl: officialUrl("ec.europa.eu", "/eurostat/web/main/help/copyright-notice"),
  retrievedAt: utcTimestamp,
  upstreamUpdatedAt: timestamp,
  cadence: z.literal("annuale"),
  bytes: z.number().int().positive().safe(),
  sha256,
}).strict();

const historyPointSchema = z.object({ referenceDate: isoDate, totalCents: nonnegativeMoney }).strict();
const annualPointSchema = z.object({
  year: z.number().int().min(1900),
  interestExpenseCents: nonnegativeMoney.positive(),
  totalGovernmentExpenditureCents: nonnegativeMoney.positive(),
  interestShareBasisPoints: basisPoints,
}).strict();

function monthIndex(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function shareBasisPoints(numerator: number, denominator: number) {
  return Number((BigInt(numerator) * BigInt(10_000) + BigInt(denominator) / BigInt(2)) / BigInt(denominator));
}

function issue(context: z.RefinementCtx, message: string, path: PropertyKey[] = []) {
  context.addIssue({ code: "custom", message, path });
}

export const publicDebtSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.object({ bancaditalia: bankSourceSchema, eurostat: eurostatSourceSchema }).strict(),
  stock: z.object({
    referenceDate: isoDate,
    totalCents: nonnegativeMoney,
    previousMonthCents: nonnegativeMoney,
    changeCents: money,
    history: z.array(historyPointSchema).length(13),
    instruments: z.object({
      currencyAndDepositsCents: nonnegativeMoney,
      securitiesCents: nonnegativeMoney,
      loansAndOtherLiabilitiesCents: nonnegativeMoney,
    }).strict(),
  }).strict(),
  change: z.object({
    referenceDate: isoDate,
    borrowingRequirementCents: money,
    debtInstrumentTransactionsCents: money,
    rawLiquidityChangeCents: money,
    liquidityContributionCents: money,
    otherEffectsCents: money,
    netShortTermSecuritiesCents: money,
    netMediumLongTermSecuritiesCents: money,
  }).strict(),
  holders: z.object({
    referenceDate: isoDate,
    totalCents: nonnegativeMoney,
    sectors: z.array(z.object({
      id: z.enum(["bankitalia", "other-mfi", "other-financial", "other-residents", "non-residents"]),
      label: z.string().min(1),
      amountCents: nonnegativeMoney,
      shareBasisPoints: basisPoints,
    }).strict()).length(5),
  }).strict(),
  residualMaturity: z.object({
    referenceDate: isoDate,
    totalCents: nonnegativeMoney,
    upToOneYearCents: nonnegativeMoney,
    oneToFiveYearsCents: nonnegativeMoney,
    overFiveYearsCents: nonnegativeMoney,
    averageYears: z.number().positive().finite(),
  }).strict(),
  annualInterest: z.object({
    referenceYear: z.number().int().min(1900),
    previousYear: z.number().int().min(1900),
    interestExpenseCents: nonnegativeMoney.positive(),
    previousInterestExpenseCents: nonnegativeMoney.positive(),
    totalGovernmentExpenditureCents: nonnegativeMoney.positive(),
    previousTotalGovernmentExpenditureCents: nonnegativeMoney.positive(),
    interestShareBasisPoints: basisPoints,
    previousInterestShareBasisPoints: basisPoints,
    history: z.array(annualPointSchema).length(5),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(1),
}).strict().superRefine((snapshot, context) => {
  const cubeIds = snapshot.sources.bancaditalia.cubes.map((cube) => cube.id);
  if (new Set(cubeIds).size !== 4) issue(context, "cubi BDS duplicati", ["sources", "bancaditalia", "cubes"]);
  snapshot.sources.bancaditalia.cubes.forEach((cube, index) => {
    const expectedPath = `/infostat/dataservices/export/IT/CSV/ALL/CUBE/BANKITALIA/DIFF/${cube.id}`;
    if (new URL(cube.exportUrl).pathname !== expectedPath) issue(context, "URL cubo BDS non coerente", ["sources", "bancaditalia", "cubes", index, "exportUrl"]);
  });

  const { stock, change, holders, residualMaturity, annualInterest } = snapshot;
  if (stock.totalCents - stock.previousMonthCents !== stock.changeCents) issue(context, "variazione stock non riconciliata", ["stock"]);
  const instruments = stock.instruments.currencyAndDepositsCents + stock.instruments.securitiesCents + stock.instruments.loansAndOtherLiabilitiesCents;
  if (instruments !== stock.totalCents) issue(context, "strumenti non riconciliati", ["stock", "instruments"]);
  const dates = stock.history.map((point) => point.referenceDate);
  if (new Set(dates).size !== 13 || dates.some((value, index) => index > 0 && monthIndex(value) - monthIndex(dates[index - 1]!) !== 1) || dates.at(-1) !== stock.referenceDate) {
    issue(context, "storia stock non consecutiva", ["stock", "history"]);
  }
  if (stock.history.at(-1)?.totalCents !== stock.totalCents || stock.history.at(-2)?.totalCents !== stock.previousMonthCents) issue(context, "storia stock non riconciliata", ["stock", "history"]);
  if (change.referenceDate !== stock.referenceDate || residualMaturity.referenceDate !== stock.referenceDate) issue(context, "periodi BDS non allineati");
  if (change.debtInstrumentTransactionsCents + change.rawLiquidityChangeCents !== change.borrowingRequirementCents) issue(context, "fabbisogno non riconciliato", ["change"]);
  if (change.liquidityContributionCents !== -change.rawLiquidityChangeCents) issue(context, "liquidità non riconciliata", ["change"]);
  if (change.borrowingRequirementCents + change.liquidityContributionCents + change.otherEffectsCents !== stock.changeCents) issue(context, "altri effetti non riconciliati", ["change"]);
  const holderLag = monthIndex(stock.referenceDate) - monthIndex(holders.referenceDate);
  if (holderLag < 0 || holderLag > 2) issue(context, "periodo detentori fuori latenza", ["holders", "referenceDate"]);
  if (new Set(holders.sectors.map((sector) => sector.id)).size !== 5) issue(context, "settori detentori duplicati", ["holders", "sectors"]);
  if (Math.abs(holders.sectors.reduce((sum, sector) => sum + sector.amountCents, 0) - holders.totalCents) > TOLERANCE_CENTS) issue(context, "detentori non riconciliati", ["holders"]);
  if (Math.abs(holders.sectors.reduce((sum, sector) => sum + sector.shareBasisPoints, 0) - 10_000) > 20) issue(context, "quote detentori non riconciliate", ["holders"]);
  if (holders.totalCents > 0) {
    holders.sectors.forEach((sector, index) => {
      const calculatedShare = shareBasisPoints(sector.amountCents, holders.totalCents);
      if (Math.abs(sector.shareBasisPoints - calculatedShare) > HOLDER_SHARE_TOLERANCE_BASIS_POINTS) {
        issue(context, "quota detentore non coerente con l'importo", ["holders", "sectors", index, "shareBasisPoints"]);
      }
    });
  }
  const holderStock = stock.history.find((point) => point.referenceDate === holders.referenceDate)?.totalCents;
  if (holderStock !== undefined && Math.abs(holderStock - holders.totalCents) > TOLERANCE_CENTS) issue(context, "totale detentori non coincide con stock", ["holders"]);
  const maturityTotal = residualMaturity.upToOneYearCents + residualMaturity.oneToFiveYearsCents + residualMaturity.overFiveYearsCents;
  if (Math.abs(maturityTotal - residualMaturity.totalCents) > TOLERANCE_CENTS || Math.abs(residualMaturity.totalCents - stock.totalCents) > TOLERANCE_CENTS) issue(context, "vita residua non riconciliata", ["residualMaturity"]);
  const years = annualInterest.history.map((point) => point.year);
  if (new Set(years).size !== 5 || years.some((year, index) => index > 0 && year - years[index - 1]! !== 1)) issue(context, "storia interessi non consecutiva", ["annualInterest", "history"]);
  annualInterest.history.forEach((point, index) => {
    if (point.interestShareBasisPoints !== shareBasisPoints(point.interestExpenseCents, point.totalGovernmentExpenditureCents)) issue(context, "quota interessi non riconciliata", ["annualInterest", "history", index]);
  });
  const latest = annualInterest.history.at(-1)!;
  const previous = annualInterest.history.at(-2)!;
  if (annualInterest.referenceYear !== latest.year || annualInterest.previousYear !== previous.year || annualInterest.interestExpenseCents !== latest.interestExpenseCents || annualInterest.previousInterestExpenseCents !== previous.interestExpenseCents || annualInterest.totalGovernmentExpenditureCents !== latest.totalGovernmentExpenditureCents || annualInterest.previousTotalGovernmentExpenditureCents !== previous.totalGovernmentExpenditureCents || annualInterest.interestShareBasisPoints !== latest.interestShareBasisPoints || annualInterest.previousInterestShareBasisPoints !== previous.interestShareBasisPoints) issue(context, "valori interessi principali non riconciliati", ["annualInterest"]);
});

export type PublicDebtSnapshot = z.infer<typeof publicDebtSnapshotSchema>;

export function parsePublicDebtSnapshot(input: unknown): PublicDebtSnapshot {
  return publicDebtSnapshotSchema.parse(input);
}
