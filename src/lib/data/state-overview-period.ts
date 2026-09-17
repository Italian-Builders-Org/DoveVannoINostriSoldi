export const STATE_CONSUNTIVO_YEAR = 2025;
export const STATE_SUPPORTED_YEARS = [STATE_CONSUNTIVO_YEAR] as const;

export type StateOverviewYear = (typeof STATE_SUPPORTED_YEARS)[number];

export type StateOverviewSelection =
  | { kind: "latest" }
  | { kind: "year"; year: StateOverviewYear }
  | { kind: "invalid"; value: string };

function isStateOverviewYear(value: number): value is StateOverviewYear {
  return STATE_SUPPORTED_YEARS.some((year) => year === value);
}

export function parseStateOverviewSelection(
  value: string | string[] | undefined,
): StateOverviewSelection {
  if (value === undefined) return { kind: "latest" };

  const values = Array.isArray(value) ? value : [value];
  if (values.length !== 1) {
    return { kind: "invalid", value: values.join(",") };
  }

  const raw = values[0] ?? "";
  if (!/^20\d{2}$/.test(raw)) return { kind: "invalid", value: raw };

  const year = Number.parseInt(raw, 10);
  if (!isStateOverviewYear(year)) return { kind: "invalid", value: raw };

  return { kind: "year", year };
}
