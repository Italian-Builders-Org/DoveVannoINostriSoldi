const FRIENDLY_LABELS: Readonly<Record<string, string>> = {
  "0": "Pagamenti da classificare",
  "1": "Spese correnti",
  "2": "Investimenti e opere",
  "3": "Attività finanziarie",
  "4": "Rimborso di prestiti",
  "5": "Anticipazioni di tesoreria",
  "7": "Partite di giro e conto terzi",
};

const TITLE_EXPLANATIONS: Readonly<Record<string, string>> = {
  "0": "Somme già pagate ma non ancora assegnate alla voce contabile definitiva. Non indicano una destinazione di servizio.",
  "1": "Costi di funzionamento quotidiano: personale, utenze, manutenzioni, acquisti e servizi per i cittadini.",
  "2": "Soldi usati per opere pubbliche, lavori e beni destinati a durare nel tempo, come edifici o attrezzature.",
  "3": "Operazioni finanziarie del Comune: partecipazioni, crediti o altre attività patrimoniali. Non sono servizi quotidiani.",
  "4": "Rate di mutui e prestiti già contratti: restituiscono il capitale, non finanziano nuovi servizi.",
  "5": "Restituzione di anticipazioni temporanee ricevute dal tesoriere. Movimenti di cassa, non nuova spesa per servizi.",
  "7": "Soldi che passano dal Comune per conto di terzi o come partite di giro. Di solito non sono spesa propria del Comune.",
};

const OTHER_EXPLANATION =
  "Somma delle voci minori non mostrate tra le principali. Completa il totale pagato nel periodo.";

export type MunicipalitySpendingRow = Readonly<{
  key: string;
  code: string | null;
  label: string;
  explanation: string;
  amountCents: number;
}>;

export function explainMunicipalitySpendingTitle(code: string): string {
  return TITLE_EXPLANATIONS[code] ?? "Categoria contabile SIOPE pubblicata dalla fonte ufficiale.";
}

export function municipalitySpendingTitleLabel(code: string, fallback: string): string {
  return FRIENDLY_LABELS[code] ?? fallback;
}

export function buildMunicipalitySpendingRows(
  titles: readonly Readonly<{ code: string; label: string; amountCents: number }>[],
  totalCents: number | null,
): readonly MunicipalitySpendingRow[] {
  if (totalCents === null) return [];
  const main = [...titles]
    .filter((title) => title.amountCents > 0)
    .sort((left, right) => right.amountCents - left.amountCents)
    .slice(0, 4)
    .map((title) => ({
      key: title.code,
      code: title.code,
      label: municipalitySpendingTitleLabel(title.code, title.label),
      explanation: explainMunicipalitySpendingTitle(title.code),
      amountCents: title.amountCents,
    }));
  const mainCents = main.reduce((sum, row) => sum + row.amountCents, 0);
  if (mainCents > totalCents) throw new Error("Categorie principali oltre il totale comunale");
  const otherCents = totalCents - mainCents;
  return otherCents > 0
    ? [...main, {
      key: "other",
      code: null,
      label: "Altre categorie",
      explanation: OTHER_EXPLANATION,
      amountCents: otherCents,
    }]
    : main;
}
