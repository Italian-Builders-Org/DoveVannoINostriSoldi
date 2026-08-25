import "server-only";

import type { IpaEntity } from "@/lib/ipa";
import type { OpenCivitasMunicipality, OpenCivitasSnapshot } from "@/lib/data/opencivitas-contract";
import type { PnrrChildcareMeta } from "@/lib/data/pnrr-childcare-contract";
import type { MefIrpefQueryResult, MefIrpefTerritoryRecord } from "@/lib/mef-irpef-snapshot";
import {
  getSiopeMunicipalityDetail,
  getSiopeMunicipalityPeerObservations,
  type SiopeMunicipalityDetail,
} from "@/lib/siope-municipality-detail";
import { getSiopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import {
  eurosPerSquareKilometreCents,
  getMunicipalityGeographyByIstatCode,
  populationBand,
  surfaceBand,
  type MunicipalityGeography,
} from "@/lib/municipality-geography";

export type ProfileUnavailableReason = "outside_source_scope" | "no_matching_record";

export type ProfileSection<T> =
  | Readonly<{ status: "available"; data: T }>
  | Readonly<{ status: "out_of_scope" | "not_found"; reason: ProfileUnavailableReason; message: string }>;

export type MunicipalityProfile = Readonly<{
  identifiers: Readonly<{
    codiceIpa: string;
    taxCode: string;
    istatCode: string | null;
    joinMethod: "exact_official_identifiers";
  }>;
  siope: Readonly<{
    status: "available";
    data: SiopeMunicipalityDetail;
    methodology: ReturnType<typeof getSiopeMunicipalSnapshot>["methodology"];
    sources: readonly Readonly<{ year: number; url: string; observedAt: string }>[];
    peerBenchmark: MunicipalityPeerBenchmark | null;
  }>;
  irpef: ProfileSection<Readonly<{
    period: MefIrpefQueryResult["period"];
    record: MefIrpefTerritoryRecord;
    methodology: MefIrpefQueryResult["methodology"];
    source: MefIrpefQueryResult["provenance"]["source"];
  }>>;
  openCivitas: ProfileSection<Readonly<{
    referenceYear: number;
    publishedAt: string;
    record: OpenCivitasMunicipality;
    methodology: OpenCivitasSnapshot["methodology"];
    source: OpenCivitasSnapshot["source"];
    geography: MunicipalityGeography | null;
    historicalPerSquareKmCents: number | null;
    standardPerSquareKmCents: number | null;
    differencePerSquareKmCents: number | null;
  }>>;
  pnrrChildcare: Readonly<{
    status: "available";
    data: Readonly<{
      referenceDate: string;
      submeasure: Readonly<{ code: string; label: string }>;
      totalProjects: number;
      knownTotalFundingCents: number;
      projectsWithKnownFunding: number;
      projects: readonly Readonly<{
        cup: string;
        title: string;
        progress: string | null;
        phase: string | null;
        totalFundingCents: number | null;
      }>[];
      methodology: PnrrChildcareMeta["methodology"];
      source: PnrrChildcareMeta["source"];
    }>;
  }>;
}>;

export type MunicipalityPeerBenchmark = Readonly<{
  year: number;
  peers: number;
  criteria: readonly string[];
  fallbackLevel: number;
  perSquareKmCents: Readonly<{ p25: number; median: number; p75: number }>;
  perCapitaCents: Readonly<{ p25: number; median: number; p75: number }> | null;
}>;

function quantiles(values: number[]): { p25: number; median: number; p75: number } {
  const sorted = [...values].sort((left, right) => left - right);
  const value = (probability: number) => sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
  return { p25: value(0.25), median: value(0.5), p75: value(0.75) };
}

function peerBenchmark(taxCode: string, geography: MunicipalityGeography): MunicipalityPeerBenchmark | null {
  const observations = getSiopeMunicipalityPeerObservations(geography.year)
    .filter((item) => item.taxCode !== taxCode);
  const samePopulation = (item: typeof observations[number]) =>
    populationBand(item.geography.residentPopulation) === populationBand(geography.residentPopulation);
  const sameSurface = (item: typeof observations[number]) =>
    surfaceBand(item.geography.surfaceSquareMetres) === surfaceBand(geography.surfaceSquareMetres);
  const stages = [
    {
      criteria: ["fascia di popolazione", "fascia di superficie", "zona altimetrica", "urbanizzazione", "litoraneità e insularità"],
      match: (item: typeof observations[number]) => samePopulation(item) && sameSurface(item) &&
        item.geography.altimetricZone === geography.altimetricZone &&
        item.geography.degreeUrbanization === geography.degreeUrbanization &&
        item.geography.coastal === geography.coastal && item.geography.island === geography.island,
    },
    {
      criteria: ["fascia di popolazione", "fascia di superficie", "zona altimetrica", "urbanizzazione"],
      match: (item: typeof observations[number]) => samePopulation(item) && sameSurface(item) &&
        item.geography.altimetricZone === geography.altimetricZone &&
        item.geography.degreeUrbanization === geography.degreeUrbanization,
    },
    {
      criteria: ["fascia di popolazione", "fascia di superficie", "zona altimetrica"],
      match: (item: typeof observations[number]) => samePopulation(item) && sameSurface(item) &&
        item.geography.altimetricZone === geography.altimetricZone,
    },
    {
      criteria: ["fascia di popolazione", "fascia di superficie"],
      match: (item: typeof observations[number]) => samePopulation(item) && sameSurface(item),
    },
  ];
  for (const [fallbackLevel, stage] of stages.entries()) {
    const peers = observations.filter(stage.match);
    if (peers.length < 10) continue;
    const perCapita = peers.flatMap((item) => item.perCapitaCents === null ? [] : [item.perCapitaCents]);
    return {
      year: geography.year,
      peers: peers.length,
      criteria: stage.criteria,
      fallbackLevel,
      perSquareKmCents: quantiles(peers.map((item) => item.perSquareKmCents)),
      perCapitaCents: perCapita.length >= 10 ? quantiles(perCapita) : null,
    };
  }
  return null;
}

function unavailable(
  status: "out_of_scope" | "not_found",
  reason: ProfileUnavailableReason,
  message: string,
): ProfileSection<never> {
  return { status, reason, message };
}

function normalizedIstatCode(value: string | null): string | null {
  const code = value?.trim() ?? "";
  return /^\d{6}$/.test(code) ? code : null;
}

function normalizedCadastralCode(value: string | null): string | null {
  const code = value?.trim().toLocaleUpperCase("it-IT") ?? "";
  return /^[A-Z][0-9]{3}$/.test(code) ? code : null;
}

export async function getMunicipalityProfile(entity: IpaEntity): Promise<MunicipalityProfile | null> {
  const taxCode = entity.codiceFiscale?.trim() ?? "";
  if (!/^\d{11}$/.test(taxCode)) return null;
  const siope = getSiopeMunicipalityDetail(taxCode);
  if (!siope || siope.codiceIpa !== entity.codiceIpa) return null;
  const candidateIstatCode = normalizedIstatCode(entity.sede.codiceComuneIstat);
  const cadastralCode = normalizedCadastralCode(entity.sede.codiceCatastaleComune);

  const [irpefModule, openCivitasModule, pnrrModule] = await Promise.all([
    import("@/lib/mef-irpef-snapshot"),
    import("@/lib/opencivitas-snapshot"),
    import("@/lib/pnrr-childcare-snapshot"),
  ]);

  let irpef: MunicipalityProfile["irpef"];
  let istatCode: string | null = null;
  if (!candidateIstatCode || !cadastralCode) {
    irpef = unavailable(
      "not_found",
      "no_matching_record",
      "IPA non pubblica codici ISTAT e catastale comunali validi per verificare il collegamento MEF.",
    );
  } else {
    try {
      const result = irpefModule.queryMefMunicipalIrpef({
        year: 2024,
        level: "municipality",
        code: candidateIstatCode,
        limit: 1,
      });
      const record = result.data[0];
      if (
        record?.territory.level !== "municipality" ||
        record.territory.cadastralCode !== cadastralCode
      ) {
        irpef = unavailable(
          "not_found",
          "no_matching_record",
          "I codici ISTAT e catastale IPA non riconciliano con lo stesso record MEF.",
        );
      } else {
        istatCode = candidateIstatCode;
        irpef = {
          status: "available",
          data: {
            period: result.period,
            record,
            methodology: result.methodology,
            source: result.provenance.source,
          },
        };
      }
    } catch (error) {
      if (!(error instanceof irpefModule.MefIrpefQueryError) || error.code !== "not_found") throw error;
      irpef = unavailable(
        "not_found",
        "no_matching_record",
        `Il rilascio MEF 2024 non contiene un Comune con codice ISTAT ${candidateIstatCode}.`,
      );
    }
  }

  const openCivitasSnapshot = openCivitasModule.openCivitasSnapshot;
  const openCivitasRecord = istatCode
    ? openCivitasSnapshot.municipalities.find((item) => item.istatCode === istatCode)
    : undefined;
  let openCivitas: MunicipalityProfile["openCivitas"];
  if (openCivitasRecord) {
    const geography = getMunicipalityGeographyByIstatCode(openCivitasSnapshot.referenceYear, istatCode!);
    openCivitas = {
      status: "available",
      data: {
        referenceYear: openCivitasSnapshot.referenceYear,
        publishedAt: openCivitasSnapshot.publishedAt,
        record: openCivitasRecord,
        methodology: openCivitasSnapshot.methodology,
        source: openCivitasSnapshot.source,
        geography,
        historicalPerSquareKmCents: eurosPerSquareKilometreCents(
          openCivitasRecord.historicalSpendingCents,
          geography?.surfaceSquareMetres ?? null,
        ),
        standardPerSquareKmCents: eurosPerSquareKilometreCents(
          openCivitasRecord.standardSpendingCents,
          geography?.surfaceSquareMetres ?? null,
        ),
        differencePerSquareKmCents: eurosPerSquareKilometreCents(
          openCivitasRecord.differenceCents,
          geography?.surfaceSquareMetres ?? null,
        ),
      },
    };
  } else if (
    siope.region &&
    !openCivitasSnapshot.coverage.regionNames.includes(siope.region.toLocaleUpperCase("it-IT"))
  ) {
    openCivitas = unavailable(
      "out_of_scope",
      "outside_source_scope",
      "OpenCivitas 2022 copre soltanto i Comuni delle Regioni a statuto ordinario.",
    );
  } else {
    openCivitas = unavailable(
      "not_found",
      "no_matching_record",
      istatCode
        ? `OpenCivitas 2022 non contiene un record collegabile al codice ISTAT ${istatCode}.`
        : "IPA non pubblica un codice ISTAT comunale valido per collegare OpenCivitas.",
    );
  }

  const pnrrProjects = [...pnrrModule.getPnrrChildcareProjectsByImplementerTaxCode(taxCode)]
    .sort((left, right) => left.cup.localeCompare(right.cup, "en"));
  const projectsWithKnownFunding = pnrrProjects.filter((project) => project.funding.totalCents !== null);

  return {
    identifiers: {
      codiceIpa: entity.codiceIpa,
      taxCode,
      istatCode,
      joinMethod: "exact_official_identifiers",
    },
    siope: {
      status: "available",
      data: siope,
      methodology: getSiopeMunicipalSnapshot().methodology,
      sources: siope.years.map((year) => {
        const snapshot = getSiopeMunicipalSnapshot(year.year);
        return { year: year.year, url: snapshot.source.siopeMovementsUrl, observedAt: year.observedAt };
      }),
      peerBenchmark: siope.years[0].geography
        ? peerBenchmark(taxCode, siope.years[0].geography)
        : null,
    },
    irpef,
    openCivitas,
    pnrrChildcare: {
      status: "available",
      data: {
        referenceDate: pnrrModule.pnrrChildcareData.referenceDate,
        submeasure: pnrrModule.pnrrChildcareData.submeasure,
        totalProjects: pnrrProjects.length,
        knownTotalFundingCents: projectsWithKnownFunding.reduce(
          (total, project) => total + (project.funding.totalCents ?? 0),
          0,
        ),
        projectsWithKnownFunding: projectsWithKnownFunding.length,
        projects: pnrrProjects.slice(0, 6).map((project) => ({
          cup: project.cup,
          title: project.title,
          progress: project.status.progress,
          phase: project.status.phase,
          totalFundingCents: project.funding.totalCents,
        })),
        methodology: pnrrModule.pnrrChildcareMeta.methodology,
        source: pnrrModule.pnrrChildcareMeta.source,
      },
    },
  };
}
