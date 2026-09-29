import "server-only";

import { compactEuro, exactEuro, integer, percent } from "@/lib/format";
import {
  buildMunicipalitySpendingRows,
  municipalitySpendingTitleLabel,
  type MunicipalitySpendingRow,
} from "@/lib/municipality-spending-view";
import {
  getMunicipalityProfile,
  type MunicipalityPeerBenchmark,
  type MunicipalityProfile,
} from "@/lib/municipality-profile";
import { municipalitySnapshotEntity } from "@/lib/municipality-snapshot-entity";
import {
  getMunicipalitySearchEntities,
  getSiopeMunicipalityDetailByIpaCode,
} from "@/lib/siope-municipality-detail";
import { getSiopeMunicipalityReceipts } from "@/lib/siope-receipts";

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

export type ComuniSearchHit = Readonly<{
  codiceIpa: string;
  name: string;
  province: string | null;
  region: string | null;
  taxCode: string;
}>;

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
  openCivitas: MunicipalityProfile["openCivitas"];
  irpef: MunicipalityProfile["irpef"];
  pnrrChildcare: MunicipalityProfile["pnrrChildcare"];
  schoolServices: MunicipalityProfile["schoolServices"];
  methodology: MunicipalityProfile["siope"]["methodology"];
  sources: MunicipalityProfile["siope"]["sources"];
  entityHref: `/enti/${string}`;
}>;

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function displayMunicipalityName(name: string): string {
  const trimmed = name.trim().replace(/^comune di\s+/i, "");
  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (/^(di|de|del|della|dei|delle|dello|da|e|ed|in|sul|sulla)$/i.test(word)) {
        return word.toLocaleLowerCase("it-IT");
      }
      if (/^[A-Z]'/i.test(word) && word.length > 2) {
        return word.charAt(0).toLocaleUpperCase("it-IT")
          + word.charAt(1)
          + word.slice(2).toLocaleLowerCase("it-IT");
      }
      return word.charAt(0).toLocaleUpperCase("it-IT") + word.slice(1).toLocaleLowerCase("it-IT");
    })
    .join(" ");
}

export function searchComuni(query: string, limit = 12): readonly ComuniSearchHit[] {
  const needle = normalizeSearch(query);
  if (needle.length < 2) return [];
  const hits: ComuniSearchHit[] = [];
  for (const entity of getMunicipalitySearchEntities()) {
    const hay = normalizeSearch(entity.denominazione);
    if (!hay.includes(needle) && !normalizeSearch(entity.codiceIpa).includes(needle)) continue;
    hits.push({
      codiceIpa: entity.codiceIpa,
      name: entity.denominazione,
      province: null,
      region: null,
      taxCode: entity.codiceFiscale ?? "",
    });
  }
  return hits
    .sort((left, right) => {
      const leftExact = normalizeSearch(displayMunicipalityName(left.name)) === needle ? 0 : 1;
      const rightExact = normalizeSearch(displayMunicipalityName(right.name)) === needle ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      const leftStarts = normalizeSearch(displayMunicipalityName(left.name)).startsWith(needle) ? 0 : 1;
      const rightStarts = normalizeSearch(displayMunicipalityName(right.name)).startsWith(needle) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;
      return left.name.localeCompare(right.name, "it");
    })
    .slice(0, limit);
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
  titles: MunicipalityProfile["siope"]["data"]["years"][number]["titles"],
  totalCents: number | null,
  code: string,
): number | null {
  if (totalCents === null || totalCents <= 0) return null;
  const title = titles.find((item) => item.code === code);
  if (!title) return null;
  return title.amountCents / totalCents;
}

function buildIndicators(
  profile: MunicipalityProfile,
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

export function buildComuniFootprint(profile: MunicipalityProfile): ComuniFootprint {
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
    pnrrChildcare: profile.pnrrChildcare,
    schoolServices: profile.schoolServices,
    methodology: profile.siope.methodology,
    sources: profile.siope.sources,
    entityHref: `/enti/${encodeURIComponent(profile.identifiers.codiceIpa)}`,
  };
}

export async function getComuniFootprintByIpaCode(rawCode: string): Promise<ComuniFootprint | null> {
  const code = rawCode.trim();
  if (!CANONICAL_IPA.test(code)) return null;
  const detail = getSiopeMunicipalityDetailByIpaCode(code);
  if (!detail) return null;
  const entity = municipalitySnapshotEntity(detail);
  if (!entity) return null;
  const profile = await getMunicipalityProfile(entity, { allowCommittedIstatIdentity: true });
  if (!profile) return null;
  return buildComuniFootprint(profile);
}
