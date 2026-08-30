import { discoverLatestStatePaymentDataset } from "@/lib/bdap-payments";
import { discoverMopDataset } from "@/lib/bdap-public-works";
import { classifyFreshness, type Freshness } from "@/lib/data/freshness";
import { fetchOfficialSource } from "@/lib/data/source-fetch";
import {
  SOURCE_IDS,
  SOURCE_POLICIES,
  type SourceId,
  type SourcePolicy,
} from "@/lib/data/source-policy";
import { IPA_ENTI_RESOURCE_ID } from "@/lib/ipa";
import { IPA_AOO_RESOURCE_ID, IPA_UO_RESOURCE_ID } from "@/lib/ipa-structure";
import { mefParticipationsSnapshot } from "@/lib/mef-participations-snapshot";
import { openCoesioneSnapshot } from "@/lib/opencoesione-snapshot";
import { consulentiSnapshot } from "@/lib/consulenti-snapshot";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import parliamentManifest from "@/data/generated/parliament-source-manifest.json";
import pcmMetadata from "@/data/generated/pcm-financial-2024.meta.json";
import pcmData from "@/data/generated/pcm-financial-2024.data.json";
import { anacCigSnapshot } from "@/lib/anac-cig-snapshot";
import { inpsCivilInvaliditySnapshot } from "@/lib/inps-invalidity-snapshot";
import { cptRegionalFiscalSnapshot } from "@/lib/cpt-regional-fiscal-snapshot";
import { istatPensionsSnapshot } from "@/lib/istat-pensions-snapshot";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { PNRR_CHILDCARE_SOURCE } from "@/lib/data/pnrr-childcare-source";
import { getSsnCceSourceHealth, type SsnCceSourceHealth } from "@/lib/ssn-cce-snapshot";
import { getPublicDebtSnapshot } from "@/lib/public-debt";
import { getGovernmentScorecardSnapshot } from "@/lib/government-scorecard";
import { getGovernmentScorecardForecastCoverage } from "@/lib/data/government-scorecard-contract";
import { getGovernmentCurrentSignalsSnapshot } from "@/lib/government-current-signals";
import istatMunicipalityGeographyMetadata from "@/data/generated/istat-municipality-geography.meta.json";

export type SourceIntegrationState = "active";
export type SourceReachability = "up" | "down" | "not-probed";

export type SourceHealth = {
  sourceId: SourceId;
  label: string;
  owner: string;
  integration: SourceIntegrationState;
  reachability: SourceReachability;
  freshness: Freshness;
  checkedAt: string;
  latencyMs: number | null;
  detail: string | null;
  recordCount: number | null;
  /**
   * Version-pinned artifact checks attached to a source adapter. These are
   * descriptive runtime results; they never trigger a source refresh.
   */
  snapshot?: SsnCceSourceHealth;
  policy: Pick<
    SourcePolicy,
    | "cadence"
    | "cadenceNote"
    | "discoveryRevalidateSeconds"
    | "dataRevalidateSeconds"
    | "staleAfterSeconds"
    | "sourceUrl"
  >;
};

type CkanDatastoreHealthResponse = {
  success?: boolean;
  result?: {
    total?: number;
  };
};

type CkanResourceResponse = {
  success?: boolean;
  result?: {
    last_modified?: unknown;
    metadata_modified?: unknown;
  };
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

type IstatMunicipalityGeographyMetadata = Readonly<{
  schemaVersion: 1;
  datasetId: "istat-municipality-geography";
  generatedAt: string;
  availableYears: number[];
  latest: Readonly<{
    year: number;
    sourceTimestamp: string;
    municipalities: number;
  }>;
}>;

export function validateIstatMunicipalityGeographyMetadata(
  value: unknown,
): IstatMunicipalityGeographyMetadata {
  const metadata = value as Partial<IstatMunicipalityGeographyMetadata>;
  const years = metadata.availableYears;
  const latest = metadata.latest;
  const validIsoDate = (date: unknown) =>
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
    !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf());

  if (
    metadata.schemaVersion !== 1 ||
    metadata.datasetId !== "istat-municipality-geography" ||
    typeof metadata.generatedAt !== "string" ||
    Number.isNaN(new Date(metadata.generatedAt).valueOf()) ||
    !Array.isArray(years) ||
    years.length === 0 ||
    !years.every((year, index) =>
      Number.isSafeInteger(year) && (index === 0 || year > years[index - 1]!),
    ) ||
    !latest ||
    latest.year !== years.at(-1) ||
    !validIsoDate(latest.sourceTimestamp) ||
    !Number.isSafeInteger(latest.municipalities) ||
    latest.municipalities < 7_800
  ) {
    throw new Error("Metadati health ISTAT SITUAS non validi");
  }

  return metadata as IstatMunicipalityGeographyMetadata;
}

function freshnessFor(sourceId: SourceId, sourceTimestamp: string | null): Freshness {
  return classifyFreshness(
    SOURCE_POLICIES[sourceId].staleAfterSeconds,
    sourceTimestamp,
  );
}

function baseHealth(
  sourceId: SourceId,
): Omit<
  SourceHealth,
  "reachability" | "freshness" | "latencyMs" | "detail" | "recordCount"
> {
  const policy = SOURCE_POLICIES[sourceId];
  return {
    sourceId,
    label: policy.label,
    owner: policy.owner,
    integration: "active",
    checkedAt: new Date().toISOString(),
    policy: {
      cadence: policy.cadence,
      cadenceNote: policy.cadenceNote,
      discoveryRevalidateSeconds: policy.discoveryRevalidateSeconds,
      dataRevalidateSeconds: policy.dataRevalidateSeconds,
      staleAfterSeconds: policy.staleAfterSeconds,
      sourceUrl: policy.sourceUrl,
    },
  };
}

async function getIpaRecordCount(): Promise<number | null> {
  const url = `https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search?${new URLSearchParams({
    resource_id: IPA_ENTI_RESOURCE_ID,
    limit: "0",
  }).toString()}`;
  const response = await fetchOfficialSource("ipa", url, {
    kind: "discovery",
    headers: { Accept: "application/json" },
    tags: ["health:ipa", "dataset:ipa-enti"],
  });

  if (!response.ok) throw new Error(`IPA datastore HTTP ${response.status}`);
  const payload = (await response.json()) as CkanDatastoreHealthResponse;
  if (!payload.success) throw new Error("Risposta datastore IPA non valida");
  return typeof payload.result?.total === "number" ? payload.result.total : null;
}

async function getIpaResourceTimestamp(): Promise<string | null> {
  const url = `https://indicepa.gov.it/ipa-dati/api/3/action/resource_show?${new URLSearchParams({
    id: IPA_ENTI_RESOURCE_ID,
  }).toString()}`;
  const response = await fetchOfficialSource("ipa", url, {
    kind: "discovery",
    headers: { Accept: "application/json" },
    tags: ["health:ipa", "metadata:ipa-enti"],
  });

  if (!response.ok) throw new Error(`IPA resource_show HTTP ${response.status}`);
  const payload = (await response.json()) as CkanResourceResponse;
  if (!payload.success || !payload.result) {
    throw new Error("Risposta resource_show IPA non valida");
  }

  return text(payload.result.last_modified) ?? text(payload.result.metadata_modified);
}

async function probeIpa(): Promise<SourceHealth> {
  const base = baseHealth("ipa");
  const startedAt = performance.now();
  const [countResult, timestampResult] = await Promise.allSettled([
    getIpaRecordCount(),
    getIpaResourceTimestamp(),
  ]);
  const latencyMs = Math.round(performance.now() - startedAt);

  if (countResult.status === "rejected") {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("ipa", null),
      latencyMs,
      detail:
        countResult.reason instanceof Error
          ? countResult.reason.message
          : "Errore sconosciuto durante il probe IPA",
      recordCount: null,
    };
  }

  const sourceTimestamp =
    timestampResult.status === "fulfilled" ? timestampResult.value : null;
  const metadataDetail =
    timestampResult.status === "rejected"
      ? " · timestamp ufficiale non disponibile"
      : "";

  return {
    ...base,
    reachability: "up",
    freshness: freshnessFor("ipa", sourceTimestamp),
    latencyMs,
    detail: `Data API Enti raggiungibile${metadataDetail}`,
    recordCount: countResult.value,
  };
}

async function getIpaStructureResource(resourceId: string): Promise<{
  count: number | null;
  timestamp: string | null;
}> {
  const countUrl = `https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search?${new URLSearchParams({
    resource_id: resourceId,
    limit: "0",
  }).toString()}`;
  const metadataUrl = `https://indicepa.gov.it/ipa-dati/api/3/action/resource_show?${new URLSearchParams({
    id: resourceId,
  }).toString()}`;
  const [countResponse, metadataResponse] = await Promise.all([
    fetchOfficialSource("ipa-struttura", countUrl, {
      kind: "discovery",
      headers: { Accept: "application/json" },
      tags: ["health:ipa-structure", `resource:${resourceId}`],
    }),
    fetchOfficialSource("ipa-struttura", metadataUrl, {
      kind: "discovery",
      headers: { Accept: "application/json" },
      tags: ["health:ipa-structure", `metadata:${resourceId}`],
    }),
  ]);

  if (!countResponse.ok || !metadataResponse.ok) {
    throw new Error(`IPA struttura HTTP ${countResponse.status}/${metadataResponse.status}`);
  }
  const countPayload = (await countResponse.json()) as CkanDatastoreHealthResponse;
  const metadataPayload = (await metadataResponse.json()) as CkanResourceResponse;
  if (!countPayload.success || !metadataPayload.success || !metadataPayload.result) {
    throw new Error("Risposta struttura IPA non valida");
  }
  return {
    count: typeof countPayload.result?.total === "number" ? countPayload.result.total : null,
    timestamp: text(metadataPayload.result.last_modified) ?? text(metadataPayload.result.metadata_modified),
  };
}

async function probeIpaStructure(): Promise<SourceHealth> {
  const base = baseHealth("ipa-struttura");
  const startedAt = performance.now();
  try {
    const [units, areas] = await Promise.all([
      getIpaStructureResource(IPA_UO_RESOURCE_ID),
      getIpaStructureResource(IPA_AOO_RESOURCE_ID),
    ]);
    const timestamps = [units.timestamp, areas.timestamp].filter((value): value is string => Boolean(value));
    const oldestTimestamp = timestamps.length === 2 ? timestamps.sort().at(0) ?? null : null;
    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("ipa-struttura", oldestTimestamp),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `UO: ${units.count ?? "non disponibile"} · AOO: ${areas.count ?? "non disponibile"}`,
      recordCount: (units.count ?? 0) + (areas.count ?? 0),
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("ipa-struttura", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : "Errore sconosciuto",
      recordCount: null,
    };
  }
}

async function probeOpenBdap(): Promise<SourceHealth> {
  const base = baseHealth("openbdap");
  const startedAt = performance.now();
  const ssnCce = getSsnCceSourceHealth();

  try {
    const [latest, mop] = await Promise.all([
      discoverLatestStatePaymentDataset("mission", { maxMonthsBack: 6 }),
      discoverMopDataset(),
    ]);
    const timestamps = [latest.metadataModified, mop.metadata.referenceDate]
      .filter((value): value is string => Boolean(value))
      .map((value) => ({ value, time: new Date(value).valueOf() }))
      .filter((entry) => !Number.isNaN(entry.time))
      .sort((left, right) => left.time - right.time);

    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("openbdap", timestamps.at(0)?.value ?? null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `Pagamenti: ${latest.title} · MOP aggiornato al ${mop.metadata.referenceDate} · ${mop.schema.cupCardinality.toLocaleString("it-IT")} CUP distinti · SSN 2024: artifact e 3 input verificati`,
      recordCount: mop.schema.localProjectCardinality,
      snapshot: ssnCce,
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("openbdap", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `${error instanceof Error ? error.message : "Errore sconosciuto"} · SSN 2024: artifact e 3 input verificati`,
      recordCount: null,
      snapshot: ssnCce,
    };
  }
}

async function probeSiope(): Promise<SourceHealth> {
  const base = baseHealth("siope");
  const startedAt = performance.now();
  const year = new Date().getUTCFullYear();
  const url = `https://www.siope.it/documenti/siope2/open/last/SIOPE_USCITE.${year}.zip`;

  try {
    const response = await fetchOfficialSource("siope", url, {
      kind: "discovery",
      headers: {
        Accept: "application/zip, application/octet-stream;q=0.9, */*;q=0.5",
        Range: "bytes=0-0",
      },
      tags: ["health:siope", `dataset:siope-uscite-${year}`],
    });

    if (!response.ok) throw new Error(`SIOPE open data HTTP ${response.status}`);
    const sourceTimestamp = response.headers.get("last-modified");
    const range = response.headers.get("content-range");
    await response.body?.cancel();

    return {
      ...base,
      reachability: "up",
      freshness: freshnessFor("siope", sourceTimestamp),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: range
        ? `File nazionale uscite ${year} raggiungibile · ${range}`
        : `File nazionale uscite ${year} raggiungibile`,
      recordCount: null,
    };
  } catch (error) {
    return {
      ...base,
      reachability: "down",
      freshness: freshnessFor("siope", null),
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : "Errore sconosciuto",
      recordCount: null,
    };
  }
}

function snapshotManagedOpenCoesione(): SourceHealth {
  return {
    ...baseHealth("opencoesione"),
    reachability: "not-probed",
    freshness: freshnessFor("opencoesione", openCoesioneSnapshot.referenceDate),
    latencyMs: null,
    detail:
      "Snapshot ETL attivo; reachability controllata dal workflow dedicato, non da questo endpoint.",
    recordCount: openCoesioneSnapshot.totals.projects,
  };
}

function snapshotManagedPnrrChildcare(): SourceHealth {
  return {
    ...baseHealth(PNRR_CHILDCARE_SOURCE.id),
    reachability: "not-probed",
    freshness: freshnessFor(PNRR_CHILDCARE_SOURCE.id, PNRR_CHILDCARE_SOURCE.health.publishedAt),
    latencyMs: null,
    detail: PNRR_CHILDCARE_SOURCE.health.detail,
    recordCount: PNRR_CHILDCARE_SOURCE.health.recordCount,
  };
}

function snapshotManagedAnac(): SourceHealth {
  const latestSourceModified = anacCigSnapshot.inputs
    .map((input) => input.sourceLastModified)
    .sort()
    .at(-1) ?? null;
  return {
    ...baseHealth("anac"),
    reachability: "not-probed",
    freshness: freshnessFor("anac", latestSourceModified),
    latencyMs: null,
    detail: `Snapshot verificato il ${anacCigSnapshot.observedAt} · CIG ${anacCigSnapshot.referenceYear} · 12 distribuzioni mensili`,
    recordCount: anacCigSnapshot.population.records,
  };
}

function snapshotManagedInps(): SourceHealth {
  const latestSourceDate = inpsCivilInvaliditySnapshot.sources
    .map((source) => source.documentDate)
    .sort()
    .at(-1) ?? null;
  const regionalRecords =
    inpsCivilInvaliditySnapshot.regionalNewPensions.regions.length *
    inpsCivilInvaliditySnapshot.regionalNewPensions.years.length;
  return {
    ...baseHealth("inps"),
    reachability: "not-probed",
    freshness: freshnessFor("inps", latestSourceDate),
    latencyMs: null,
    detail:
      "Snapshot verificato · spesa nazionale 2021-2025 · nuove pensioni per regione 2016-2024",
    recordCount: regionalRecords + inpsCivilInvaliditySnapshot.spending.series.length,
  };
}

function snapshotManagedCpt(): SourceHealth {
  return {
    ...baseHealth("cpt"),
    reachability: "not-probed",
    freshness: freshnessFor("cpt", null),
    latencyMs: null,
    detail: `Snapshot verificato il ${cptRegionalFiscalSnapshot.provenance.observedAt.slice(0, 10)} · dati ${cptRegionalFiscalSnapshot.referenceYears.at(0)}-${cptRegionalFiscalSnapshot.referenceYears.at(-1)} · 21 territori`,
    recordCount: cptRegionalFiscalSnapshot.rows.length,
  };
}

function snapshotManagedMefIrpef(): SourceHealth {
  return {
    ...baseHealth(MEF_IRPEF_SOURCE.id),
    reachability: "not-probed",
    freshness: freshnessFor(MEF_IRPEF_SOURCE.id, MEF_IRPEF_SOURCE.health.publishedAt),
    latencyMs: null,
    detail: MEF_IRPEF_SOURCE.health.detail,
    recordCount: MEF_IRPEF_SOURCE.health.recordCount,
  };
}

function snapshotManagedIstat(): SourceHealth {
  const metadata = validateIstatMunicipalityGeographyMetadata(
    istatMunicipalityGeographyMetadata,
  );
  return {
    ...baseHealth("istat"),
    reachability: "not-probed",
    freshness: freshnessFor("istat", metadata.latest.sourceTimestamp),
    latencyMs: null,
    detail: `Snapshot SITUAS generato il ${metadata.generatedAt.slice(0, 10)} · dati al ${metadata.latest.sourceTimestamp} · geografia comunale ${metadata.latest.year} · ${metadata.latest.municipalities.toLocaleString("it-IT")} comuni · serie ${metadata.availableYears.at(0)}-${metadata.latest.year}`,
    recordCount: metadata.latest.municipalities,
  };
}

function snapshotManagedIstatCasellarioPensioni(): SourceHealth {
  const { data, metadata } = istatPensionsSnapshot;
  const pensionBenefits = data.pensionBenefits.observations;
  const pensioners = data.pensioners.observations;
  const benefitsObservedAt = metadata.source.assets.pensionBenefits.observedAt;
  const pensionersObservedAt = metadata.source.assets.pensioners.observedAt;
  const observedAt = benefitsObservedAt === pensionersObservedAt ? benefitsObservedAt : null;
  const artifact = metadata.integrity.dataArtifact;
  return {
    ...baseHealth("istat-casellario-pensioni"),
    reachability: "not-probed",
    freshness: freshnessFor("istat-casellario-pensioni", observedAt),
    latencyMs: null,
    detail: `Snapshot ISTAT Casellario dei pensionati verificato · dati ${data.period.from}-${data.period.to} · pensioni e pensionati separati · ${artifact.bytes.toLocaleString("it-IT")} byte · check offline-source-lock-and-snapshot-contract`,
    recordCount: pensionBenefits.length + pensioners.length,
  };
}

function snapshotManagedMefParticipations(): SourceHealth {
  return {
    ...baseHealth("partecipazioni-pubbliche"),
    reachability: "not-probed",
    freshness: freshnessFor("partecipazioni-pubbliche", mefParticipationsSnapshot.publishedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · rilevazione ${mefParticipationsSnapshot.referenceYear}`,
    recordCount: mefParticipationsSnapshot.totals.participationRecords,
  };
}

function snapshotManagedConsulenti(): SourceHealth {
  const latest = consulentiSnapshot.externalAppointments.at(-1);
  return {
    ...baseHealth("consulenti"),
    reachability: "not-probed",
    freshness: freshnessFor("consulenti", null),
    latencyMs: null,
    detail: `Snapshot estratto il ${consulentiSnapshot.source.observedAt.slice(0, 10)} · ultimo anno disponibile ${consulentiSnapshot.latestYear}, parziale`,
    recordCount: latest?.assignments ?? null,
  };
}

function snapshotManagedOpenCivitas(): SourceHealth {
  return {
    ...baseHealth("opencivitas"),
    reachability: "not-probed",
    freshness: freshnessFor("opencivitas", openCivitasSnapshot.publishedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · dati ${openCivitasSnapshot.referenceYear}`,
    recordCount: openCivitasSnapshot.coverage.municipalities,
  };
}

function snapshotManagedCamera(): SourceHealth {
  const camera = parliamentSnapshot.chambers.find((chamber) => chamber.id === "camera");
  return {
    ...baseHealth("camera"),
    reachability: "not-probed",
    freshness: freshnessFor("camera", null),
    latencyMs: null,
    detail: `Snapshot verificato il ${parliamentSnapshot.observedAt.slice(0, 10)} · consuntivo e bilancio collegati ai documenti ufficiali della Camera.`,
    recordCount: camera?.statements.length ?? null,
  };
}

function snapshotManagedSenate(): SourceHealth {
  return {
    ...baseHealth("senato"),
    reachability: "not-probed",
    freshness: freshnessFor("senato", null),
    latencyMs: null,
    detail: `Metadati verificati il ${parliamentManifest.verifiedAt.slice(0, 10)} · importi esclusi finché i PDF contabili non sono acquisiti e verificati.`,
    recordCount: parliamentManifest.senato.latestDocuments.length,
  };
}

function snapshotManagedPcm(): SourceHealth {
  return {
    ...baseHealth("pcm"),
    reachability: "not-probed",
    freshness: freshnessFor("pcm", pcmMetadata.source.publishedAt),
    latencyMs: null,
    detail: `Rendiconto PCM ${pcmData.referenceYear} · workbook XLSX verificato e ${pcmData.coverage.sourceRows} righe riconciliate.`,
    recordCount: pcmData.coverage.sourceRows,
  };
}

function snapshotManagedPublicDebt(sourceId: "bancaditalia" | "eurostat"): SourceHealth {
  const snapshot = getPublicDebtSnapshot();
  const isBank = sourceId === "bancaditalia";
  return {
    ...baseHealth(sourceId),
    reachability: "not-probed",
    freshness: freshnessFor(sourceId, isBank ? snapshot.stock.referenceDate : `${snapshot.annualInterest.referenceYear}-12-31`),
    latencyMs: null,
    detail: isBank
      ? `Snapshot ETL attivo · stock al ${snapshot.stock.referenceDate} · quattro cubi BDS riconciliati.`
      : `Snapshot ETL attivo · interessi e spesa totale ${snapshot.annualInterest.referenceYear} riconciliati.`,
    recordCount: isBank ? snapshot.stock.history.length : snapshot.annualInterest.history.length,
  };
}

function snapshotManagedGovernmentCurrentSignals(): SourceHealth {
  const snapshot = getGovernmentCurrentSignalsSnapshot();
  const recordCount = snapshot.indicators.reduce(
    (total, indicator) => total + Object.values(indicator.countries)
      .reduce((countryTotal, series) => countryTotal + series.length, 0),
    0,
  );
  return {
    ...baseHealth("eurostat-hicp"),
    reachability: "not-probed",
    freshness: freshnessFor("eurostat-hicp", snapshot.source.sourceUpdatedAt),
    latencyMs: null,
    detail: `Snapshot ETL attivo · IPCA mensile fino a ${snapshot.source.referencePeriodThrough} (${snapshot.source.datasetCode}).`,
    recordCount,
  };
}

function snapshotManagedGovernmentScorecard(
  sourceId: "ameco" | "governi-presidenza",
): SourceHealth {
  const snapshot = getGovernmentScorecardSnapshot();
  const isAmeco = sourceId === "ameco";
  const source = isAmeco
    ? snapshot.sources.ameco
    : snapshot.sources.governmentChronology;
  const observationCount = snapshot.indicators.reduce(
    (total, indicator) => total + Object.values(indicator.countries)
      .reduce((countryTotal, series) => countryTotal + series.filter((point) => point.value != null).length, 0),
    0,
  );
  const forecastCoverage = getGovernmentScorecardForecastCoverage(snapshot);
  const forecastDetail = forecastCoverage.status === "complete"
    ? `previsioni complete ${forecastCoverage.fromYear}-${forecastCoverage.throughYear}`
    : `scenario previsionale non pubblicabile · copertura ${forecastCoverage.availableCells}/${forecastCoverage.requiredCells}`;

  return {
    ...baseHealth(sourceId),
    reachability: "not-probed",
    freshness: freshnessFor(sourceId, source.retrievedAt),
    latencyMs: null,
    detail: isAmeco
      ? `Snapshot ${snapshot.sources.ameco.release} verificato · osservazioni fino al ${snapshot.sources.ameco.observedThrough} · ${forecastDetail}.`
      : `Cronologia ufficiale verificata · ${snapshot.governments.length} governi dal ${snapshot.governments.at(0)?.startDate.slice(0, 4)} · mandato corrente identificato esplicitamente.`,
    recordCount: isAmeco ? observationCount : snapshot.governments.length,
  };
}

export function getSnapshotManagedSourceHealth(): SourceHealth[] {
  return [
    snapshotManagedAnac(),
    snapshotManagedInps(),
    snapshotManagedCpt(),
    snapshotManagedMefIrpef(),
    snapshotManagedIstat(),
    snapshotManagedIstatCasellarioPensioni(),
    snapshotManagedOpenCoesione(),
    snapshotManagedPnrrChildcare(),
    snapshotManagedOpenCivitas(),
    snapshotManagedMefParticipations(),
    snapshotManagedConsulenti(),
    snapshotManagedCamera(),
    snapshotManagedSenate(),
    snapshotManagedPcm(),
    snapshotManagedGovernmentScorecard("ameco"),
    snapshotManagedGovernmentScorecard("governi-presidenza"),
    snapshotManagedPublicDebt("bancaditalia"),
    snapshotManagedPublicDebt("eurostat"),
    snapshotManagedGovernmentCurrentSignals(),
  ];
}

type SourceHealthAdapter = () => SourceHealth | Promise<SourceHealth>;

/** One concrete health adapter for every source policy. */
export const SOURCE_HEALTH_ADAPTERS = Object.freeze({
  ameco: () => snapshotManagedGovernmentScorecard("ameco"),
  "governi-presidenza": () => snapshotManagedGovernmentScorecard("governi-presidenza"),
  ipa: probeIpa,
  "ipa-struttura": probeIpaStructure,
  openbdap: probeOpenBdap,
  anac: snapshotManagedAnac,
  inps: snapshotManagedInps,
  cpt: snapshotManagedCpt,
  "mef-irpef": snapshotManagedMefIrpef,
  siope: probeSiope,
  istat: snapshotManagedIstat,
  "istat-casellario-pensioni": snapshotManagedIstatCasellarioPensioni,
  opencoesione: snapshotManagedOpenCoesione,
  italiadomani: snapshotManagedPnrrChildcare,
  opencivitas: snapshotManagedOpenCivitas,
  consulenti: snapshotManagedConsulenti,
  camera: snapshotManagedCamera,
  senato: snapshotManagedSenate,
  pcm: snapshotManagedPcm,
  "partecipazioni-pubbliche": snapshotManagedMefParticipations,
  bancaditalia: () => snapshotManagedPublicDebt("bancaditalia"),
  eurostat: () => snapshotManagedPublicDebt("eurostat"),
  "eurostat-hicp": snapshotManagedGovernmentCurrentSignals,
} satisfies Record<SourceId, SourceHealthAdapter>);

/** Orders every adapter by the public registry and fails closed on omissions. */
export function orderSourceHealth(entries: readonly SourceHealth[]): SourceHealth[] {
  const bySource = new Map(entries.map((entry) => [entry.sourceId, entry]));
  return SOURCE_IDS.map((sourceId) => {
    const health = bySource.get(sourceId);
    if (!health) throw new Error(`Adapter operativo senza probe: ${sourceId}`);
    return health;
  });
}

export async function getSourceHealthOverview(): Promise<SourceHealth[]> {
  const entries = await Promise.all(SOURCE_IDS.map((sourceId) => {
    const adapter = SOURCE_HEALTH_ADAPTERS[sourceId] as SourceHealthAdapter | undefined;
    if (!adapter) throw new Error(`Adapter operativo senza probe: ${sourceId}`);
    return adapter();
  }));
  return orderSourceHealth(entries);
}
