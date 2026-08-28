/**
 * Codifica del piano di riallocazione nella query string, per condividere lo
 * scenario con un link. Le missioni sono referenziate per indice sull'elenco
 * ordinato alfabeticamente, così il codice resta stabile fra i deploy.
 */

const SLIDER_LIMIT = 50;

export function orderedMissionList(missions: readonly string[]): string[] {
  return [...missions].sort((left, right) => left.localeCompare(right, "it"));
}

export function encodePiano(
  scenario: Record<string, number>,
  ordered: readonly string[],
): string {
  return Object.entries(scenario)
    .map(([mission, pct]) => {
      const index = ordered.indexOf(mission);
      return index < 0 || pct === 0 ? null : `${index}:${pct}`;
    })
    .filter((part): part is string => part !== null)
    .sort()
    .join(",");
}

export function decodePiano(
  raw: string | string[] | undefined,
  ordered: readonly string[],
): Record<string, number> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return {};

  const scenario: Record<string, number> = {};
  for (const part of value.split(",")) {
    const [rawIndex, rawPct] = part.split(":");
    const index = Number(rawIndex);
    const pct = Number(rawPct);
    if (
      Number.isInteger(index) &&
      ordered[index] &&
      Number.isFinite(pct) &&
      pct !== 0
    ) {
      scenario[ordered[index]] = Math.max(
        -SLIDER_LIMIT,
        Math.min(SLIDER_LIMIT, Math.round(pct)),
      );
    }
  }
  return scenario;
}
