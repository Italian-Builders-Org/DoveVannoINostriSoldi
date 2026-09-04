/**
 * Number and date formatting shared by every page.
 *
 * The site shows the same figure in two registers: a compact headline people
 * can hold in their head ("70,94 mld €") and the exact value underneath, so a
 * reader can always reconcile what we print with the source file.
 */

/*
 * Italian CLDR sets minimumGroupingDigits to 2, so four-digit numbers come out
 * as "7893" and "1203,55". Public-finance documents always group thousands and
 * so does the design, so grouping is forced on everywhere.
 */
const euroFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
  useGrouping: "always",
});

const integerFormatter = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

const billionsFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
});
const millionsFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: "always",
});
const percentFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const longDateFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Rome",
});
const shortDateFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Rome",
});

export function exactEuro(value: number): string {
  return euroFormatter.format(value);
}

export function integer(value: number): string {
  return integerFormatter.format(value);
}

export function compactEuro(value: number): string {
  return compactEuroLike(value, value);
}

/** Formats an integer-cent source value without changing its measurement unit. */
export function compactEuroFromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("L'importo in centesimi deve essere un intero sicuro");
  }
  return compactEuro(cents / 100);
}

/**
 * Formats a value in the unit that suits `reference`.
 *
 * A ranked column that switches from "mld" to "mln" halfway down forces the
 * reader to re-scale every row, so a table picks one unit from its largest
 * figure and keeps it for all of them.
 */
export function compactEuroLike(value: number, reference: number): string {
  const scale = Math.abs(reference);
  if (scale >= 1_000_000_000) {
    return `${billionsFormatter.format(value / 1_000_000_000)} mld €`;
  }
  if (scale >= 1_000_000) {
    return `${millionsFormatter.format(value / 1_000_000)} mln €`;
  }
  return euroFormatter.format(value);
}

export function billions(value: number): string {
  return billionsFormatter.format(value / 1_000_000_000);
}

export function percent(value: number, digits = 1): string {
  if (digits === 1) return `${percentFormatter.format(value)}%`;
  return `${value.toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function longDate(value: string | null | undefined): string {
  if (!value) return "non disponibile";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "non disponibile";
  return longDateFormatter.format(parsed);
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "non disponibile";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "non disponibile";
  return shortDateFormatter.format(parsed);
}
