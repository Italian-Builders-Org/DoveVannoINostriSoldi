/**
 * Distribution of Camera vote participation (#871). Pure and dependency-free:
 * the atlas client recomputes summaries under the family/role/search filters,
 * and the tests load it without the path alias.
 */

export type PresenceGroup = { id: string | null; shortLabel: string; label: string; };

export type PresenceRow = {
  /** The Camera's deputy id when matched, otherwise the official row name. */
  key: string;
  name: string;
  /** Atlas person id (`dep-…`) when the row matches a sitting deputy. */
  personId: string | null;
  /** Group as printed by the Camera for the period, not today's group. */
  group: PresenceGroup;
  presence: number;
  votesPercent: number;
  missionsPercent: number;
  absencesPercent: number;
  /** Atlas role filters the person matches today (`governo`, `presidenza`, `capigruppo`). */
  roles: string[];
  /** Only institutional roles that explain a low turnout (Government, Presidency). */
  roleLabel: string | null;
};

export type PresenceSummary = {
  count: number;
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
};

export type PresenceBin = { from: number; to: number; count: number; };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Linear interpolation between order statistics (R type 7, spreadsheet PERCENTILE). */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) throw new Error("quantile of an empty list");
  if (!(q >= 0 && q <= 1)) throw new Error(`quantile out of range: ${q}`);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower]!;
  return round2(low + (sorted[upper]! - low) * (position - lower));
}

export function summarize(values: readonly number[]): PresenceSummary | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    mean: round2(sum / sorted.length),
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    min: sorted[0]!,
    max: sorted.at(-1)!,
  };
}

/** Fixed bins over 0-100%; the last bin is closed so 100% is not a phantom bin. */
export function histogram(values: readonly number[], width = 5): PresenceBin[] {
  const size = Math.round(100 / width);
  const bins = Array.from({ length: size }, (_, index) => ({ from: index * width, to: Math.min(100, (index + 1) * width), count: 0 }));
  for (const value of values) {
    if (!(value >= 0 && value <= 100)) throw new Error(`percentuale fuori scala: ${value}`);
    bins[Math.min(size - 1, Math.floor(value / width))]!.count += 1;
  }
  return bins;
}

export function parsePresencePercent(value: string): number {
  const match = /^(\d{1,3}(?:\.\d+)?)%$/u.exec(value);
  const parsed = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error(`percentuale non valida: ${value}`);
  return parsed;
}

function fold(value: string): string {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT").replaceAll(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Prefix of the Camera's group label → atlas party family (ids of `partyFamilies`). */
const SOURCE_GROUPS: ReadonlyArray<{ prefix: string; group: PresenceGroup; }> = [
  { prefix: "fratelli d italia", group: { id: "fratelli-italia", shortLabel: "FdI", label: "Fratelli d’Italia" } },
  { prefix: "partito democratico", group: { id: "partito-democratico", shortLabel: "PD", label: "Partito Democratico" } },
  { prefix: "lega", group: { id: "lega", shortLabel: "Lega", label: "Lega" } },
  { prefix: "forza italia", group: { id: "forza-italia", shortLabel: "FI", label: "Forza Italia" } },
  { prefix: "movimento 5 stelle", group: { id: "movimento-5-stelle", shortLabel: "M5S", label: "MoVimento 5 Stelle" } },
  { prefix: "azione", group: { id: "azione", shortLabel: "Az", label: "Azione" } },
  { prefix: "alleanza verdi e sinistra", group: { id: "alleanza-verdi-sinistra", shortLabel: "AVS", label: "Alleanza Verdi e Sinistra" } },
  { prefix: "noi moderati", group: { id: "noi-moderati", shortLabel: "NM", label: "Noi Moderati" } },
  { prefix: "italia viva", group: { id: "italia-viva", shortLabel: "IV", label: "Italia Viva" } },
  // Misto components (Minoranze linguistiche, +Europa…) are one group at the Camera.
  { prefix: "misto", group: { id: "misto", shortLabel: "Misto", label: "Misto" } },
];

export function sourceGroupOf(label: string): PresenceGroup {
  const folded = fold(label);
  const known = SOURCE_GROUPS.find((item) => folded === item.prefix || folded.startsWith(`${item.prefix} `));
  return known ? { ...known.group } : { id: null, shortLabel: label, label };
}

export type PresenceFilter = { family: string | null; role: string; query: string; };

/**
 * The atlas filters applied to the table rows. `family` is the group printed by
 * the Camera for the period; roles come from the current atlas profile, so an
 * unmatched row only survives the "tutti" role.
 */
export function filterPresenceRows(rows: readonly PresenceRow[], filter: PresenceFilter): PresenceRow[] {
  const tokens = fold(filter.query).split(" ").filter(Boolean);
  return rows.filter((row) => {
    if (filter.family && row.group.id !== filter.family) return false;
    if (filter.role !== "tutti" && !row.roles.includes(filter.role)) return false;
    if (!tokens.length) return true;
    const text = fold(`${row.name} ${row.group.label} ${row.group.shortLabel} ${row.roleLabel ?? ""}`);
    return tokens.every((token) => text.includes(token));
  });
}

/** Rows at or below the 10th percentile, lowest presence first. */
export function tailRows(rows: readonly PresenceRow[]): PresenceRow[] {
  const summary = summarize(rows.map((row) => row.presence));
  if (!summary) return [];
  return rows.filter((row) => row.presence <= summary.p10)
    .sort((a, b) => a.presence - b.presence || a.name.localeCompare(b.name, "it"));
}
