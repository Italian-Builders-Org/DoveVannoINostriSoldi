import type { AssistantAnswer, AssistantComparison } from "@/lib/assistant/contracts";

/** Compare published annual aggregates, never a reconstructed constant cohort. */
export function compareSiopeAnswers(
  answers: readonly [AssistantAnswer, AssistantAnswer],
): AssistantComparison {
  const [before, after] = answers;
  if (answers.some((answer) => answer.dataset !== "siope_comuni") ||
      before.observation.scope !== after.observation.scope ||
      before.period.year >= after.period.year) {
    throw new Error("Confronto SIOPE: territorio o anni incoerenti");
  }
  const caveats = [
    "Confronto degli aggregati pubblicati per ciascun anno, non di un insieme costante di Comuni: enti con movimenti e abbinamenti territoriali possono cambiare.",
    "Importi nominali, non corretti per l’inflazione. La variazione non misura efficienza, qualità dei servizi o cause politiche.",
  ];
  const complete = answers.every((answer) =>
    answer.period.month === 12 && new Date(answer.source.observedAt).getUTCFullYear() > answer.period.year,
  );
  if (!complete) {
    return {
      answers,
      change: null,
      caveats: ["Variazione non calcolata: servono due anni completi. I valori restano separati con il periodo effettivamente disponibile; non annualizzo dati parziali.", ...caveats],
    };
  }
  const beforeCents = Math.round(before.observation.value * 100);
  const afterCents = Math.round(after.observation.value * 100);
  const deltaCents = afterCents - beforeCents;
  if (![beforeCents, afterCents, deltaCents].every(Number.isSafeInteger)) {
    throw new Error("Confronto SIOPE: importi fuori intervallo");
  }
  return {
    answers,
    change: { euro: deltaCents / 100, percent: beforeCents === 0 ? null : deltaCents / beforeCents * 100 },
    caveats: beforeCents === 0
      ? ["Variazione percentuale non calcolabile: il valore dell’anno iniziale è zero.", ...caveats]
      : caveats,
  };
}
