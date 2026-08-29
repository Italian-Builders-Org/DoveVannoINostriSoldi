import { z } from "zod";

export const GOVERNMENT_SCORECARD_INDICATOR_IDS = [
  "real_compensation",
  "unemployment",
  "real_gdp_per_capita",
  "debt_ratio",
  "primary_balance",
  "investment_share",
] as const;

export const GOVERNMENT_SCORECARD_COUNTRY_IDS = ["italy", "france", "germany", "spain"] as const;

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS atteso");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const isoDate = z.iso.date();
const utcTimestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "timestamp UTC atteso")
  .refine((value) => Number.isFinite(Date.parse(value)), "timestamp UTC atteso");
const finiteNumber = z.number().finite();

const amecoSourceSchema = z.object({
  owner: z.literal("European Commission, Directorate-General for Economic and Financial Affairs"),
  title: z.literal("AMECO annual macro-economic database"),
  release: z.string().min(1),
  releaseDate: isoDate,
  landingUrl: httpsUrl.refine((value) => new URL(value).hostname === "economy-finance.ec.europa.eu"),
  downloadUrl: httpsUrl.refine((value) => {
    const url = new URL(value);
    return url.hostname === "ec.europa.eu" && url.pathname === "/economy_finance/db_indicators/ameco/documents/ameco0_csv.zip";
  }, "URL AMECO ufficiale atteso"),
  termsUrl: httpsUrl.refine((value) => new URL(value).hostname === "commission.europa.eu"),
  license: z.literal("CC BY 4.0 unless otherwise indicated"),
  cadence: z.string().min(1),
  geography: z.string().min(1),
  referencePeriod: z.string().min(1),
  publication: z.string().min(1),
  retrievedAt: utcTimestamp,
  bytes: z.number().int().positive().safe(),
  sha256,
  observedThrough: z.literal(2024),
  forecastFrom: z.literal(2025),
  forecastThrough: z.literal(2027),
}).strict();

const chronologySourceSchema = z.object({
  owner: z.literal("Presidenza del Consiglio dei Ministri"),
  title: z.literal("I Governi nelle Legislature"),
  pageUrl: httpsUrl.refine((value) => {
    const url = new URL(value);
    return url.hostname === "www.governo.it" && url.pathname === "/it/i-governi-dal-1943-ad-oggi/i-governi-nelle-legislature/192";
  }, "URL cronologia ufficiale atteso"),
  termsUrl: httpsUrl.refine((value) => new URL(value).hostname === "www.governo.it"),
  cadence: z.string().min(1),
  geography: z.string().min(1),
  referencePeriod: z.string().min(1),
  publication: z.string().min(1),
  retrievedAt: utcTimestamp,
  bytes: z.number().int().positive().safe(),
  sha256,
}).strict();

const observationSchema = z.object({
  year: z.number().int().min(1960).max(2027),
  value: finiteNumber.nullable(),
}).strict();

const countrySeriesSchema = z.object({
  italy: z.array(observationSchema).length(68),
  france: z.array(observationSchema).length(68),
  germany: z.array(observationSchema).length(68),
  spain: z.array(observationSchema).length(68),
}).strict();

const sourceCodesSchema = z.object({
  italy: z.array(z.string().min(1)).min(1).max(2),
  france: z.array(z.string().min(1)).min(1).max(2),
  germany: z.array(z.string().min(1)).min(1).max(2),
  spain: z.array(z.string().min(1)).min(1).max(2),
}).strict();

const indicatorSchema = z.object({
  id: z.enum(GOVERNMENT_SCORECARD_INDICATOR_IDS),
  area: z.enum(["purchasing-power", "labour", "growth", "public-finance", "future-capacity"]),
  label: z.string().min(1),
  weightBasisPoints: z.number().int().positive().max(10_000),
  direction: z.enum(["higher", "lower"]),
  transformation: z.enum(["log-change", "point-change"]),
  unit: z.string().min(1),
  limitations: z.string().min(1),
  sourceCodes: sourceCodesSchema,
  countries: countrySeriesSchema,
}).strict();

const governmentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  status: z.enum(["ended", "current"]),
}).strict();

const contextSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  startYear: z.number().int().min(1946).max(2027),
  endYear: z.number().int().min(1946).max(2027),
  kind: z.enum(["regime", "external-shock", "financial-shock", "shared-policy-context"]),
  summary: z.string().min(1),
  sourceUrl: httpsUrl,
}).strict();

const measureSchema = z.object({
  government: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["enacted", "implemented-across-governments"]),
  act: z.string().min(1),
  mechanism: z.string().min(1),
  evidence: z.string().min(1),
  sourceUrl: httpsUrl,
}).strict();

const methodSchema = z.object({
  firstScoreYear: z.literal(1995),
  minimumWindowYears: z.literal(2),
  peerCountryIds: z.tuple([z.literal("france"), z.literal("germany"), z.literal("spain")]),
  historicalWeightBasisPoints: z.literal(5000),
  peerWeightBasisPoints: z.literal(5000),
  robustScale: z.literal(1.4826),
  winsorizedZ: z.literal(3),
  scoreStatus: z.string().min(1),
  missingDataRule: z.string().min(1),
  endpointRule: z.string().min(1),
  attributionRule: z.string().min(1),
}).strict();

function issue(context: z.RefinementCtx, message: string, path: PropertyKey[] = []) {
  context.addIssue({ code: "custom", message, path });
}

export const governmentScorecardSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  methodologyVersion: z.literal("core-annual-v1"),
  generatedAt: utcTimestamp,
  sources: z.object({
    ameco: amecoSourceSchema,
    governmentChronology: chronologySourceSchema,
  }).strict(),
  method: methodSchema,
  indicators: z.array(indicatorSchema).length(GOVERNMENT_SCORECARD_INDICATOR_IDS.length),
  governments: z.array(governmentSchema).length(17),
  contexts: z.array(contextSchema).min(8),
  measures: z.array(measureSchema).min(10),
  caveats: z.array(z.string().min(1)).min(4),
}).strict().superRefine((snapshot, context) => {
  const indicatorIds = snapshot.indicators.map((indicator) => indicator.id);
  if (new Set(indicatorIds).size !== GOVERNMENT_SCORECARD_INDICATOR_IDS.length || GOVERNMENT_SCORECARD_INDICATOR_IDS.some((id) => !indicatorIds.includes(id))) {
    issue(context, "paniere indicatori incompleto o duplicato", ["indicators"]);
  }
  if (snapshot.indicators.reduce((sum, indicator) => sum + indicator.weightBasisPoints, 0) !== 10_000) {
    issue(context, "pesi indicatori non riconciliati", ["indicators"]);
  }
  const expectedYears = Array.from({ length: 68 }, (_, index) => 1960 + index);
  snapshot.indicators.forEach((indicator, indicatorIndex) => {
    const expectedCodeCount = indicator.id === "investment_share" ? 2 : 1;
    GOVERNMENT_SCORECARD_COUNTRY_IDS.forEach((countryId) => {
      const codes = indicator.sourceCodes[countryId];
      if (codes.length !== expectedCodeCount || new Set(codes).size !== codes.length) {
        issue(context, "codici serie inattesi", ["indicators", indicatorIndex, "sourceCodes", countryId]);
      }
      const points = indicator.countries[countryId];
      if (points.some((point, index) => point.year !== expectedYears[index])) {
        issue(context, "anni non consecutivi", ["indicators", indicatorIndex, "countries", countryId]);
      }
      for (let year = snapshot.method.firstScoreYear; year <= snapshot.sources.ameco.forecastThrough; year += 1) {
        if (points[year - 1960]?.value == null) {
          issue(context, "dato obbligatorio mancante dal 1995", ["indicators", indicatorIndex, "countries", countryId, year - 1960]);
          break;
        }
      }
    });
  });

  const governmentIds = snapshot.governments.map((government) => government.id);
  const governmentNames = snapshot.governments.map((government) => government.name);
  if (new Set(governmentIds).size !== snapshot.governments.length || new Set(governmentNames).size !== snapshot.governments.length) {
    issue(context, "governi duplicati", ["governments"]);
  }
  snapshot.governments.forEach((government, index) => {
    if (index > 0 && government.startDate <= snapshot.governments[index - 1]!.startDate) {
      issue(context, "governi non ordinati", ["governments", index]);
    }
    if (government.status === "current" !== (government.endDate === null)) {
      issue(context, "stato governo non coerente", ["governments", index]);
    }
  });
  const current = snapshot.governments.filter((government) => government.status === "current");
  if (current.length !== 1 || current[0]?.id !== "meloni-i" || current[0].startDate !== "2022-10-22") {
    issue(context, "governo corrente inatteso", ["governments"]);
  }
  snapshot.measures.forEach((measure, index) => {
    if (!governmentNames.includes(measure.government)) issue(context, "misura senza governo", ["measures", index, "government"]);
  });
  snapshot.contexts.forEach((item, index) => {
    if (item.endYear < item.startYear) issue(context, "finestra di contesto invertita", ["contexts", index]);
  });
});

export type GovernmentScorecardSnapshot = z.infer<typeof governmentScorecardSnapshotSchema>;
export type GovernmentScorecardIndicator = GovernmentScorecardSnapshot["indicators"][number];
export type GovernmentScorecardGovernment = GovernmentScorecardSnapshot["governments"][number];
export type GovernmentScorecardCountryId = keyof GovernmentScorecardIndicator["countries"];

export function parseGovernmentScorecardSnapshot(input: unknown): GovernmentScorecardSnapshot {
  return governmentScorecardSnapshotSchema.parse(input);
}
