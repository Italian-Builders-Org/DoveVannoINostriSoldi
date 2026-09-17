/**
 * Derivazioni pubbliche, senza I/O, della scheda operatore ANAC.
 *
 * Regole:
 * - il link alla fonte esiste solo se il CIG ha la forma pubblicata in fonte;
 * - il numero di stazioni appaltanti distinte è esatto finché l'elenco non è
 *   troncato dal tetto dell'indice, poi diventa un minimo dichiarato;
 * - la classificazione "sotto soglia" non è derivabile dai campi pubblicati,
 *   quindi resta dichiarata "non disponibile" con l'elenco di ciò che manca.
 */

/** Dashboard ufficiale ANAC di dettaglio CIG, già usata dalle schede ente. */
export const ANAC_CIG_DETAIL_URL =
  "https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=";

/** Tetto dell'indice pubblico per l'elenco stazioni appaltanti di un operatore. */
export const OPERATOR_AUTHORITY_LIST_CAP = 5;

export const OPERATOR_THRESHOLD_METHODOLOGY_URL =
  "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/blob/main/docs/ANAC_OPERATOR_THRESHOLD.md";

/**
 * Campi che una classificazione "sotto soglia" richiederebbe riga per riga.
 * La soglia applicabile dipende da periodo, categoria e settore: non è una
 * cifra unica e non è deducibile dai campi pubblicati in questa scheda.
 */
export const BELOW_THRESHOLD_REQUIRED_INPUTS = [
  "valore stimato a base di gara, non l'importo di aggiudicazione pubblicato",
  "categoria del contratto: lavori, servizi o forniture",
  "settore: ordinario o speciale",
  "tipo di procedura dichiarato in fonte",
  "soglia applicabile al periodo e al settore della gara",
] as const;

/** Stato pubblicato, invariato finché l'indice non contiene gli input richiesti. */
export const BELOW_THRESHOLD_STATUS = "non disponibile";

const CIG_PATTERN = /^[A-Z0-9]{10}$/;

export type AnacOperatorAwardProcedureFields = Readonly<{
  oggetto: string | null;
  cpvCode: string | null;
  cpvLabel: string | null;
  contractingAuthority: string | null;
  cigYear: number | null;
  matched: boolean;
}>;

/**
 * URL ufficiale di dettaglio CIG, oppure `null` se il codice non ha la forma
 * pubblicata in fonte. Meglio nessun link che un link a un CIG non verificato.
 */
export function anacCigDetailUrl(cig: string | null | undefined): string | null {
  if (typeof cig !== "string" || !CIG_PATTERN.test(cig)) return null;
  return `${ANAC_CIG_DETAIL_URL}${encodeURIComponent(cig)}`;
}

export type DistinctContractingAuthorities = Readonly<{
  /** Numero di stazioni distinte osservate; minimo quando `capped` è true. */
  count: number;
  /** True quando l'indice pubblica solo le prime voci e il numero è un minimo. */
  capped: boolean;
}>;

/**
 * Stazioni appaltanti distinte nell'elenco pubblicato per un operatore.
 * L'indice pubblica al massimo {@link OPERATOR_AUTHORITY_LIST_CAP} voci: oltre
 * quel tetto il conteggio diventa un minimo, mai una stima.
 */
export function distinctContractingAuthorities(
  authorities: readonly Readonly<{ label: string }>[] | undefined,
): DistinctContractingAuthorities {
  const labels = new Set<string>();
  for (const item of authorities ?? []) {
    const label = item.label.trim();
    if (label) labels.add(label);
  }
  if (labels.size >= OPERATOR_AUTHORITY_LIST_CAP) {
    return { count: OPERATOR_AUTHORITY_LIST_CAP, capped: true };
  }
  return { count: labels.size, capped: false };
}

/** Etichetta leggibile e non ambigua del conteggio stazioni. */
export function describeDistinctContractingAuthorities(
  value: DistinctContractingAuthorities,
): string {
  if (value.count === 0) return "nessuna stazione appaltante abbinata";
  if (value.capped) return `${value.count} o più stazioni appaltanti distinte`;
  return value.count === 1
    ? "1 stazione appaltante distinta"
    : `${value.count} stazioni appaltanti distinte`;
}

/**
 * Campi di procedura pubblicati per un affidamento, oppure `null` quando il CIG
 * non è abbinato agli snapshot CIG annuali: la scheda non mostra un dettaglio
 * che non esiste in fonte.
 */
export function publishedProcedureFields(
  procedure: AnacOperatorAwardProcedureFields | undefined,
): AnacOperatorAwardProcedureFields | null {
  if (!procedure || !procedure.matched) return null;
  return procedure;
}
