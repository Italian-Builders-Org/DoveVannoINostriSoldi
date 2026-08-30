import { consulentiSnapshot } from "@/lib/consulenti-snapshot";
import { anacCigSnapshot } from "@/lib/anac-cig-snapshot";
import { cptRegionalFiscalSnapshot } from "@/lib/cpt-regional-fiscal-snapshot";
import { inpsCivilInvaliditySnapshot } from "@/lib/inps-invalidity-snapshot";
import { istatPensionsSnapshot } from "@/lib/istat-pensions-snapshot";
import { mefParticipationsSnapshot } from "@/lib/mef-participations-snapshot";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import { openCoesioneSnapshot } from "@/lib/opencoesione-snapshot";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import parliamentManifest from "@/data/generated/parliament-source-manifest.json";
import pcmMetadata from "@/data/generated/pcm-financial-2024.meta.json";
import { siopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import { MEF_IRPEF_SOURCE } from "@/lib/data/mef-irpef-source";
import { PNRR_CHILDCARE_SOURCE } from "@/lib/data/pnrr-childcare-source";
import type { SourceId } from "@/lib/data/source-policy";
import { getPublicDebtSnapshot } from "@/lib/public-debt";
import { getGovernmentCurrentSignalsSnapshot } from "@/lib/government-current-signals";
import { getGovernmentScorecardSnapshot } from "@/lib/government-scorecard";
import { getGovernmentScorecardForecastCoverage } from "@/lib/data/government-scorecard-contract";

export type SourceLatestData =
  | { kind: "date"; value: string }
  | { kind: "period"; label: string }
  | null;

function dated(value: string | null): SourceLatestData {
  return value ? { kind: "date", value } : null;
}

/* A null value means that the adapter discovers the latest release at request
   time. Annual periods remain periods: they must not be converted into an
   invented day just to reuse date formatting. */
const exhaustiveLatestDataBySlug = {
  ameco: (() => {
    const snapshot = getGovernmentScorecardSnapshot();
    const coverage = getGovernmentScorecardForecastCoverage(snapshot);
    return {
      kind: "period" as const,
      label: coverage.status === "complete"
        ? `osservati ${snapshot.sources.ameco.observedThrough} · previsioni complete ${coverage.fromYear}-${coverage.throughYear}`
        : `osservati ${snapshot.sources.ameco.observedThrough} · previsioni non pubblicabili`,
    };
  })(),
  "governi-presidenza": { kind: "period", label: "governo in carica dal 2022" },
  bancaditalia: { kind: "date", value: getPublicDebtSnapshot().stock.referenceDate },
  eurostat: { kind: "period", label: String(getPublicDebtSnapshot().annualInterest.referenceYear) },
  "eurostat-hicp": {
    kind: "period",
    label: `IPCA ${getGovernmentCurrentSignalsSnapshot().source.referencePeriodThrough}`,
  },
  siope: dated(siopeMunicipalSnapshot.source.siopeMovementsLastModified),
  ipa: dated(siopeMunicipalSnapshot.source.ipaLastModified),
  "ipa-struttura": null,
  openbdap: null,
  opencoesione: { kind: "date", value: openCoesioneSnapshot.referenceDate },
  [PNRR_CHILDCARE_SOURCE.id]: PNRR_CHILDCARE_SOURCE.latestData,
  opencivitas: { kind: "date", value: openCivitasSnapshot.publishedAt },
  "partecipazioni-pubbliche": { kind: "date", value: mefParticipationsSnapshot.publishedAt },
  anac: { kind: "period", label: String(anacCigSnapshot.referenceYear) },
  consulenti: { kind: "period", label: `${consulentiSnapshot.latestYear} · parziale` },
  camera: {
    kind: "period",
    label: String(
      Math.max(...parliamentSnapshot.chambers.flatMap((chamber) => chamber.statements.map((item) => item.year))),
    ),
  },
  senato: {
    kind: "period",
    label: String(Math.max(...parliamentManifest.senato.latestDocuments.map((item) => item.year))),
  },
  pcm: { kind: "period", label: pcmMetadata.source.referencePeriod },
  inps: {
    kind: "period",
    label: `spesa ${inpsCivilInvaliditySnapshot.spending.series.at(-1)!.year} · territori ${inpsCivilInvaliditySnapshot.regionalNewPensions.years.at(-1)}`,
  },
  cpt: { kind: "period", label: String(cptRegionalFiscalSnapshot.defaultYear) },
  istat: { kind: "date", value: "2026-08-25" },
  "istat-casellario-pensioni": {
    kind: "period",
    label: `${istatPensionsSnapshot.data.period.from}-${istatPensionsSnapshot.data.period.to}`,
  },
  [MEF_IRPEF_SOURCE.id]: MEF_IRPEF_SOURCE.latestData,
} satisfies Readonly<Record<SourceId, SourceLatestData>>;

// Public source slugs come from content data and are intentionally typed as
// strings. Keep the construction exhaustive while exposing a safe lookup map.
export const latestDataBySlug: Readonly<Record<string, SourceLatestData>> =
  exhaustiveLatestDataBySlug;
