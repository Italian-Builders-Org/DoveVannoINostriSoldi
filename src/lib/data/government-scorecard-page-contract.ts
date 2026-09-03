import { createHash } from "node:crypto";

import { z } from "zod";

import supplementalSnapshot from "@/data/generated/government-scorecard-page.json";
import { GOVERNMENT_SCORECARD_V6_CHRONOLOGY } from "@/lib/government-scorecard-chronology";

export const GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS = [
  "inflation",
  "real_compensation",
  "unemployment",
  "employment_rate",
  "real_gdp_per_capita",
  "debt_ratio",
  "debt_per_capita",
  "primary_balance",
  "investment_share",
] as const;

const CONTEXT_CATEGORIES = [
  "overview",
  "inheritance",
  "geopolitics_crises",
  "eurozone_ecb",
  "laws_measures",
  "chronology",
] as const;
const GEOGRAPHIES = ["IT", "FR", "DE", "ES"] as const;
const FREQUENCIES = ["annual", "quarterly", "monthly"] as const;
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS atteso");
const dataUrl = httpsUrl.refine((value) => [
  "ec.europa.eu",
  "economy-finance.ec.europa.eu",
  "commission.europa.eu",
].includes(new URL(value).hostname), "fonte dati ufficiale attesa");
const contextUrl = httpsUrl.refine((value) => [
  "www.normattiva.it",
  "www.quirinale.it",
  "archivio.quirinale.it",
  "www.ecb.europa.eu",
  "www.bancaditalia.it",
  "documenti.camera.it",
  "www.upbilancio.it",
  "www.mimit.gov.it",
  "commission.europa.eu",
  "ec.europa.eu",
].includes(new URL(value).hostname), "fonte contestuale ufficiale attesa");
const timestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/)
  .refine((value) => Number.isFinite(Date.parse(value)), "timestamp ISO atteso");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

const sourceSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  title: z.string().min(1),
  dataset_code: z.string().min(1),
  source_version: z.string().min(1).optional(),
  query_url: dataUrl,
  landing_url: dataUrl,
  terms_url: dataUrl,
  retrieved_at: timestamp,
  upstream_updated_at: z.string().min(1),
  raw_bytes: z.number().int().positive().safe(),
  raw_sha256: sha256,
}).strict();

const componentSourceSchema = z.object({
  dataset_code: z.enum(["gov_10dd_edpt1", "gov_10q_ggnfa", "nama_10_pe"]),
  raw_sha256: sha256,
  source_url: dataUrl,
}).strict();

const debtPerCapitaDerivationSchema = z.object({
  formula: z.literal("debt_stock_mio_eur * 1000 / population_thousand"),
  debt_stock_mio_eur: z.number().finite().nonnegative(),
  population_thousand: z.number().finite().positive(),
  debt_year: z.number().int().min(1995).max(2100),
  population_year: z.number().int().min(1995).max(2100),
  debt_sector: z.literal("S13"),
  debt_item: z.literal("GD"),
  population_item: z.literal("POP_NC"),
}).strict();

const primaryBalanceDerivationSchema = z.object({
  formula: z.literal("net_lending_percent_gdp + interest_payable_percent_gdp"),
  net_lending_percent_gdp: z.number().finite(),
  interest_payable_percent_gdp: z.number().finite().nonnegative(),
  sector: z.literal("S13"),
  net_lending_item: z.literal("B9"),
  interest_item: z.literal("D41PAY"),
}).strict();

const derivationSchema = z.union([debtPerCapitaDerivationSchema, primaryBalanceDerivationSchema]);

const pointSchema = z.object({
  year: z.number().int().min(1995).max(2100),
  period: z.string().regex(/^\d{4}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?$/),
  period_start: z.iso.date(),
  value: z.number().finite(),
  unit: z.string().min(1),
  frequency: z.enum(FREQUENCIES),
  status: z.enum(["observed", "provisional", "estimated"]),
  upstream_status_or_null: z.string().min(1).nullable(),
  source_id: z.string().min(1),
  source_owner: z.string().min(1),
  source_url: dataUrl,
  retrieved_at: timestamp,
  raw_sha256: sha256,
  derivation: derivationSchema.optional(),
  component_sources: z.array(componentSourceSchema).min(1).max(2).optional(),
}).strict();

const seriesSchema = z.object({
  indicator_id: z.enum(GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS),
  label: z.string().min(1),
  usage: z.enum(["score_and_context", "context_only"]),
  frequency: z.enum(FREQUENCIES),
  latest_published_period: z.string().regex(/^\d{4}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?$/),
  geographies: z.array(z.object({
    geography: z.enum(GEOGRAPHIES),
    points: z.array(pointSchema).min(1),
  }).strict()).length(4),
}).strict();

const contextSourceSchema = z.object({
  owner: z.string().min(1),
  type: z.literal("official"),
  url: contextUrl,
}).strict();

const readyContextItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  period: z.string().min(1),
  start_date: z.iso.date(),
  end_date_or_null: z.iso.date().nullable(),
  date_precision: z.enum(["day", "month", "quarter", "year"]),
  economic_channel: z.string().min(1),
  mandate_relation: z.enum(["inherited", "during", "cross_government"]),
  selection_rule: z.string().min(1),
  score_impact: z.literal("none"),
  sources: z.array(contextSourceSchema).min(1),
  retrieved_at: timestamp,
  evidence_sha256: sha256,
}).strict();

const readyContextSlideSchema = z.object({
  category: z.enum(CONTEXT_CATEGORIES),
  title: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  status: z.literal("ready"),
  catalog_complete: z.literal(true),
  score_impact: z.literal("none"),
  items: z.array(readyContextItemSchema).min(1),
}).strict();

const emptyContextSlideSchema = z.object({
  category: z.enum(CONTEXT_CATEGORIES),
  title: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  message: z.string().min(1),
  status: z.literal("empty"),
  catalog_complete: z.literal(true),
  score_impact: z.literal("none"),
  items: z.tuple([]),
}).strict();

const contextSlideSchema = z.discriminatedUnion("status", [readyContextSlideSchema, emptyContextSlideSchema]);

export const governmentScorecardV6SupplementalSnapshotSchema = z.object({
  schema_version: z.literal(4),
  snapshot_version: z.literal("government-scorecard-page-2026-09-03-r3"),
  as_of_date: z.literal("2026-09-03"),
  coverage: z.object({
    first_period: z.literal("1995"),
    latest_published_periods: z.array(z.object({
      indicator_id: z.enum(GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS),
      period: z.string().min(4),
    }).strict()).length(9),
    missing_rule: z.literal("omit unavailable source observations; never interpolate"),
  }).strict(),
  sources: z.array(sourceSchema).length(10),
  series: z.array(seriesSchema).length(9),
  contexts: z.array(z.object({
    government_id: z.string().regex(/^[a-z0-9-]+$/),
    government_name: z.string().min(1),
    slides: z.array(contextSlideSchema).length(6),
  }).strict()).length(17),
  score_contract: z.object({
    supplemental_score_impact: z.literal("none"),
    core_artifact_sha256: z.literal("f814dfe6f5bf7f6c93f1c52282e0f1829835a797bc14d1d81d3d684a3a7f4894"),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  const expectedSourceIds = [
    "ameco:2026-spring",
    "eurostat:prc_hicp_minr",
    "eurostat:une_rt_m",
    "eurostat:lfsi_emp_q",
    "eurostat:namq_10_pc",
    "eurostat:gov_10dd_edpt1",
    "eurostat:gov_10q_ggdebt",
    "eurostat:gov_10q_ggnfa",
    "eurostat:namq_10_gdp",
    "eurostat:nama_10_pe",
  ];
  if (snapshot.sources.some((source, index) => source.id !== expectedSourceIds[index])) {
    context.addIssue({ code: "custom", message: "registro fonti divergente", path: ["sources"] });
  }
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  snapshot.series.forEach((series, seriesIndex) => {
    if (series.indicator_id !== GOVERNMENT_SCORECARD_V6_SUPPLEMENTAL_INDICATOR_IDS[seriesIndex]) {
      context.addIssue({ code: "custom", message: "ordine indicatori supplementari divergente", path: ["series", seriesIndex, "indicator_id"] });
    }
    series.geographies.forEach((geography, geographyIndex) => {
      if (geography.geography !== GEOGRAPHIES[geographyIndex]) {
        context.addIssue({ code: "custom", message: "ordine geografie divergente", path: ["series", seriesIndex, "geographies", geographyIndex, "geography"] });
      }
      let previousYear = 0;
      let previousPeriodStart = "";
      geography.points.forEach((point, pointIndex) => {
        if (
          point.period_start <= previousPeriodStart
          || point.year < previousYear
          || point.frequency !== series.frequency
          || !point.period.startsWith(String(point.year))
        ) {
          context.addIssue({ code: "custom", message: "periodi duplicati, non crescenti o incoerenti", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
        }
        previousYear = point.year;
        previousPeriodStart = point.period_start;
        if (series.indicator_id === "debt_per_capita") {
          if (!point.derivation || point.derivation.formula !== "debt_stock_mio_eur * 1000 / population_thousand" || !point.component_sources || point.component_sources.length !== 2) {
            context.addIssue({ code: "custom", message: "debito per abitante privo di derivazione", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
            return;
          }
          const expected = Math.round((point.derivation.debt_stock_mio_eur * 1000 / point.derivation.population_thousand) * 100) / 100;
          if (
            point.derivation.debt_year !== point.year
            || point.derivation.population_year !== point.year
            || point.value !== expected
            || point.component_sources[0].dataset_code !== "gov_10dd_edpt1"
            || point.component_sources[1].dataset_code !== "nama_10_pe"
            || point.component_sources[0].raw_sha256 !== sourceById.get("eurostat:gov_10dd_edpt1")?.raw_sha256
            || point.component_sources[1].raw_sha256 !== sourceById.get("eurostat:nama_10_pe")?.raw_sha256
            || point.raw_sha256 !== canonicalHash(point.component_sources.map((source) => source.raw_sha256))
          ) {
            context.addIssue({ code: "custom", message: "debito per abitante non riconciliato", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
          }
        } else if (series.indicator_id === "primary_balance") {
          if (!point.derivation || point.derivation.formula !== "net_lending_percent_gdp + interest_payable_percent_gdp" || !point.component_sources || point.component_sources.length !== 1) {
            context.addIssue({ code: "custom", message: "saldo primario privo di derivazione", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
            return;
          }
          const expected = Math.round((point.derivation.net_lending_percent_gdp + point.derivation.interest_payable_percent_gdp) * 10_000) / 10_000;
          if (
            point.value !== expected
            || point.component_sources[0].dataset_code !== "gov_10q_ggnfa"
            || point.component_sources[0].raw_sha256 !== sourceById.get("eurostat:gov_10q_ggnfa")?.raw_sha256
            || point.raw_sha256 !== canonicalHash([point.component_sources[0].raw_sha256, "B9+D41PAY"])
          ) {
            context.addIssue({ code: "custom", message: "saldo primario non riconciliato", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
          }
        } else if (point.derivation || point.component_sources) {
          context.addIssue({ code: "custom", message: "derivazione inattesa", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
        } else {
          const source = sourceById.get(point.source_id);
          if (
            !source
            || source.owner !== point.source_owner
            || source.query_url !== point.source_url
            || source.retrieved_at !== point.retrieved_at
            || source.raw_sha256 !== point.raw_sha256
          ) {
            context.addIssue({ code: "custom", message: "provenienza del punto non riconciliata", path: ["series", seriesIndex, "geographies", geographyIndex, "points", pointIndex] });
          }
        }
      });
    });
    const latest = series.geographies
      .flatMap((geography) => geography.points.map((point) => point.period))
      .toSorted()
      .at(-1);
    if (series.latest_published_period !== latest) {
      context.addIssue({ code: "custom", message: "ultimo periodo pubblicato divergente", path: ["series", seriesIndex, "latest_published_period"] });
    }
  });

  snapshot.contexts.forEach((governmentContext, governmentIndex) => {
    const expectedGovernment = GOVERNMENT_SCORECARD_V6_CHRONOLOGY[governmentIndex];
    if (
      !expectedGovernment
      || governmentContext.government_id !== expectedGovernment.id
      || governmentContext.government_name !== expectedGovernment.name
    ) {
      context.addIssue({ code: "custom", message: "contesto associato al governo sbagliato", path: ["contexts", governmentIndex] });
    }
    governmentContext.slides.forEach((slide, slideIndex) => {
      if (slide.category !== CONTEXT_CATEGORIES[slideIndex]) {
        context.addIssue({ code: "custom", message: "ordine del contesto divergente", path: ["contexts", governmentIndex, "slides", slideIndex, "category"] });
      }
      slide.items.forEach((item, itemIndex) => {
        const itemEvidence = {
          id: item.id,
          title: item.title,
          summary: item.summary,
          period: item.period,
          start_date: item.start_date,
          end_date_or_null: item.end_date_or_null,
          date_precision: item.date_precision,
          economic_channel: item.economic_channel,
          mandate_relation: item.mandate_relation,
          selection_rule: item.selection_rule,
          score_impact: item.score_impact,
          sources: item.sources,
        };
        if (item.evidence_sha256 !== canonicalHash(itemEvidence)) {
          context.addIssue({ code: "custom", message: "hash dell'evento divergente", path: ["contexts", governmentIndex, "slides", slideIndex, "items", itemIndex, "evidence_sha256"] });
        }
      });
    });
  });
});

export type GovernmentScorecardV6SupplementalSnapshot = z.infer<typeof governmentScorecardV6SupplementalSnapshotSchema>;

export class GovernmentScorecardV6SupplementalContractError extends Error {
  constructor(cause: unknown) {
    super("Lo snapshot supplementare v6 non supera il contratto dati", { cause });
    this.name = "GovernmentScorecardV6SupplementalContractError";
  }
}

export function parseGovernmentScorecardV6SupplementalSnapshot(input: unknown): GovernmentScorecardV6SupplementalSnapshot {
  const result = governmentScorecardV6SupplementalSnapshotSchema.safeParse(input);
  if (!result.success) throw new GovernmentScorecardV6SupplementalContractError(result.error);
  return result.data;
}

let cachedSnapshot: GovernmentScorecardV6SupplementalSnapshot | undefined;

export function getGovernmentScorecardV6SupplementalSnapshot(): GovernmentScorecardV6SupplementalSnapshot {
  cachedSnapshot ??= parseGovernmentScorecardV6SupplementalSnapshot(supplementalSnapshot);
  return cachedSnapshot;
}
