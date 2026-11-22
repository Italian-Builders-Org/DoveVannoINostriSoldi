import "server-only";

import { displayMunicipalityName } from "@/lib/comuni-search";
import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";
import { mefIrpefMetadata, mefIrpefMunicipalIncome } from "@/lib/mef-irpef-snapshot";
import {
  getMunicipalityGeographyByTaxCodeIfNameAgrees,
  populationBand,
  type MunicipalityGeography,
} from "@/lib/municipality-geography";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import { openCivitas2022AmministrazioneSnapshot } from "@/lib/opencivitas-2022-amministrazione-snapshot";
import { openCivitas2022IstruzioneSnapshot } from "@/lib/opencivitas-2022-istruzione-snapshot";
import { openCivitas2022PoliziaSnapshot } from "@/lib/opencivitas-2022-polizia-snapshot";
import { openCivitas2022RifiutiSnapshot } from "@/lib/opencivitas-2022-rifiuti-snapshot";
import { openCivitas2022SocialeAsiliSnapshot } from "@/lib/opencivitas-2022-sociale-asili-snapshot";
import { openCivitas2022ViabilitaSnapshot } from "@/lib/opencivitas-2022-viabilita-snapshot";
import type { OpenCivitasMunicipality } from "@/lib/data/opencivitas-contract";
import { getSiopeMunicipalityCompareRows } from "@/lib/siope-municipality-detail";
import { getSiopeMunicipalityReceipts } from "@/lib/siope-receipts";

/**
 * Peer comparison of municipalities ("Confronta"). Everything is derived from
 * snapshots already validated and bundled with the deployment: one index per
 * instance, no I/O per request, no score. A group is the population band of
 * the chosen municipality, optionally narrowed by region, altimetric zone and
 * coastal status. The chosen municipality never enters its own group stats.
 */

/** Last SIOPE year published for all twelve months. */
export const COMPARE_YEAR = 2025;
export const COMPARE_MAX_COMPARED = 4;
const AUTO_SUGGESTED = 3;
const SUGGESTIONS = 8;
const IPA_CODE = /^[A-Za-z0-9_]{1,40}$/;
// Bounded parsing: a hostile query string cannot make us scan unbounded tokens.
const MAX_RAW_TOKENS = 24;

export type CompareFilters = Readonly<{ region: boolean; altitude: boolean; coast: boolean }>;

export type CompareRequest = Readonly<{
  ente: string | null;
  compared: readonly string[];
  rejected: readonly string[];
  truncated: boolean;
  /** True when `con` is absent: the page proposes the nearest peers. */
  autoSuggest: boolean;
  filters: CompareFilters;
}>;

type Params = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length === 1 ? value[0]! : null;
  return value;
}

export function parseCompareParams(params: Params): CompareRequest {
  const rawEnte = single(params.ente)?.trim() ?? "";
  const ente = IPA_CODE.test(rawEnte) ? rawEnte : null;
  const rawCon = params.con;
  const tokens = (Array.isArray(rawCon) ? rawCon : rawCon === undefined ? [] : [rawCon])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_RAW_TOKENS);
  const compared: string[] = [];
  const rejected: string[] = [];
  let truncated = false;
  for (const token of tokens) {
    if (!IPA_CODE.test(token)) {
      rejected.push(token.slice(0, 40));
      continue;
    }
    if (token === ente || compared.includes(token)) continue;
    if (compared.length >= COMPARE_MAX_COMPARED) {
      truncated = true;
      continue;
    }
    compared.push(token);
  }
  const flag = (key: string) => single(params[key]) === "1";
  return {
    ente,
    compared,
    rejected,
    truncated,
    autoSuggest: rawCon === undefined,
    filters: { region: flag("regione"), altitude: flag("zona"), coast: flag("costa") },
  };
}

export type CompareMetricId =
  | "spesaTotale" | "spesaCorrente" | "investimenti" | "rimborsoPrestiti" | "quotaCorrente" | "quotaInvestimenti"
  | "entrateTributarie" | "trasferimenti" | "extratributarie" | "entrateCapitale" | "autonomia"
  | "ocTotale" | "ocScostamento" | "ocRifiuti" | "ocIstruzione" | "ocPolizia" | "ocViabilita" | "ocSociale" | "ocAmministrazione"
  | "redditoMedio" | "contribuenti" | "densita";

export type CompareMetricGroup = "Quanto spende" | "Come spende" | "Da dove arrivano i soldi" | "Spesa per servizio" | "Contesto";
export type CompareUnit = "euroPerCapita" | "percent" | "euro" | "perKm2" | "perHundred";

export type CompareMetric = Readonly<{
  id: CompareMetricId;
  group: CompareMetricGroup;
  label: string;
  unit: CompareUnit;
  description: string;
  source: string;
}>;

const SIOPE_SOURCE = `SIOPE, pagamenti di cassa ${COMPARE_YEAR}`;
const RECEIPTS_SOURCE = `SIOPE, incassi di cassa ${COMPARE_YEAR}`;
const OC_SOURCE = `OpenCivitas ${openCivitasSnapshot.referenceYear}, solo Regioni a statuto ordinario`;
const IRPEF_SOURCE = `MEF, dichiarazioni IRPEF ${mefIrpefMetadata.period.declarationYear} (anno d'imposta ${mefIrpefMetadata.period.taxYear})`;

export const COMPARE_METRICS: readonly CompareMetric[] = [
  { id: "spesaTotale", group: "Quanto spende", label: "Pagamenti totali", unit: "euroPerCapita", source: SIOPE_SOURCE,
    description: "Tutto ciò che è uscito dai conti del Comune nell'anno, diviso per i residenti. Include partite di giro e anticipazioni di cassa." },
  { id: "spesaCorrente", group: "Quanto spende", label: "Spese correnti", unit: "euroPerCapita", source: SIOPE_SOURCE,
    description: "Funzionamento quotidiano: personale, utenze, manutenzioni, servizi acquistati." },
  { id: "investimenti", group: "Quanto spende", label: "Investimenti", unit: "euroPerCapita", source: SIOPE_SOURCE,
    description: "Opere pubbliche e beni durevoli (spese in conto capitale)." },
  { id: "rimborsoPrestiti", group: "Quanto spende", label: "Rimborso prestiti", unit: "euroPerCapita", source: SIOPE_SOURCE,
    description: "Rate di mutui e prestiti già contratti: restituiscono capitale, non finanziano nuovi servizi." },
  { id: "quotaCorrente", group: "Come spende", label: "Quota spese correnti", unit: "percent", source: SIOPE_SOURCE,
    description: "Parte dei pagamenti totali che va al funzionamento quotidiano." },
  { id: "quotaInvestimenti", group: "Come spende", label: "Quota investimenti", unit: "percent", source: SIOPE_SOURCE,
    description: "Parte dei pagamenti totali che va a opere e beni durevoli." },
  { id: "entrateTributarie", group: "Da dove arrivano i soldi", label: "Tributi e perequazione", unit: "euroPerCapita", source: RECEIPTS_SOURCE,
    description: "Incassi da tributi locali (IMU, addizionale, TARI) e fondo di solidarietà comunale." },
  { id: "trasferimenti", group: "Da dove arrivano i soldi", label: "Trasferimenti correnti", unit: "euroPerCapita", source: RECEIPTS_SOURCE,
    description: "Soldi ricevuti da Stato, Regione e altri enti per la spesa corrente." },
  { id: "extratributarie", group: "Da dove arrivano i soldi", label: "Entrate extratributarie", unit: "euroPerCapita", source: RECEIPTS_SOURCE,
    description: "Tariffe dei servizi, multe, canoni, affitti e altri proventi propri." },
  { id: "entrateCapitale", group: "Da dove arrivano i soldi", label: "Entrate in conto capitale", unit: "euroPerCapita", source: RECEIPTS_SOURCE,
    description: "Contributi per investimenti (compreso il PNRR), alienazioni, oneri di urbanizzazione." },
  { id: "autonomia", group: "Da dove arrivano i soldi", label: "Entrate proprie", unit: "percent", source: RECEIPTS_SOURCE,
    description: "Tributi ed entrate extratributarie sul totale delle entrate correnti incassate. Calcolo DVNS sulla cassa, non l'indicatore di bilancio." },
  { id: "ocTotale", group: "Spesa per servizio", label: "Servizi comunali, spesa storica", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per le funzioni fondamentali, per abitante, come pubblicata da OpenCivitas." },
  { id: "ocScostamento", group: "Spesa per servizio", label: "Scostamento dal fabbisogno standard", unit: "percent", source: OC_SOURCE,
    description: "Differenza tra spesa storica e fabbisogno standard. Positivo: spende più dello standard. Non è una misura di spreco." },
  { id: "ocRifiuti", group: "Spesa per servizio", label: "Rifiuti", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per raccolta e smaltimento dei rifiuti." },
  { id: "ocIstruzione", group: "Spesa per servizio", label: "Istruzione", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per scuole, refezione e trasporto scolastico." },
  { id: "ocPolizia", group: "Spesa per servizio", label: "Polizia locale", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per la polizia municipale." },
  { id: "ocViabilita", group: "Spesa per servizio", label: "Viabilità e territorio", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per strade, illuminazione pubblica e territorio." },
  { id: "ocSociale", group: "Spesa per servizio", label: "Sociale e asili nido", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per servizi sociali e asili nido." },
  { id: "ocAmministrazione", group: "Spesa per servizio", label: "Amministrazione generale", unit: "euroPerCapita", source: OC_SOURCE,
    description: "Spesa storica per uffici, organi istituzionali e gestione generale." },
  { id: "redditoMedio", group: "Contesto", label: "Reddito medio dichiarato", unit: "euro", source: IRPEF_SOURCE,
    description: "Reddito complessivo dichiarato diviso per chi lo dichiara. Non è il reddito di una famiglia tipo." },
  { id: "contribuenti", group: "Contesto", label: "Contribuenti ogni 100 abitanti", unit: "perHundred", source: IRPEF_SOURCE,
    description: "Dichiaranti IRPEF rispetto ai residenti ISTAT." },
  { id: "densita", group: "Contesto", label: "Densità", unit: "perKm2", source: "ISTAT, popolazione e superficie",
    description: "Abitanti per chilometro quadrato." },
];

export type CompareValues = Readonly<Record<CompareMetricId, number | null>>;

export type CompareMember = Readonly<{
  codiceIpa: string;
  taxCode: string;
  name: string;
  province: string;
  region: string | null;
  regionCode: string;
  population: number | null;
  altimetricZone: number | null;
  altimetricZoneLabel: string | null;
  coastal: boolean;
  values: CompareValues;
  /** Shares of total payments by SIOPE title group, 0-100. */
  composition: Readonly<{ correnti: number; investimenti: number; prestiti: number; altro: number }> | null;
}>;

export type CompareStat = Readonly<{ count: number; p10: number; p25: number; median: number; p75: number; p90: number }>;

export type ComparedMember = CompareMember & Readonly<{ inGroup: boolean; autoSuggested: boolean }>;

export type ComuniComparison = Readonly<{
  year: number;
  base: CompareMember;
  compared: readonly ComparedMember[];
  missing: readonly string[];
  request: CompareRequest;
  group: Readonly<{
    band: string;
    size: number;
    criteria: readonly string[];
    members: readonly CompareMember[];
  }>;
  metrics: readonly CompareMetric[];
  stats: Readonly<Record<CompareMetricId, CompareStat | null>>;
  /** Share of group members strictly below each value of the base (0-100). */
  basePercentile: Readonly<Record<CompareMetricId, number | null>>;
  suggestions: readonly Readonly<{ codiceIpa: string; name: string; province: string; population: number | null }>[];
}>;

const euros = (cents: number) => cents / 100;
const per = (amountCents: number | undefined, population: number | null) =>
  amountCents === undefined || !population || population <= 0 ? null : euros(amountCents) / population;
const share = (part: number, total: number) => (total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : null);

function openCivitasIndex(municipalities: readonly OpenCivitasMunicipality[]): ReadonlyMap<string, OpenCivitasMunicipality> {
  return new Map(municipalities.map((item) => [item.istatCode, item]));
}

type Index = Readonly<{ members: readonly CompareMember[]; byIpa: ReadonlyMap<string, CompareMember> }>;
let index: Index | null = null;

function buildIndex(): Index {
  const rows = getSiopeMunicipalityCompareRows(COMPARE_YEAR);
  const total = openCivitasIndex(openCivitasSnapshot.municipalities);
  const functions = {
    ocRifiuti: openCivitasIndex(openCivitas2022RifiutiSnapshot.municipalities),
    ocIstruzione: openCivitasIndex(openCivitas2022IstruzioneSnapshot.municipalities),
    ocPolizia: openCivitasIndex(openCivitas2022PoliziaSnapshot.municipalities),
    ocViabilita: openCivitasIndex(openCivitas2022ViabilitaSnapshot.municipalities),
    ocSociale: openCivitasIndex(openCivitas2022SocialeAsiliSnapshot.municipalities),
    ocAmministrazione: openCivitasIndex(openCivitas2022AmministrazioneSnapshot.municipalities),
  } as const;
  const income = mefIrpefMunicipalIncome();
  const members: CompareMember[] = [];
  for (const row of rows.values()) {
    const geography: MunicipalityGeography | null =
      getMunicipalityGeographyByTaxCodeIfNameAgrees(COMPARE_YEAR, row.taxCode, row.name);
    if (!geography) continue;
    const titles = row.titleCents;
    // TITLE_ORDER: 0, 1, 2, 3, 4, 5, 7.
    const t = (index: number) => titles?.[index];
    const receipts = getSiopeMunicipalityReceipts(row.taxCode, COMPARE_YEAR);
    const r = (code: string) => receipts?.titles.find((item) => item.code === code)?.amountCents;
    const ownCurrent = (r("1") ?? 0) + (r("3") ?? 0);
    const allCurrent = ownCurrent + (r("2") ?? 0);
    const oc = total.get(geography.istatCode);
    const ocPer = (map: ReadonlyMap<string, OpenCivitasMunicipality>) => {
      const item = map.get(geography.istatCode);
      return item ? euros(item.historicalPerCapitaCents) : null;
    };
    const irpef = income.get(geography.istatCode);
    const incomeAvailable = irpef && irpef.comprehensiveIncomeFrequency && irpef.comprehensiveIncomeAmountCents !== null;
    const population = geography.residentPopulation;
    const values: CompareValues = {
      spesaTotale: per(row.totalCents, row.population),
      spesaCorrente: per(t(1), row.population),
      investimenti: per(t(2), row.population),
      rimborsoPrestiti: per(t(4), row.population),
      quotaCorrente: titles ? share(t(1)!, row.totalCents) : null,
      quotaInvestimenti: titles ? share(t(2)!, row.totalCents) : null,
      entrateTributarie: receipts ? per(r("1"), receipts.population) : null,
      trasferimenti: receipts ? per(r("2"), receipts.population) : null,
      extratributarie: receipts ? per(r("3"), receipts.population) : null,
      entrateCapitale: receipts ? per(r("4"), receipts.population) : null,
      autonomia: receipts && allCurrent > 0 ? share(ownCurrent, allCurrent) : null,
      ocTotale: oc ? euros(oc.historicalPerCapitaCents) : null,
      ocScostamento: oc ? oc.differenceBasisPoints / 100 : null,
      ocRifiuti: ocPer(functions.ocRifiuti),
      ocIstruzione: ocPer(functions.ocIstruzione),
      ocPolizia: ocPer(functions.ocPolizia),
      ocViabilita: ocPer(functions.ocViabilita),
      ocSociale: ocPer(functions.ocSociale),
      ocAmministrazione: ocPer(functions.ocAmministrazione),
      redditoMedio: incomeAvailable ? euros(irpef.comprehensiveIncomeAmountCents!) / irpef.comprehensiveIncomeFrequency! : null,
      contribuenti: irpef && population ? (irpef.taxpayers / population) * 100 : null,
      densita: geography.densityPerSquareKilometre,
    };
    const composition = titles && row.totalCents > 0 ? (() => {
      const correnti = share(t(1)!, row.totalCents)!;
      const investimenti = share(t(2)!, row.totalCents)!;
      const prestiti = share(t(4)!, row.totalCents)!;
      return { correnti, investimenti, prestiti, altro: Math.max(0, 100 - correnti - investimenti - prestiti) };
    })() : null;
    members.push({
      codiceIpa: row.codiceIpa,
      taxCode: row.taxCode,
      name: displayMunicipalityName(row.name),
      province: displayMunicipalityName(row.province),
      region: REGION_NAME_BY_ISTAT_CODE[geography.regionCode as keyof typeof REGION_NAME_BY_ISTAT_CODE] ?? row.region,
      regionCode: geography.regionCode,
      population,
      altimetricZone: geography.altimetricZone,
      altimetricZoneLabel: geography.altimetricZoneLabel,
      coastal: geography.coastal,
      values,
      composition,
    });
  }
  return { members, byIpa: new Map(members.map((member) => [member.codiceIpa, member])) };
}

function getIndex(): Index {
  index ??= buildIndex();
  return index;
}

/** Linear interpolation between order statistics, as in the studies. */
function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function stat(values: readonly number[]): CompareStat | null {
  if (values.length < 5) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
  };
}

function distance(population: number | null, target: number | null): number {
  if (!population || !target) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log(population / target));
}

export function buildComuniComparison(request: CompareRequest): ComuniComparison | null {
  if (!request.ente) return null;
  const { members, byIpa } = getIndex();
  const base = byIpa.get(request.ente);
  if (!base) return null;
  const band = populationBand(base.population);
  if (!band) return null;
  const { filters } = request;
  const criteria = [`stessa fascia di popolazione (${band})`];
  if (filters.region) criteria.push(`stessa regione (${base.region ?? base.regionCode})`);
  if (filters.altitude) criteria.push(`stessa zona altimetrica (${base.altimetricZoneLabel ?? "n.d."})`);
  if (filters.coast) criteria.push(base.coastal ? "comuni costieri" : "comuni non costieri");
  const inGroup = (member: CompareMember) =>
    member.codiceIpa !== base.codiceIpa
    && populationBand(member.population) === band
    && (!filters.region || member.regionCode === base.regionCode)
    && (!filters.altitude || member.altimetricZone === base.altimetricZone)
    && (!filters.coast || member.coastal === base.coastal);
  const group = members.filter(inGroup);

  const stats = {} as Record<CompareMetricId, CompareStat | null>;
  const basePercentile = {} as Record<CompareMetricId, number | null>;
  for (const metric of COMPARE_METRICS) {
    const values = group.flatMap((member) => (member.values[metric.id] === null ? [] : [member.values[metric.id]!]));
    stats[metric.id] = stat(values);
    const own = base.values[metric.id];
    basePercentile[metric.id] = own === null || values.length < 5
      ? null
      : (values.filter((value) => value < own).length / values.length) * 100;
  }

  const byDistance = [...group].sort((a, b) =>
    distance(a.population, base.population) - distance(b.population, base.population)
    || a.name.localeCompare(b.name, "it"));
  const missing: string[] = [];
  const compared: ComparedMember[] = [];
  if (request.autoSuggest) {
    for (const member of byDistance.slice(0, AUTO_SUGGESTED)) compared.push({ ...member, inGroup: true, autoSuggested: true });
  } else {
    for (const code of request.compared) {
      const member = byIpa.get(code);
      if (!member) missing.push(code);
      else compared.push({ ...member, inGroup: inGroup(member), autoSuggested: false });
    }
  }
  const chosen = new Set(compared.map((member) => member.codiceIpa));
  const suggestions = byDistance
    .filter((member) => !chosen.has(member.codiceIpa))
    .slice(0, SUGGESTIONS)
    .map(({ codiceIpa, name, province, population }) => ({ codiceIpa, name, province, population }));

  return {
    year: COMPARE_YEAR,
    base,
    compared,
    missing,
    request,
    group: { band, size: group.length, criteria, members: group },
    metrics: COMPARE_METRICS,
    stats,
    basePercentile,
    suggestions,
  };
}

/** Canonical compare URL: stable parameter order, only effective filters. */
export function compareHref(ente: string, compared: readonly string[], filters: CompareFilters, extra?: string): string {
  const params = new URLSearchParams({ ente });
  const list = extra && !compared.includes(extra) ? [...compared, extra] : [...compared];
  params.set("con", list.slice(0, COMPARE_MAX_COMPARED).join(","));
  if (filters.region) params.set("regione", "1");
  if (filters.altitude) params.set("zona", "1");
  if (filters.coast) params.set("costa", "1");
  return `/comuni/confronta?${params.toString().replaceAll("%2C", ",")}`;
}

/** URL prefix for the search box: the picked Codice IPA is appended to `con`. */
export function compareAddPrefix(ente: string, compared: readonly string[], filters: CompareFilters): string {
  const params = new URLSearchParams({ ente });
  if (filters.region) params.set("regione", "1");
  if (filters.altitude) params.set("zona", "1");
  if (filters.coast) params.set("costa", "1");
  const list = compared.slice(0, COMPARE_MAX_COMPARED - 1).join(",");
  return `/comuni/confronta?${params.toString()}&con=${list}${list ? "," : ""}`;
}
