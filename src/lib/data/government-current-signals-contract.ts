import { z } from "zod";

export const GOVERNMENT_CURRENT_SIGNAL_IDS = ["all-items", "food", "housing-energy"] as const;
export const GOVERNMENT_CURRENT_SIGNAL_COUNTRY_IDS = ["germany", "spain", "france", "italy"] as const;

const API_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?lang=en&unit=I25&unit=RCH_A&coicop18=TOTAL&coicop18=CP01&coicop18=CP04&geo=IT&geo=FR&geo=DE&geo=ES&sinceTimePeriod=2022-10";
const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const utcTimestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)), "timestamp UTC atteso");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();

const observationSchema = z.object({
  period: month,
  index: finite.positive().lt(1_000),
  annualRate: finite.gt(-100).lt(200),
}).strict();

const countrySeriesSchema = z.object({
  germany: z.array(observationSchema).min(1),
  spain: z.array(observationSchema).min(1),
  france: z.array(observationSchema).min(1),
  italy: z.array(observationSchema).min(1),
}).strict();

const indicatorSchema = z.object({
  id: z.enum(GOVERNMENT_CURRENT_SIGNAL_IDS),
  code: z.enum(["TOTAL", "CP01", "CP04"]),
  label: z.string().min(1),
  question: z.string().min(1),
  indexUnit: z.literal("indice 2025=100"),
  annualRateUnit: z.literal("variazione percentuale annua"),
  limitations: z.string().min(1),
  countries: countrySeriesSchema,
}).strict();

const sourceSchema = z.object({
  owner: z.literal("Eurostat"),
  datasetCode: z.literal("prc_hicp_minr"),
  title: z.literal("Harmonised index of consumer prices (HICP) - ECOICOP ver.2 - indices and rates of change, monthly data"),
  landingUrl: z.literal("https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en"),
  informationUrl: z.literal("https://ec.europa.eu/eurostat/web/hicp/information-data"),
  reuseUrl: z.literal("https://ec.europa.eu/eurostat/help/copyright-notice"),
  apiUrl: z.literal(API_URL),
  cadence: z.string().min(1),
  sourceUpdatedAt: utcTimestamp,
  retrievedAt: utcTimestamp,
  referencePeriodFrom: z.literal("2022-10"),
  referencePeriodThrough: month,
  bytes: z.number().int().positive().max(512 * 1024),
  sha256,
}).strict();

function nextPeriod(period: string) {
  const [year, monthNumber] = period.split("-").map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
}

function issue(context: z.RefinementCtx, message: string, path: PropertyKey[] = []) {
  context.addIssue({ code: "custom", message, path });
}

export const governmentCurrentSignalsSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  methodologyVersion: z.literal("current-signals-v1"),
  generatedAt: utcTimestamp,
  governmentStartPeriod: z.literal("2022-10"),
  source: sourceSchema,
  indicators: z.array(indicatorSchema).length(GOVERNMENT_CURRENT_SIGNAL_IDS.length),
  caveats: z.array(z.string().min(1)).min(4),
}).strict().superRefine((snapshot, context) => {
  if (Date.parse(snapshot.source.sourceUpdatedAt) > Date.parse(snapshot.source.retrievedAt)
    || Date.parse(snapshot.source.retrievedAt) > Date.parse(snapshot.generatedAt)) {
    issue(context, "timestamp fonte, acquisizione o generazione non ordinato", ["source"]);
  }
  const indicatorIds = snapshot.indicators.map((indicator) => indicator.id);
  if (new Set(indicatorIds).size !== GOVERNMENT_CURRENT_SIGNAL_IDS.length
    || GOVERNMENT_CURRENT_SIGNAL_IDS.some((id) => !indicatorIds.includes(id))) {
    issue(context, "paniere corrente incompleto o duplicato", ["indicators"]);
  }
  const codeById = { "all-items": "TOTAL", food: "CP01", "housing-energy": "CP04" } as const;
  let expectedPeriods: readonly string[] | undefined;
  snapshot.indicators.forEach((indicator, indicatorIndex) => {
    if (indicator.code !== codeById[indicator.id]) {
      issue(context, "codice ECOICOP incoerente", ["indicators", indicatorIndex, "code"]);
    }
    GOVERNMENT_CURRENT_SIGNAL_COUNTRY_IDS.forEach((countryId) => {
      const points = indicator.countries[countryId];
      const periods = points.map((point) => point.period);
      if (periods[0] !== snapshot.governmentStartPeriod
        || periods.some((period, index) => index > 0 && period !== nextPeriod(periods[index - 1]!))) {
        issue(context, "periodi mensili non continui", ["indicators", indicatorIndex, "countries", countryId]);
      }
      if (!expectedPeriods) expectedPeriods = periods;
      else if (periods.length !== expectedPeriods.length || periods.some((period, index) => period !== expectedPeriods?.[index])) {
        issue(context, "copertura mensile non uniforme", ["indicators", indicatorIndex, "countries", countryId]);
      }
    });
  });
  if (!expectedPeriods || expectedPeriods.at(-1) !== snapshot.source.referencePeriodThrough) {
    issue(context, "ultimo periodo non riconciliato", ["source", "referencePeriodThrough"]);
  }
});

export type GovernmentCurrentSignalsSnapshot = z.infer<typeof governmentCurrentSignalsSnapshotSchema>;
export type GovernmentCurrentSignalIndicator = GovernmentCurrentSignalsSnapshot["indicators"][number];
export type GovernmentCurrentSignalCountryId = keyof GovernmentCurrentSignalIndicator["countries"];

export function parseGovernmentCurrentSignalsSnapshot(input: unknown): GovernmentCurrentSignalsSnapshot {
  return governmentCurrentSignalsSnapshotSchema.parse(input);
}
