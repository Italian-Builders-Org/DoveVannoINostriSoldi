export type ReferencePeriod = {
  year?: number;
  month?: number;
};

export type ReferencePeriodResult =
  | { ok: true; value: ReferencePeriod }
  | { ok: false; error: string };

function integer(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : null;
}

export function parseReferencePeriod(
  searchParams: URLSearchParams,
  currentYear = new Date().getUTCFullYear(),
): ReferencePeriodResult {
  const rawYear = searchParams.get("anno");
  const rawMonth = searchParams.get("mese");

  if (rawYear === null && rawMonth === null) return { ok: true, value: {} };
  if (rawYear === null) {
    return { ok: false, error: "Per scegliere il mese devi indicare anche l'anno." };
  }

  const year = integer(rawYear);
  if (year === null || year < 2000 || year > currentYear + 1) {
    return { ok: false, error: "L'anno richiesto non è valido." };
  }

  if (rawMonth === null) return { ok: true, value: { year } };
  const month = integer(rawMonth);
  if (month === null || month < 1 || month > 12) {
    return { ok: false, error: "Il mese deve essere un numero da 1 a 12." };
  }

  return { ok: true, value: { year, month } };
}
