import "server-only";

import budgetLawSnapshotArtifact from "@/data/generated/openbdap-budget-law-missions.json";
import {
  validateBudgetLawSnapshotArtifact,
  type MissionEnactedAllocation,
} from "@/lib/bdap-legge-bilancio";
import { pcmFinancialMetadata, pcmFinancialSnapshot } from "@/lib/pcm-financial-snapshot";
import { rgsMinistriesMetadata, rgsMinistriesSnapshot } from "@/lib/rgs-ministries-snapshot";

export const SPORT_MISSION_LABEL = "Giovani e sport";
export const SPORT_PCM_MISSION_CODE = "30";
export const SPORT_RGS_MISSION_CODE = "030";

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
  },
] as const;

export type SportFocusEntity = (typeof SPORT_FOCUS_ENTITIES)[number];

export type SportMissionPoint = Readonly<{
  year: number;
  enactedEur: number;
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
  entities: readonly SportFocusEntity[];
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

/**
 * Fail-closed view for /spese/sport. Reuses hashed OpenBDAP / PCM / RGS /
 * MEF-participation facts already on the platform. Never invents event totals.
 */
export function buildSportPublicSpendingView(): SportPublicSpendingView {
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
    entities: SPORT_FOCUS_ENTITIES,
    outOfScope: [
      "Totale unico della spesa sportiva italiana (missione, società e eventi non sono sommabili).",
      "Riparti del Fondo unico L. 205/2017 scaricati da PDF o HTML non hashed.",
      "Bilanci di esercizio di Sport e Salute, CONI o comitati organizzatori non ancora in snapshot.",
      "Tracker completo Taranto 2026 / Milano Cortina 2026 da decreti e siti commissariali.",
      "Stime di ricavi (biglietti, sponsor) o giudizi di spreco/efficienza.",
    ],
    readingNotes: [
      "La Legge di Bilancio mostra lo stanziamento published (competenza A1), non i pagamenti.",
      "Il rendiconto PCM riguarda solo Palazzo Chigi; il rendiconto RGS ministeri riguarda le amministrazioni centrali nel perimetro del dataset.",
      "Le società partecipate descrivono controllo e quote, non quanto è stato speso per uno sport o un evento.",
    ],
  };
}
