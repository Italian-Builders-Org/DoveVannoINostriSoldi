import "server-only";

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { z } from "zod";

import scoreData from "@/data/generated/government-scorecard.json";
import pageData from "@/data/generated/government-scorecard-page.json";
import chronology from "../../scripts/etl/specs/government-scorecard-chronology.json";
import methodology from "../../scripts/etl/specs/government-scorecard-methodology.json";
import pageProvenance from "../../scripts/etl/specs/government-scorecard-page.source.json";
import scoreProvenance from "../../scripts/etl/specs/government-scorecard.source.json";
import { getGovernmentScorecardV6SupplementalSnapshot } from "@/lib/data/government-scorecard-page-contract";
import { GOVERNMENT_SCORECARD_DOWNLOADS } from "@/lib/government-scorecard-download-links";
import {
  getGovernmentScorecardV6View,
  GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS,
} from "@/lib/government-scorecard-governments";

const DOWNLOAD_DEFINITIONS = GOVERNMENT_SCORECARD_DOWNLOADS;

type GovernmentScorecardDownloadId = (typeof DOWNLOAD_DEFINITIONS)[number]["id"];
export const MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES = 4_500_000;

const PAYLOADS: Record<GovernmentScorecardDownloadId, unknown> = {
  methodology,
  chronology,
  "score-data": scoreData,
  "page-data": pageData,
  "score-provenance": scoreProvenance,
  "page-provenance": pageProvenance,
};

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T/);

const downloadSchema = z.object({
  id: z.enum(DOWNLOAD_DEFINITIONS.map((download) => download.id)),
  filename: z.string().regex(/^[a-z0-9-]+\.json(?:\.gz)?$/),
  category: z.enum(["methodology", "chronology", "data", "provenance"]),
  label: z.string().min(1),
  description: z.string().min(1),
  format: z.literal("json"),
  compression: z.enum(["none", "gzip"]),
  content_type: z.enum(["application/json; charset=utf-8", "application/gzip"]),
  bytes: z.number().int().positive(),
  sha256,
  href: z.string().regex(/^\/api\/governi\/dati\/[a-z0-9-]+$/),
}).strict();

const indicatorSchema = z.object({
  id: z.string().regex(/^(?:score|page):[a-z0-9_]+$/),
  indicator_id: z.string().regex(/^[a-z0-9_]+$/),
  data_role: z.enum(["score_data", "page_data"]),
  source_owner: z.string().min(1),
  dataset_code: z.string().min(1),
  series_or_query: z.array(z.string().min(1)).min(1),
  unit: z.string().min(1),
  frequency: z.enum(["annual", "quarterly", "monthly"]),
  period: z.string().min(1),
  vintage: z.string().min(1),
  transformation: z.string().min(1),
  acquired_at: timestamp,
  sha256,
  record_download_id: z.enum(["score-data", "page-data"]),
  provenance_download_id: z.enum(["score-provenance", "page-provenance"]),
}).strict();

const manifestSchema = z.object({
  schema_version: z.literal(1),
  methodology_version: z.literal("peer-relative-v6"),
  as_of_date: z.string().min(10),
  data_roles: z.tuple([
    z.literal("score_data"),
    z.literal("page_data"),
    z.literal("editorial_context"),
  ]),
  downloads: z.array(downloadSchema).length(DOWNLOAD_DEFINITIONS.length),
  indicators: z.array(indicatorSchema).length(15),
  editorial_context: z.object({
    data_role: z.literal("editorial_context"),
    score_impact: z.literal("none"),
    record_download_id: z.literal("page-data"),
    provenance_download_id: z.literal("page-provenance"),
    note: z.string().min(1),
  }).strict(),
  verification: z.object({
    offline: z.object({
      command: z.literal("npm run government-scorecard:verify"),
      scope: z.string().min(1),
    }).strict(),
    online: z.object({
      workflow: z.literal(".github/workflows/government-scorecard-refresh.yml"),
      scope: z.string().min(1),
    }).strict(),
  }).strict(),
}).strict();

function serialize(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function serializeGovernmentScorecardDownloadJson(payload: unknown): string {
  return serialize(payload);
}

type GovernmentScorecardDownloadBody = string | Uint8Array<ArrayBuffer>;

function bodyBytes(body: GovernmentScorecardDownloadBody): number {
  return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
}

function digestBody(body: GovernmentScorecardDownloadBody): string {
  return createHash("sha256").update(body).digest("hex");
}

function deterministicGzip(body: string): Uint8Array<ArrayBuffer> {
  const compressed = gzipSync(Buffer.from(body), { level: 9 });
  compressed.writeUInt32LE(0, 4);
  compressed[9] = 255;
  return new Uint8Array(compressed);
}

export function assertGovernmentScorecardFunctionResponseSize(
  bytes: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(bytes)
    || bytes < 0
    || bytes > MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES
  ) {
    throw new GovernmentScorecardDownloadContractError(
      `${label}: risposta oltre il limite di 4.500.000 byte`,
    );
  }
}

function buildDownloadArtifact(definition: (typeof DOWNLOAD_DEFINITIONS)[number]) {
  const json = serializeGovernmentScorecardDownloadJson(PAYLOADS[definition.id]);
  const compression = definition.id === "page-data" ? "gzip" as const : "none" as const;
  const body = compression === "gzip" ? deterministicGzip(json) : json;
  const bytes = bodyBytes(body);
  assertGovernmentScorecardFunctionResponseSize(bytes, definition.id);
  return {
    id: definition.id,
    filename: definition.filename,
    category: definition.category,
    label: definition.label,
    description: definition.description,
    format: "json" as const,
    compression,
    contentType: compression === "gzip"
      ? "application/gzip" as const
      : "application/json; charset=utf-8" as const,
    body,
    bytes,
    sha256: digestBody(body),
  };
}

function downloadEntries() {
  return DOWNLOAD_DEFINITIONS.map((definition) => {
    const artifact = buildDownloadArtifact(definition);
    return {
      id: artifact.id,
      filename: artifact.filename,
      category: artifact.category,
      label: artifact.label,
      description: artifact.description,
      format: artifact.format,
      compression: artifact.compression,
      content_type: artifact.contentType,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      href: definition.href,
    };
  });
}

function scoreIndicatorEntries() {
  const source = scoreData.sources.ameco;
  return methodology.indicators.map((indicator) => ({
    id: `score:${indicator.id}`,
    indicator_id: indicator.id,
    data_role: "score_data" as const,
    source_owner: methodology.source.source_owner,
    dataset_code: methodology.source.dataset_code,
    series_or_query: indicator.source_series.map((series) => series.selector_template),
    unit: indicator.unit,
    frequency: "annual" as const,
    period: `1960-${source.forecastThrough}; osservati fino al ${source.observedThrough}; previsioni escluse dal voto`,
    vintage: methodology.source.vintage,
    transformation: indicator.transformation,
    acquired_at: source.retrievedAt,
    sha256: source.sha256,
    record_download_id: "score-data" as const,
    provenance_download_id: "score-provenance" as const,
  }));
}

function pageIndicatorEntries() {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const sourceByDatasetCode = new Map(snapshot.sources.map((source) => [source.dataset_code, source]));

  return snapshot.series.map((series) => {
    const points = series.geographies.flatMap((geography) => geography.points);
    const firstPoint = points[0];
    if (!firstPoint) throw new Error(`serie di pagina priva di punti: ${series.indicator_id}`);
    const componentSources = firstPoint.component_sources?.map((component) =>
      sourceByDatasetCode.get(component.dataset_code)) ?? [];
    const sources = componentSources.length > 0
      ? componentSources
      : [sourceById.get(firstPoint.source_id)];
    if (sources.some((source) => source === undefined)) {
      throw new Error(`provenienza di pagina mancante: ${series.indicator_id}`);
    }
    const verifiedSources = sources.filter((source) => source !== undefined);
    const firstPeriod = points.map((point) => point.period).toSorted()[0];
    const transformation = firstPoint.derivation?.formula ?? "published_source_value";
    return {
      id: `page:${series.indicator_id}`,
      indicator_id: series.indicator_id,
      data_role: "page_data" as const,
      source_owner: [...new Set(verifiedSources.map((source) => source.owner))].join(" + "),
      dataset_code: [...new Set(verifiedSources.map((source) => source.dataset_code))].join(" + "),
      series_or_query: verifiedSources.map((source) => source.query_url),
      unit: firstPoint.unit,
      frequency: series.frequency,
      period: `${firstPeriod}-${series.latest_published_period}`,
      vintage: [...new Set(verifiedSources.map((source) => source.source_version ?? source.upstream_updated_at))].join(" + "),
      transformation,
      acquired_at: firstPoint.retrieved_at,
      sha256: firstPoint.raw_sha256,
      record_download_id: "page-data" as const,
      provenance_download_id: "page-provenance" as const,
    };
  });
}

function buildManifest() {
  return {
    schema_version: 1 as const,
    methodology_version: "peer-relative-v6" as const,
    as_of_date: pageData.as_of_date,
    data_roles: ["score_data", "page_data", "editorial_context"] as const,
    downloads: downloadEntries(),
    indicators: [...scoreIndicatorEntries(), ...pageIndicatorEntries()],
    editorial_context: {
      data_role: "editorial_context" as const,
      score_impact: "none" as const,
      record_download_id: "page-data" as const,
      provenance_download_id: "page-provenance" as const,
      note: "Contesto selezionato e revisionato editorialmente: ogni elemento conserva fonti ufficiali, periodo, data di acquisizione e hash della prova; non modifica il voto.",
    },
    verification: {
      offline: {
        command: "npm run government-scorecard:verify" as const,
        scope: "Valida offline gli snapshot congelati, il calcolo, gli hash e la riconciliazione della provenienza senza ricreare i payload raw non conservati.",
      },
      online: {
        workflow: ".github/workflows/government-scorecard-refresh.yml" as const,
        scope: "Il refresh online interroga le fonti ufficiali e propone separatamente eventuali nuovi snapshot verificati.",
      },
    },
  };
}

export type GovernmentScorecardDownloadManifest = z.infer<typeof manifestSchema>;

export class GovernmentScorecardDownloadContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GovernmentScorecardDownloadContractError";
  }
}

export function validateGovernmentScorecardDownloadManifest(
  input: unknown,
): GovernmentScorecardDownloadManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new GovernmentScorecardDownloadContractError(
      "manifest download privo di provenienza o incoerente",
      { cause: parsed.error },
    );
  }
  const expected = buildManifest();
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
    throw new GovernmentScorecardDownloadContractError(
      "manifest download o hash sha256 divergente dagli artefatti registrati",
    );
  }
  return parsed.data;
}

let cachedManifest: GovernmentScorecardDownloadManifest | undefined;

export function getGovernmentScorecardDownloadManifest(): GovernmentScorecardDownloadManifest {
  cachedManifest ??= validateGovernmentScorecardDownloadManifest(buildManifest());
  return cachedManifest;
}

export function getGovernmentScorecardDownload(id: string) {
  const definition = DOWNLOAD_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) return null;
  return buildDownloadArtifact(definition);
}

export function reconcileGovernmentScorecardPageProvenance() {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const sourceByDatasetCode = new Map(snapshot.sources.map((source) => [source.dataset_code, source]));
  let charts = 0;
  let displayedValues = 0;
  let contextItems = 0;

  for (const governmentId of GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS) {
    const view = getGovernmentScorecardV6View(governmentId);
    if (view.charts.status !== "ready") {
      throw new GovernmentScorecardDownloadContractError(`grafici non disponibili per ${governmentId}`);
    }
    for (const chart of view.charts.slides) {
      charts += 1;
      const frozenSeries = snapshot.series.find((series) => series.indicator_id === chart.indicator_id);
      if (!frozenSeries) {
        throw new GovernmentScorecardDownloadContractError(`record di pagina mancante per ${chart.indicator_id}`);
      }
      for (const displayedSeries of chart.series) {
        const frozenGeography = frozenSeries.geographies.find(
          (geography) => geography.geography === displayedSeries.id,
        );
        if (!frozenGeography) {
          throw new GovernmentScorecardDownloadContractError(
            `geografia mancante per ${chart.indicator_id}:${displayedSeries.id}`,
          );
        }
        for (const displayedPoint of displayedSeries.points) {
          const record = frozenGeography.points.find((point) => point.period === displayedPoint.period);
          if (
            !record
            || record.value !== displayedPoint.value
            || record.period_start !== displayedPoint.period_start
            || record.status !== displayedPoint.status
          ) {
            throw new GovernmentScorecardDownloadContractError(
              `valore UI non riconciliato: ${chart.indicator_id}:${displayedSeries.id}:${displayedPoint.period}`,
            );
          }
          if (record.component_sources) {
            for (const component of record.component_sources) {
              const receipt = sourceByDatasetCode.get(component.dataset_code);
              if (
                !receipt
                || receipt.raw_sha256 !== component.raw_sha256
                || receipt.query_url !== component.source_url
              ) {
                throw new GovernmentScorecardDownloadContractError(
                  `ricevuta componente mancante: ${chart.indicator_id}:${component.dataset_code}`,
                );
              }
            }
          } else {
            const receipt = sourceById.get(record.source_id);
            if (
              !receipt
              || receipt.owner !== record.source_owner
              || receipt.query_url !== record.source_url
              || receipt.retrieved_at !== record.retrieved_at
              || receipt.raw_sha256 !== record.raw_sha256
            ) {
              throw new GovernmentScorecardDownloadContractError(
                `ricevuta fonte mancante: ${chart.indicator_id}:${record.source_id}`,
              );
            }
          }
          displayedValues += 1;
        }
      }
    }

    const frozenContext = snapshot.contexts.find((context) => context.government_id === governmentId);
    if (!frozenContext) {
      throw new GovernmentScorecardDownloadContractError(`contesto congelato mancante per ${governmentId}`);
    }
    for (const slide of view.context.slides) {
      const frozenSlide = frozenContext.slides.find((candidate) => candidate.category === slide.category);
      if (!frozenSlide) {
        throw new GovernmentScorecardDownloadContractError(
          `provenienza contesto mancante: ${governmentId}:${slide.category}`,
        );
      }
      for (const item of slide.items) {
        const record = frozenSlide.items.find((candidate) => candidate.id === item.id);
        if (
          !record
          || record.summary !== item.summary
          || record.evidence_sha256 !== item.evidence_sha256
          || JSON.stringify(record.sources) !== JSON.stringify(item.sources)
        ) {
          throw new GovernmentScorecardDownloadContractError(
            `elemento editoriale non riconciliato: ${governmentId}:${item.id}`,
          );
        }
        contextItems += 1;
      }
    }
  }

  return {
    governments: GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.length,
    charts,
    displayed_values: displayedValues,
    context_items: contextItems,
    source_receipts: snapshot.sources.length,
  };
}
