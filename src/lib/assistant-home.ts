/**
 * Ingresso all'assistente dalla home: la domanda arriva nella chat come bozza
 * (`/assistente?q=...`) e non viene mai inviata da sola. Consenso, quota delle
 * 10 domande gratuite e scelta del provider restano nella pagina della chat, e
 * un link seguito da un crawler non consuma chiamate al modello.
 */

export const HOME_QUESTION_MAX = 300;

/** Domande già supportate dagli strumenti dell'assistente (stessi esempi della chat). */
export const HOME_ASSISTANT_EXAMPLES = [
  "Quanto hanno speso i Comuni nel 2025?",
  "Qual è l’imposta netta dichiarata in Calabria nel 2024?",
  "Quanto ha speso lo Stato nel 2025?",
] as const;

export function assistantHref(question: string): string {
  return `/assistente?${new URLSearchParams({ q: question }).toString()}`;
}

/** Bozza dalla query string: una riga, senza caratteri di controllo, al massimo HOME_QUESTION_MAX caratteri. */
export function assistantPrefill(search: string): string {
  const raw = new URLSearchParams(search).get("q") ?? "";
  return raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, "").replace(/\s+/gu, " ").trim().slice(0, HOME_QUESTION_MAX);
}
