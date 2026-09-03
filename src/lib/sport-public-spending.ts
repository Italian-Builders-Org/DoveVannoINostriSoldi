import "server-only";

import budgetLawSnapshotArtifact from "@/data/generated/openbdap-budget-law-missions.json";
import {
  validateBudgetLawSnapshotArtifact,
  type MissionEnactedAllocation,
} from "@/lib/bdap-legge-bilancio";
import {
  integratedRowChunkCount,
  type IntegratedPublicRow,
} from "@/lib/integrated-source-contract";
import {
  loadIntegratedDatasetChunk,
  loadIntegratedSourceBundle,
} from "@/lib/integrated-sources";
import { pcmFinancialMetadata, pcmFinancialSnapshot } from "@/lib/pcm-financial-snapshot";
import { rgsMinistriesMetadata, rgsMinistriesSnapshot } from "@/lib/rgs-ministries-snapshot";

export const SPORT_MISSION_LABEL = "Giovani e sport";
export const SPORT_PCM_MISSION_CODE = "30";
export const SPORT_RGS_MISSION_CODE = "030";

const OPENBDAP_CAPITOLI_DATASET = "openbdap-capitoli-2024-2026";
const PROCUREMENT_PARTECIPATE_DATASET = "procurement-partecipate";
const PARTECIPATE_AT_FOCUS_DATASET = "partecipate-at-focus";

/**
 * Curated MEF-participated entities already present in the integrated
 * `partecipate-statali-focus` corpus. Values must stay identical to that source;
 * tests verify the names against the committed rows.
 */
export const SPORT_FOCUS_ENTITIES = [
  {
    id: "sport-e-salute",
    name: "Sport e salute S.p.A.",
    ipa: "csspa",
    mefShare: "100%",
    parent: "Ministero dell'Economia e delle Finanze",
    siteUrl: "https://www.sportesalute.eu",
    sourceUrl:
      "https://www.de.mef.gov.it/it/attivita_istituzionali/partecipazioni/elenco_partecipazioni/",
    role:
      "Società partecipata al 100% dal MEF. Nella piattaforma compare tra le partecipate statali in focus; qui non pubblichiamo i suoi bilanci di esercizio.",
    atNameHints: ["sport e salute"] as const,
  },
  {
    id: "simico",
    name: "Infrastrutture Milano Cortina 2020-2026 S.p.A. (SIMICO)",
    ipa: "DUAF58ZW",
    mefShare: "35%",
    parent: "Ministero dell'Economia e delle Finanze",
    siteUrl: "https://www.simico.it",
    sourceUrl:
      "https://www.de.mef.gov.it/it/attivita_istituzionali/partecipazioni/elenco_partecipazioni/",
    role:
      "Società per le infrastrutture dei Giochi invernali Milano Cortina 2026. La quota MEF è un fatto di partecipazione, non un totale di spesa dell'evento.",
    atNameHints: ["simico", "milano cortina"] as const,
  },
  {
    id: "credito-sportivo",
    name: "ICSC S.p.A. - Istituto per il credito sportivo e culturale S.p.A.",
    ipa: "MDDV4KRP",
    mefShare: "80,44%",
    parent: "Ministero dell'Economia e delle Finanze",
    siteUrl: "https://www.creditosportivo.it",
    sourceUrl:
      "https://www.de.mef.gov.it/it/attivita_istituzionali/partecipazioni/elenco_partecipazioni/",
    role:
      "Istituto di credito sportivo e culturale con partecipazione MEF. Utile per capire gli attori, non per sommare finanziamenti alle missioni di bilancio.",
    atNameHints: ["icsc", "credito sportivo"] as const,
  },
] as const;

/**
 * Capitoli MEF della missione Giovani e sport con destinatario riconoscibile.
 * I numeri capitolo sono chiavi contabili della fonte OpenBDAP, non giudizi.
 */
export const SPORT_FOCUS_CHAPTERS = [
  {
    number: "1897",
    shortLabel: "Trasferimento a Sport e Salute S.p.A.",
    kind: "ente",
  },
  {
    number: "8014",
    shortLabel: "Commissario infrastrutture / Paralimpici Milano Cortina",
    kind: "evento",
  },
  {
    number: "2001",
    shortLabel: "Commissario logistica Milano Cortina 2026",
    kind: "evento",
  },
  {
    number: "8011",
    shortLabel: "Commissario Giochi del Mediterraneo Taranto 2026",
    kind: "evento",
  },
  {
    number: "7457",
    shortLabel: "Fondo Sport e Periferie (assegnato alla PCM)",
    kind: "fondo",
  },
  {
    number: "7469",
    shortLabel: "Credito Sportivo · Fondo italiano per lo sport",
    kind: "fondo",
  },
  {
    number: "1896",
    shortLabel: "Finanziamento CONI",
    kind: "ente",
  },
  {
    number: "2132",
    shortLabel: "Comitato Italiano Paralimpico",
    kind: "ente",
  },
] as const;

export type SportFocusEntity = (typeof SPORT_FOCUS_ENTITIES)[number];
export type SportFocusChapter = (typeof SPORT_FOCUS_CHAPTERS)[number];

export type SportMissionPoint = Readonly<{
  year: number;
  enactedEur: number;
}>;

export type SportProgramPoint = Readonly<{
  program: string;
  amountEur: number;
}>;

export type SportChapterPoint = Readonly<{
  number: string;
  shortLabel: string;
  kind: SportFocusChapter["kind"];
  chapterLabel: string;
  program: string;
  paid2025Eur: number | null;
  forecast2026Eur: number | null;
  sourceUrl: string | null;
}>;

export type SportEntityAtLinks = Readonly<{
  hubUrl: string | null;
  bandiUrl: string | null;
  affidamentiUrl: string | null;
  consulentiUrl: string | null;
  note: string | null;
}>;

export type SportEntityCard = SportFocusEntity &
  Readonly<{
    at: SportEntityAtLinks;
  }>;

export type SportProcurementSummary = Readonly<{
  entityId: "sport-e-salute";
  entityName: string;
  ipa: string;
  uniqueCig: number;
  rowsWithAmount: number;
  totalEur: number;
  maxSingleEur: number | null;
  sourceTitle: string;
  caveats: readonly string[];
}>;

export type SportPublicSpendingView = Readonly<{
  missionLabel: typeof SPORT_MISSION_LABEL;
  budgetLaw: Readonly<{
    sourceTitle: string;
    license: string;
    datasetUrl: string;
    observedAt: string;
    series: readonly SportMissionPoint[];
    latest: SportMissionPoint;
    previous: SportMissionPoint | null;
    deltaEur: number | null;
    deltaPct: number | null;
  }>;
  pcm: Readonly<{
    referenceYear: number;
    missionCode: string;
    missionLabel: string;
    commitmentsCents: number;
    paymentsCents: number;
    sourceTitle: string;
    sourceUrl: string;
    acquiredAt: string;
  }>;
  rgs: Readonly<{
    referenceYear: number;
    administrationLabel: string;
    missionCode: string;
    missionLabel: string;
    commitmentsCpCents: number;
    paymentsCompetenceCpCents: number;
    remainingCpCents: number;
    sourceTitle: string;
    sourceUrl: string;
    acquiredAt: string;
  }>;
  chapters: Readonly<{
    datasetTitle: string;
    datasetId: typeof OPENBDAP_CAPITOLI_DATASET;
    administrationLabel: string;
    missionRows: number;
    programs2026Forecast: readonly SportProgramPoint[];
    programs2025Paid: readonly SportProgramPoint[];
    focus: readonly SportChapterPoint[];
    caveats: readonly string[];
  }>;
  entities: readonly SportEntityCard[];
  procurement: SportProcurementSummary | null;
  outOfScope: readonly string[];
  readingNotes: readonly string[];
}>;

function requireMissionAllocations(
  allocations: readonly MissionEnactedAllocation[],
): SportMissionPoint[] {
  const points = allocations
    .filter((row) => row.mission === SPORT_MISSION_LABEL)
    .map((row) => ({ year: row.year, enactedEur: row.amountEur }))
    .sort((left, right) => left.year - right.year);
  if (points.length < 2) {
    throw new Error(`Serie Legge di Bilancio assente per la missione ${SPORT_MISSION_LABEL}`);
  }
  return points;
}

function cell(row: IntegratedPublicRow, key: string): string {
  const value = row.cells[key];
  return typeof value === "string" ? value.trim() : "";
}

function parseEuro(raw: string): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

async function loadAllDatasetRows(datasetId: string): Promise<{
  title: string;
  caveats: readonly string[];
  rows: readonly IntegratedPublicRow[];
}> {
  const bundle = await loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get(datasetId);
  if (!dataset || (dataset.publication !== "rows" && dataset.publication !== "source-index")) {
    throw new Error(`Dataset integrato assente o non pubblicabile a righe: ${datasetId}`);
  }
  const chunkCount = integratedRowChunkCount(dataset.publicRows);
  const rows: IntegratedPublicRow[] = [];
  for (let ordinal = 0; ordinal < chunkCount; ordinal += 1) {
    const chunk = await loadIntegratedDatasetChunk(bundle, dataset, ordinal);
    rows.push(...chunk.rows);
  }
  if (rows.length !== dataset.publicRows) {
    throw new Error(
      `Righe ${datasetId}: attese ${dataset.publicRows}, lette ${rows.length}`,
    );
  }
  return { title: dataset.title, caveats: dataset.caveats, rows };
}

function aggregatePrograms(
  rows: readonly IntegratedPublicRow[],
  amountKey: "pagato" | "previsioni_definitive_cp",
): SportProgramPoint[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const program = cell(row, "programma") || "Programma non indicato";
    const amount = parseEuro(cell(row, amountKey)) ?? 0;
    totals.set(program, (totals.get(program) ?? 0) + amount);
  }
  return [...totals.entries()]
    .map(([program, amountEur]) => ({ program, amountEur }))
    .sort((left, right) => right.amountEur - left.amountEur || left.program.localeCompare(right.program));
}

function buildFocusChapters(rows: readonly IntegratedPublicRow[]): SportChapterPoint[] {
  const byNumber = new Map<string, IntegratedPublicRow[]>();
  for (const row of rows) {
    const number = cell(row, "numero_capitolo");
    if (!number) continue;
    const bucket = byNumber.get(number) ?? [];
    bucket.push(row);
    byNumber.set(number, bucket);
  }

  return SPORT_FOCUS_CHAPTERS.map((focus) => {
    const matches = byNumber.get(focus.number) ?? [];
    const paid2025 = matches.find(
      (row) => cell(row, "esercizio") === "2025" && cell(row, "fonte") === "rendiconto",
    );
    const forecast2026 = matches.find(
      (row) => cell(row, "esercizio") === "2026" && cell(row, "fonte") === "legge_bilancio",
    );
    const labelRow = paid2025 ?? forecast2026 ?? matches[0];
    if (!labelRow) {
      throw new Error(`Capitolo focus ${focus.number} assente dal corpus OpenBDAP`);
    }
    return {
      number: focus.number,
      shortLabel: focus.shortLabel,
      kind: focus.kind,
      chapterLabel: cell(labelRow, "capitolo"),
      program: cell(labelRow, "programma"),
      paid2025Eur: paid2025 ? parseEuro(cell(paid2025, "pagato")) : null,
      forecast2026Eur: forecast2026
        ? parseEuro(cell(forecast2026, "previsioni_definitive_cp"))
        : null,
      sourceUrl: cell(labelRow, "fonte_url") || labelRow.sourceUrls[0] || null,
    };
  });
}

function matchAtRow(
  entity: SportFocusEntity,
  rows: readonly IntegratedPublicRow[],
): IntegratedPublicRow | null {
  const lowered = rows.map((row) => ({ row, name: cell(row, "nome").toLowerCase() }));
  for (const hint of entity.atNameHints) {
    const hit = lowered.find((entry) => entry.name.includes(hint));
    if (hit) return hit.row;
  }
  return null;
}

function buildEntityCards(atRows: readonly IntegratedPublicRow[]): SportEntityCard[] {
  return SPORT_FOCUS_ENTITIES.map((entity) => {
    const atRow = matchAtRow(entity, atRows);
    return {
      ...entity,
      at: {
        hubUrl: atRow ? cell(atRow, "url_at_hub") || null : null,
        bandiUrl: atRow ? cell(atRow, "url_bandi") || null : null,
        affidamentiUrl: atRow ? cell(atRow, "url_affidamenti_diretti") || null : null,
        consulentiUrl: atRow ? cell(atRow, "url_consulenti") || null : null,
        note: atRow ? cell(atRow, "note") || null : null,
      },
    };
  });
}

function buildSportESaluteProcurement(
  title: string,
  caveats: readonly string[],
  rows: readonly IntegratedPublicRow[],
): SportProcurementSummary {
  const relevant = rows.filter((row) => cell(row, "ipa").toLowerCase() === "csspa");
  if (relevant.length === 0) {
    throw new Error("Affidamenti Sport e Salute (csspa) assenti dal corpus procurement-partecipate");
  }

  const byCig = new Map<string, number | null>();
  for (const row of relevant) {
    const cig = cell(row, "cig") || `row:${row.sourceRow}`;
    const amount = parseEuro(cell(row, "importo_euro"));
    if (!byCig.has(cig)) {
      byCig.set(cig, amount);
      continue;
    }
    const previous = byCig.get(cig) ?? null;
    if (previous === null && amount !== null) byCig.set(cig, amount);
  }

  const amounts = [...byCig.values()].filter((value): value is number => value !== null);
  return {
    entityId: "sport-e-salute",
    entityName: "Sport e salute S.p.A.",
    ipa: "csspa",
    uniqueCig: byCig.size,
    rowsWithAmount: amounts.length,
    totalEur: amounts.reduce((sum, value) => sum + value, 0),
    maxSingleEur: amounts.length > 0 ? Math.max(...amounts) : null,
    sourceTitle: title,
    caveats: [
      ...caveats,
      "Somma sui soli CIG unici con importo presente; non è il bilancio di Sport e Salute né il totale appalti ANAC.",
    ],
  };
}

let viewPromise: Promise<SportPublicSpendingView> | null = null;

/**
 * Fail-closed view for /spese/sport. Reuses hashed OpenBDAP / PCM / RGS /
 * MEF-participation and integrated corpus facts. Never invents event totals.
 */
export function buildSportPublicSpendingView(): Promise<SportPublicSpendingView> {
  viewPromise ??= buildSportPublicSpendingViewUncached();
  return viewPromise;
}

async function buildSportPublicSpendingViewUncached(): Promise<SportPublicSpendingView> {
  const artifact = validateBudgetLawSnapshotArtifact(budgetLawSnapshotArtifact);
  const series = requireMissionAllocations(artifact.series.allocations);
  const latest = series.at(-1)!;
  const previous = series.at(-2) ?? null;
  const deltaEur = previous ? latest.enactedEur - previous.enactedEur : null;
  const deltaPct =
    previous && previous.enactedEur !== 0
      ? (deltaEur! / previous.enactedEur) * 100
      : null;

  const pcmMission = pcmFinancialSnapshot.missions.find(
    (mission) => mission.code === SPORT_PCM_MISSION_CODE,
  );
  if (!pcmMission) {
    throw new Error("Missione PCM 30 Giovani e sport assente dallo snapshot");
  }

  const mef = rgsMinistriesSnapshot.ministries.find((ministry) => ministry.code === "02");
  if (!mef) throw new Error("Ministero dell'Economia assente dallo snapshot RGS");
  const rgsMission = mef.missions.find((mission) => mission.code === SPORT_RGS_MISSION_CODE);
  if (!rgsMission) {
    throw new Error("Missione RGS 030 Giovani e sport assente dallo snapshot ministeri");
  }

  const [capitoli, procurement, atFocus] = await Promise.all([
    loadAllDatasetRows(OPENBDAP_CAPITOLI_DATASET),
    loadAllDatasetRows(PROCUREMENT_PARTECIPATE_DATASET),
    loadAllDatasetRows(PARTECIPATE_AT_FOCUS_DATASET),
  ]);

  const missionRows = capitoli.rows.filter(
    (row) => cell(row, "missione") === SPORT_MISSION_LABEL,
  );
  if (missionRows.length < 20) {
    throw new Error("Troppe poche righe OpenBDAP per la missione Giovani e sport");
  }

  const rows2026Forecast = missionRows.filter(
    (row) => cell(row, "esercizio") === "2026" && cell(row, "fonte") === "legge_bilancio",
  );
  const rows2025Paid = missionRows.filter(
    (row) => cell(row, "esercizio") === "2025" && cell(row, "fonte") === "rendiconto",
  );
  if (rows2026Forecast.length === 0 || rows2025Paid.length === 0) {
    throw new Error("Fette OpenBDAP 2025 rendiconto / 2026 legge di bilancio assenti");
  }

  const administrationLabel = cell(missionRows[0]!, "amministrazione");
  const sanitizedCapitoliCaveats = capitoli.caveats.map((caveat) =>
    caveat.replaceAll("\u2014", "-").replaceAll("\u2013", "-"),
  );

  return {
    missionLabel: SPORT_MISSION_LABEL,
    budgetLaw: {
      sourceTitle: artifact.series.dataset.title,
      license: artifact.series.dataset.license,
      datasetUrl: artifact.series.dataset.csvUrl,
      observedAt: artifact.series.observedAt,
      series,
      latest,
      previous,
      deltaEur,
      deltaPct,
    },
    pcm: {
      referenceYear: pcmFinancialSnapshot.referenceYear,
      missionCode: pcmMission.code,
      missionLabel: pcmMission.label,
      commitmentsCents: pcmMission.commitmentsCents,
      paymentsCents: pcmMission.paymentsCents,
      sourceTitle: pcmFinancialMetadata.source.owner,
      sourceUrl: pcmFinancialMetadata.source.landingUrl,
      acquiredAt: pcmFinancialMetadata.source.acquiredAt,
    },
    rgs: {
      referenceYear: rgsMinistriesSnapshot.referenceYear,
      administrationLabel: mef.label,
      missionCode: rgsMission.code,
      missionLabel: rgsMission.label,
      commitmentsCpCents: rgsMission.commitmentsCpCents,
      paymentsCompetenceCpCents: rgsMission.paymentsCompetenceCpCents,
      remainingCpCents: rgsMission.remainingCpCents,
      sourceTitle: rgsMinistriesMetadata.source.owner,
      sourceUrl: rgsMinistriesMetadata.source.landingUrl,
      acquiredAt: rgsMinistriesMetadata.source.acquiredAt,
    },
    chapters: {
      datasetTitle: capitoli.title,
      datasetId: OPENBDAP_CAPITOLI_DATASET,
      administrationLabel,
      missionRows: missionRows.length,
      programs2026Forecast: aggregatePrograms(rows2026Forecast, "previsioni_definitive_cp"),
      programs2025Paid: aggregatePrograms(rows2025Paid, "pagato"),
      focus: buildFocusChapters(missionRows),
      caveats: [
        ...sanitizedCapitoliCaveats,
        "I capitoli sono unità contabili MEF: un trasferimento al commissario non è il bilancio completo dell'evento.",
      ],
    },
    entities: buildEntityCards(atFocus.rows),
    procurement: buildSportESaluteProcurement(
      procurement.title,
          procurement.caveats.map((caveat) =>
            caveat.replaceAll("\u2014", "-").replaceAll("\u2013", "-"),
          ),
      procurement.rows,
    ),
    outOfScope: [
      "Totale unico della spesa sportiva italiana (missione, società e eventi non sono sommabili).",
      "Riparti del Fondo unico L. 205/2017 scaricati da PDF o HTML non hashed.",
      "Bilanci di esercizio di Sport e Salute, CONI o comitati organizzatori non ancora in snapshot.",
      "Tracker completo delle opere CUP OpenCoesione / OpenBDAP per Taranto 2026 e Milano Cortina 2026.",
      "Appalti ANAC nazionali di SIMICO e Credito Sportivo (qui solo AT / affidamenti Sport e Salute).",
      "Stime di ricavi (biglietti, sponsor) o giudizi di spreco/efficienza.",
    ],
    readingNotes: [
      "La Legge di Bilancio mostra lo stanziamento published (competenza A1), non i pagamenti.",
      "Il dettaglio capitoli OpenBDAP distingue previsioni 2026 e pagamenti 2024-2025: non vanno sommati.",
      "Il rendiconto PCM riguarda solo Palazzo Chigi; il rendiconto RGS ministeri riguarda le amministrazioni centrali nel perimetro del dataset.",
      "Le società partecipate descrivono controllo e quote; gli affidamenti AT di Sport e Salute sono un pezzo di procurement, non la spesa missione.",
    ],
  };
}
