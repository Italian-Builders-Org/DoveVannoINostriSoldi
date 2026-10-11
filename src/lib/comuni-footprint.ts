import "server-only";

import { compactEuro, exactEuro, integer, percent } from "@/lib/format";
import {
  displayMunicipalityName,
  searchComuni,
  type ComuniSearchHit,
} from "@/lib/comuni-search";
import {
  buildMunicipalitySpendingRows,
  type MunicipalitySpendingRow,
} from "@/lib/municipality-spending-view";
import { loadAnacEntityProcurementPage } from "@/lib/data/anac-entity-procurement-page";
import {
  MEF_IRPEF_INCOME_BAND_MEASURE_ORDER,
  type MefIrpefIncomeBandMeasureKey,
} from "@/lib/data/mef-irpef-contract";
import type { ReportedMeasure } from "@/lib/mef-irpef-snapshot";
import {
  getMunicipalityFinancialProfile,
  type MunicipalityPeerBenchmark,
  type MunicipalityFinancialProfile,
} from "@/lib/municipality-financial-profile";
import {
  getMunicipalitySchoolServicesFromIndex,
  type ComuniSchoolServices,
} from "@/lib/mim-school-services-municipal";
import { municipalitySnapshotEntity } from "@/lib/municipality-snapshot-entity";
import {
  getSiopeMunicipalityDetailByIpaCode,
} from "@/lib/siope-municipality-detail";
import { getSiopeMunicipalityReceipts } from "@/lib/siope-receipts";

export { displayMunicipalityName, searchComuni, type ComuniSearchHit };

const CANONICAL_IPA = /^[A-Za-z0-9_]+$/;
/** Default city shown on bare `/comuni` so the radar is visible immediately. */
export const DEFAULT_COMUNI_IPA = "c_e897";
const FEATURED_IPA = [
  "c_h501",
  "c_f205",
  "c_f839",
  "c_d612",
  "c_a783",
  DEFAULT_COMUNI_IPA,
] as const;

/** Transparent distance bands from the peer median (=100). Not a risk score. */
export type FootprintStatus = "in_linea" | "da_osservare" | "notevole" | "non_disponibile";

export type FootprintIndicator = Readonly<{
  id: string;
  label: string;
  /** Compact label for the radar rim. */
  shortLabel: string;
  /** Plain-language meaning of the axis; shown next to the value. */
  meaning: string;
  valueLabel: string;
  medianLabel: string | null;
  /** Index vs peer median; 100 = mediana. Null if not comparable. */
  index: number | null;
  status: FootprintStatus;
  note: string;
}>;

export type ComuniFootprint = Readonly<{
  codiceIpa: string;
  name: string;
  displayName: string;
  province: string;
  region: string | null;
  taxCode: string;
  year: number;
  latestMonth: number;
  completeness: "complete" | "partial";
  observedAt: string;
  totalCents: number | null;
  population: number | null;
  perCapitaCents: number | null;
  perSquareKmCents: number | null;
  receiptsTotalCents: number | null;
  receiptsPerCapitaCents: number | null;
  peer: MunicipalityPeerBenchmark | null;
  indicators: readonly FootprintIndicator[];
  statusCounts: Readonly<{ inLinea: number; daOsservare: number; notevole: number }>;
  spendingRows: readonly MunicipalitySpendingRow[];
  trend: readonly Readonly<{
    year: number;
    totalCents: number | null;
    perCapitaCents: number | null;
    completeness: "complete" | "partial";
  }>[];
  openCivitas: MunicipalityFinancialProfile["openCivitas"];
  irpef: MunicipalityFinancialProfile["irpef"];
  irpefIncomeBands: readonly ComuniIrpefIncomeBand[] | null;
  schoolServices: ComuniSchoolServices;
  anac: ComuniAnacOverview;
  pnrr: ComuniPnrrOverview;
  pnrrChildcare: MunicipalityFinancialProfile["pnrrChildcare"];
  methodology: MunicipalityFinancialProfile["siope"]["methodology"];
  sources: MunicipalityFinancialProfile["siope"]["sources"];
  entityHref: `/enti/${string}`;
  appaltiHref: `/enti/${string}/appalti`;
}>;

export type ComuniIrpefIncomeBand = Readonly<{
  key: MefIrpefIncomeBandMeasureKey;
  label: string;
  frequency: number | null;
  amountCents: number | null;
  coverage: ReportedMeasure["coverage"];
}>;

export type ComuniAnacOverview =
  | Readonly<{
      status: "available";
      procedureCount: number;
      awardCount: number;
      awardValueLabel: string;
      awardeeCount: number;
      topOperators: readonly Readonly<{
        ref: string;
        name: string;
        awardCount: number;
        attributedValueLabel: string;
      }>[];
      observedAt: string;
      appaltiHref: `/enti/${string}/appalti`;
    }>
  | Readonly<{ status: "unavailable"; message: string }>;

export type ComuniPnrrOverview = Readonly<{
  referenceDate: string;
  localizedRegistrations: number | null;
  implementerRegistrations: number | null;
  sampleProjects: readonly Readonly<{
    cup: string;
    title: string;
    fundingLabel: string;
  }>[];
  projectsHref: string;
  methodologyNote: string;
}>;

const IRPEF_BAND_LABELS: Readonly<Record<MefIrpefIncomeBandMeasureKey, string>> = {
  nonPositiveComprehensiveIncome: "≤ 0 €",
  comprehensiveIncome0To10000: "0-10 mila",
  comprehensiveIncome10000To15000: "10-15 mila",
  comprehensiveIncome15000To26000: "15-26 mila",
  comprehensiveIncome26000To55000: "26-55 mila",
  comprehensiveIncome55000To75000: "55-75 mila",
  comprehensiveIncome75000To120000: "75-120 mila",
  comprehensiveIncomeOver120000: "> 120 mila",
};

function measureFrequency(measure: ReportedMeasure): number | null {
  if (measure.coverage === "complete") return measure.frequency;
  return measure.knownFrequency;
}

function measureAmountCents(measure: ReportedMeasure): number | null {
  if (measure.coverage === "complete") return measure.amountCents;
  return measure.knownAmountCents;
}

function decimalEuroLabel(value: string): string {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return "n.d.";
  const [euros, fraction = ""] = value.split(".");
  return `${euros.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0").slice(0, 2)} €`;
}

function irpefIncomeBandsFromProfile(
  irpef: MunicipalityFinancialProfile["irpef"],
): readonly ComuniIrpefIncomeBand[] | null {
  if (irpef.status !== "available") return null;
  const bands = irpef.data.record.breakdowns?.incomeBands;
  if (!bands) return null;
  return MEF_IRPEF_INCOME_BAND_MEASURE_ORDER.map((key) => {
    const measure = bands[key];
    return {
      key,
      label: IRPEF_BAND_LABELS[key],
      frequency: measureFrequency(measure),
      amountCents: measureAmountCents(measure),
      coverage: measure.coverage,
    };
  });
}

function loadSchoolServices(profile: MunicipalityFinancialProfile): ComuniSchoolServices {
  const identity = profile.irpef.status === "available" && profile.irpef.data.record.territory.level === "municipality"
    ? profile.irpef.data.record.territory
    : null;
  return getMunicipalitySchoolServicesFromIndex(identity?.code ?? profile.identifiers.istatCode, identity?.cadastralCode ?? null);
}

async function loadAnacOverview(profile: MunicipalityFinancialProfile): Promise<ComuniAnacOverview> {
  const appaltiHref = `/enti/${encodeURIComponent(profile.identifiers.codiceIpa)}/appalti` as const;
  // Offline shard read only: live IPA verification is unnecessary here and would
  // hide missing NFT shards behind unrelated network errors.
  const state = await loadAnacEntityProcurementPage({
    codiceIpa: profile.identifiers.codiceIpa,
    currentEntityCf: profile.identifiers.taxCode,
    verifyLiveFiscalCode: false,
  });
  if (state.status !== "available") {
    return { status: "unavailable", message: state.message };
  }
  const { summary, operators, meta } = state.profile;
  return {
    status: "available",
    procedureCount: summary.procedureCount,
    awardCount: summary.awardCount,
    awardValueLabel: decimalEuroLabel(summary.awardValue),
    awardeeCount: summary.awardeeCount,
    topOperators: operators.slice(0, 5).map((operator) => ({
      ref: operator.ref,
      name: operator.name,
      awardCount: operator.awardCount,
      attributedValueLabel: decimalEuroLabel(operator.attributedValue),
    })),
    observedAt: meta.observedAt,
    appaltiHref,
  };
}

async function loadPnrrOverview(profile: MunicipalityFinancialProfile): Promise<ComuniPnrrOverview> {
  // Counts only from the committed ReGiS index. Loading public rows would pull
  // data/source-ledger into the /comuni NFT, which runtime-trace forbids.
  const { pnrrMatchingRows, pnrrProjectMetadata } = await import("@/lib/pnrr-projects-index");
  const { getPnrrImplementerTaxCodesForMunicipality } = await import("@/lib/pnrr-childcare-snapshot");
  const istatCode = profile.identifiers.istatCode;
  const taxCode = profile.identifiers.taxCode;
  const localizedRegistrations = istatCode
    ? (await pnrrMatchingRows({ territory: istatCode }))?.length ?? 0
    : null;
  // Italia Domani may publish a municipal CF distinct from the current SIOPE/IPA code.
  const implementerCodes = getPnrrImplementerTaxCodesForMunicipality(taxCode, profile.siope.data.name);
  let implementerRegistrations = 0;
  for (const code of implementerCodes) {
    implementerRegistrations += (await pnrrMatchingRows({ code }))?.length ?? 0;
  }
  const projectsHref = istatCode
    ? `/pnrr?territory=${encodeURIComponent(istatCode)}`
    : "/pnrr";
  return {
    referenceDate: pnrrProjectMetadata.referenceDate,
    localizedRegistrations,
    implementerRegistrations,
    sampleProjects: [],
    projectsHref,
    methodologyNote:
      "Le registrazioni PNRR contano CUP×CLP×submisura. Localizzazione e soggetto attuatore sono perimetri distinti; i CF attuatore storici della fonte restano distinti dal CF SIOPE corrente.",
  };
}

export function featuredComuni(): readonly ComuniSearchHit[] {
  return FEATURED_IPA.flatMap((code) => {
    const detail = getSiopeMunicipalityDetailByIpaCode(code);
    if (!detail?.codiceIpa) return [];
    return [{
      codiceIpa: detail.codiceIpa,
      name: detail.name,
      province: detail.province,
      region: detail.region,
      taxCode: detail.taxCode,
    }];
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(0.5 * sorted.length) - 1)]!;
}

function roundedEuro(cents: number): string {
  return `${integer(Math.round(cents / 100))} €`;
}

function shareLabel(share: number): string {
  return percent(share * 100);
}

export function footprintStatusFromIndex(index: number | null): FootprintStatus {
  if (index === null || !Number.isFinite(index)) return "non_disponibile";
  if (index >= 80 && index <= 120) return "in_linea";
  if (index >= 60 && index < 80) return "da_osservare";
  if (index > 120 && index <= 150) return "da_osservare";
  return "notevole";
}

/**
 * Human label for the badge: direction vs mediana (=100), not a vague "lontano".
 * Bands match {@link footprintStatusFromIndex}.
 */
export function footprintStatusLabel(index: number | null): string {
  if (index === null || !Number.isFinite(index)) return "n.d.";
  if (index >= 80 && index <= 120) return "In linea";
  if (index > 120 && index <= 150) return "Più alti";
  if (index > 150) return "Molto più alti";
  if (index >= 60 && index < 80) return "Più bassi";
  return "Molto più bassi";
}

function indexVsMedian(value: number, medianValue: number | null): number | null {
  if (medianValue === null || medianValue <= 0 || !Number.isFinite(value)) return null;
  return Math.round((value / medianValue) * 1000) / 10;
}

function distanceNote(index: number | null, unitHint: string): string {
  if (index === null) return "Confronto non disponibile.";
  if (index >= 98 && index <= 102) return `In linea con il riferimento (${unitHint}).`;
  const delta = Math.abs(index - 100);
  return `${percent(delta)} ${index > 100 ? "sopra" : "sotto"} il riferimento (${unitHint}).`;
}

function titleShare(
  titles: MunicipalityFinancialProfile["siope"]["data"]["years"][number]["titles"],
  totalCents: number | null,
  code: string,
): number | null {
  if (totalCents === null || totalCents <= 0) return null;
  const title = titles.find((item) => item.code === code);
  if (!title) return null;
  return title.amountCents / totalCents;
}

function buildIndicators(
  profile: MunicipalityFinancialProfile,
  receiptsPerCapitaCents: number | null,
  peerReceiptsPerCapitaMedian: number | null,
): readonly FootprintIndicator[] {
  const latest = profile.siope.data.years[0]!;
  const peer = profile.siope.peerBenchmark;
  const openCivitas = profile.openCivitas.status === "available" ? profile.openCivitas.data : null;
  const currentShare = titleShare(latest.titles, latest.totalCents, "1");
  const investmentShare = titleShare(latest.titles, latest.totalCents, "2");
  const passThroughShare = titleShare(latest.titles, latest.totalCents, "7");

  const items: FootprintIndicator[] = [
    {
      id: "payments-per-capita",
      label: "Pagamenti per abitante",
      shortLabel: "Pagamenti / ab.",
      meaning:
        "I pagamenti di cassa SIOPE per abitante: soldi usciti dai conti del Comune divisi per i residenti. Non dice se i servizi sono buoni o cattivi.",
      valueLabel: latest.perCapitaCents === null ? "n.d." : roundedEuro(latest.perCapitaCents),
      medianLabel: peer?.perCapitaCents ? roundedEuro(peer.perCapitaCents.median) : null,
      index: indexVsMedian(latest.perCapitaCents ?? NaN, peer?.perCapitaCents?.median ?? null),
      status: "non_disponibile",
      note: "",
    },
    {
      id: "payments-per-km2",
      label: "Pagamenti per km²",
      shortLabel: "Pagamenti / km²",
      meaning:
        "Stesso totale pagato, ma diviso i km² del territorio (ISTAT). Serve nei comuni grandi e poco abitati; va letto insieme al pro capite.",
      valueLabel: latest.perSquareKmCents === null ? "n.d." : exactEuro(latest.perSquareKmCents / 100),
      medianLabel: peer ? exactEuro(peer.perSquareKmCents.median / 100) : null,
      index: indexVsMedian(latest.perSquareKmCents ?? NaN, peer?.perSquareKmCents.median ?? null),
      status: "non_disponibile",
      note: "",
    },
    {
      id: "receipts-per-capita",
      label: "Incassi per abitante",
      shortLabel: "Incassi / ab.",
      meaning:
        "Soldi entrati nei conti del Comune per abitante (cassa SIOPE). Non sono solo le tasse dei residenti: entrano anche trasferimenti, prestiti e partite di giro.",
      valueLabel: receiptsPerCapitaCents === null ? "n.d." : roundedEuro(receiptsPerCapitaCents),
      medianLabel: peerReceiptsPerCapitaMedian === null ? null : roundedEuro(peerReceiptsPerCapitaMedian),
      index: indexVsMedian(receiptsPerCapitaCents ?? NaN, peerReceiptsPerCapitaMedian),
      status: "non_disponibile",
      note: "",
    },
    {
      id: "current-share",
      label: "Quota spese correnti",
      shortLabel: "Spese correnti",
      meaning:
        "Quanto del totale pagato va al funzionamento quotidiano: personale, utenze, manutenzioni e servizi. È una quota sul totale, non un euro assoluto.",
      valueLabel: currentShare === null ? "n.d." : shareLabel(currentShare),
      medianLabel: peer?.titleShares?.["1"] ? shareLabel(peer.titleShares["1"].median) : null,
      index: indexVsMedian(currentShare ?? NaN, peer?.titleShares?.["1"]?.median ?? null),
      status: "non_disponibile",
      note: "",
    },
    {
      id: "investment-share",
      label: "Quota investimenti",
      shortLabel: "Investimenti",
      meaning:
        "Quanto del totale pagato va a opere e beni che durano nel tempo (lavori pubblici, impianti). Anche questa è una quota sul totale.",
      valueLabel: investmentShare === null ? "n.d." : shareLabel(investmentShare),
      medianLabel: peer?.titleShares?.["2"] ? shareLabel(peer.titleShares["2"].median) : null,
      index: indexVsMedian(investmentShare ?? NaN, peer?.titleShares?.["2"]?.median ?? null),
      status: "non_disponibile",
      note: "",
    },
    {
      id: "passthrough-share",
      label: "Quota partite di giro",
      shortLabel: "Partite di giro",
      meaning:
        "Quota di partite di giro e conto di terzi: movimenti che transitano dai conti del Comune per conto di altri (trattenute, depositi…). Di solito non sono spesa propria e gonfiano i totali.",
      valueLabel: passThroughShare === null ? "n.d." : shareLabel(passThroughShare),
      medianLabel: peer?.titleShares?.["7"] ? shareLabel(peer.titleShares["7"].median) : null,
      index: indexVsMedian(passThroughShare ?? NaN, peer?.titleShares?.["7"]?.median ?? null),
      status: "non_disponibile",
      note: "",
    },
  ];

  if (openCivitas && openCivitas.record.standardSpendingCents > 0) {
    const ratio = openCivitas.record.historicalSpendingCents / openCivitas.record.standardSpendingCents;
    items.push({
      id: "opencivitas-vs-standard",
      label: "Spesa storica rispetto allo standard",
      shortLabel: "Vs standard",
      meaning:
        `OpenCivitas ${openCivitas.referenceYear}: spesa storica del Comune confrontata con il «fabbisogno standard» ufficiale per enti simili. Indice 100 = in linea con lo standard. Non è un voto di efficienza né di spreco.`,
      valueLabel: compactEuro(openCivitas.record.historicalSpendingCents / 100),
      medianLabel: compactEuro(openCivitas.record.standardSpendingCents / 100),
      index: Math.round(ratio * 1000) / 10,
      status: "non_disponibile",
      note: "",
    });
  } else {
    items.push({
      id: "opencivitas-vs-standard",
      label: "Spesa storica rispetto allo standard",
      shortLabel: "Vs standard",
      meaning:
        "OpenCivitas confronta spesa storica e fabbisogno standard. Qui il collegamento non è disponibile (fuori perimetro o identificativi non riconciliati).",
      valueLabel: "n.d.",
      medianLabel: null,
      index: null,
      status: "non_disponibile",
      note: profile.openCivitas.status === "available"
        ? "OpenCivitas non collegabile."
        : profile.openCivitas.message,
    });
  }

  return items.map((item) => {
    if (item.id === "opencivitas-vs-standard") {
      if (item.index === null) return item;
      return {
        ...item,
        status: footprintStatusFromIndex(item.index),
        note: distanceNote(item.index, "standard OpenCivitas = 100"),
      };
    }
    return {
      ...item,
      status: footprintStatusFromIndex(item.index),
      note: distanceNote(item.index, "mediana dei simili = 100"),
    };
  });
}

export function buildComuniFootprint(
  profile: MunicipalityFinancialProfile,
  extras: Readonly<{
    schoolServices: ComuniSchoolServices;
    anac: ComuniAnacOverview;
    pnrr: ComuniPnrrOverview;
  }>,
): ComuniFootprint {
  const latest = profile.siope.data.years[0]!;
  const peer = profile.siope.peerBenchmark;
  const receipts = getSiopeMunicipalityReceipts(profile.identifiers.taxCode, latest.year);
  const peerReceiptsPerCapitaMedian = peer
    ? median(
      peer.taxCodes.flatMap((taxCode) => {
        const row = getSiopeMunicipalityReceipts(taxCode, latest.year);
        return row?.perCapitaCents === null || row?.perCapitaCents === undefined
          ? []
          : [row.perCapitaCents];
      }),
    )
    : null;
  const indicators = buildIndicators(profile, receipts?.perCapitaCents ?? null, peerReceiptsPerCapitaMedian);
  const statusCounts = {
    inLinea: indicators.filter((item) => item.status === "in_linea").length,
    daOsservare: indicators.filter((item) => item.status === "da_osservare").length,
    notevole: indicators.filter((item) => item.status === "notevole").length,
  };

  return {
    codiceIpa: profile.identifiers.codiceIpa,
    name: profile.siope.data.name,
    displayName: displayMunicipalityName(profile.siope.data.name),
    province: profile.siope.data.province,
    region: profile.siope.data.region,
    taxCode: profile.identifiers.taxCode,
    year: latest.year,
    latestMonth: latest.latestMonth,
    completeness: latest.completeness,
    observedAt: latest.observedAt,
    totalCents: latest.totalCents,
    population: latest.population,
    perCapitaCents: latest.perCapitaCents,
    perSquareKmCents: latest.perSquareKmCents,
    receiptsTotalCents: receipts?.totalCents ?? null,
    receiptsPerCapitaCents: receipts?.perCapitaCents ?? null,
    peer,
    indicators,
    statusCounts,
    spendingRows: buildMunicipalitySpendingRows(latest.titles, latest.totalCents),
    trend: profile.siope.data.years
      .slice()
      .reverse()
      .map((year) => ({
        year: year.year,
        totalCents: year.totalCents,
        perCapitaCents: year.perCapitaCents,
        completeness: year.completeness,
      })),
    openCivitas: profile.openCivitas,
    irpef: profile.irpef,
    irpefIncomeBands: irpefIncomeBandsFromProfile(profile.irpef),
    schoolServices: extras.schoolServices,
    anac: extras.anac,
    pnrr: extras.pnrr,
    pnrrChildcare: profile.pnrrChildcare,
    methodology: profile.siope.methodology,
    sources: profile.siope.sources,
    entityHref: `/enti/${encodeURIComponent(profile.identifiers.codiceIpa)}`,
    appaltiHref: `/enti/${encodeURIComponent(profile.identifiers.codiceIpa)}/appalti`,
  };
}

export async function getComuniFootprintByIpaCode(rawCode: string): Promise<ComuniFootprint | null> {
  const code = rawCode.trim();
  if (!CANONICAL_IPA.test(code)) return null;
  const detail = getSiopeMunicipalityDetailByIpaCode(code);
  if (!detail) return null;
  const entity = municipalitySnapshotEntity(detail);
  if (!entity) return null;
  const profile = await getMunicipalityFinancialProfile(entity, { allowCommittedIstatIdentity: true });
  if (!profile) return null;
  const schoolServices = loadSchoolServices(profile);
  const [anac, pnrr] = await Promise.all([
    loadAnacOverview(profile),
    loadPnrrOverview(profile),
  ]);
  return buildComuniFootprint(profile, { schoolServices, anac, pnrr });
}
