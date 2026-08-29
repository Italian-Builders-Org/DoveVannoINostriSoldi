import { z } from "zod";
import methodologyManifest from "../../../scripts/etl/specs/government-scorecard-methodology.json";
import sourceSpec from "../../../scripts/etl/specs/government-scorecard.source.json";

export const GOVERNMENT_SCORECARD_INDICATOR_IDS = [
  "real_compensation",
  "unemployment",
  "real_gdp_per_capita",
  "debt_ratio",
  "primary_balance",
  "investment_share",
] as const;

export const GOVERNMENT_SCORECARD_COUNTRY_IDS = ["italy", "france", "germany", "spain"] as const;

const INDICATOR_VALUE_RANGES: Readonly<Record<typeof GOVERNMENT_SCORECARD_INDICATOR_IDS[number], readonly [number, number]>> = {
  real_compensation: [0, 1_000],
  unemployment: [0, 100],
  real_gdp_per_capita: [0, 1_000],
  debt_ratio: [0, 1_000],
  primary_balance: [-100, 100],
  investment_share: [0, 100],
};

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS atteso");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const isoDate = z.iso.date();
const utcTimestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "timestamp UTC atteso")
  .refine((value) => Number.isFinite(Date.parse(value)), "timestamp UTC atteso");
const finiteNumber = z.number().finite();
const GOVERNMENT_DATE_BOUNDARY_MEANING = "startDate ed endDate sono i confini istituzionali del governo pubblicati dalle fonti; endDate può coincidere con l'inizio del governo successivo e non indica necessariamente l'ultimo giorno in carica, una data di dimissioni o responsabilità causale";
const HISTORICAL_PAGE_ALLOWLIST = [
  {
    governmentId: "dini-i",
    sourceLabel: "Governo Dini",
    pageTitle: "I Governo Dini",
    pageUrl: "https://storia.camera.it/governi/i-governo-dini/Ministero%20del%20tesoro",
    startDate: "1995-01-17",
    endDate: "1996-05-17",
  },
  {
    governmentId: "prodi-i",
    sourceLabel: "Governo Prodi",
    pageTitle: "I Governo Prodi",
    pageUrl: "https://storia.camera.it/governi/i-governo-prodi/Ministero%20delle%20finanze",
    startDate: "1996-05-17",
    endDate: "1998-10-21",
  },
  {
    governmentId: "dalema-i",
    sourceLabel: "Governo D'Alema",
    pageTitle: "I Governo D'Alema",
    pageUrl: "https://storia.camera.it/governi/i-governo-d-alema/Presidenza%20del%20Consiglio%20-%20rapporti%20con%20il%20parlamento",
    startDate: "1998-10-21",
    endDate: "1999-12-22",
  },
  {
    governmentId: "dalema-ii",
    sourceLabel: "Governo D'Alema II",
    pageTitle: "II Governo D'Alema",
    pageUrl: "https://storia.camera.it/governi/ii-governo-d-alema/Ministero%20dell%27interno",
    startDate: "1999-12-22",
    endDate: "2000-04-25",
  },
  {
    governmentId: "amato-ii",
    sourceLabel: "Governo Amato II",
    pageTitle: "II Governo Amato",
    pageUrl: "https://storia.camera.it/governi/ii-governo-amato/Presidenza%20del%20Consiglio%20-%20affari%20regionali",
    startDate: "2000-04-25",
    endDate: "2001-06-10",
  },
] as const;

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
  historicalOwner: z.literal("Camera dei deputati · Portale storico"),
  dateMeaning: z.literal(GOVERNMENT_DATE_BOUNDARY_MEANING),
  retrievedAt: utcTimestamp,
  bytes: z.number().int().positive().safe(),
  sha256,
  historicalReceipts: z.array(z.object({
    governmentId: z.string().regex(/^[a-z0-9-]+$/),
    sourceLabel: z.string().min(1),
    pageTitle: z.string().min(1),
    pageUrl: httpsUrl,
    startDate: isoDate,
    endDate: isoDate,
    retrievedAt: utcTimestamp,
    bytes: z.number().int().positive().safe(),
    sha256,
  }).strict()).length(HISTORICAL_PAGE_ALLOWLIST.length),
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

const sourceSeriesSchema = z.array(z.object({
  file: z.string().min(1),
  codeTemplate: z.string().min(1),
  title: z.string().min(1),
  unit: z.string().min(1),
}).strict()).min(1).max(2);

const indicatorSchema = z.object({
  id: z.enum(GOVERNMENT_SCORECARD_INDICATOR_IDS),
  sourceId: z.literal("ameco"),
  area: z.enum(["purchasing-power", "labour", "growth", "public-finance", "future-capacity"]),
  label: z.string().min(1),
  weightBasisPoints: z.number().int().positive().max(10_000),
  direction: z.enum(["higher", "lower"]),
  transformation: z.enum(["log-change", "point-change"]),
  unit: z.string().min(1),
  limitations: z.string().min(1),
  referencePeriod: z.literal("annual, 1960-2027; observations through 2024; forecasts from 2025"),
  coverageNotes: z.literal("Unavailable country-years remain explicit null values; 1995-2024 is mandatory for every country, while 2025-2027 is published only as a complete forecast scenario."),
  sourceSeries: sourceSeriesSchema,
  derived: z.string().min(1).optional(),
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
  minimumWindowYears: z.literal(1),
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
  methodologyVersion: z.literal("core-annual-v4"),
  generatedAt: utcTimestamp,
  sources: z.object({
    ameco: amecoSourceSchema,
    governmentChronology: chronologySourceSchema,
  }).strict(),
  method: methodSchema,
  indicators: z.array(indicatorSchema).length(GOVERNMENT_SCORECARD_INDICATOR_IDS.length),
  governments: z.array(governmentSchema).min(17),
  contexts: z.array(contextSchema).min(8),
  measures: z.array(measureSchema).min(10),
  caveats: z.array(z.string().min(1)).min(4),
}).strict().superRefine((snapshot, context) => {
  if (JSON.stringify(snapshot.method) !== JSON.stringify(methodologyManifest.method)) {
    issue(context, "metodo divergente dal manifest versionato", ["method"]);
  }
  const indicatorIds = snapshot.indicators.map((indicator) => indicator.id);
  if (new Set(indicatorIds).size !== GOVERNMENT_SCORECARD_INDICATOR_IDS.length || GOVERNMENT_SCORECARD_INDICATOR_IDS.some((id) => !indicatorIds.includes(id))) {
    issue(context, "paniere indicatori incompleto o duplicato", ["indicators"]);
  }
  if (snapshot.indicators.reduce((sum, indicator) => sum + indicator.weightBasisPoints, 0) !== 10_000) {
    issue(context, "pesi indicatori non riconciliati", ["indicators"]);
  }
  const historicalReceipts = snapshot.sources.governmentChronology.historicalReceipts;
  if (historicalReceipts.length !== HISTORICAL_PAGE_ALLOWLIST.length) {
    issue(context, "ricevute Camera incomplete", ["sources", "governmentChronology", "historicalReceipts"]);
  }
  historicalReceipts.forEach((receipt, receiptIndex) => {
    const expected = HISTORICAL_PAGE_ALLOWLIST[receiptIndex];
    if (!expected || ["governmentId", "sourceLabel", "pageTitle", "pageUrl", "startDate", "endDate"]
      .some((field) => receipt[field as keyof typeof receipt] !== expected[field as keyof typeof expected])) {
      issue(context, "ricevuta Camera divergente dalla allowlist", ["sources", "governmentChronology", "historicalReceipts", receiptIndex]);
    }
    if (receipt.retrievedAt !== snapshot.sources.governmentChronology.retrievedAt) {
      issue(context, "timestamp ricevuta Camera divergente", ["sources", "governmentChronology", "historicalReceipts", receiptIndex, "retrievedAt"]);
    }
  });
  const expectedYears = Array.from({ length: 68 }, (_, index) => 1960 + index);
  snapshot.indicators.forEach((indicator, indicatorIndex) => {
    const expectedIndicator = methodologyManifest.indicators[indicatorIndex];
    if (!expectedIndicator || ["id", "area", "label", "weightBasisPoints", "direction", "transformation", "unit", "limitations"]
      .some((field) => indicator[field as keyof typeof indicator] !== expectedIndicator[field as keyof typeof expectedIndicator])) {
      issue(context, "indicatore divergente dal manifest versionato", ["indicators", indicatorIndex]);
      return;
    }
    if (JSON.stringify(indicator.sourceSeries) !== JSON.stringify(expectedIndicator.sourceSeries)) {
      issue(context, "provenienza delle serie divergente dal manifest versionato", ["indicators", indicatorIndex, "sourceSeries"]);
    }
    const expectedDerived = "derived" in expectedIndicator ? expectedIndicator.derived : undefined;
    if (indicator.derived !== expectedDerived) {
      issue(context, "formula derivata divergente dal manifest versionato", ["indicators", indicatorIndex, "derived"]);
    }
    GOVERNMENT_SCORECARD_COUNTRY_IDS.forEach((countryId) => {
      const codes = indicator.sourceCodes[countryId];
      const countryCode = methodologyManifest.countryCodes[countryId];
      const expectedCodes = expectedIndicator.sourceSeries.map((source) => source.codeTemplate.replace("{country}", countryCode));
      if (codes.length !== expectedCodes.length || codes.some((code, index) => code !== expectedCodes[index])) {
        issue(context, "codici serie inattesi", ["indicators", indicatorIndex, "sourceCodes", countryId]);
      }
      const points = indicator.countries[countryId];
      if (points.some((point, index) => point.year !== expectedYears[index])) {
        issue(context, "anni non consecutivi", ["indicators", indicatorIndex, "countries", countryId]);
      }
      for (let year = snapshot.method.firstScoreYear; year <= snapshot.sources.ameco.observedThrough; year += 1) {
        if (points[year - 1960]?.value == null) {
          issue(context, "dato obbligatorio mancante dal 1995", ["indicators", indicatorIndex, "countries", countryId, year - 1960]);
          break;
        }
      }
      const [minimum, maximum] = INDICATOR_VALUE_RANGES[indicator.id];
      const invalidValue = points.findIndex((point) => point.value != null && (point.value < minimum || point.value > maximum));
      if (invalidValue >= 0) {
        issue(context, "valore fuori intervallo plausibile", ["indicators", indicatorIndex, "countries", countryId, invalidValue, "value"]);
      }
    });
  });

  const governmentIds = snapshot.governments.map((government) => government.id);
  const governmentNames = snapshot.governments.map((government) => government.name);
  if (new Set(governmentIds).size !== snapshot.governments.length || new Set(governmentNames).size !== snapshot.governments.length) {
    issue(context, "governi duplicati", ["governments"]);
  }
  snapshot.governments.forEach((government, index) => {
    const expected = sourceSpec.governmentChronology.governments[index];
    if (!expected || government.id !== expected.id || government.name !== expected.name
      || government.startDate !== expected.startDate || government.endDate !== expected.endDate
      || government.status !== expected.status) {
      issue(context, "cronologia governi divergente dalla fonte versionata", ["governments", index]);
    }
    if (index > 0 && government.startDate <= snapshot.governments[index - 1]!.startDate) {
      issue(context, "governi non ordinati", ["governments", index]);
    }
    if (government.status === "current" !== (government.endDate === null)) {
      issue(context, "stato governo non coerente", ["governments", index]);
    }
  });
  const current = snapshot.governments.filter((government) => government.status === "current");
  if (current.length !== 1 || current[0] !== snapshot.governments.at(-1)) {
    issue(context, "governo corrente non univoco o non più recente", ["governments"]);
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

export type GovernmentScorecardForecastCoverage = Readonly<{
  status: "complete" | "partial" | "missing";
  fromYear: number;
  throughYear: number;
  availableCells: number;
  requiredCells: number;
}>;

export function getGovernmentScorecardForecastCoverage(
  snapshot: GovernmentScorecardSnapshot,
): GovernmentScorecardForecastCoverage {
  const { forecastFrom, forecastThrough } = snapshot.sources.ameco;
  const forecastYears = forecastThrough - forecastFrom + 1;
  const requiredCells = snapshot.indicators.length
    * GOVERNMENT_SCORECARD_COUNTRY_IDS.length
    * forecastYears;
  const availableCells = snapshot.indicators.reduce(
    (indicatorTotal, indicator) => indicatorTotal + GOVERNMENT_SCORECARD_COUNTRY_IDS.reduce(
      (countryTotal, countryId) => countryTotal + indicator.countries[countryId].filter(
        (point) => point.year >= forecastFrom
          && point.year <= forecastThrough
          && point.value != null,
      ).length,
      0,
    ),
    0,
  );
  const status = availableCells === 0
    ? "missing" as const
    : availableCells === requiredCells
      ? "complete" as const
      : "partial" as const;

  return {
    status,
    fromYear: forecastFrom,
    throughYear: forecastThrough,
    availableCells,
    requiredCells,
  };
}

export function parseGovernmentScorecardSnapshot(input: unknown): GovernmentScorecardSnapshot {
  return governmentScorecardSnapshotSchema.parse(input);
}
