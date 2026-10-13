/** Intestazione prima colonna tabella tile: periodo temporale vs voce/territorio. */
export function tableRowAxisLabel(points: readonly { label: string }[]): string {
  if (points.length === 0) return "Voce";
  const sample = points.slice(0, Math.min(12, points.length));
  let periodLike = 0;
  for (const point of sample) {
    const label = point.label.trim();
    if (
      /^\d{4}$/u.test(label)
      || /^\d{4}[-/]\d{1,2}/u.test(label)
      || /^(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\b/iu.test(label)
      || /^anno\s+\d{4}/iu.test(label)
    ) {
      periodLike += 1;
    }
  }
  if (periodLike >= Math.ceil(sample.length * 0.6)) return "Periodo";
  return "Voce";
}
