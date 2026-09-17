/**
 * Clear names for public expenditure titles.
 *
 * Official files use accounting Italian. The UI keeps the meaning intact and
 * explains each title in plain, professional language.
 */

export type SpendingScope = "comune" | "regione";

export type SiopeTitleCopy = {
  /** Clear name shown as the heading. */
  name: string;
  /** Official accounting term. */
  official: string;
  /** One sentence on what the title covers. */
  explanation: string;
};

type TitleEntry = {
  name: string;
  official: string;
  explanation: Record<SpendingScope, string>;
};

const fallback: SiopeTitleCopy = {
  name: "Altra uscita",
  official: "titolo non mappato",
  explanation: "Voce presente nella fonte, ancora senza descrizione operativa.",
};

const byCode: Record<string, TitleEntry> = {
  "1": {
    name: "Spese correnti",
    official: "spese correnti",
    explanation: {
      comune:
        "Funzionamento ordinario: personale, servizi e attività che tengono aperto il Comune.",
      regione:
        "Funzionamento ordinario: personale, servizi e attività correnti della Regione.",
    },
  },
  "2": {
    name: "Investimenti in opere",
    official: "conto capitale",
    explanation: {
      comune: "Spese in conto capitale: infrastrutture, edifici e impianti.",
      regione: "Spese in conto capitale: infrastrutture, edifici e impianti sul territorio.",
    },
  },
  "3": {
    name: "Investimenti finanziari",
    official: "attività finanziarie",
    explanation: {
      comune: "Acquisizione di partecipazioni e altre attività finanziarie.",
      regione: "Acquisizione di partecipazioni e altre attività finanziarie.",
    },
  },
  "4": {
    name: "Rimborso di prestiti",
    official: "rimborso prestiti",
    explanation: {
      comune: "Rimborso di mutui e altri finanziamenti già contratti.",
      regione: "Rimborso di mutui e altri finanziamenti già contratti.",
    },
  },
  "5": {
    name: "Chiusura anticipazioni",
    official: "chiusura anticipazioni",
    explanation: {
      comune: "Restituzione di anticipazioni di tesoreria ricevute dall'istituto cassiere.",
      regione: "Restituzione di anticipazioni di tesoreria ricevute dall'istituto cassiere.",
    },
  },
  "7": {
    name: "Partite di giro",
    official: "uscite per conto terzi",
    explanation: {
      comune:
        "Uscite per conto terzi: importi gestiti e riversati ad altri soggetti.",
      regione:
        "Uscite per conto terzi: importi gestiti e riversati ad altri soggetti.",
    },
  },
  "0": {
    name: "Da classificare",
    official: "da regolarizzare",
    explanation: {
      comune: "Pagamenti registrati e non ancora assegnati a un titolo.",
      regione: "Importi registrati e non ancora assegnati a un titolo.",
    },
  },
};

/** Title 7 is money managed for third parties, not own-service spending. */
export const PASS_THROUGH_TITLE_CODE = "7";

export function siopeTitleCopy(
  code: string,
  scope: SpendingScope = "comune",
): SiopeTitleCopy {
  const entry = byCode[code];
  if (!entry) return fallback;
  return {
    name: entry.name,
    official: entry.official,
    explanation: entry.explanation[scope],
  };
}

/**
 * Seven slices is more than a thumbnail chart can carry, so the home page
 * groups the tail into five buckets.
 */
export const HOME_SPENDING_BUCKETS: { name: string; shortName: string; explanation: string; codes: string[] }[] = [
  {
    name: "Spese correnti",
    shortName: "Spese correnti",
    explanation: "Funzionamento ordinario: personale, servizi, attività quotidiane.",
    codes: ["1"],
  },
  {
    name: "Investimenti in opere",
    shortName: "Investimenti",
    explanation: "Conto capitale: infrastrutture, edifici, impianti.",
    codes: ["2"],
  },
  {
    name: "Partite di giro",
    shortName: "Partite di giro",
    explanation: "Uscite per conto terzi, riversate ad altri soggetti.",
    codes: ["7"],
  },
  {
    name: "Prestiti e anticipazioni",
    shortName: "Prestiti",
    explanation: "Rimborso di mutui e chiusura di anticipazioni di tesoreria.",
    codes: ["5", "4"],
  },
  {
    name: "Altre uscite",
    shortName: "Altre uscite",
    explanation: "Voci da classificare e investimenti finanziari.",
    codes: ["0", "3"],
  },
];
