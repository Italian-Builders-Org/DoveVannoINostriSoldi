import type { GiudiziarioOutcome } from "@/lib/data/parlamento-giudiziario-contract";

export const OUTCOME_LABELS: Record<GiudiziarioOutcome, string> = {
  condannato: "Condanna penale",
  contabile: "Condanna della Corte dei conti",
  non_condannato: "Procedimento chiuso senza condanna",
  esito_ignoto: "Esito non documentato",
};

/**
 * The institutional map keys people as `dep-<numero>` and `sen-<id>`, while the
 * judicial dataset keys them as the chambers do (`d<numero>_19`, `s<id>`).
 */
export function graphPersonId(memberId: string): string | null {
  const camera = /^d(\d+)_19$/u.exec(memberId);
  if (camera) {
    return `dep-${camera[1]}`;
  }
  return /^s\d+$/u.test(memberId) ? `sen-${memberId}` : null;
}

export function formatSentenceMonths(months: number | null): string | null {
  if (months === null) {
    return null;
  }
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = Math.round((months - years * 12) * 10) / 10;
    const yearLabel = years === 1 ? "1 anno" : `${years} anni`;
    if (rest === 0) {
      return yearLabel;
    }
    // Sentences written as years plus days arrive as a fraction of a month: say
    // "circa" rather than pretending to a precision the sources do not give.
    if (rest < 1) {
      return `${yearLabel} e circa ${Math.round(rest * 30)} giorni`;
    }
    return `${yearLabel} e ${rest} mesi`;
  }
  return months === 1 ? "1 mese" : `${Math.round(months * 10) / 10} mesi`;
}

export function formatEuroCents(cents: number | null): string | null {
  if (cents === null) {
    return null;
  }
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}
