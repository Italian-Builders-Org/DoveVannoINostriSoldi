/**
 * DVNS Index: contratto di confine e vista.
 *
 * Base oggettiva: dati ufficiali verificabili (OpenCivitas MEF/SOSE, SIOPE,
 * ANAC). Parte di indicatore: le regole dichiarate nello spec
 * `scripts/etl/specs/dvns-index.source.json`, riportate nel payload e
 * mostrate in pagina. Ogni punteggio si scompone in pilastri, pesi e dati di
 * partenza: la vista produce anche le frasi che spiegano perché un Comune ha
 * quel punteggio.
 *
 * Validazione scritta a mano, come per gli altri snapshot ricevuti da
 * dvns_snapshots: niente Zod nel percorso del typecheck.
 */
import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";

export const PILLARS = ["resa", "sovraspesa", "investire", "appalti", "puntualita", "risultati"] as const;
export type Pillar = (typeof PILLARS)[number];
export const BANDS = ["A", "B", "C", "D", "E"] as const;
export type Band = (typeof BANDS)[number];
export type Status = "ranked" | "partial" | "special-statute" | "no-opencivitas";
export const FUNCTION_LABELS: Record<string, string> = {
  amministrazione: "amministrazione",
  istruzione: "istruzione",
  polizia: "polizia locale",
  rifiuti: "rifiuti",
  "sociale-asili": "sociale e asili nido",
  viabilita: "viabilità e territorio",
};
export const PILLAR_LABELS: Record<Pillar, { title: string; short: string; question: string }> = {
  resa: { title: "Resa della spesa", short: "resa della spesa", question: "Quanti servizi ottiene per quello che spende?" },
  sovraspesa: { title: "Spesa non giustificata", short: "spesa non giustificata", question: "Spende più del necessario senza offrire di più?" },
  investire: { title: "Capacità di investire", short: "investimenti", question: "Quanta parte della spesa va in opere e beni durevoli?" },
  appalti: { title: "Apertura degli appalti", short: "apertura degli appalti", question: "Mette in gara gli appalti o li affida senza confronto?" },
  puntualita: { title: "Puntualità nei pagamenti", short: "puntualità nei pagamenti", question: "Paga i fornitori entro i tempi di legge?" },
  risultati: { title: "Raccolta differenziata", short: "raccolta differenziata", question: "Quanta parte dei rifiuti viene differenziata?" },
};

export type IndexEntry = {
  istat: string;
  taxCode: string | null;
  name: string;
  regionCode: string;
  population: number;
  status: Status;
  score: number | null;
  band: Band | null;
  bandStability: number | null;
  rank: number | null;
  /** Positions at the 5th and 95th percentile of the weight draws. */
  rankLow: number | null;
  rankHigh: number | null;
  peerRank: number | null;
  peerRanked: number | null;
  group: number | null;
  pillars: Partial<Record<Pillar, number>>;
  spending2022: number | null;
  services2022: number | null;
  spending2021: number | null;
  services2021: number | null;
  investmentShare: number | null;
  withoutTenderShare: number | null;
  procedures: number | null;
  topSupplierShare: number | null;
  awards: number | null;
  functionResa: (number | null)[];
  /** Weighted average delay in paying suppliers, days (negative = early). PCC, Ragioneria Generale dello Stato. */
  delay2024: number | null;
  delay2025: number | null;
  /** Separate waste collection, % (ISPRA). */
  rd2022: number | null;
  rd2023: number | null;
  /** Capital payments per resident per year, euro (SIOPE 2024-2025). */
  capitalPerCapita: number | null;
  /** Spends below the need but pays suppliers late: the lower spending earns no efficiency credit. */
  underspendWithoutCredit: boolean;
  /** OpenCivitas services changed by more than the threshold between 2021 and 2022: out of the ranking. */
  volatile: boolean;
  /** Too few contracts to judge: the procurement pillar is set to 50, the middle value. */
  appaltiNeutral: boolean;
};

export type PeerGroup = { id: number; stage: string; values: (number | boolean | null)[]; size: number };
export type IndexRules = {
  weights: Record<Pillar, number>;
  procurementThresholdEuro: number;
  minProcedures: number;
  minAwards: number;
  shrinkProcedures: number;
  shrinkAwards: number;
  reducedCompetition: string[];
  neutral: string[];
  sensitivity: { draws: number; spread: number };
  volatileServicesPoints: number;
  implausibleEarlyPaymentDays: number;
  minPeerValues: number;
  /** Minimum comparable Comuni (covered by OpenCivitas) in a peer group before it is widened. */
  minPeers: number;
  concentrationExcludedCpvDivisions: string[];
};
export type IndexSnapshot = {
  version: string;
  rules: IndexRules;
  functions: string[];
  entries: IndexEntry[];
  groups: PeerGroup[];
  summary: {
    municipalities: number;
    ranked: number;
    partial: number;
    specialStatute: number;
    volatile: number;
    /** Payment years discarded because the payment would precede the invoice. */
    implausibleDelays: number;
    underspendWithoutCredit: number;
    medianScore: number;
    medianStability: number;
    bandCutoffs: number[];
    anacProcedures: number;
    medianWithoutTenderShare: number;
    appaltiNeutral: number;
    /** External check: Comuni in financial distress (Interior Ministry decree) and where the index puts them. */
    validation: { listed: number; matched: number; ranked: number; medianScore: number; bands: Record<Band, number> };
  };
  sources: { id: string; label: string; owner: string; url: string; license: string }[];
};

const COLUMNS = [
  "istat", "taxCode", "name", "region", "population", "status", "score", "band", "bandStability", "rank", "rankLow", "rankHigh", "peerRank", "peerRanked", "group",
  "pResa", "pSovraspesa", "pInvestire", "pAppalti", "pPuntualita", "pRisultati",
  "spending2022", "services2022", "spending2021", "services2021",
  "investmentShare", "withoutTenderShare", "procedures", "topSupplierShare", "awards", "functionResa",
  "delay2024", "delay2025", "rd2022", "rd2023", "capitalPerCapita", "underspendWithoutCredit", "volatile", "appaltiNeutral",
] as const;

function fail(message: string): never {
  throw new Error(`Snapshot DVNS Index non valido: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} non è un oggetto`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} non è un elenco`);
  return value;
}

function num(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${path} fuori dominio`);
  return value;
}

function optNum(value: unknown, path: string, min = -Infinity, max = Infinity): number | null {
  return value === null ? null : num(value, path, min, max);
}

function optInt(value: unknown, path: string, min = 0): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < min) fail(`${path} non è un intero valido`);
  return value as number;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} non è vero/falso`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${path} vuoto`);
  return value;
}

export function assertIndexSnapshot(value: unknown): IndexSnapshot {
  const root = record(value, "snapshot");
  if (root.schemaVersion !== 1 || root.datasetId !== "dvns-index") fail("schema o dataset inattesi");
  const columns = list(root.columns, "columns");
  if (columns.length !== COLUMNS.length || columns.some((column, index) => column !== COLUMNS[index])) fail("colonne inattese");
  const rules = record(root.rules, "rules");
  const weights = record(rules.weights, "rules.weights");
  const weightValues = PILLARS.map((pillar) => num(weights[pillar], `rules.weights.${pillar}`, 0, 1));
  num(rules.volatileServicesPoints, "rules.volatileServicesPoints", 1);
  if (!Array.isArray(rules.concentrationExcludedCpvDivisions)) fail("rules.concentrationExcludedCpvDivisions non è un elenco");
  if (Math.abs(weightValues.reduce((sum, item) => sum + item, 0) - 1) > 1e-9) fail("i pesi non sommano a 1");
  const functions = list(root.functions, "functions").map((item, index) => text(item, `functions[${index}]`));
  const groups = list(root.groups, "groups").map((item, index): PeerGroup => {
    const row = record(item, `groups[${index}]`);
    if (row.id !== index) fail(`groups[${index}].id`);
    return { id: index, stage: text(row.stage, `groups[${index}].stage`), values: list(row.values, `groups[${index}].values`) as PeerGroup["values"], size: num(row.size, `groups[${index}].size`, 1) };
  });
  const seen = new Set<string>();
  let ranked = 0;
  const entries = list(root.rows, "rows").map((item, index): IndexEntry => {
    const path = `rows[${index}]`;
    const row = list(item, path);
    if (row.length !== COLUMNS.length) fail(`${path}: lunghezza`);
    const [istat, taxCode, name, region, population, status, score, band, stability, rank, rankLow, rankHigh, peerRank, peerRanked, group,
      pResa, pSovraspesa, pInvestire, pAppalti, pPuntualita, pRisultati, spending2022, services2022, spending2021, services2021,
      investmentShare, withoutTenderShare, procedures, topSupplierShare, awards, functionResa,
      delay2024, delay2025, rd2022, rd2023, capitalPerCapita, underspendWithoutCredit, volatile, appaltiNeutral] = row;
    if (typeof istat !== "string" || !/^\d{6}$/u.test(istat) || seen.has(istat)) fail(`${path}: codice ISTAT`);
    seen.add(istat);
    if (status !== "ranked" && status !== "partial" && status !== "special-statute" && status !== "no-opencivitas") fail(`${path}: stato`);
    if (band !== null && !BANDS.includes(band as Band)) fail(`${path}: fascia`);
    if (status === "ranked") {
      ranked += 1;
      if (band === null || rank === null || score === null) fail(`${path}: Comune in classifica senza fascia o posizione`);
    } else if (band !== null || rank !== null) fail(`${path}: fascia o posizione fuori classifica`);
    const groupId = optInt(group, `${path}.group`);
    if (groupId !== null && groupId >= groups.length) fail(`${path}: gruppo sconosciuto`);
    const pillars: Partial<Record<Pillar, number>> = {};
    for (const [pillar, value] of [["resa", pResa], ["sovraspesa", pSovraspesa], ["investire", pInvestire], ["appalti", pAppalti], ["puntualita", pPuntualita], ["risultati", pRisultati]] as const) {
      const parsed = optNum(value, `${path}.${pillar}`, 0, 100);
      if (parsed !== null) pillars[pillar] = parsed;
    }
    const resaByFunction = list(functionResa, `${path}.functionResa`);
    if (resaByFunction.length !== functions.length) fail(`${path}: funzioni`);
    return {
      istat,
      taxCode: taxCode === null ? null : text(taxCode, `${path}.taxCode`),
      name: text(name, `${path}.name`),
      regionCode: text(region, `${path}.region`),
      population: num(population, `${path}.population`, 0),
      status,
      score: optNum(score, `${path}.score`, 0, 100),
      band: band as Band | null,
      bandStability: optNum(stability, `${path}.bandStability`, 0, 1),
      rank: optInt(rank, `${path}.rank`, 1),
      rankLow: optInt(rankLow, `${path}.rankLow`, 1),
      rankHigh: optInt(rankHigh, `${path}.rankHigh`, 1),
      peerRank: optInt(peerRank, `${path}.peerRank`, 1),
      peerRanked: optInt(peerRanked, `${path}.peerRanked`, 1),
      group: groupId,
      pillars,
      spending2022: optNum(spending2022, `${path}.spending2022`),
      services2022: optNum(services2022, `${path}.services2022`),
      spending2021: optNum(spending2021, `${path}.spending2021`),
      services2021: optNum(services2021, `${path}.services2021`),
      investmentShare: optNum(investmentShare, `${path}.investmentShare`, 0, 100),
      withoutTenderShare: optNum(withoutTenderShare, `${path}.withoutTenderShare`, 0, 100),
      procedures: optInt(procedures, `${path}.procedures`),
      topSupplierShare: optNum(topSupplierShare, `${path}.topSupplierShare`, 0, 100),
      awards: optInt(awards, `${path}.awards`),
      functionResa: resaByFunction.map((value, position) => optNum(value, `${path}.functionResa[${position}]`)),
      delay2024: optNum(delay2024, `${path}.delay2024`, -60, 2000),
      delay2025: optNum(delay2025, `${path}.delay2025`, -60, 2000),
      rd2022: optNum(rd2022, `${path}.rd2022`, 0, 100),
      rd2023: optNum(rd2023, `${path}.rd2023`, 0, 100),
      capitalPerCapita: optNum(capitalPerCapita, `${path}.capitalPerCapita`, 0),
      underspendWithoutCredit: bool(underspendWithoutCredit, `${path}.underspendWithoutCredit`),
      volatile: bool(volatile, `${path}.volatile`),
      appaltiNeutral: bool(appaltiNeutral, `${path}.appaltiNeutral`),
    };
  });
  const summary = record(root.summary, "summary");
  if (summary.ranked !== ranked) fail("il riepilogo non corrisponde ai Comuni in classifica");
  if (entries.some((entry) => entry.appaltiNeutral && entry.pillars.appalti !== 50)) fail("appalti neutri diversi da 50");
  const validation = record(summary.validation, "summary.validation");
  const validationBands = record(validation.bands, "summary.validation.bands");
  const bandTotal = BANDS.reduce((sum, band) => sum + num(validationBands[band], `summary.validation.bands.${band}`, 0), 0);
  if (bandTotal !== num(validation.ranked, "summary.validation.ranked", 0)) fail("controllo sui dissesti incoerente");
  const ranks = entries.flatMap((entry) => (entry.rank === null ? [] : [entry.rank])).sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1)) fail("posizioni non consecutive");
  return {
    version: text(root.version, "version"),
    rules: rules as unknown as IndexRules,
    functions,
    entries,
    groups,
    summary: summary as unknown as IndexSnapshot["summary"],
    sources: list(root.sources, "sources").map((item, index) => {
      const source = record(item, `sources[${index}]`);
      const url = text(source.url, `sources[${index}].url`);
      if (!url.startsWith("https://")) fail(`sources[${index}].url`);
      return { id: text(source.id, "id"), label: text(source.label, "label"), owner: text(source.owner, "owner"), url, license: text(source.license, "license") };
    }),
  };
}

// ── vista ───────────────────────────────────────────────────────────────────

const ALTITUDE: Record<number, string> = { 1: "montagna interna", 2: "montagna litoranea", 3: "collina interna", 4: "collina litoranea", 5: "pianura" };
const URBAN: Record<number, string> = { 1: "città", 2: "zona a densità intermedia", 3: "zona rurale" };
const POPULATION = ["con meno di 1.000 abitanti", "da 1.000 a 4.999 abitanti", "da 5.000 a 19.999 abitanti", "da 20.000 a 49.999 abitanti", "da 50.000 a 99.999 abitanti", "con almeno 100.000 abitanti"];
const SURFACE = ["meno di 10 km²", "10-50 km²", "50-200 km²", "200-500 km²", "oltre 500 km²"];

/** Es. "i Comuni da 1.000 a 4.999 abitanti, con 10-50 km² di superficie, in collina interna e in zona rurale, non costieri". */
export function describeGroup(group: PeerGroup): string {
  if (group.stage === "big") return "le città con almeno 100.000 abitanti";
  const [population, surface, altitude, urban, coastal, island] = group.values as [number, number?, number?, number?, boolean?, boolean?];
  const parts = [`i Comuni ${POPULATION[population]}`];
  if (surface !== undefined) parts.push(`con ${SURFACE[surface]} di superficie`);
  const place = [
    altitude !== undefined && altitude !== null ? `in ${ALTITUDE[altitude]}` : null,
    urban !== undefined && urban !== null ? `in ${URBAN[urban]}` : null,
  ].filter(Boolean);
  if (place.length) parts.push(place.join(" e "));
  if (coastal !== undefined) parts.push(coastal ? "sulla costa" : "non costieri");
  if (island) parts.push("su un'isola");
  return parts.join(", ");
}

/** "il 12,3% di servizi in più", "il 18,1% in meno", "in linea". */
function relative(value: number, noun?: string): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return noun ? `${noun} in linea` : "in linea";
  const amount = `il ${Math.abs(rounded).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
  return `${amount}${noun ? ` di ${noun}` : ""} ${rounded > 0 ? "in più" : "in meno"}`;
}

const points = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toLocaleString("it-IT", { maximumFractionDigits: 1 })}`;
};
const pct = (value: number) => `${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
const integer = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 0 });

export type PillarExplanation = {
  pillar: Pillar;
  percentile: number | null;
  weight: number;
  points: number | null;
  verdict: string;
  facts: string[];
};

function betterThan(percentile: number | null): string {
  if (percentile === null) return "Non valutabile: dati insufficienti";
  const value = Math.round(percentile);
  // "dell'80%", "dell'11%", "dell'8%"; "del 50%" negli altri casi.
  const article = value === 8 || value === 11 || (value >= 80 && value <= 89) ? "dell'" : "del ";
  return `Meglio ${article}${value}% dei Comuni simili`;
}

/** Le frasi del "perché": ogni pilastro con il suo percentile, il peso e i dati da cui nasce. */
export function explainEntry(entry: IndexEntry, rules: IndexRules): PillarExplanation[] {
  return PILLARS.map((pillar) => {
    const percentile = entry.pillars[pillar] ?? null;
    const weight = rules.weights[pillar];
    const facts: string[] = [];
    if (pillar === "resa") {
      if (entry.spending2022 !== null && entry.services2022 !== null) {
        facts.push(`Nel 2022 offre ${relative(entry.services2022, "servizi")} rispetto alla media dei Comuni della sua fascia e spende ${relative(entry.spending2022)} rispetto al fabbisogno standard.`);
        // Same rule as resa_value in the ETL: late payers get no credit for spending below the need.
        const saldo = (services: number, spending: number) => services - (entry.underspendWithoutCredit && spending < 0 ? 0 : spending);
        facts.push(`Saldo ${entry.underspendWithoutCredit ? "usato nel calcolo" : "tra servizi e spesa"}: ${points(saldo(entry.services2022, entry.spending2022))} punti percentuali nel 2022${entry.spending2021 !== null && entry.services2021 !== null ? `, ${points(saldo(entry.services2021, entry.spending2021))} nel 2021` : ""}. Più il saldo è alto, più servizi ottiene per ogni euro.`);
        if (entry.underspendWithoutCredit) facts.push("Spende meno del fabbisogno ma paga i fornitori in ritardo: la spesa bassa può dipendere da difficoltà di cassa, quindi non conta come efficienza. Nel saldo contano solo i servizi.");
      } else facts.push("OpenCivitas non pubblica livelli di spesa e servizi per questo Comune.");
    } else if (pillar === "sovraspesa") {
      if (entry.spending2022 !== null && entry.services2022 !== null) {
        const gap = Math.max(0, entry.spending2022 - Math.max(0, entry.services2022));
        facts.push(gap > 0
          ? `Spende il ${pct(Math.round(gap * 10) / 10)} oltre il fabbisogno senza servizi in più che lo giustifichino.`
          : entry.spending2022 > 0
            ? "Spende più del fabbisogno, ma offre servizi in più almeno nella stessa misura: nessuna penalità."
            : "Spende quanto il fabbisogno standard o meno: nessuna penalità.");
      }
    } else if (pillar === "investire") {
      if (entry.investmentShare !== null) facts.push(`Nel 2024 e nel 2025 il ${pct(entry.investmentShare)} dei pagamenti è andato in investimenti, il resto in spesa corrente.`);
      if (entry.capitalPerCapita !== null) facts.push(`In media ${integer(Math.round(entry.capitalPerCapita))} € di investimenti per abitante all'anno. La quota e la cifra per abitante pesano metà ciascuna, così un Comune con poca spesa corrente non sembra un grande investitore.`);
      if (!facts.length) facts.push("Pagamenti SIOPE 2024-2025 non disponibili.");
    } else if (pillar === "puntualita") {
      const delays = [[2024, entry.delay2024], [2025, entry.delay2025]].filter((pair): pair is [number, number] => pair[1] !== null);
      if (delays.length) {
        facts.push(`Ritardo medio ponderato nel pagare le fatture: ${delays.map(([year, days]) => `${days > 0 ? `${integer(Math.round(days))} giorni oltre la scadenza` : days < 0 ? `${integer(Math.round(-days))} giorni prima della scadenza` : "in pari con la scadenza"} nel ${year}`).join(", ")}.`);
        facts.push("La legge chiede di pagare entro 30 giorni (60 per alcune forniture). Un ritardo indica cassa in difficoltà o uffici lenti, e costa interessi ai fornitori.");
      } else facts.push("La Piattaforma dei crediti commerciali non riporta tempi di pagamento per questo Comune.");
    } else if (pillar === "risultati") {
      const rd = [[2022, entry.rd2022], [2023, entry.rd2023]].filter((pair): pair is [number, number] => pair[1] !== null);
      if (rd.length) {
        facts.push(`Raccolta differenziata: ${rd.map(([year, value]) => `${pct(Math.round(value * 10) / 10)} nel ${year}`).join(", ")}. L'obiettivo di legge è il 65%.`);
        facts.push("È uno dei pochi risultati misurati da un ente terzo (ISPRA) per tutti i Comuni: non dice tutto sulla qualità dei servizi, ma non dipende da quanto dichiara il Comune.");
      } else facts.push("ISPRA non pubblica la raccolta differenziata di questo Comune.");
    } else {
      if (entry.withoutTenderShare !== null && entry.procedures !== null) {
        facts.push(`Delle sue ${integer(entry.procedures)} procedure da almeno ${integer(rules.procurementThresholdEuro)} € pubblicate nel 2025, il ${pct(entry.withoutTenderShare)} del valore è stato assegnato senza gara.`);
      }
      if (entry.topSupplierShare !== null && entry.awards !== null) {
        facts.push(`Il fornitore principale ha ricevuto il ${pct(entry.topSupplierShare)} del valore delle sue ${integer(entry.awards)} aggiudicazioni a un singolo operatore. Rifiuti, energia e acqua sono esclusi: lì un solo gestore è la norma.`);
      }
      if (!facts.length) facts.push(entry.appaltiNeutral
        ? "Nel 2025 le procedure e le aggiudicazioni sono troppo poche per giudicare: il pilastro vale 50, la media, così non premia e non penalizza."
        : "Nel 2025 le procedure e le aggiudicazioni sono troppo poche per un confronto affidabile.");
      else if ((entry.procedures ?? 0) < 20 || (entry.awards ?? 0) < 20) facts.push("Con pochi appalti un solo contratto sposta molto la quota: per questo il valore è stato avvicinato alla mediana nazionale.");
    }
    // With no unjustified spending a Comune ties with most of its peers: "better than 58%" would read as a fault.
    const noPenalty = pillar === "sovraspesa" && entry.spending2022 !== null && entry.services2022 !== null
      && entry.spending2022 - Math.max(0, entry.services2022) <= 0;
    const label = noPenalty && percentile !== null ? "Nessuna spesa non giustificata, come la maggior parte dei Comuni simili" : betterThan(percentile);
    return { pillar, percentile, weight, points: percentile === null ? null : Math.round(percentile * weight * 10) / 10, verdict: label, facts };
  });
}

/** Le due funzioni dove il Comune rende di più e di meno (OpenCivitas 2022, saldo servizi meno spesa). */
export function functionHighlights(entry: IndexEntry, functions: string[]): { best: string[]; worst: string[] } {
  const known = functions
    .map((name, index) => ({ name: FUNCTION_LABELS[name] ?? name, value: entry.functionResa[index] }))
    .filter((item): item is { name: string; value: number } => item.value !== null)
    .sort((a, b) => b.value - a.value);
  if (known.length < 3) return { best: [], worst: [] };
  return { best: known.slice(0, 2).map((item) => item.name), worst: known.slice(-2).reverse().map((item) => item.name) };
}

/**
 * OpenCivitas service quantities come from questionnaires filled in by the
 * Comuni: a jump above rules.volatileServicesPoints in one year is more
 * likely a reporting error than a real change, so the ETL keeps the Comune
 * out of the ranking and the page says why.
 */
export function servicesVolatility(entry: IndexEntry): number | null {
  if (!entry.volatile || entry.services2021 === null || entry.services2022 === null) return null;
  return Math.round(Math.abs(entry.services2022 - entry.services2021));
}

export function rankRange(entry: IndexEntry): string | null {
  if (entry.rankLow === null || entry.rankHigh === null) return null;
  if (entry.rankLow === entry.rankHigh) return `sempre ${entry.rankLow}°`;
  return `tra ${entry.rankLow.toLocaleString("it-IT")}° e ${entry.rankHigh.toLocaleString("it-IT")}°`;
}

export function stabilityLabel(stability: number | null): string {
  if (stability === null) return "";
  if (stability >= 0.95) return "Fascia molto solida";
  if (stability >= 0.8) return "Fascia solida";
  if (stability >= 0.6) return "Fascia incerta";
  return "Fascia fragile";
}

export function statusLabel(status: Status, volatile = false): string {
  if (status === "partial" && volatile) return "Punteggio indicativo: i servizi dichiarati a OpenCivitas cambiano troppo tra il 2021 e il 2022, quindi il Comune non è in classifica";
  if (status === "partial") return "Punteggio parziale: manca almeno un pilastro, quindi il Comune non è in classifica";
  if (status === "special-statute") return "Non valutabile: OpenCivitas non copre le Regioni a statuto speciale";
  if (status === "no-opencivitas") return "Non valutabile: OpenCivitas non pubblica i livelli di spesa e servizi di questo Comune";
  return "In classifica";
}

export const DOT_BIN_WIDTH = 2;
export const DOT_SIZE = 10;

/**
 * Il grafico a punti: una colonna ogni 2 punti di punteggio, ogni punto è un
 * gruppo di al massimo 10 Comuni consecutivi per punteggio. Ogni Comune in
 * classifica sta in esattamente un punto, così cliccando un punto si vedono
 * proprio i Comuni che rappresenta.
 */
export function dotLayout(entries: IndexEntry[], binWidth = DOT_BIN_WIDTH, size = DOT_SIZE): IndexEntry[][][] {
  const columns: IndexEntry[][] = Array.from({ length: Math.ceil(100 / binWidth) }, () => []);
  for (const entry of entries) {
    if (entry.status !== "ranked" || entry.score === null) continue;
    columns[Math.min(columns.length - 1, Math.floor(entry.score / binWidth))].push(entry);
  }
  return columns.map((column) => {
    const sorted = [...column].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const dots: IndexEntry[][] = [];
    for (let index = 0; index < sorted.length; index += size) dots.push(sorted.slice(index, index + size));
    return dots;
  });
}

export function locateDot(layout: IndexEntry[][][], istat: string): { column: number; row: number } | null {
  for (const [column, dots] of layout.entries()) {
    const row = dots.findIndex((members) => members.some((entry) => entry.istat === istat));
    if (row >= 0) return { column, row };
  }
  return null;
}

/** Istogramma dei punteggi in classifica: bins di 2 punti, per il grafico a punti. */
export function distribution(entries: IndexEntry[], binWidth = 2): number[] {
  const bins = Array.from({ length: Math.ceil(100 / binWidth) }, () => 0);
  for (const entry of entries) {
    if (entry.status !== "ranked" || entry.score === null) continue;
    bins[Math.min(bins.length - 1, Math.floor(entry.score / binWidth))] += 1;
  }
  return bins;
}

export type RankingQuery = { region: string | null; size: number | null; band: Band | null; page: number };
export const RANKING_PAGE_SIZE = 50;
export const SIZE_FILTERS = [
  { id: 1, label: "Meno di 1.000 abitanti", min: 0, max: 999 },
  { id: 2, label: "1.000-4.999", min: 1000, max: 4999 },
  { id: 3, label: "5.000-19.999", min: 5000, max: 19999 },
  { id: 4, label: "20.000-99.999", min: 20000, max: 99999 },
  { id: 5, label: "100.000 o più", min: 100000, max: Infinity },
] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parametri da URL: solo valori di elenchi chiusi, il resto viene ignorato. */
export function parseRankingQuery(params: Record<string, string | string[] | undefined>): RankingQuery {
  const region = first(params.regione);
  const size = Number(first(params.dimensione));
  const band = first(params.fascia).toUpperCase();
  const page = Number(first(params.pagina));
  return {
    region: region in REGION_NAME_BY_ISTAT_CODE ? region : null,
    size: SIZE_FILTERS.some((filter) => filter.id === size) ? size : null,
    band: BANDS.includes(band as Band) ? (band as Band) : null,
    page: Number.isSafeInteger(page) && page >= 1 && page <= 200 ? page : 1,
  };
}

export function queryRanking(entries: IndexEntry[], query: RankingQuery) {
  const size = SIZE_FILTERS.find((filter) => filter.id === query.size);
  const matched = entries
    .filter((entry) => entry.status === "ranked")
    .filter((entry) => !query.region || entry.regionCode === query.region)
    .filter((entry) => !size || (entry.population >= size.min && entry.population <= size.max))
    .filter((entry) => !query.band || entry.band === query.band)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const pages = Math.max(1, Math.ceil(matched.length / RANKING_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return { total: matched.length, page, pages, rows: matched.slice((page - 1) * RANKING_PAGE_SIZE, page * RANKING_PAGE_SIZE) };
}

export function regionName(code: string): string {
  return (REGION_NAME_BY_ISTAT_CODE as Record<string, string>)[code] ?? code;
}

export type RegionalRank = { rank: number; total: number };

/**
 * Position among the ranked Comuni of the same region. The national ranking
 * also measures a North-South gap (payment delays, separate collection): the
 * regional position separates "good for where it is" from "good in Italy".
 */
export function regionalRanks(entries: IndexEntry[]): Map<string, RegionalRank> {
  const byRegion = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    if (entry.rank === null || entry.score === null) continue;
    const list = byRegion.get(entry.regionCode) ?? [];
    list.push(entry);
    byRegion.set(entry.regionCode, list);
  }
  const ranks = new Map<string, RegionalRank>();
  for (const list of byRegion.values()) {
    list.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    list.forEach((entry, position) => ranks.set(entry.istat, { rank: position + 1, total: list.length }));
  }
  return ranks;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median band stability for each band among the ranked Comuni. */
export function stabilityByBand(entries: IndexEntry[]): Partial<Record<Band, number>> {
  const result: Partial<Record<Band, number>> = {};
  for (const band of BANDS) {
    const value = median(entries.flatMap((entry) => (entry.rank !== null && entry.band === band && entry.bandStability !== null ? [entry.bandStability] : [])));
    if (value !== null) result[band] = value;
  }
  return result;
}

/**
 * Share of the variance of a value explained by the region (between-region
 * sum of squares over total), among the ranked Comuni: how much of a
 * difference is "where", not "who".
 */
export function regionVarianceShare(entries: IndexEntry[], value: (entry: IndexEntry) => number | null): number | null {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const entry of entries) {
    const current = entry.rank === null ? null : value(entry);
    if (current === null) continue;
    all.push(current);
    const list = groups.get(entry.regionCode) ?? [];
    list.push(current);
    groups.set(entry.regionCode, list);
  }
  if (all.length < 2) return null;
  const mean = all.reduce((sum, item) => sum + item, 0) / all.length;
  const total = all.reduce((sum, item) => sum + (item - mean) ** 2, 0);
  if (total === 0) return null;
  let between = 0;
  for (const list of groups.values()) {
    const groupMean = list.reduce((sum, item) => sum + item, 0) / list.length;
    between += list.length * (groupMean - mean) ** 2;
  }
  return between / total;
}

/** The figure that matters most for each pillar, in one line: the card shows it under the bar. */
export function pillarKeyFact(entry: IndexEntry, pillar: Pillar): string {
  if (pillar === "resa") {
    return entry.services2022 === null || entry.spending2022 === null
      ? "Dati OpenCivitas non disponibili"
      : `Servizi ${points(entry.services2022)}% sulla media, spesa ${points(entry.spending2022)}% sul fabbisogno (2022)`;
  }
  if (pillar === "sovraspesa") {
    if (entry.spending2022 === null || entry.services2022 === null) return "Dati OpenCivitas non disponibili";
    const gap = Math.max(0, entry.spending2022 - Math.max(0, entry.services2022));
    return gap > 0 ? `${pct(Math.round(gap * 10) / 10)} di spesa oltre il fabbisogno non coperta da servizi` : "Nessuna spesa oltre il fabbisogno senza servizi in più";
  }
  if (pillar === "investire") {
    const parts = [
      entry.investmentShare === null ? null : `${pct(entry.investmentShare)} dei pagamenti in investimenti`,
      entry.capitalPerCapita === null ? null : `${integer(Math.round(entry.capitalPerCapita))} € per abitante l'anno`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Pagamenti SIOPE non disponibili";
  }
  if (pillar === "appalti") {
    if (entry.appaltiNeutral) return "Troppo pochi appalti per giudicare: vale 50, la media";
    if (entry.withoutTenderShare !== null && entry.procedures !== null) return `${pct(entry.withoutTenderShare)} del valore senza gara, ${integer(entry.procedures)} procedure nel 2025`;
    if (entry.topSupplierShare !== null) return `Primo fornitore al ${pct(entry.topSupplierShare)} del valore aggiudicato`;
    return "Pochi appalti nel 2025";
  }
  if (pillar === "puntualita") {
    const one = (days: number | null, year: number) => {
      if (days === null) return null;
      const value = integer(Math.round(Math.abs(days)));
      return Math.round(days) > 0 ? `${value} giorni di ritardo (${year})` : Math.round(days) < 0 ? `${value} giorni d'anticipo (${year})` : `puntuale (${year})`;
    };
    return [one(entry.delay2024, 2024), one(entry.delay2025, 2025)].filter(Boolean).join(" · ") || "Tempi di pagamento non disponibili";
  }
  const rd = [[entry.rd2022, 2022], [entry.rd2023, 2023]] as const;
  const parts = rd.filter(([value]) => value !== null).map(([value, year]) => `${pct(Math.round((value as number) * 10) / 10)} (${year})`);
  return parts.length ? `${parts.join(" · ")} · obiettivo 65%` : "Raccolta differenziata non disponibile";
}

export type RegionSummary = {
  code: string;
  comuni: number;
  ranked: number;
  coverage: number;
  populationCoverage: number;
  median: number | null;
  weighted: number | null;
  bandMedian: Band | null;
  bandWeighted: Band | null;
  bands: Record<Band, number>;
  best: { istat: string; name: string; score: number } | null;
  worst: { istat: string; name: string; score: number } | null;
};

function bandForScore(score: number, cutoffs: number[]): Band {
  return BANDS[cutoffs.findIndex((cut) => score >= cut)] ?? "E";
}

/**
 * One row per region: the score of the typical Comune (median, each Comune
 * counts once) and per resident (population-weighted mean, big cities weigh
 * more), with the same band cut-offs as the national ranking.
 */
export function regionSummaries(entries: IndexEntry[], cutoffs: number[]): RegionSummary[] {
  const byRegion = new Map<string, IndexEntry[]>();
  for (const entry of entries) byRegion.set(entry.regionCode, [...(byRegion.get(entry.regionCode) ?? []), entry]);
  return [...byRegion.entries()].map(([code, all]) => {
    const ranked = all.filter((entry): entry is IndexEntry & { score: number } => entry.rank !== null && entry.score !== null);
    const population = (list: IndexEntry[]) => list.reduce((sum, entry) => sum + entry.population, 0);
    const bands = Object.fromEntries(BANDS.map((band) => [band, ranked.filter((entry) => entry.band === band).length])) as Record<Band, number>;
    const medianScore = median(ranked.map((entry) => entry.score));
    const weighted = ranked.length ? ranked.reduce((sum, entry) => sum + entry.score * entry.population, 0) / population(ranked) : null;
    const sorted = [...ranked].sort((a, b) => b.score - a.score);
    const pick = (entry: (typeof ranked)[number] | undefined) => (entry ? { istat: entry.istat, name: entry.name, score: entry.score } : null);
    return {
      code,
      comuni: all.length,
      ranked: ranked.length,
      coverage: all.length ? ranked.length / all.length : 0,
      populationCoverage: population(all) ? population(ranked) / population(all) : 0,
      median: medianScore,
      weighted,
      bandMedian: medianScore === null ? null : bandForScore(medianScore, cutoffs),
      bandWeighted: weighted === null ? null : bandForScore(weighted, cutoffs),
      bands,
      best: pick(sorted[0]),
      worst: pick(sorted.at(-1)),
    };
  });
}
