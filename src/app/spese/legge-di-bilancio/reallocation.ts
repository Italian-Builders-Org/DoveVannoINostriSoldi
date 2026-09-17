/**
 * Logica pura del piano di riallocazione: saldo, verso delle voci toccate e
 * "verdetto" sintetico. Isolata qui perché la usano sia il treemap
 * (`MissionPicker`) sia il resto della pagina (`SimulatoreClient`, HUD, share
 * card) ed è l'unico pezzo con test unitari.
 */

export type MissionSummary = {
  mission: string;
  latestAmountEur: number;
  /** Variazione reale anno su anno del dato pubblicato, se calcolabile. */
  realDeltaPct: number | null;
};

export type PlanEntry = {
  mission: string;
  pct: number;
  realDeltaPct: number | null;
  observed: number;
  effective: number;
  diff: number;
};

export type Plan = {
  entries: PlanEntry[];
  observedTotal: number;
  effectiveTotal: number;
  net: number;
  netPct: number;
  increasesTotal: number;
  cutsTotal: number;
  increasesCount: number;
  cutsCount: number;
};

/**
 * Missioni sotto questa quota dello stanziamento dell'ultimo anno restano fuori
 * dal treemap (diventerebbero riquadri di pochi pixel) e vanno nella striscia di
 * chip. La soglia è ancorata al dato osservato, così un riquadro non salta
 * nell'elenco quando lo ridimensioni.
 */
export const MAJOR_SHARE_THRESHOLD = 0.007;

/** Etichette brevi per la tassonomia RGS delle missioni (nomi stabili dal 2017). */
export const SHORT_LABELS: Readonly<Record<string, string>> = {
  "Agricoltura, politiche agroalimentari e pesca": "Agricoltura e pesca",
  "Amministrazione generale e supporto alla rappresentanza generale di Governo e dello Stato sul territorio":
    "Amministrazione generale",
  "Casa e assetto urbanistico": "Casa e urbanistica",
  "Commercio internazionale ed internazionalizzazione del sistema produttivo": "Commercio internazionale",
  "Competitivita' e sviluppo delle imprese": "Sviluppo delle imprese",
  "Comunicazioni": "Comunicazioni",
  "Debito pubblico": "Debito pubblico",
  "Difesa e sicurezza del territorio": "Difesa",
  "Diritti sociali, politiche sociali e famiglia": "Diritti sociali e famiglia",
  "Diritto alla mobilita' e sviluppo dei sistemi di trasporto": "Mobilità e trasporti",
  "Energia e diversificazione delle fonti energetiche": "Energia",
  "Fondi da ripartire": "Fondi da ripartire",
  "Giovani e sport": "Giovani e sport",
  "Giustizia": "Giustizia",
  "Immigrazione, accoglienza e garanzia dei diritti": "Immigrazione e accoglienza",
  "Infrastrutture pubbliche e logistica": "Infrastrutture e logistica",
  "Istruzione scolastica": "Istruzione scolastica",
  "Istruzione universitaria e formazione post-universitaria": "Università e ricerca",
  "L'Italia in Europa e nel mondo": "Italia in Europa e nel mondo",
  "Ordine pubblico e sicurezza": "Ordine pubblico e sicurezza",
  "Organi costituzionali, a rilevanza costituzionale e Presidenza del Consiglio dei ministri":
    "Organi costituzionali e PCM",
  "Politiche economico-finanziarie e di bilancio e tutela della finanza pubblica":
    "Politiche economiche e bilancio",
  "Politiche per il lavoro": "Lavoro",
  "Politiche previdenziali": "Previdenza",
  "Regolazione dei mercati": "Regolazione dei mercati",
  "Relazioni finanziarie con le autonomie territoriali": "Finanza delle autonomie",
  "Ricerca e innovazione": "Ricerca e innovazione",
  "Servizi istituzionali e generali delle amministrazioni pubbliche": "Servizi istituzionali PA",
  "Soccorso civile": "Soccorso civile",
  "Sviluppo e riequilibrio territoriale": "Sviluppo territoriale",
  "Sviluppo sostenibile e tutela del territorio e dell'ambiente": "Ambiente e territorio",
  "Turismo": "Turismo",
  "Tutela della salute": "Salute",
  "Tutela e valorizzazione dei beni e attivita' culturali e paesaggistici": "Cultura e paesaggio",
};

export function shortLabel(mission: string): string {
  return SHORT_LABELS[mission] ?? mission;
}

/** Contesto per le missioni che un lettore rischia di interpretare male. */
export const MISSION_NOTES: Readonly<Record<string, string>> = {
  "Debito pubblico":
    "Quasi tutto interessi e rimborso di titoli in scadenza: l'importo non dipende dalle scelte di policy dell'anno.",
  "Fondi da ripartire":
    "Risorse stanziate ma non ancora assegnate a una missione specifica.",
  "Politiche previdenziali":
    "Pensioni già maturate: la spesa è in larga parte incomprimibile nel breve periodo.",
  "Relazioni finanziarie con le autonomie territoriali":
    "Trasferimenti dello Stato a Regioni ed enti locali, non spesa diretta dei ministeri.",
  "Politiche economico-finanziarie e di bilancio e tutela della finanza pubblica":
    "Include poste tecniche e regolazioni contabili, non solo spesa discrezionale.",
  "L'Italia in Europa e nel mondo":
    "Comprende i contributi al bilancio dell'Unione europea e alle organizzazioni internazionali.",
};

export type CategoryId = "sociale" | "sicurezza" | "sviluppo" | "ambiente" | "stato";

export const CATEGORY_LABEL: Readonly<Record<CategoryId, string>> = {
  sociale: "spesa sociale",
  sicurezza: "difesa e sicurezza",
  sviluppo: "sviluppo e infrastrutture",
  ambiente: "ambiente e cultura",
  stato: "conti pubblici e amministrazione",
};

export const MISSION_CATEGORY: Readonly<Record<string, CategoryId>> = {
  "Tutela della salute": "sociale",
  "Istruzione scolastica": "sociale",
  "Istruzione universitaria e formazione post-universitaria": "sociale",
  "Diritti sociali, politiche sociali e famiglia": "sociale",
  "Politiche previdenziali": "sociale",
  "Politiche per il lavoro": "sociale",
  "Giovani e sport": "sociale",
  "Immigrazione, accoglienza e garanzia dei diritti": "sociale",

  "Difesa e sicurezza del territorio": "sicurezza",
  "Ordine pubblico e sicurezza": "sicurezza",
  "Giustizia": "sicurezza",
  "Soccorso civile": "sicurezza",

  "Competitivita' e sviluppo delle imprese": "sviluppo",
  "Ricerca e innovazione": "sviluppo",
  "Regolazione dei mercati": "sviluppo",
  "Commercio internazionale ed internazionalizzazione del sistema produttivo": "sviluppo",
  "Comunicazioni": "sviluppo",
  "Turismo": "sviluppo",
  "Agricoltura, politiche agroalimentari e pesca": "sviluppo",
  "Energia e diversificazione delle fonti energetiche": "sviluppo",
  "Diritto alla mobilita' e sviluppo dei sistemi di trasporto": "sviluppo",
  "Infrastrutture pubbliche e logistica": "sviluppo",
  "Sviluppo e riequilibrio territoriale": "sviluppo",

  "Sviluppo sostenibile e tutela del territorio e dell'ambiente": "ambiente",
  "Casa e assetto urbanistico": "ambiente",
  "Tutela e valorizzazione dei beni e attivita' culturali e paesaggistici": "ambiente",

  "Debito pubblico": "stato",
  "Fondi da ripartire": "stato",
  "Politiche economico-finanziarie e di bilancio e tutela della finanza pubblica": "stato",
  "Relazioni finanziarie con le autonomie territoriali": "stato",
  "Servizi istituzionali e generali delle amministrazioni pubbliche": "stato",
  "Amministrazione generale e supporto alla rappresentanza generale di Governo e dello Stato sul territorio":
    "stato",
  "Organi costituzionali, a rilevanza costituzionale e Presidenza del Consiglio dei ministri": "stato",
  "L'Italia in Europa e nel mondo": "stato",
};

function categoryOf(mission: string): CategoryId {
  return MISSION_CATEGORY[mission] ?? "stato";
}

export function scenarioPctOf(map: Record<string, number>, mission: string): number {
  return map[mission] ?? 0;
}

/** Verde quando la voce cresce, rosso quando cala, neutro se invariata. */
export function toneColor(value: number): string {
  if (value > 0) return "var(--color-positive)";
  if (value < 0) return "var(--color-critical)";
  return "var(--color-neutral-500)";
}

/**
 * Colore del saldo netto della manovra: qui la logica è rovesciata rispetto a
 * `toneColor`. Saldo positivo = si spende di più → rosso; saldo ≤ 0 = si
 * risparmia → verde.
 */
export function netToneColor(net: number): string {
  return net > 0 ? "var(--color-critical)" : "var(--color-positive)";
}

export function clampPct(value: number): number {
  return Math.max(-50, Math.min(50, Math.round(value)));
}

export function effectiveAmount(item: MissionSummary, map: Record<string, number>): number {
  return item.latestAmountEur * (1 + scenarioPctOf(map, item.mission) / 100);
}

export function computePlan(
  summaries: readonly MissionSummary[],
  scenarioByMission: Record<string, number>,
): Plan {
  const observedTotal = summaries.reduce((acc, item) => acc + item.latestAmountEur, 0);
  const effectiveTotal = summaries.reduce(
    (acc, item) => acc + effectiveAmount(item, scenarioByMission),
    0,
  );
  const entries: PlanEntry[] = summaries
    .filter(
      (item) => scenarioPctOf(scenarioByMission, item.mission) !== 0 && item.latestAmountEur > 0,
    )
    .map((item) => {
      const observed = item.latestAmountEur;
      const effective = effectiveAmount(item, scenarioByMission);
      return {
        mission: item.mission,
        pct: scenarioPctOf(scenarioByMission, item.mission),
        realDeltaPct: item.realDeltaPct,
        observed,
        effective,
        diff: effective - observed,
      };
    })
    .sort((left, right) => Math.abs(right.diff) - Math.abs(left.diff));

  const increases = entries.filter((entry) => entry.diff > 0);
  const cuts = entries.filter((entry) => entry.diff < 0);
  const net = effectiveTotal - observedTotal;

  return {
    entries,
    observedTotal,
    effectiveTotal,
    net,
    netPct: observedTotal > 0 ? (net / observedTotal) * 100 : 0,
    increasesTotal: increases.reduce((acc, entry) => acc + entry.diff, 0),
    cutsTotal: cuts.reduce((acc, entry) => acc + entry.diff, 0), // ≤ 0
    increasesCount: increases.length,
    cutsCount: cuts.length,
  };
}

export type Verdict = {
  headline: string;
  detail: string | null;
};

function signedBillions(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const num =
    abs >= 1_000_000_000
      ? `${(abs / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} Mld €`
      : `${(abs / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} Mln €`;
  return `${sign}${num}`;
}

function signedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Riga di sintesi ("impronta") dello scenario, descrittiva e senza giudizi. */
export function computeVerdict(
  plan: Plan,
  summaries: readonly MissionSummary[],
  scenarioByMission: Record<string, number>,
): Verdict {
  if (plan.entries.length === 0) {
    return { headline: "Nessuna modifica: sei sul dato pubblicato", detail: null };
  }

  const byCategory = new Map<CategoryId, number>();
  for (const item of summaries) {
    const pct = scenarioPctOf(scenarioByMission, item.mission);
    if (pct === 0 || item.latestAmountEur <= 0) continue;
    const category = categoryOf(item.mission);
    byCategory.set(category, (byCategory.get(category) ?? 0) + item.latestAmountEur * (pct / 100));
  }
  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const catUp = ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : null;
  const last = ranked.at(-1);
  const catDown = last && last[1] < 0 ? last[0] : null;

  const n = plan.entries.length;
  let headline: string;
  if (
    Math.abs(plan.netPct) < 0.25 &&
    plan.increasesCount > 0 &&
    plan.cutsCount > 0 &&
    catUp &&
    catDown
  ) {
    headline = `Manovra in pareggio · più ${CATEGORY_LABEL[catUp]}, meno ${CATEGORY_LABEL[catDown]}`;
  } else if (plan.netPct <= -1 && plan.cutsCount >= 3) {
    headline = "La tua impronta: rigore di bilancio";
  } else if (catUp) {
    headline = `La tua impronta: più ${CATEGORY_LABEL[catUp]}`;
  } else {
    headline = `La tua proposta: ${n} ${
      n === 1 ? "voce ritoccata" : "voci ritoccate"
    } · saldo ${signedPct(plan.netPct)}`;
  }

  let detail: string | null = null;
  if (catUp) {
    let realDelta = 0;
    for (const item of summaries) {
      if (categoryOf(item.mission) !== catUp) continue;
      if (item.realDeltaPct === null || item.latestAmountEur <= 0) continue;
      const prior = item.latestAmountEur / (1 + item.realDeltaPct / 100);
      realDelta += item.latestAmountEur - prior;
    }
    const yourDelta = byCategory.get(catUp) ?? 0;
    // Solo se entrambe le cifre sono abbastanza grandi da non arrotondarsi a zero.
    if (Math.abs(realDelta) >= 500_000_000 && Math.abs(yourDelta) >= 500_000_000) {
      detail = `Sul ${CATEGORY_LABEL[catUp]}: lo stanziamento pubblicato ${signedBillions(
        realDelta,
      )}, la tua ${signedBillions(yourDelta)}`;
    }
  }

  return { headline, detail };
}
