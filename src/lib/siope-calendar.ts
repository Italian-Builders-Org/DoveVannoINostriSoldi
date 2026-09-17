/**
 * When a SIOPE year is still filling up.
 *
 * SIOPE republishes the running month as payments land, so the newest month of
 * the year in progress is always partial. A year downloaded after it ended is
 * closed: every one of its months is final, December included.
 *
 * Getting this wrong is not cosmetic — it makes a closed year read as still
 * growing and silently drops December out of every "completed months" average.
 *
 * Kept free of imports so the rule can be unit-tested on its own.
 */
export function partialMonthOf(
  year: number,
  latestMonth: number,
  observedAt: string,
): number | null {
  const observed = new Date(observedAt);
  // An unreadable observation date is not a licence to call a month final.
  if (Number.isNaN(observed.getTime())) return latestMonth;
  return observed.getUTCFullYear() === year ? latestMonth : null;
}
